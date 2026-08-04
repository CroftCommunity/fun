//! Browser binding over [`othello_core`] + [`othello_solver`] — raw C-ABI +
//! serde-JSON, no `wasm-bindgen` (the same pattern as `drop4-wasm`).
//!
//! The module holds **one** Othello match. Rules exports let the host read legal
//! placements / play a cell / **pass** / read the board, hash, result, and render
//! text (for an LLM prompt). The **shipped opponent** is [`live_move`] (a
//! difficulty-tuned band over the heuristic + exact-endgame search). Tutor
//! exports ([`assess_json`], [`tutor_json`]) expose engine-grounded coaching
//! facts with the honest `exact` flag. Reads are JSON written to one output
//! buffer the host reads via the return pointer + [`out_len`].
//!
//! **Never panics** (a wasm panic aborts the module): every fallible path maps
//! to a status code or an empty/`"null"` buffer.

use adversary_core::{Adversary, MatchResult, Side};
use othello_core::{apply_move, legal_moves, legal_places, result, Board, Move, Othello, SIZE};
use othello_solver::{assess, best_move, choose, move_values, Level, MoveClass, TutorMove};
use pond_outcome::{attest, Outcome};
use rand_chacha::rand_core::SeedableRng;
use rand_chacha::ChaCha20Rng;
use serde::Serialize;

/// Returned by [`live_move`] / [`oracle_best`] when the match is over / no game.
const MOVE_OVER: u32 = 0xFFFF_FFFF;
/// Returned by [`live_move`] / [`oracle_best`] when the chosen move is a pass.
const MOVE_PASS: u32 = 0xFFFF_FFFE;
/// Depth used by the analysis "oracle" exports (the strongest shipped level).
const ORACLE_DEPTH: u32 = 7;

// --- the held session ----------

