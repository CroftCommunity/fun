//! Browser binding over [`cribbage_core`] + [`cribbage_solver`] — raw C-ABI +
//! serde-JSON, no `wasm-bindgen` (the `furrow-wasm` pattern).
//!
//! The module holds **one** game: the human in seat A, the engine in seat B,
//! the seed deciding who deals first. What is different from every other
//! binding on the shelf follows from the game having hidden information:
//!
//! - **There is no state export.** [`view_json`] returns the **human's**
//!   `View` — its own cards, the table, the count, and at the show each hand as
//!   it comes face up. The engine's hand, its throws, and the cut before the
//!   discards are not in any buffer this module writes. That is the binding's
//!   half of "never peeks": the UI could not show the engine's hand even by
//!   accident, because it is never handed one.
//! - **The engine reasons over its own view.** [`live_move`] builds seat B's
//!   `View` and calls the solver, which by its own type-level rule takes nothing
//!   else.
//! - **Counting is a move.** [`auto_claim`] is the exact claim for the hand on
//!   the table, for automatic counting; manual counting submits `32 + n`
//!   through [`play`] like any other code.
//!
//! **Never panics** (a wasm panic aborts the module): every fallible path maps
//! to a status code or an empty / `"null"` buffer.

#![warn(missing_docs)]

use cribbage_core::game::{apply, legal_moves, GameState, Move, Phase, Scored, Seat, ShowStep};
use cribbage_core::score::score_hand;
use cribbage_core::{state_hash, Card, Cribbage, View};
use cribbage_solver::{assess, coach_line, live_move as solver_move, CribTable, Level};
use pond_outcome::{attest, Outcome};
use rand_chacha::rand_core::SeedableRng;
use rand_chacha::ChaCha20Rng;
use serde::Serialize;

/// Returned by [`live_move`] / [`auto_claim`] when there is no move to offer.
const MOVE_OVER: u32 = 0xFFFF_FFFF;

/// The human's seat. The engine takes the other.
const HUMAN: Seat = Seat::A;

struct Session {
    seed: u64,
    state: GameState,
    moves: Vec<Move>,
    rng: ChaCha20Rng,
    table: CribTable,
    assisted: bool,
}

static mut STATE: Option<Session> = None;
static mut OUT: Vec<u8> = Vec::new();

fn session_mut() -> Option<&'static mut Session> {
    // SAFETY: single-threaded wasm; host calls are sequential.
    unsafe { (*core::ptr::addr_of_mut!(STATE)).as_mut() }
}

fn set_out(bytes: Vec<u8>) -> *const u8 {
    // SAFETY: single-threaded; the host reads OUT (ptr + out_len) between calls.
    unsafe {
        let p = core::ptr::addr_of_mut!(OUT);
        (*p) = bytes;
        (*p).as_ptr()
    }
}

fn set_out_str(s: &str) -> *const u8 {
    set_out(s.as_bytes().to_vec())
}

fn set_out_json<T: Serialize>(value: &T) -> *const u8 {
    match serde_json::to_vec(value) {
        Ok(bytes) => set_out(bytes),
        Err(_) => set_out_str("null"),
    }
}

/// Length in bytes of the last value written to the output buffer.
#[no_mangle]
pub extern "C" fn out_len() -> u32 {
    // SAFETY: single-threaded read of the static buffer's length.
    unsafe { u32::try_from((*core::ptr::addr_of!(OUT)).len()).unwrap_or(0) }
}

// --- lifecycle ----------

/// Start a fresh game for `seed`: the human in seat A, the engine in seat B.
#[no_mangle]
pub extern "C" fn new_game(seed_lo: u32, seed_hi: u32) {
    let seed = (u64::from(seed_hi) << 32) | u64::from(seed_lo);
    // SAFETY: single-threaded; replaces the held session.
    unsafe {
        *core::ptr::addr_of_mut!(STATE) = Some(Session {
            seed,
            state: GameState::new(seed),
            moves: Vec::new(),
            rng: ChaCha20Rng::seed_from_u64(seed),
            table: CribTable::shipped(),
            assisted: false,
        });
    }
}

