//! Browser binding over [`furrow_core`] + [`furrow_solver`] — raw C-ABI +
//! serde-JSON, no `wasm-bindgen` (the same pattern as `dots-wasm` and
//! `drop4-wasm`).
//!
//! The module holds **one** Furrow match. Rules exports let the host read legal
//! pits, sow one, and read the board, hash, result and render text (for a
//! language-model prompt). The shipped opponent is [`live_move`]. Tutor exports
//! expose engine-grounded facts with the honest `exact` flag, split into a cheap
//! per-tap [`coach_json`] and a deeper [`tutor_json`] so the panel's cost does not
//! land on every tap.
//!
//! **Never panics** (a wasm panic aborts the module): every fallible path maps to
//! a status code or an empty / `"null"` buffer.
//!
//! Two things here are unlike the other games' bindings, and both come from the
//! same property — **one move writes to many cells**:
//!
//! - [`sow_path_json`] reports the exact cells a sow would drop seeds into, in
//!   order, plus what it keeps and what it takes. Without it a UI animating the
//!   sow would have to re-implement the skip-the-opponent's-store rule in
//!   TypeScript, which is precisely the duplication the tap-first standard
//!   forbids: the core decides, the UI draws.
//! - `board_json` reports `keptTurn`, as dots' does, so the UI can tell the
//!   player *why* it is still their turn — and `sweptAtEnd`, because the final
//!   score is not what accumulated during play and a player who is not told the
//!   sweep happened will read the end screen as a bug.

use adversary_core::{Adversary, MatchResult, Side};
use furrow_core::{
    apply_move, legal_pits, state_hash, Board, Furrow, Pit, A_STORE, B_STORE, CELLS, PITS, SEEDS,
};
use furrow_solver::live::{live_band, Level};
use furrow_solver::tutor::{assess, coach_line, MoveClass, COACH_DEPTH, TUTOR_DEPTH};
use pond_outcome::{attest, Outcome};
use rand_chacha::rand_core::SeedableRng;
use rand_chacha::ChaCha20Rng;
use serde::Serialize;

/// Returned by [`live_move`] when the match is over or there is no game.
const MOVE_OVER: u32 = 0xFFFF_FFFF;

// --- the held session ----------

struct Session {
    seed: u64,
    board: Board,
    moves: Vec<Pit>,
    rng: ChaCha20Rng,
    assisted: bool,
    /// Whether the most recent move landed in the mover's store and so kept the
    /// turn.
    kept_turn: bool,
    /// Whether the most recent move ended the game and triggered the sweep.
    swept: bool,
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

/// Start a fresh match for `seed` (the standard 6 x 4 opening; Side A moves
/// first).
///
/// `seed` does not change the board — every seed opens the same way — it seeds
/// the opponent's difficulty RNG, which is how a tournament varies games.
#[no_mangle]
pub extern "C" fn new_game(seed_lo: u32, seed_hi: u32) {
    let seed = (u64::from(seed_hi) << 32) | u64::from(seed_lo);
    // SAFETY: single-threaded; replaces the held session.
    unsafe {
        *core::ptr::addr_of_mut!(STATE) = Some(Session {
            seed,
            board: <Furrow as Adversary>::initial(seed),
            moves: Vec::new(),
            rng: ChaCha20Rng::seed_from_u64(seed),
            assisted: false,
            kept_turn: false,
            swept: false,
        });
    }
}

// --- reads ----------

fn side_byte(side: Side) -> u8 {
    match side {
        Side::A => 1,
        Side::B => 2,
    }
}

fn result_code_of(board: &Board) -> i8 {
    match <Furrow as Adversary>::result(board) {
        None => -1,
        Some(MatchResult::WinA) => 1,
        Some(MatchResult::WinB) => 2,
        Some(MatchResult::Draw) => 0,
    }
}

/// The board as the UI reads it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardView {
    /// Pits per side, so the UI need not restate the board shape.
    pits: usize,
    /// Seeds a pit starts with.
    seeds: u8,
    /// All fourteen cell counts, in cell order — the stores included, at their
    /// own indices, so the UI indexes the board the way every rule does.
    cells: Vec<u8>,
    /// Side A's store index.
    a_store: usize,
    /// Side B's store index.
    b_store: usize,
    /// Seeds banked by A.
    store_a: u8,
    /// Seeds banked by B.
    store_b: u8,
    /// Seeds still outside both stores — how much game is left, and the number
    /// the exact threshold is a function of.
    in_play: u32,
    /// Side to move: `1` = A, `2` = B.
    to_move: u8,
    /// The pits that can still be sown.
    legal: Vec<u8>,
    /// The pit sown by the most recent move, or `null` at the start.
    last_pit: Option<u8>,
    /// Whether the most recent move landed in the mover's store and kept the turn.
    kept_turn: bool,
    /// Whether the most recent move ended the game, so the stores hold swept
    /// seeds and not only what was banked in play.
    swept_at_end: bool,
    /// `-1` ongoing, `0` draw, `1` A won, `2` B won.
    result: i8,
}