struct Session {
    seed: u64,
    board: Board,
    moves: Vec<Move>,
    rng: ChaCha20Rng,
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

/// Start a fresh Othello match for `seed` (the standard opening; Side A / Black
/// moves first). `seed` seeds the opponent's difficulty RNG.
#[no_mangle]
pub extern "C" fn new_game(seed_lo: u32, seed_hi: u32) {
    let seed = (u64::from(seed_hi) << 32) | u64::from(seed_lo);
    // SAFETY: single-threaded; replaces the held session.
    unsafe {
        *core::ptr::addr_of_mut!(STATE) = Some(Session {
            seed,
            board: <Othello as Adversary>::initial(seed),
            moves: Vec::new(),
            rng: ChaCha20Rng::seed_from_u64(seed),
            assisted: false,
        });
    }
}

// --- reads ----------

fn result_of(board: &Board) -> i8 {
    match <Othello as Adversary>::result(board) {
        None => -1,
        Some(MatchResult::WinA) => 1,
        Some(MatchResult::WinB) => 2,
        Some(MatchResult::Draw) => 0,
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BoardView {
    size: usize,
    /// Row-major rows, **row 0 = top**. `0` empty, `1` = A/Black, `2` = B/White.
    cells: Vec<Vec<u8>>,
    /// Side to move: `1` = A/Black, `2` = B/White.
    to_move: u8,
    /// Legal placement cell indices.
    legal: Vec<u8>,
    /// True when the side to move has no placement but the game is not over
    /// (a forced pass — the UI auto-passes).
    must_pass: bool,
    /// `-1` ongoing, `0` draw, `1` A won, `2` B won.
    result: i8,
}

fn board_view(s: &Session) -> BoardView {
    let b = &s.board;
    let cells = (0..SIZE)
        .map(|r| (0..SIZE).map(|c| b.get(r, c)).collect())
        .collect();
    let legal = legal_places(b);
    let must_pass = legal.is_empty() && result(b).is_none();
    BoardView {
        size: SIZE,
        cells,
        to_move: match b.to_move {
            Side::A => 1,
            Side::B => 2,
        },
        legal,
        must_pass,
        result: result_of(b),
    }
}

/// The current board (cells, side to move, legal placements, forced-pass flag,
/// result) as JSON. `"null"` if no game.
#[no_mangle]
pub extern "C" fn board_json() -> *const u8 {
    match session_mut() {
        Some(s) => set_out_json(&board_view(s)),
        None => set_out_str("null"),
    }
}

/// The legal placement cell indices as a JSON array. `[]` if none / no game
/// (empty with a live game means a forced pass — see `board_json().mustPass`).
#[no_mangle]
pub extern "C" fn legal_moves_json() -> *const u8 {
    match session_mut() {
        Some(s) => set_out_json(&legal_places(&s.board)),
        None => set_out_str("[]"),
    }
}

/// The canonical `state_hash` of the current state (quoted JSON string).
#[no_mangle]
pub extern "C" fn current_hash() -> *const u8 {
    match session_mut() {
        Some(s) => set_out_json(&<Othello as Adversary>::state_hash(&s.board)),
        None => set_out_str("\"\""),
    }
}

/// `-1` ongoing, `0` draw, `1` A won, `2` B won, `-2` no game.
#[no_mangle]
pub extern "C" fn result_code() -> i32 {
    match session_mut() {
        Some(s) => i32::from(result_of(&s.board)),
        None => -2,
    }
}

/// A human/LLM-readable rendering of the board + whose turn (JSON string).
#[no_mangle]
pub extern "C" fn render_text() -> *const u8 {
    match session_mut() {
        Some(s) => set_out_json(&<Othello as Adversary>::render_text(&s.board)),
        None => set_out_str("\"\""),
    }
}

// --- moves (status: 0 applied / 1 illegal / 2 over or bad) ----------

/// Place a disc at cell `idx` for the side to move. `1` if `idx` is not a legal
/// placement; `2` if the match is over / no game / `idx` out of range.
#[no_mangle]
pub extern "C" fn play(idx: u32) -> u32 {
    let Some(s) = session_mut() else { return 2 };
    if result(&s.board).is_some() {
        return 2;
    }
    let Ok(i) = u8::try_from(idx) else { return 2 };
    let mv = Move::Place(i);
    if !legal_moves(&s.board).contains(&mv) {
        return 1;
    }
    s.board = apply_move(&s.board, mv);
    s.moves.push(mv);
    0
}

/// Pass for the side to move. `1` if a pass is not allowed (the side has a legal
/// placement); `2` if the match is over / no game. A pass is legal only when the
/// side to move has no placement (a forced pass).
#[no_mangle]
pub extern "C" fn pass() -> u32 {
    let Some(s) = session_mut() else { return 2 };
    if result(&s.board).is_some() {
        return 2;
    }
    if !legal_moves(&s.board).contains(&Move::Pass) {
        return 1; // a pass is only legal when there is no placement
    }
    s.board = apply_move(&s.board, Move::Pass);
    s.moves.push(Move::Pass);
    0
}

// --- opponent / oracle ----------

fn level_from(code: u32) -> Level {
    match code {
        0 => Level::Easy,
        1 => Level::Medium,
        2 => Level::Hard,
        _ => Level::Expert,
    }
}

fn move_code(mv: Option<Move>) -> u32 {
    match mv {
        Some(Move::Place(idx)) => u32::from(idx),
        Some(Move::Pass) => MOVE_PASS,
        None => MOVE_OVER,
    }
}

/// The **live** (shipped) opponent's move at difficulty `level` (0 Easy / 1
/// Medium / 2 Hard / 3 Expert): a cell index, `MOVE_PASS` (`0xFFFF_FFFE`) for a
/// forced pass, or `MOVE_OVER` (`0xFFFF_FFFF`) if the match is over / no game.
#[no_mangle]
pub extern "C" fn live_move(level: u32) -> u32 {
    let Some(s) = session_mut() else {
        return MOVE_OVER;
    };
    let board = s.board;
    move_code(choose(&board, level_from(level), &mut s.rng))
}

/// The analysis oracle's best move at the strongest level (a cell index,
/// `MOVE_PASS`, or `MOVE_OVER`). Heuristic early, exact in the endgame.
#[no_mangle]
pub extern "C" fn oracle_best(_level: u32) -> u32 {
    let Some(s) = session_mut() else {
        return MOVE_OVER;
    };
    move_code(best_move(&s.board, ORACLE_DEPTH))
}

#[derive(Serialize)]
struct MoveValue {
    col: u8,
    value: i32,
}

/// The value of every legal **placement** (the analysis oracle's judgment) as
/// JSON `[{col, value}]`. Higher is better for the side to move. `[]` if none.
#[no_mangle]
pub extern "C" fn oracle_move_values_json() -> *const u8 {
    let Some(s) = session_mut() else {
        return set_out_str("[]");
    };
    let vals: Vec<MoveValue> = move_values(&s.board, ORACLE_DEPTH)
        .into_iter()
        .filter_map(|(mv, value)| match mv {
            Move::Place(idx) => Some(MoveValue { col: idx, value }),
            Move::Pass => None,
        })
        .collect();
    set_out_json(&vals)
}

// --- tutor (engine-grounded coaching facts) ----------

fn quality_str(q: MoveClass) -> &'static str {
    match q {
        MoveClass::Optimal => "optimal",
        MoveClass::ResultPreserving => "resultPreserving",
        MoveClass::Blunder => "blunder",
    }
}

/// The per-move tutor view. `immediateWin` / `blocksOpponentWin` are always
/// `false` for Othello (there is no immediate line-win or single-square block) —
/// they are carried so the view is a structural superset of the shared TS
/// `TutorFactMove`, so `hybrid-player.ts`'s `buildBand` reuses **unchanged**.
/// Othello's one-ply fact is `takesCorner`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AssessView {
    col: u8,
    value: i32,
    best_value: i32,
    regret: i32,
    /// `"optimal"` / `"resultPreserving"` / `"blunder"`.
    quality: &'static str,
    immediate_win: bool,
    blocks_opponent_win: bool,
    takes_corner: bool,
    /// `true` when the facts are the exact solve's (endgame); `false` when they
    /// are the horizon-approximate heuristic's (so the UI softens its wording).
    exact: bool,
}

fn assess_view(m: &TutorMove, exact: bool) -> AssessView {
    AssessView {
        col: m.col,
        value: m.value,
        best_value: m.best_value,
        regret: m.regret,
        quality: quality_str(m.quality),
        immediate_win: false,
        blocks_opponent_win: false,
        takes_corner: m.takes_corner,
        exact,
    }
}

/// Engine-grounded assessment of the candidate placement `idx` at the current
/// position: quality, regret, the corner fact, and whether the facts are
/// `exact`. `"null"` if there is no game or `idx` is not a legal placement.
#[no_mangle]
pub extern "C" fn assess_json(idx: u32) -> *const u8 {
    let Some(s) = session_mut() else {
        return set_out_str("null");
    };
    let Ok(c) = u8::try_from(idx) else {
        return set_out_str("null");
    };
    let report = assess(&s.board);
    match report.moves.iter().find(|m| m.col == c) {
        Some(m) => set_out_json(&assess_view(m, report.exact)),
        None => set_out_str("null"),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TutorView {
    moves: Vec<AssessView>,
    /// The best cell (first, if several tie), or `null` if nothing to assess.
    best_col: Option<u8>,
    exact: bool,
}

/// The current position's whole-position tutor report: every legal placement's
/// assessment, the best cell, and whether the facts are `exact`. `"null"` if no
/// game; an empty `moves` for a forced pass / terminal. Never panics.
#[no_mangle]
pub extern "C" fn tutor_json() -> *const u8 {
    let Some(s) = session_mut() else {
        return set_out_str("null");
    };
    let report = assess(&s.board);
    let view = TutorView {
        moves: report
            .moves
            .iter()
            .map(|m| assess_view(m, report.exact))
            .collect(),
        best_col: report.best_col,
        exact: report.exact,
    };
    set_out_json(&view)
}

// --- assistance + outcome ----------

/// Record that the player used a hint this match (assistance).
#[no_mangle]
pub extern "C" fn mark_assistance() {
    if let Some(s) = session_mut() {
        s.assisted = true;
    }
}

/// The outcome record for the current match as a `pond-docformat` envelope JSON
/// (`kind = "othello"`), verifiable by replaying `(seed, moves)` (passes
/// included) through `othello_core::Othello`. `Won` when Side A (the opening
/// player) won. When `declare` is non-zero the self-declared assistance flag is
/// included; when `0` the declaration is opted out (`null`).
#[no_mangle]
pub extern "C" fn outcome_json(declare: u32) -> *const u8 {
    let Some(s) = session_mut() else {
        return set_out_str("null");
    };
    let result = match <Othello as Adversary>::result(&s.board) {
        Some(MatchResult::WinA) => Outcome::Won,
        Some(MatchResult::WinB | MatchResult::Draw) => Outcome::Lost,
        None => Outcome::Abandoned,
    };
    let assistance = if declare != 0 { Some(s.assisted) } else { None };
    let record = attest::<Othello>(s.seed, s.moves.clone(), result, assistance);
    match pond_outcome::to_doc::<Othello>(&record) {
        Ok(bytes) => set_out(bytes),
        Err(_) => set_out_str("null"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn out_slice(ptr: *const u8) -> Vec<u8> {
        let n = out_len() as usize;
        // SAFETY: single-threaded test; the caller just wrote OUT.
        unsafe { std::slice::from_raw_parts(ptr, n).to_vec() }
    }

    fn json(ptr: *const u8) -> serde_json::Value {
        serde_json::from_slice(&out_slice(ptr)).unwrap()
    }

    #[test]
    fn cabi_rules_tutor_and_outcome() {
        new_game(7, 0);

        // Fresh board: 4 discs, 4 legal opening moves {19,26,37,44}, A (1) to move.
        let view = json(board_json());
        assert_eq!(view["toMove"], serde_json::json!(1));
        assert_eq!(view["mustPass"], serde_json::json!(false));
        assert_eq!(view["result"], serde_json::json!(-1));
        let legal = json(legal_moves_json());
        let mut cols: Vec<u64> = legal
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_u64().unwrap())
            .collect();
        cols.sort_unstable();
        assert_eq!(cols, vec![19, 26, 37, 44], "the 4 textbook opening moves");

        // render_text mentions the cell-index prompt.
        let text: String = serde_json::from_value(json(render_text())).unwrap();
        assert!(text.contains("cell index"));

        // An illegal placement (a center-occupied cell) is rejected (1), not a panic.
        assert_eq!(play(27), 1, "27 is occupied at the start");
        // A pass is not allowed while placements exist.
        assert_eq!(pass(), 1, "pass illegal when moves exist");

        // Play the textbook d3 (idx 19): it flips (3,3)=idx 27 to A.
        assert_eq!(play(19), 0);
        let after = json(board_json());
        assert_eq!(
            after["cells"][3][3],
            serde_json::json!(1),
            "(3,3) flipped to A"
        );
        assert_eq!(after["toMove"], serde_json::json!(2), "now B to move");

        // The live engine returns a legal move for B (a cell index, not a sentinel).
        let mv = live_move(3);
        assert!(mv < 64, "live_move returns a legal cell index");

        // tutor_json at the opening-ish position: capped (early), a best cell,
        // one assessment per legal placement, and the shared TutorFactMove fields.
        let t = json(tutor_json());
        assert_eq!(
            t["exact"],
            serde_json::json!(false),
            "early position is capped"
        );
        assert!(t["bestCol"].is_number(), "there is a best cell");
        let first = &t["moves"][0];
        assert!(
            first["immediateWin"] == serde_json::json!(false),
            "othello has no immediate win"
        );
        assert!(
            first.get("takesCorner").is_some(),
            "carries the corner fact"
        );

        // assess_json of an illegal cell is null, not a panic.
        assert!(json(assess_json(99)).is_null());

        // outcome_json is a verifiable pond envelope of kind "othello".
        let rec = json(outcome_json(0));
        assert_eq!(rec["kind"], serde_json::json!("othello"));
        assert_eq!(rec["payload"]["assistance"], serde_json::Value::Null);

        // A declared assistance flag is honest.
        mark_assistance();
        let rec = json(outcome_json(1));
        assert_eq!(rec["payload"]["assistance"], serde_json::json!(true));
    }
}