// --- the view, as the UI reads it ----------

const fn seat_code(seat: Seat) -> u8 {
    match seat {
        Seat::A => 1,
        Seat::B => 2,
    }
}

fn phase_name(phase: Phase) -> &'static str {
    match phase {
        Phase::Discard => "discard",
        Phase::Peg => "peg",
        Phase::Show(ShowStep::NonDealer) => "showNonDealer",
        Phase::Show(ShowStep::Dealer) => "showDealer",
        Phase::Show(ShowStep::Crib) => "showCrib",
        Phase::Over => "over",
    }
}

/// A card as the UI draws it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CardView {
    rank: u8,
    suit: u8,
    code: u8,
}

fn card(c: Card) -> CardView {
    CardView {
        rank: c.rank,
        suit: c.suit,
        code: c.code(),
    }
}

/// A hand on the table at the show.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RevealedView {
    /// `nonDealer` | `dealer` | `crib`.
    step: &'static str,
    /// `1` = the human, `2` = the engine.
    owner: u8,
    cards: Vec<CardView>,
    /// Present once claimed: what was claimed, the true breakdown, the muggins.
    claimed: Option<u8>,
    actual: Option<HandBreakdown>,
    muggins: Option<u8>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HandBreakdown {
    fifteens: u8,
    pairs: u8,
    runs: u8,
    flush: u8,
    nobs: u8,
    total: u8,
}

/// What the last move scored.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LastView {
    /// `1` = the human, `2` = the engine.
    seat: u8,
    /// `heels` | `peg` | `go` | `lastCard` | `claim`.
    kind: &'static str,
    points: u8,
    /// For `peg`: the breakdown.
    fifteen: u8,
    thirty_one: u8,
    pairs: u8,
    run: u8,
    /// For `claim`: the claim and the truth.
    claimed: Option<u8>,
    actual: Option<HandBreakdown>,
    muggins: Option<u8>,
}

/// The human's view of the game.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UiView {
    /// `1` = the human deals this deal, `2` = the engine.
    dealer: u8,
    /// `1` = the human to move, `2` = the engine.
    to_move: u8,
    phase: &'static str,
    deal_no: u32,
    /// `[human, engine]`.
    scores: [u8; 2],
    /// Cards still in the human's hand.
    hand: Vec<CardView>,
    /// The four the human kept (empty until it has discarded).
    kept: Vec<CardView>,
    cut: Option<CardView>,
    /// Cards since the count last reset, in play order.
    stack: Vec<CardView>,
    count: u8,
    /// Every card played this deal: `[seat, card]`.
    played: Vec<(u8, CardView)>,
    /// How many cards the engine still holds.
    opponent_cards: u8,
    /// How many cards are in the crib so far (0, 2 or 4) — never which.
    crib_cards: u8,
    revealed: Vec<RevealedView>,
    last: Option<LastView>,
    /// The legal move codes for the seat to move.
    legal: Vec<u8>,
    /// `-1` ongoing, `1` the human won, `2` the engine won.
    result: i8,
    /// The game's value once over (1 / 2 skunk / 3 double skunk), else 0.
    value: u8,
}

fn breakdown(h: cribbage_core::score::HandScore) -> HandBreakdown {
    HandBreakdown {
        fifteens: h.fifteens,
        pairs: h.pairs,
        runs: h.runs,
        flush: h.flush,
        nobs: h.nobs,
        total: h.total(),
    }
}