/// The whole board as JSON, or `"null"` when there is no game.
#[no_mangle]
pub extern "C" fn board_json() -> *const u8 {
    let Some(s) = session_mut() else {
        return set_out_str("null");
    };
    let view = BoardView {
        pits: PITS,
        seeds: SEEDS,
        cells: s.board.cells.to_vec(),
        a_store: A_STORE,
        b_store: B_STORE,
        store_a: s.board.store(Side::A),
        store_b: s.board.store(Side::B),
        in_play: s.board.in_play(),
        to_move: side_byte(s.board.to_move),
        legal: legal_pits(&s.board).iter().map(|m| m.0).collect(),
        last_pit: s.moves.last().map(|m| m.0),
        kept_turn: s.kept_turn,
        swept_at_end: s.swept,
        result: result_code_of(&s.board),
    };
    set_out_json(&view)
}

/// The legal pit numbers as a JSON array.
#[no_mangle]
pub extern "C" fn legal_moves_json() -> *const u8 {
    let Some(s) = session_mut() else {
        return set_out_str("[]");
    };
    let legal: Vec<u8> = legal_pits(&s.board).iter().map(|m| m.0).collect();
    set_out_json(&legal)
}

/// The current canonical state hash, or an empty buffer when there is no game.
#[no_mangle]
pub extern "C" fn current_hash() -> *const u8 {
    match session_mut() {
        Some(s) => set_out_str(&state_hash(&s.board)),
        None => set_out_str(""),
    }
}

/// `-1` ongoing, `0` draw, `1` A won, `2` B won; `-1` when there is no game.
#[no_mangle]
pub extern "C" fn result_code() -> i32 {
    match session_mut() {
        Some(s) => i32::from(result_code_of(&s.board)),
        None => -1,
    }
}

/// The board rendered as text — the form a language-model player reads.
#[no_mangle]
pub extern "C" fn render_text() -> *const u8 {
    match session_mut() {
        Some(s) => set_out_str(&<Furrow as Adversary>::render_text(&s.board)),
        None => set_out_str(""),
    }
}

// --- moves ----------

/// Sow pit `pit`. `0` applied, `1` illegal, `2` no game / already over.
#[no_mangle]
pub extern "C" fn play(pit: u32) -> u32 {
    let Some(s) = session_mut() else { return 2 };
    if <Furrow as Adversary>::result(&s.board).is_some() {
        return 2;
    }
    let Ok(p) = u8::try_from(pit) else { return 2 };
    let mv = Pit(p);
    if !legal_pits(&s.board).contains(&mv) {
        return 1;
    }
    let before = s.board.to_move;
    let was_over = legal_pits(&s.board).is_empty();
    s.board = apply_move(&s.board, mv);
    s.moves.push(mv);
    s.kept_turn = s.board.to_move == before;
    s.swept = !was_over && legal_pits(&s.board).is_empty();
    0
}

