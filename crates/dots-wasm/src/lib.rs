//! Browser binding over [`dots_core`] + [`dots_solver`] — raw C-ABI +
//! serde-JSON, no `wasm-bindgen` (the same pattern as `drop4-wasm`).
//!
//! The module holds **one** Dots and Boxes match. Rules exports let the host read
//! legal edges, draw an edge, and read the board, hash, result and render text
//! (for a language-model prompt). The shipped opponent is [`live_move`]. Tutor
//! exports expose engine-grounded facts with the honest `exact` flag, split into a
//! cheap per-tap [`coach_json`] and a deeper [`tutor_json`] so the panel's cost
//! does not land on every tap.
//!
//! **Never panics** (a wasm panic aborts the module): every fallible path maps to
//! a status code or an empty / `"null"` buffer.
//!
//! One thing here is unlike the other three games' bindings: because a capture
//! grants another move, `board_json` reports [`BoardView::kept_turn`] so the UI can
//! tell the player *why* it is still their turn instead of leaving it a mystery.

use adversary_core::{Adversary, MatchResult};
use dots_core::{
    apply_move, completed_boxes, legal_edges, state_hash, Board, Dots, Edge, COLS, EDGES, ROWS,
};
use dots_solver::{assess, coach_line, live_band, Level, MoveClass, COACH_DEPTH, TUTOR_DEPTH};
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
    moves: Vec<Edge>,
    rng: ChaCha20Rng,
    assisted: bool,
    /// Whether the most recent move closed a box and so kept the turn.
    kept_turn: bool,
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

/// Start a fresh match for `seed` (the empty lattice; Side A moves first).
///
/// `seed` does not change the board — every seed opens empty — it seeds the
/// opponent's difficulty RNG, which is how a tournament varies games.
#[no_mangle]
pub extern "C" fn new_game(seed_lo: u32, seed_hi: u32) {
    let seed = (u64::from(seed_hi) << 32) | u64::from(seed_lo);
    // SAFETY: single-threaded; replaces the held session.
    unsafe {
        *core::ptr::addr_of_mut!(STATE) = Some(Session {
            seed,
            board: <Dots as Adversary>::initial(seed),
            moves: Vec::new(),
            rng: ChaCha20Rng::seed_from_u64(seed),
            assisted: false,
            kept_turn: false,
        });
    }
}

// --- reads ----------

fn result_code_of(board: &Board) -> i8 {
    match <Dots as Adversary>::result(board) {
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
    /// Boxes down.
    rows: usize,
    /// Boxes across.
    cols: usize,
    /// Total edges (so the UI need not recompute the lattice arithmetic).
    edges: usize,
    /// Per-edge drawn flag, indexed by edge number.
    drawn: Vec<bool>,
    /// Per-edge owner: `0` undrawn, `1` drawn by A, `2` drawn by B. Lets the UI
    /// colour an edge by who drew it, which is how a player reads a chain back.
    edge_owner: Vec<u8>,
    /// Box owners, box-major; `0` unclaimed, `1` A, `2` B.
    owners: Vec<u8>,
    /// Boxes claimed by A.
    boxes_a: u8,
    /// Boxes claimed by B.
    boxes_b: u8,
    /// Side to move: `1` = A, `2` = B.
    to_move: u8,
    /// The edges that can still be drawn.
    legal: Vec<u8>,
    /// The edge drawn by the most recent move, or `null` at the start.
    last_edge: Option<u8>,
    /// Whether the most recent move closed a box and therefore kept the turn.
    kept_turn: bool,
    /// `-1` ongoing, `0` draw, `1` A won, `2` B won.
    result: i8,
}

/// Per-edge owner bytes, derived by replaying the recorded move list.
fn edge_owners(moves: &[Edge]) -> Vec<u8> {
    let mut owner = vec![0u8; EDGES];
    let mut pos = <Dots as Adversary>::initial(0);
    for &mv in moves {
        let who = dots_core::owner_of(pos.to_move);
        if let Some(slot) = owner.get_mut(mv.0 as usize) {
            *slot = who;
        }
        pos = apply_move(&pos, mv);
    }
    owner
}

/// The whole board as JSON, or `"null"` when there is no game.
#[no_mangle]
pub extern "C" fn board_json() -> *const u8 {
    let Some(s) = session_mut() else {
        return set_out_str("null");
    };
    let (boxes_a, boxes_b) = s.board.box_counts();
    let view = BoardView {
        rows: ROWS,
        cols: COLS,
        edges: EDGES,
        drawn: (0..EDGES).map(|e| s.board.is_drawn(e)).collect(),
        edge_owner: edge_owners(&s.moves),
        owners: s.board.owners.to_vec(),
        boxes_a,
        boxes_b,
        to_move: dots_core::owner_of(s.board.to_move),
        legal: legal_edges(&s.board).iter().map(|m| m.0).collect(),
        last_edge: s.moves.last().map(|m| m.0),
        kept_turn: s.kept_turn,
        result: result_code_of(&s.board),
    };
    set_out_json(&view)
}

/// The legal edge numbers as a JSON array.
#[no_mangle]
pub extern "C" fn legal_moves_json() -> *const u8 {
    let Some(s) = session_mut() else {
        return set_out_str("[]");
    };
    let legal: Vec<u8> = legal_edges(&s.board).iter().map(|m| m.0).collect();
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
        Some(s) => set_out_str(&<Dots as Adversary>::render_text(&s.board)),
        None => set_out_str(""),
    }
}