fn last_view(last: Option<(Seat, Scored)>) -> Option<LastView> {
    let (seat, what) = last?;
    let base = LastView {
        seat: seat_code(seat),
        kind: "",
        points: 0,
        fifteen: 0,
        thirty_one: 0,
        pairs: 0,
        run: 0,
        claimed: None,
        actual: None,
        muggins: None,
    };
    Some(match what {
        Scored::Heels => LastView {
            kind: "heels",
            points: 2,
            ..base
        },
        Scored::Go => LastView {
            kind: "go",
            points: 1,
            ..base
        },
        Scored::LastCard => LastView {
            kind: "lastCard",
            points: 1,
            ..base
        },
        Scored::Peg(p) => LastView {
            kind: "peg",
            points: p.total(),
            fifteen: p.fifteen,
            thirty_one: p.thirty_one,
            pairs: p.pairs,
            run: p.run,
            ..base
        },
        Scored::Claim {
            claimed,
            actual,
            muggins,
        } => LastView {
            kind: "claim",
            points: claimed.min(actual.total()),
            claimed: Some(claimed),
            actual: Some(breakdown(actual)),
            muggins: Some(muggins),
            ..base
        },
    })
}

fn ui_view(s: &Session) -> UiView {
    let v = View::for_seat(&s.state, HUMAN);
    let outcome = s.state.outcome();
    UiView {
        dealer: seat_code(v.dealer),
        to_move: seat_code(v.to_move),
        phase: phase_name(v.phase),
        deal_no: v.deal_no,
        scores: v.scores,
        hand: v.hand.iter().copied().map(card).collect(),
        kept: v.kept.iter().copied().map(card).collect(),
        cut: v.cut.map(card),
        stack: v.stack.iter().copied().map(card).collect(),
        count: v.count,
        played: v
            .played
            .iter()
            .map(|(who, c)| (seat_code(*who), card(*c)))
            .collect(),
        opponent_cards: v.opponent_cards,
        crib_cards: crib_count(&v),
        revealed: v
            .revealed
            .iter()
            .map(|r| RevealedView {
                step: match r.step {
                    ShowStep::NonDealer => "nonDealer",
                    ShowStep::Dealer => "dealer",
                    ShowStep::Crib => "crib",
                },
                owner: seat_code(r.owner),
                cards: r.cards.iter().copied().map(card).collect(),
                claimed: r.graded.map(|g| g.claimed),
                actual: r.graded.map(|g| breakdown(g.actual)),
                muggins: r.graded.map(|g| g.muggins),
            })
            .collect(),
        last: last_view(v.last),
        legal: legal_moves(&s.state).iter().map(|m| m.code()).collect(),
        result: outcome.map_or(-1, |o| seat_code(o.winner) as i8),
        value: outcome.map_or(0, |o| o.value),
    }
}

/// How many cards are in the crib, from what the human can see: its own two
/// throws, plus the engine's once the cut is showing (both have thrown).
fn crib_count(v: &View) -> u8 {
    let mine = if v.kept.is_empty() { 0 } else { 2 };
    let theirs = if v.cut.is_some() { 2 } else { 0 };
    mine + theirs
}

/// The human's view as JSON, or `"null"` when there is no game.
#[no_mangle]
pub extern "C" fn view_json() -> *const u8 {
    match session_mut() {
        Some(s) => set_out_json(&ui_view(s)),
        None => set_out_str("null"),
    }
}

/// The legal move codes for the seat to move, as JSON.
#[no_mangle]
pub extern "C" fn legal_moves_json() -> *const u8 {
    match session_mut() {
        Some(s) => set_out_json(
            &legal_moves(&s.state)
                .iter()
                .map(|m| m.code())
                .collect::<Vec<u8>>(),
        ),
        None => set_out_str("[]"),
    }
}

/// The canonical state hash — raw UTF-8.
#[no_mangle]
pub extern "C" fn current_hash() -> *const u8 {
    match session_mut() {
        Some(s) => set_out_str(&state_hash(&s.state)),
        None => set_out_str(""),
    }
}

/// `-1` ongoing, `1` the human won, `2` the engine won.
#[no_mangle]
pub extern "C" fn result_code() -> i32 {
    match session_mut() {
        Some(s) => s
            .state
            .outcome()
            .map_or(-1, |o| i32::from(seat_code(o.winner))),
        None => -1,
    }
}