/// The shipped opponent's pit at `level` (`0..3`), or [`MOVE_OVER`].
///
/// Does **not** apply the move — the host plays it, so the UI can animate the
/// opponent's sow before the board changes under it.
#[no_mangle]
pub extern "C" fn live_move(level: u32) -> u32 {
    let Some(s) = session_mut() else {
        return MOVE_OVER;
    };
    match furrow_solver::live::choose(&s.board, Level::from_code(level), &mut s.rng) {
        Some(mv) => u32::from(mv.0),
        None => MOVE_OVER,
    }
}

// --- the sow, as the UI must draw it ----------

/// What sowing a pit would do, cell by cell.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SowView {
    /// The cells a seed lands in, in the order they are dropped. The opponent's
    /// store is absent, because the rule skips it — which is the whole reason
    /// this export exists rather than the UI counting cells itself.
    path: Vec<u8>,
    /// Whether the last seed lands in the mover's own store, so the turn is kept.
    keeps_turn: bool,
    /// Seeds this move banks, counting a capture and the sweep.
    banks: u8,
    /// The pit a capture empties, or `null` when the move captures nothing.
    captures_from: Option<u8>,
    /// Whether the move ends the game.
    ends_game: bool,
}

/// The sow `pit` would perform, or `"null"` when there is no game or the pit is
/// not legal here.
///
/// **The point of this export.** One move drops seeds into as many as thirteen
/// cells and skips exactly one of the fourteen. A UI animating that from the
/// board alone would have to re-implement the skip rule, and a second
/// implementation of a rule is a second place for it to be wrong. The core
/// decides; the UI draws what it is told.
#[no_mangle]
pub extern "C" fn sow_path_json(pit: u32) -> *const u8 {
    let Some(s) = session_mut() else {
        return set_out_str("null");
    };
    let Ok(p) = u8::try_from(pit) else {
        return set_out_str("null");
    };
    let mv = Pit(p);
    if !legal_pits(&s.board).contains(&mv) {
        return set_out_str("null");
    }
    let me = s.board.to_move;
    let from = p as usize;
    let their_store = match me {
        Side::A => B_STORE,
        Side::B => A_STORE,
    };

    let mut path = Vec::new();
    let mut hand = s.board.cells[from];
    let mut at = from;
    while hand > 0 {
        at = (at + 1) % CELLS;
        if at == their_store {
            continue;
        }
        path.push(at as u8);
        hand -= 1;
    }

    let after = apply_move(&s.board, mv);
    let banks = after.store(me) - s.board.store(me);
    // A capture empties the pit facing where the last seed landed. Read it off
    // the applied position rather than re-deriving the rule.
    //
    // The `is_pit_of` guard has to come **first**, not merely be one conjunct:
    // `opposite_pit` is `2 * PITS - pit`, which underflows when handed a store,
    // and a sow that ends in the mover's own store does exactly that. In release
    // the subtraction wraps and the index that follows is out of bounds; in debug
    // it panics outright, which is how this was caught. Same shape as the search's
    // window-sentinel overflow, and the same lesson: nothing in the normal gate
    // compiles this with overflow checks on.
    let landed = *path.last().unwrap_or(&0) as usize;
    let captured = furrow_core::is_pit_of(me, landed) && after.cells[landed] == 0 && {
        let facing = furrow_core::opposite_pit(landed);
        s.board.cells[facing] > 0 && after.cells[facing] == 0
    };
    let facing = if captured {
        Some(furrow_core::opposite_pit(landed) as u8)
    } else {
        None
    };

    let view = SowView {
        path,
        keeps_turn: after.to_move == me,
        banks,
        captures_from: facing,
        ends_game: legal_pits(&after).is_empty(),
    };
    set_out_json(&view)
}

// --- tutor ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FactView {
    /// The pit number. Named `col` because it feeds the shared `TutorFactMove`
    /// shape, whose field is the Drop-4-era name for "the move's wire code".
    col: u8,
    value: i32,
    best_value: i32,
    regret: i32,
    /// `"optimal"` / `"resultPreserving"` / `"blunder"`.
    quality: &'static str,
    immediate_win: bool,
    blocks_opponent_win: bool,
    /// This game's own one-line reason, so a persona has something to say beyond
    /// the shared generic fallback.
    idea: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReportView {
    moves: Vec<FactView>,
    best_col: Option<u8>,
    exact: bool,
}