// --- moves ----------

/// Draw edge `edge`. `0` applied, `1` illegal, `2` no game / already over.
#[no_mangle]
pub extern "C" fn play(edge: u32) -> u32 {
    let Some(s) = session_mut() else { return 2 };
    if <Dots as Adversary>::result(&s.board).is_some() {
        return 2;
    }
    let Ok(e) = u8::try_from(edge) else { return 2 };
    let mv = Edge(e);
    if !legal_edges(&s.board).contains(&mv) {
        return 1;
    }
    let before = s.board.to_move;
    s.board = apply_move(&s.board, mv);
    s.moves.push(mv);
    s.kept_turn = s.board.to_move == before;
    0
}

/// The shipped opponent's edge at `level` (`0..3`), or [`MOVE_OVER`].
///
/// Does **not** apply the move — the host plays it, so the UI can animate the
/// opponent's edge before the board changes under it.
#[no_mangle]
pub extern "C" fn live_move(level: u32) -> u32 {
    let Some(s) = session_mut() else {
        return MOVE_OVER;
    };
    match dots_solver::choose(&s.board, Level::from_code(level), &mut s.rng) {
        Some(mv) => u32::from(mv.0),
        None => MOVE_OVER,
    }
}

// --- tutor ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FactView {
    /// The edge number. Named `col` because it feeds the shared `TutorFactMove`
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
                col: m.edge.0,
                value: m.value,
                best_value: m.best_value,
                regret: m.regret,
                quality: quality_str(m.quality),
                immediate_win: m.immediate_win,
                blocks_opponent_win: m.blocks_opponent_win,
                idea: m.idea.clone(),
            })
            .collect(),
        best_col: report.best_edge.map(|m| m.0),
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
/// depth buys proofs and this is the only surface allowed to claim one.
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