/// `1` = the human to move, `2` = the engine; `0` with no game.
#[no_mangle]
pub extern "C" fn to_move() -> u32 {
    session_mut().map_or(0, |s| u32::from(seat_code(s.state.to_move())))
}

// --- moves ----------

/// Play move `code` for the seat to move. `0` applied, `1` illegal, `2` no
/// game / over.
#[no_mangle]
pub extern "C" fn play(code: u32) -> u32 {
    let Some(s) = session_mut() else { return 2 };
    if s.state.outcome().is_some() {
        return 2;
    }
    let Some(mv) = u8::try_from(code).ok().and_then(Move::from_code) else {
        return 1;
    };
    match apply(&s.state, mv) {
        Ok(next) => {
            s.state = next;
            s.moves.push(mv);
            0
        }
        Err(_) => 1,
    }
}

/// The engine's move at `level` (`0..3`) for the seat to move — **over that
/// seat's own view**, never the state — or [`MOVE_OVER`]. Does not apply it.
#[no_mangle]
pub extern "C" fn live_move(level: u32) -> u32 {
    let Some(s) = session_mut() else {
        return MOVE_OVER;
    };
    let seat = s.state.to_move();
    let view = View::for_seat(&s.state, seat);
    match solver_move(&view, &s.table, Level::from_code(level), &mut s.rng) {
        Some(mv) => u32::from(mv.code()),
        None => MOVE_OVER,
    }
}

/// The exact claim code for the hand on the table (automatic counting), or
/// [`MOVE_OVER`] when it is not a show step.
#[no_mangle]
pub extern "C" fn auto_claim() -> u32 {
    let Some(s) = session_mut() else {
        return MOVE_OVER;
    };
    let Phase::Show(step) = s.state.phase() else {
        return MOVE_OVER;
    };
    let view = View::for_seat(&s.state, s.state.to_move());
    let Some(on_table) = view.revealed.iter().find(|r| r.step == step) else {
        return MOVE_OVER;
    };
    let (Some(cut), [first, second, third, fourth]) = (view.cut, on_table.cards.as_slice()) else {
        return MOVE_OVER;
    };
    let total = score_hand(
        &[*first, *second, *third, *fourth],
        cut,
        step == ShowStep::Crib,
    )
    .total();
    u32::from(Move::Claim(total).code())
}

// --- the tutor ----------

/// One option, assessed, as the UI reads it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AssessmentView {
    code: u8,
    /// Expected points, hundredths.
    expected: i32,
    regret: i32,
    /// `best` | `close` | `loose` | `blunder`.
    quality: &'static str,
    /// True for a discard verdict (exhaustive), false for pegging (a model).
    exact: bool,
    /// The coach's sentence, bound to `exact` in Rust.
    line: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReportView {
    moves: Vec<AssessmentView>,
    best: Option<u8>,
    exact: bool,
}

fn quality_name(q: cribbage_solver::MoveClass) -> &'static str {
    match q {
        cribbage_solver::MoveClass::Best => "best",
        cribbage_solver::MoveClass::Close => "close",
        cribbage_solver::MoveClass::Loose => "loose",
        cribbage_solver::MoveClass::Blunder => "blunder",
    }
}

fn report_view(s: &Session) -> ReportView {
    let view = View::for_seat(&s.state, HUMAN);
    let r = assess(&view, &s.table);
    ReportView {
        best: r.moves.first().map(|a| a.mv.code()),
        moves: r
            .moves
            .iter()
            .map(|a| AssessmentView {
                code: a.mv.code(),
                expected: a.expected,
                regret: a.regret,
                quality: quality_name(a.quality),
                exact: r.exact,
                line: coach_line(a.quality, r.exact),
            })
            .collect(),
        exact: r.exact,
    }
}