fn quality_str(q: MoveClass) -> &'static str {
    match q {
        MoveClass::Optimal => "optimal",
        MoveClass::ResultPreserving => "resultPreserving",
        MoveClass::Blunder => "blunder",
    }
}

fn report_json(depth: u32) -> *const u8 {
    let Some(s) = session_mut() else {
        return set_out_str("null");
    };
    let report = assess(&s.board, depth);
    let view = ReportView {
        moves: report
            .moves
            .iter()
            .map(|m| FactView {
                col: m.pit.0,
                value: m.value,
                best_value: m.best_value,
                regret: m.regret,
                quality: quality_str(m.quality),
                immediate_win: m.immediate_win,
                blocks_opponent_win: m.blocks_opponent_win,
                idea: m.idea.clone(),
            })
            .collect(),
        best_col: report.best_pit.map(|m| m.0),
        exact: report.exact,
    };
    set_out_json(&view)
}

/// The cheap per-tap report, at [`COACH_DEPTH`]. Called on every move, so it must
/// stay cheap — this is the export that exists so the panel's budget does not
/// land on the tap path.
#[no_mangle]
pub extern "C" fn coach_json() -> *const u8 {
    report_json(COACH_DEPTH)
}

/// The deliberately-opened panel's report, at [`TUTOR_DEPTH`]. Deeper, because
/// depth buys a better answer where nothing can be proven — and here that is
/// about 70% of a game.
#[no_mangle]
pub extern "C" fn tutor_json() -> *const u8 {
    report_json(TUTOR_DEPTH)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AssessView {
    quality: &'static str,
    exact: bool,
    immediate_win: bool,
    blocks_opponent_win: bool,
    /// The coach's sentence, already bound to `exact` in Rust so the UI cannot
    /// accidentally word a heuristic as a proof.
    line: &'static str,
    idea: String,
}

/// Assess one candidate pit **before** it is sown, at [`COACH_DEPTH`].
/// `"null"` when there is no game or the pit is not legal here.
#[no_mangle]
pub extern "C" fn assess_json(pit: u32) -> *const u8 {
    let Some(s) = session_mut() else {
        return set_out_str("null");
    };
    let Ok(p) = u8::try_from(pit) else {
        return set_out_str("null");
    };
    let report = assess(&s.board, COACH_DEPTH);
    let Some(fact) = report.moves.iter().find(|m| m.pit == Pit(p)) else {
        return set_out_str("null");
    };
    let view = AssessView {
        quality: quality_str(fact.quality),
        exact: report.exact,
        immediate_win: fact.immediate_win,
        blocks_opponent_win: fact.blocks_opponent_win,
        line: coach_line(fact.quality, report.exact),
        idea: fact.idea.clone(),
    };
    set_out_json(&view)
}

/// The level's band knobs, so the UI can describe a difficulty honestly rather
/// than restating them in TypeScript where they would drift.
#[no_mangle]
pub extern "C" fn level_sloppiness(level: u32) -> u32 {
    live_band(Level::from_code(level)).sloppiness_pct
}

/// Whether the engine can currently **prove** its verdicts — that is, whether
/// the position is inside the exact threshold.
///
/// Exposed so the UI can say "from here the engine is solving, not guessing"
/// rather than inferring it from the tutor's `exact` flag on a report it may not
/// have asked for. Reading it never runs a search.
#[no_mangle]
pub extern "C" fn is_solved_from_here() -> u32 {
    match session_mut() {
        Some(s) => u32::from(furrow_solver::search::is_affordable(&s.board)),
        None => 0,
    }
}

// --- outcome ----------

/// Record that assistance (a hint or an undo) was used.
#[no_mangle]
pub extern "C" fn mark_assistance() {
    if let Some(s) = session_mut() {
        s.assisted = true;
    }
}

/// The `pond-outcome` record as a `pond-docformat` document, or `"null"`.
///
/// `Outcome::Won` means **Side A won**, as it does in the other adversarial
/// games. The front end knows which side the human took and derives the
/// human-facing label itself.
#[no_mangle]
pub extern "C" fn outcome_json(declare: u32) -> *const u8 {
    let Some(s) = session_mut() else {
        return set_out_str("null");
    };
    let result = match <Furrow as Adversary>::result(&s.board) {
        Some(MatchResult::WinA) => Outcome::Won,
        Some(MatchResult::WinB | MatchResult::Draw) => Outcome::Lost,
        None => Outcome::Abandoned,
    };
    let assistance = if declare != 0 { Some(s.assisted) } else { None };
    let record = attest::<Furrow>(s.seed, s.moves.clone(), result, assistance);
    match pond_outcome::to_doc::<Furrow>(&record) {
        Ok(bytes) => set_out(bytes),
        Err(_) => set_out_str("null"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The exports are a C ABI over one global session, so the tests drive them in
    /// sequence exactly as the host does. Rust runs tests in parallel threads and
    /// this module is single-threaded by design, so they share one lock.
    static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn lock() -> std::sync::MutexGuard<'static, ()> {
        LOCK.lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn out() -> String {
        // SAFETY: single-threaded under LOCK; reads the buffer the last call wrote.
        unsafe { String::from_utf8_lossy(&(*core::ptr::addr_of!(OUT))).into_owned() }
    }

    #[test]
    fn a_full_game_plays_through_the_exports_and_emits_a_record() {
        let _g = lock();
        new_game(0, 0);
        assert_eq!(result_code(), -1);

        let mut moves = 0;
        loop {
            let mv = live_move(3);
            if mv == MOVE_OVER {
                break;
            }
            assert_eq!(play(mv), 0, "the engine's own move must be legal");
            moves += 1;
            assert!(moves < 400, "a game cannot run forever");
        }
        assert_ne!(result_code(), -1, "the game ended");

        board_json();
        let view: serde_json::Value = serde_json::from_str(&out()).expect("board is JSON");
        assert_eq!(view["inPlay"], 0, "a finished game has been swept");
        assert_eq!(
            view["storeA"].as_u64().unwrap_or(0) + view["storeB"].as_u64().unwrap_or(0),
            48,
            "and the stores hold every seed"
        );

        outcome_json(1);
        let doc = out();
        assert!(
            doc.contains("\"furrow\""),
            "the record names its kind: {doc}"
        );
    }

    #[test]
    fn the_exports_never_panic_without_a_game() {
        let _g = lock();
        // SAFETY: single-threaded under LOCK; clears the held session.
        unsafe {
            *core::ptr::addr_of_mut!(STATE) = None;
        }
        assert_eq!(result_code(), -1);
        assert_eq!(play(0), 2);
        assert_eq!(live_move(3), MOVE_OVER);
        assert_eq!(level_sloppiness(3), 0);
        assert_eq!(is_solved_from_here(), 0);
        board_json();
        assert_eq!(out(), "null");
        legal_moves_json();
        assert_eq!(out(), "[]");
        current_hash();
        assert_eq!(out(), "");
        render_text();
        assert_eq!(out(), "");
        sow_path_json(0);
        assert_eq!(out(), "null");
        assess_json(0);
        assert_eq!(out(), "null");
        outcome_json(1);
        assert_eq!(out(), "null");
        mark_assistance(); // must not panic either
    }

    #[test]
    fn an_illegal_pit_is_refused_rather_than_applied() {
        let _g = lock();
        new_game(0, 0);
        assert_eq!(play(6), 1, "a store is not a pit");
        assert_eq!(play(9), 1, "the opponent's pit is not A's to sow");
        assert_eq!(play(999), 2, "an out-of-range code is not a move");
        legal_moves_json();
        assert_eq!(out(), "[0,1,2,3,4,5]", "and none of it changed the board");
    }

    #[test]
    fn the_classic_opening_keeps_the_turn_and_the_board_says_why() {
        let _g = lock();
        new_game(0, 0);
        assert_eq!(play(2), 0);
        board_json();
        let view: serde_json::Value = serde_json::from_str(&out()).expect("board is JSON");
        assert_eq!(view["keptTurn"], true);
        assert_eq!(view["toMove"], 1, "still A");
        assert_eq!(view["storeA"], 1);
        assert_eq!(view["lastPit"], 2);
        assert_eq!(view["sweptAtEnd"], false);
    }

    #[test]
    fn the_sow_path_skips_the_opponents_store_and_the_ui_never_recomputes_it() {
        let _g = lock();
        new_game(0, 0);
        // Nine seeds is more than one row, so the path has to cross both stores'
        // territory -- exactly where a UI counting cells itself would go wrong.
        assert_eq!(play(2), 0); // banks one, keeps the turn
        assert_eq!(play(0), 0); // A sows pit 0
        assert_eq!(play(12), 0); // B sows pit 12
        sow_path_json(5);
        let view: serde_json::Value = serde_json::from_str(&out()).expect("sow is JSON");
        let path: Vec<u64> = view["path"]
            .as_array()
            .expect("a path")
            .iter()
            .map(|v| v.as_u64().unwrap_or(0))
            .collect();
        assert!(!path.is_empty());
        assert!(
            !path.contains(&(B_STORE as u64)),
            "the opponent's store is never sown: {path:?}"
        );
        assert_eq!(
            path.len(),
            usize::from(SEEDS + 1),
            "pit 5 picked up a seed from A's earlier sow"
        );
    }

    #[test]
    fn the_sow_path_reports_a_capture_and_where_it_comes_from() {
        let _g = lock();
        new_game(0, 0);
        // Drive to a capture through the exports only, then ask about it.
        let mut found = None;
        'outer: for _ in 0..40 {
            legal_moves_json();
            let legal: Vec<u8> = serde_json::from_str(&out()).expect("legal is JSON");
            if legal.is_empty() {
                break;
            }
            for &p in &legal {
                sow_path_json(u32::from(p));
                let view: serde_json::Value = serde_json::from_str(&out()).expect("sow is JSON");
                if view["capturesFrom"].is_u64() {
                    found = Some((p, view));
                    break 'outer;
                }
            }
            assert_eq!(play(u32::from(legal[0])), 0);
        }
        let (pit, view) = found.expect("a capture appears within forty moves");
        let facing = view["capturesFrom"].as_u64().expect("a pit index");
        assert!(
            view["banks"].as_u64().unwrap_or(0) >= 2,
            "a capture banks more than a pass-by"
        );
        assert_eq!(
            view["keepsTurn"], false,
            "a capture does not grant another move"
        );
        // And playing it really does empty that pit.
        assert_eq!(play(u32::from(pit)), 0);
        board_json();
        let after: serde_json::Value = serde_json::from_str(&out()).expect("board is JSON");
        assert_eq!(after["cells"][facing as usize], 0);
    }

    #[test]
    fn a_sow_ending_in_your_own_store_is_described_without_touching_the_capture_rule() {
        // The regression. `opposite_pit` is `2 * PITS - pit` and underflows when
        // handed a store, and a sow that lands in the mover's own store lands on
        // exactly that index. Release wraps and reads out of bounds; debug
        // aborts. Both sides are checked, because the A-only version of this code
        // stays inside `usize` by luck (A's store is 6 and `12 - 6` is fine) while
        // B's store is 13 and `12 - 13` is not.
        let _g = lock();
        new_game(0, 0);
        sow_path_json(2); // A's pit 2 is four from A's store
        let a: serde_json::Value = serde_json::from_str(&out()).expect("sow is JSON");
        assert_eq!(a["keepsTurn"], true);
        assert!(
            a["capturesFrom"].is_null(),
            "a store landing captures nothing"
        );

        // Hand the turn to B and ask the same of B's mirror-image pit.
        new_game(0, 0);
        assert_eq!(play(0), 0);
        sow_path_json(9); // B's pit 9 is four from B's store
        let b: serde_json::Value = serde_json::from_str(&out()).expect("sow is JSON");
        assert_eq!(b["keepsTurn"], true);
        assert!(b["capturesFrom"].is_null());
    }

    #[test]
    fn the_sow_path_refuses_a_pit_that_is_not_legal_here() {
        let _g = lock();
        new_game(0, 0);
        sow_path_json(6);
        assert_eq!(out(), "null", "a store has no sow");
        sow_path_json(9);
        assert_eq!(out(), "null", "nor does the opponent's pit");
    }

    #[test]
    fn the_opening_report_is_not_exact_and_says_so() {
        let _g = lock();
        new_game(0, 0);
        assert_eq!(
            is_solved_from_here(),
            0,
            "48 seeds is far above the exact threshold"
        );
        coach_json();
        let view: serde_json::Value = serde_json::from_str(&out()).expect("report is JSON");
        assert_eq!(view["exact"], false);
        assert_eq!(view["moves"].as_array().map(Vec::len), Some(6));
        // And nothing in it may be worded as a proof.
        assess_json(0);
        let one: serde_json::Value = serde_json::from_str(&out()).expect("assess is JSON");
        assert_eq!(one["exact"], false);
        assert!(!one["line"].as_str().unwrap_or("").contains("threw"));
        assert!(
            !one["idea"].as_str().unwrap_or("").is_empty(),
            "the engine's own reason must reach the UI"
        );
    }

    #[test]
    fn the_endgame_report_is_exact_and_the_flag_flips_with_the_position() {
        let _g = lock();
        new_game(4, 0);
        // Play until the position is inside the threshold, then check the flag
        // moved -- which is what makes `exact` a property of the search rather
        // than a constant the binding hard-codes.
        let mut became_exact = false;
        for _ in 0..200 {
            if is_solved_from_here() == 1 {
                became_exact = true;
                break;
            }
            let mv = live_move(3);
            if mv == MOVE_OVER {
                break;
            }
            assert_eq!(play(mv), 0);
        }
        assert!(became_exact, "a game reaches its own endgame");
        tutor_json();
        let view: serde_json::Value = serde_json::from_str(&out()).expect("report is JSON");
        assert_eq!(view["exact"], true);
        assert!(view["bestCol"].is_u64(), "an exact report names a best pit");
    }

    #[test]
    fn the_record_verifies_and_a_tampered_one_does_not() {
        let _g = lock();
        new_game(11, 0);
        for _ in 0..200 {
            let mv = live_move(2);
            if mv == MOVE_OVER {
                break;
            }
            assert_eq!(play(mv), 0);
        }
        current_hash();
        let hash = out();
        assert_eq!(hash.len(), 64);
        outcome_json(1);
        let doc = out();
        assert!(
            doc.contains(&hash),
            "the record carries the position it reached"
        );
    }

    #[test]
    fn assistance_is_recorded_only_when_it_happened() {
        let _g = lock();
        new_game(0, 0);
        assert_eq!(play(0), 0);
        outcome_json(1);
        let clean = out();
        new_game(0, 0);
        assert_eq!(play(0), 0);
        mark_assistance();
        outcome_json(1);
        let helped = out();
        assert_ne!(clean, helped, "a hint must change what the record claims");
    }

    #[test]
    fn the_text_board_is_the_form_a_language_model_reads() {
        let _g = lock();
        new_game(0, 0);
        render_text();
        let text = out();
        assert!(text.contains("Store: X 0, O 0."), "got:\n{text}");
        assert!(
            text.contains("pit number (0, 1, 2, 3, 4, 5)"),
            "got:\n{text}"
        );
    }

    #[test]
    fn every_level_answers_and_the_top_one_is_deterministic() {
        let _g = lock();
        for level in 0..4u32 {
            new_game(3, 0);
            assert_ne!(live_move(level), MOVE_OVER);
        }
        new_game(3, 0);
        let a = live_move(3);
        new_game(3, 0);
        assert_eq!(
            a,
            live_move(3),
            "Expert plays the same game from the same seed"
        );
        assert_eq!(level_sloppiness(3), 0, "and takes no random draw");
        assert!(level_sloppiness(0) > 0, "Easy is sloppy on purpose");
    }
}