/// Assess one candidate edge **before** it is played, at [`COACH_DEPTH`].
/// `"null"` when there is no game or the edge is not legal here.
#[no_mangle]
pub extern "C" fn assess_json(edge: u32) -> *const u8 {
    let Some(s) = session_mut() else {
        return set_out_str("null");
    };
    let Ok(e) = u8::try_from(edge) else {
        return set_out_str("null");
    };
    let report = assess(&s.board, COACH_DEPTH);
    let Some(fact) = report.moves.iter().find(|m| m.edge == Edge(e)) else {
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

/// How many boxes drawing `edge` would close right now (`0`, `1` or `2`), or `0`
/// when there is no game or the edge is not drawable. Lets the UI show the
/// extra-turn consequence without re-implementing the rule.
#[no_mangle]
pub extern "C" fn closes_count(edge: u32) -> u32 {
    let Some(s) = session_mut() else { return 0 };
    let Ok(e) = usize::try_from(edge) else {
        return 0;
    };
    completed_boxes(s.board.edges, e).count_ones()
}

/// The level's band knobs, so the UI can describe a difficulty honestly rather
/// than restating them in TypeScript where they would drift.
#[no_mangle]
pub extern "C" fn level_sloppiness(level: u32) -> u32 {
    live_band(Level::from_code(level)).sloppiness_pct
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
/// games. The front end knows which side the human took — and here that choice is
/// the player's, because 3x3 is a second-player win — so it derives the
/// human-facing label itself.
#[no_mangle]
pub extern "C" fn outcome_json(declare: u32) -> *const u8 {
    let Some(s) = session_mut() else {
        return set_out_str("null");
    };
    let result = match <Dots as Adversary>::result(&s.board) {
        Some(MatchResult::WinA) => Outcome::Won,
        Some(MatchResult::WinB | MatchResult::Draw) => Outcome::Lost,
        None => Outcome::Abandoned,
    };
    let assistance = if declare != 0 { Some(s.assisted) } else { None };
    let record = attest::<Dots>(s.seed, s.moves.clone(), result, assistance);
    match pond_outcome::to_doc::<Dots>(&record) {
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

    fn out() -> String {
        // SAFETY: single-threaded under LOCK; reads the buffer the last call wrote.
        unsafe { String::from_utf8_lossy(&(*core::ptr::addr_of!(OUT))).into_owned() }
    }

    #[test]
    fn a_full_game_plays_through_the_exports_and_emits_a_record() {
        let _g = LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
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
            assert!(moves <= EDGES, "a game cannot exceed the edge count");
        }
        assert_eq!(moves, EDGES, "a finished game drew every edge");
        assert_ne!(result_code(), -1, "the game ended decisively");
        assert_eq!(result_code(), 2, "3x3 is a second-player win");

        outcome_json(1);
        let doc = out();
        assert!(doc.contains("\"dots\""), "the record names its kind: {doc}");
    }

    #[test]
    fn an_illegal_or_repeated_edge_is_rejected_without_panicking() {
        let _g = LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        new_game(0, 0);
        assert_eq!(play(0), 0);
        assert_eq!(play(0), 1, "an already-drawn edge is illegal");
        assert_eq!(play(99), 1, "an off-board edge is illegal, not a panic");
        assert_eq!(play(u32::MAX), 2, "an unrepresentable edge is rejected");
    }

    #[test]
    fn exports_are_safe_before_a_game_exists() {
        let _g = LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        // SAFETY: single-threaded under LOCK; clears the held session.
        unsafe {
            *core::ptr::addr_of_mut!(STATE) = None;
        }
        assert_eq!(play(0), 2);
        assert_eq!(live_move(3), MOVE_OVER);
        assert_eq!(result_code(), -1);
        assert_eq!(closes_count(0), 0);
        board_json();
        assert_eq!(out(), "null");
        legal_moves_json();
        assert_eq!(out(), "[]");
        current_hash();
        assert_eq!(out(), "");
        assess_json(0);
        assert_eq!(out(), "null");
        tutor_json();
        assert_eq!(out(), "null");
        outcome_json(1);
        assert_eq!(out(), "null");
        mark_assistance(); // must not panic
    }

    #[test]
    fn board_json_reports_the_extra_turn_and_the_score() {
        let _g = LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        new_game(0, 0);
        // Box 0 closes on 0, 3, 12, 13. The fourth of those keeps the turn.
        for e in [0u32, 3, 12] {
            assert_eq!(play(e), 0);
        }
        board_json();
        assert!(out().contains("\"keptTurn\":false"), "no capture yet");
        assert_eq!(closes_count(13), 1, "edge 13 closes box 0");
        assert_eq!(play(13), 0);
        board_json();
        let view = out();
        assert!(
            view.contains("\"keptTurn\":true"),
            "a capture keeps the turn"
        );
        assert!(
            view.contains("\"boxesB\":1") || view.contains("\"boxesA\":1"),
            "the closed box is scored: {view}"
        );
    }

    #[test]
    fn the_coach_never_claims_a_proof_it_does_not_have() {
        let _g = LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        new_game(0, 0);
        // The opening is above the exact threshold, so nothing is proven here.
        assess_json(0);
        let view = out();
        assert!(
            view.contains("\"exact\":false"),
            "opening proves nothing: {view}"
        );
        assert!(
            !view.contains("threw the game"),
            "and must not say so: {view}"
        );
    }

    #[test]
    fn hash_changes_with_play_and_is_stable_without_it() {
        let _g = LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        new_game(0, 0);
        current_hash();
        let first = out();
        current_hash();
        assert_eq!(out(), first, "reading twice does not change the board");
        assert_eq!(play(5), 0);
        current_hash();
        assert_ne!(out(), first, "a drawn edge changes the hash");
    }

    #[test]
    fn out_len_matches_the_bytes_the_host_would_read() {
        let _g = LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        new_game(0, 0);
        board_json();
        assert_eq!(out_len() as usize, out().len());
    }

    #[test]
    fn render_text_is_available_for_a_text_player() {
        let _g = LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        new_game(0, 0);
        render_text();
        let t = out();
        assert!(
            t.contains("edge number"),
            "the prompt explains the move: {t}"
        );
    }
}