/// The human's options assessed, best first (empty off-turn or at the show).
#[no_mangle]
pub extern "C" fn tutor_json() -> *const u8 {
    match session_mut() {
        Some(s) => set_out_json(&report_view(s)),
        None => set_out_str("null"),
    }
}

/// One candidate move for the human assessed, or `"null"` if it is not an option.
#[no_mangle]
pub extern "C" fn assess_json(code: u32) -> *const u8 {
    let Some(s) = session_mut() else {
        return set_out_str("null");
    };
    let report = report_view(s);
    match report.moves.into_iter().find(|a| u32::from(a.code) == code) {
        Some(a) => set_out_json(&a),
        None => set_out_str("null"),
    }
}

// --- outcome ----------

/// Record that assistance (a hint) was used.
#[no_mangle]
pub extern "C" fn mark_assistance() {
    if let Some(s) = session_mut() {
        s.assisted = true;
    }
}

/// The `pond-outcome` record as a `pond-docformat` document, or `"null"`.
/// `Won` means the human (seat A) won; `score` is the game's value.
#[no_mangle]
pub extern "C" fn outcome_json(declare: u32) -> *const u8 {
    let Some(s) = session_mut() else {
        return set_out_str("null");
    };
    let result = match s.state.outcome() {
        Some(o) if o.winner == HUMAN => Outcome::Won,
        Some(_) => Outcome::Lost,
        None => Outcome::Abandoned,
    };
    let assistance = if declare != 0 { Some(s.assisted) } else { None };
    let mut record = attest::<Cribbage>(s.seed, s.moves.clone(), result, assistance);
    record.result = result;
    match pond_outcome::to_doc::<Cribbage>(&record) {
        Ok(bytes) => set_out(bytes),
        Err(_) => set_out_str("null"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn lock() -> std::sync::MutexGuard<'static, ()> {
        LOCK.lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn out() -> String {
        // SAFETY: single-threaded under LOCK; reads the buffer the last call wrote.
        unsafe { String::from_utf8_lossy(&(*core::ptr::addr_of!(OUT))).into_owned() }
    }

    fn view() -> serde_json::Value {
        view_json();
        serde_json::from_str(&out()).expect("view is JSON")
    }

    /// Drive one game: the engine plays both seats, auto-claiming at the show.
    fn play_out() -> u32 {
        let mut n = 0;
        while result_code() == -1 {
            let mv = live_move(3);
            assert_ne!(mv, MOVE_OVER, "a move on turn");
            assert_eq!(play(mv), 0, "the engine's own move must be legal");
            n += 1;
            assert!(n < 1000);
        }
        n
    }

    #[test]
    fn a_full_game_plays_through_the_exports_and_emits_a_record() {
        let _g = lock();
        new_game(7, 0);
        assert_eq!(result_code(), -1);
        let v = view();
        assert_eq!(v["phase"], "discard");
        assert_eq!(v["hand"].as_array().map(Vec::len), Some(6));
        assert_eq!(v["opponentCards"], 6);
        assert_eq!(v["legal"].as_array().map(Vec::len), Some(15));
        play_out();
        let v = view();
        assert_eq!(v["phase"], "over");
        assert!(v["result"] == 1 || v["result"] == 2);
        assert!(v["value"].as_u64().unwrap() >= 1);

        outcome_json(1);
        let doc: serde_json::Value = serde_json::from_str(&out()).expect("record is JSON");
        assert_eq!(doc["kind"], "cribbage");
        assert_eq!(doc["payload"]["assistance"], false);
        let won = doc["payload"]["result"] == "Won";
        assert_eq!(won, v["result"] == 1);
        assert_eq!(doc["payload"]["score"], v["value"]);
    }

    #[test]
    fn the_view_never_carries_the_engines_cards_and_the_hash_replays() {
        let _g = lock();
        new_game(11, 0);
        // The human's six and the engine's six are disjoint; the view must show
        // only the human's, and no card object anywhere in the JSON may be one
        // of the engine's — checked by replaying against the core directly.
        let state = GameState::new(11);
        let engine_hand: Vec<u8> = View::for_seat(&state, HUMAN.other())
            .hand
            .iter()
            .map(|c| c.code())
            .collect();
        let json = out_of(view_json);
        for code in &engine_hand {
            let needle = format!("\"code\":{code}}}");
            assert!(
                !json.contains(&needle),
                "engine card {code} leaked into the view"
            );
        }
        assert!(
            !json.contains("\"seen\""),
            "the raw View is not what the UI gets"
        );
        current_hash();
        assert_eq!(out(), state_hash(&state));
    }

    fn out_of(f: extern "C" fn() -> *const u8) -> String {
        f();
        out()
    }

    #[test]
    fn play_refuses_bad_codes_and_the_wrong_phase() {
        let _g = lock();
        new_game(3, 0);
        assert_eq!(play(15), 1, "no move has code 15");
        assert_eq!(play(16), 1, "a play at the discard");
        assert_eq!(play(20), 1, "a go at the discard");
        assert_eq!(play(0), 0);
        assert_eq!(play(0), 0);
        let v = view();
        assert_eq!(v["phase"], "peg");
        assert!(v["cut"].is_object());
        assert_eq!(v["cribCards"], 4);
        assert_eq!(v["kept"].as_array().map(Vec::len), Some(4));
    }

    #[test]
    fn auto_claim_is_the_exact_total_and_only_at_the_show() {
        let _g = lock();
        new_game(5, 0);
        assert_eq!(auto_claim(), MOVE_OVER);
        // play to the first show
        while !matches!(session_mut().unwrap().state.phase(), Phase::Show(_)) {
            let mv = live_move(3);
            assert_eq!(play(mv), 0);
        }
        let claim = auto_claim();
        assert!((32..=61).contains(&claim));
        assert_eq!(play(claim), 0);
        let v = view();
        assert_eq!(v["last"]["kind"], "claim");
        assert_eq!(v["last"]["muggins"], 0);
        assert_eq!(v["last"]["claimed"], v["last"]["actual"]["total"]);
        assert_eq!(v["revealed"].as_array().map(Vec::len), Some(2));
    }

    #[test]
    fn the_tutor_reports_the_humans_options_with_the_honesty_flag() {
        let _g = lock();
        new_game(21, 0);
        // seat A (the human) discards first only if it is the non-dealer
        if to_move() == 2 {
            assert_eq!(play(live_move(3)), 0);
        }
        tutor_json();
        let r: serde_json::Value = serde_json::from_str(&out()).unwrap();
        assert_eq!(r["exact"], true);
        assert_eq!(r["moves"].as_array().map(Vec::len), Some(15));
        assert_eq!(r["moves"][0]["regret"], 0);
        assert_eq!(r["moves"][0]["quality"], "best");
        assert!(r["moves"][0]["line"]
            .as_str()
            .unwrap()
            .contains("best keep"));
        let best = r["best"].as_u64().unwrap() as u32;
        assess_json(best);
        let a: serde_json::Value = serde_json::from_str(&out()).unwrap();
        assert_eq!(a["code"], best);
        assess_json(16);
        assert_eq!(out(), "null");
    }

    #[test]
    fn no_session_is_safe_everywhere() {
        let _g = lock();
        // SAFETY: test-only reset of the single-threaded session.
        unsafe {
            *core::ptr::addr_of_mut!(STATE) = None;
        }
        assert_eq!(play(0), 2);
        assert_eq!(live_move(3), MOVE_OVER);
        assert_eq!(auto_claim(), MOVE_OVER);
        assert_eq!(result_code(), -1);
        assert_eq!(to_move(), 0);
        assert_eq!(out_of(view_json), "null");
        assert_eq!(out_of(tutor_json), "null");
        assert_eq!(out_of(current_hash), "");
        outcome_json(0);
        assert_eq!(out(), "null");
        legal_moves_json();
        assert_eq!(out(), "[]");
    }
}
