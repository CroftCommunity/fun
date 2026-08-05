//! Browser binding over [`checkers_core`] + [`checkers_solver`] — raw C-ABI +
//! serde-JSON, no `wasm-bindgen` (the same pattern as `drop4-wasm` and
//! `othello-wasm`).
//!
//! The module holds **one** checkers match. Rules exports let the host read legal
//! moves / play a move / read the board, hash, result, and render text (for an
//! LLM prompt). The **shipped opponent** is [`live_move`] (a difficulty-tuned band
//! over the search). Tutor exports ([`assess_json`], [`tutor_json`]) expose
//! engine-grounded coaching facts with the honest `exact` flag. Reads are JSON
//! written to one output buffer the host reads via the return pointer +
//! [`out_len`].
//!
//! **Never panics** (a wasm panic aborts the module): every fallible path maps to
//! a status code or an empty/`"null"` buffer.
//!
//! ## Two deliberate differences from the Othello binding
//!
//! 1. **There is no `pass`.** Checkers has no pass; a side with no legal move has
//!    lost. So the forced-pass machinery — the `mustPass` flag, the `MOVE_PASS`
//!    sentinel, the separate export — is simply absent rather than stubbed.
//! 2. **[`legal_moves_json`] returns objects, not a bare index array.** A checkers
//!    move can be a multi-jump chain, and the front-end has to let a player tap
//!    that chain out one landing at a time. Rather than re-implement the rules in
//!    TypeScript to know where a half-finished chain may continue, each entry
//!    carries its **full path** — so the UI filters the core's own chains by the
//!    prefix tapped so far and never decides legality itself.

#![warn(missing_docs)]

use adversary_core::{Adversary, MatchResult, Side};
use checkers_core::{
    apply_move, legal_chains, legal_moves, result, Board, Checkers, Move, SQUARES,
};
use checkers_solver::{assess, best_move, choose, move_values, Level, MoveClass, TutorMove};
use pond_outcome::{attest, Outcome};
use rand_chacha::rand_core::SeedableRng;
use rand_chacha::ChaCha20Rng;
use serde::Serialize;

/// Returned by [`live_move`] / [`oracle_best`] when the match is over / no game.
///
/// There is no pass sentinel: checkers has no pass.
const MOVE_OVER: u32 = 0xFFFF_FFFF;

/// Depth used by the analysis "oracle" exports (the strongest shipped level).
const ORACLE_DEPTH: u32 = Level::Expert.depth();

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

/// Start a fresh checkers match for `seed` (the standard opening; Side A / Black
/// moves first). `seed` seeds the opponent's difficulty RNG.
#[no_mangle]
pub extern "C" fn new_game(seed_lo: u32, seed_hi: u32) {
    let seed = (u64::from(seed_hi) << 32) | u64::from(seed_lo);
    // SAFETY: single-threaded; replaces the held session.
    unsafe {
        *core::ptr::addr_of_mut!(STATE) = Some(Session {
            seed,
            board: <Checkers as Adversary>::initial(seed),
            moves: Vec::new(),
            rng: ChaCha20Rng::seed_from_u64(seed),
            assisted: false,
        });
    }
}

// --- reads ----------

fn result_of(board: &Board) -> i8 {
    match <Checkers as Adversary>::result(board) {
        None => -1,
        Some(MatchResult::WinA) => 1,
        Some(MatchResult::WinB) => 2,
        Some(MatchResult::Draw) => 0,
    }
}

/// One legal move, with everything the front-end needs to animate and validate a
/// multi-jump without knowing the rules.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MoveView {
    /// The packed `(from, to, variant)` wire code — what [`play`] takes.
    code: u16,
    /// 0-based origin square.
    from: u8,
    /// 0-based final square.
    to: u8,
    /// Each landing in order; the last is `to`. Length 1 for a simple move, so a
    /// step and a one-hop jump are told apart by `captures`, not by this.
    path: Vec<u8>,
    /// The squares of the pieces this move takes, in hop order.
    captures: Vec<u8>,
    /// Whether this move crowns the moving man.
    crowns: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BoardView {
    /// Playable dark squares (32). The UI derives the 8x8 grid from the numbering.
    squares: usize,
    /// One byte per dark square, index `i` = square number `i + 1`.
    /// `0` empty, `1` A man, `2` A king, `3` B man, `4` B king.
    cells: Vec<u8>,
    /// Side to move: `1` = A/Black, `2` = B/White.
    to_move: u8,
    /// Every legal move, with its full path. Empty when the game is over.
    legal: Vec<MoveView>,
    /// Plies since the last capture or man advance; the game is drawn at 80.
    no_progress: u16,
    /// `-1` ongoing, `0` draw, `1` A won, `2` B won.
    result: i8,
}

fn move_views(board: &Board) -> Vec<MoveView> {
    // `legal_chains` and `legal_moves` are index-aligned by construction.
    legal_moves(board)
        .into_iter()
        .zip(legal_chains(board))
        .map(|(mv, chain)| MoveView {
            code: mv.code(),
            from: chain.from,
            to: chain.to,
            path: chain.landings,
            captures: chain.captures,
            crowns: chain.crowned,
        })
        .collect()
}

fn board_view(s: &Session) -> BoardView {
    let b = &s.board;
    BoardView {
        squares: SQUARES,
        cells: b.cells.to_vec(),
        to_move: match b.to_move {
            Side::A => 1,
            Side::B => 2,
        },
        legal: move_views(b),
        no_progress: b.no_progress,
        result: result_of(b),
    }
}

/// The current board (cells, side to move, legal moves with their paths, the
/// no-progress counter, result) as JSON. `"null"` if no game.
#[no_mangle]
pub extern "C" fn board_json() -> *const u8 {
    match session_mut() {
        Some(s) => set_out_json(&board_view(s)),
        None => set_out_str("null"),
    }
}

/// Every legal move as JSON `[{code, from, to, path, captures, crowns}]`.
///
/// Richer than the other games' bare index arrays, and deliberately so — see the
/// module docs. `[]` if the game is over or there is no game.
#[no_mangle]
pub extern "C" fn legal_moves_json() -> *const u8 {
    match session_mut() {
        Some(s) => set_out_json(&move_views(&s.board)),
        None => set_out_str("[]"),
    }
}

/// The canonical `state_hash` of the current state (quoted JSON string).
#[no_mangle]
pub extern "C" fn current_hash() -> *const u8 {
    match session_mut() {
        Some(s) => set_out_json(&<Checkers as Adversary>::state_hash(&s.board)),
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
        Some(s) => set_out_json(&<Checkers as Adversary>::render_text(&s.board)),
        None => set_out_str("\"\""),
    }
}

// --- moves (status: 0 applied / 1 illegal / 2 over or bad) ----------

/// Play the move named by packed `code` for the side to move. `1` if `code` is
/// not a legal move here; `2` if the match is over / no game / the code is not a
/// structurally valid move.
#[no_mangle]
pub extern "C" fn play(code: u32) -> u32 {
    let Some(s) = session_mut() else { return 2 };
    if result(&s.board).is_some() {
        return 2;
    }
    let Ok(packed) = u16::try_from(code) else {
        return 2;
    };
    let Some(mv) = Move::from_code(packed) else {
        return 2;
    };
    if !legal_moves(&s.board).contains(&mv) {
        return 1;
    }
    s.board = apply_move(&s.board, mv);
    s.moves.push(mv);
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
        Some(m) => u32::from(m.code()),
        None => MOVE_OVER,
    }
}

/// The **live** (shipped) opponent's move at difficulty `level` (0 Easy / 1
/// Medium / 2 Hard / 3 Expert): a packed move code, or `MOVE_OVER`
/// (`0xFFFF_FFFF`) if the match is over / no game.
#[no_mangle]
pub extern "C" fn live_move(level: u32) -> u32 {
    let Some(s) = session_mut() else {
        return MOVE_OVER;
    };
    let board = s.board;
    move_code(choose(&board, level_from(level), &mut s.rng))
}

/// The analysis oracle's best move at the strongest level (a packed code, or
/// `MOVE_OVER`). Heuristic at the horizon, proven where a terminal is reachable.
#[no_mangle]
pub extern "C" fn oracle_best(_level: u32) -> u32 {
    let Some(s) = session_mut() else {
        return MOVE_OVER;
    };
    move_code(best_move(&s.board, ORACLE_DEPTH))
}

#[derive(Serialize)]
struct MoveValue {
    col: u16,
    value: i32,
}

/// The value of every legal move (the analysis oracle's judgment) as JSON
/// `[{col, value}]`. Higher is better for the side to move. `[]` if none.
#[no_mangle]
pub extern "C" fn oracle_move_values_json() -> *const u8 {
    let Some(s) = session_mut() else {
        return set_out_str("[]");
    };
    let vals: Vec<MoveValue> = move_values(&s.board, ORACLE_DEPTH)
        .into_iter()
        .map(|(mv, value)| MoveValue {
            col: mv.code(),
            value,
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

/// The per-move tutor view.
///
/// `immediateWin` / `blocksOpponentWin` are always `false` for checkers (there is
/// no one-move win or single-square block) — they are carried so the view stays a
/// structural superset of the shared TS `TutorFactMove`, so `hybrid-player.ts`'s
/// `buildBand` reuses **unchanged**. Checkers' one-ply fact is `captures`.
///
/// `exact` is **this move's** flag, not the report's. Checkers has no
/// position-level tractability switch, so exactness is per move — see
/// `checkers_solver::tutor`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AssessView {
    col: u16,
    value: i32,
    best_value: i32,
    regret: i32,
    /// `"optimal"` / `"resultPreserving"` / `"blunder"`.
    quality: &'static str,
    immediate_win: bool,
    blocks_opponent_win: bool,
    /// How many pieces this move takes — checkers' one-ply fact.
    captures: u8,
    /// `true` when this move's value is a proven one (its line ends in a real
    /// terminal); `false` when it is a horizon judgement, so the UI hedges.
    exact: bool,
}

fn assess_view(m: &TutorMove) -> AssessView {
    AssessView {
        col: m.col,
        value: m.value,
        best_value: m.best_value,
        regret: m.regret,
        quality: quality_str(m.quality),
        immediate_win: false,
        blocks_opponent_win: false,
        captures: m.captures,
        exact: m.exact,
    }
}

/// Engine-grounded assessment of the candidate move `code` at the current
/// position: quality, regret, the capture count, and whether the value is
/// `exact`. `"null"` if there is no game or `code` is not a legal move.
#[no_mangle]
pub extern "C" fn assess_json(code: u32) -> *const u8 {
    let Some(s) = session_mut() else {
        return set_out_str("null");
    };
    let Ok(packed) = u16::try_from(code) else {
        return set_out_str("null");
    };
    let report = assess(&s.board);
    match report.moves.iter().find(|m| m.col == packed) {
        Some(m) => set_out_json(&assess_view(m)),
        None => set_out_str("null"),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TutorView {
    moves: Vec<AssessView>,
    /// The best move code (first, if several tie), or `null` if nothing to assess.
    best_col: Option<u16>,
    /// `true` only when **every** move in the report is proven.
    exact: bool,
}

/// The current position's whole-position tutor report: every legal move's
/// assessment, the best move, and whether the whole report is `exact`. `"null"`
/// if no game; an empty `moves` for a terminal position. Never panics.
#[no_mangle]
pub extern "C" fn tutor_json() -> *const u8 {
    let Some(s) = session_mut() else {
        return set_out_str("null");
    };
    let report = assess(&s.board);
    let view = TutorView {
        moves: report.moves.iter().map(assess_view).collect(),
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
/// (`kind = "checkers"`), verifiable by replaying `(seed, moves)` through
/// `checkers_core::Checkers`. `Won` when Side A (the opening player) won. When
/// `declare` is non-zero the self-declared assistance flag is included; when `0`
/// the declaration is opted out (`null`).
#[no_mangle]
pub extern "C" fn outcome_json(declare: u32) -> *const u8 {
    let Some(s) = session_mut() else {
        return set_out_str("null");
    };
    let result = match <Checkers as Adversary>::result(&s.board) {
        Some(MatchResult::WinA) => Outcome::Won,
        Some(MatchResult::WinB | MatchResult::Draw) => Outcome::Lost,
        None => Outcome::Abandoned,
    };
    let assistance = if declare != 0 { Some(s.assisted) } else { None };
    let record = attest::<Checkers>(s.seed, s.moves.clone(), result, assistance);
    match pond_outcome::to_doc::<Checkers>(&record) {
        Ok(bytes) => set_out(bytes),
        Err(_) => set_out_str("null"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Mutex, MutexGuard};

    /// The module holds **one** session in a `static mut`, and Rust runs tests in
    /// parallel threads — so two tests calling `new_game` interleave and each sees
    /// the other's board. (Othello's binding avoids this by having exactly one
    /// test; three named tests are worth a lock.) Poisoning is ignored on purpose:
    /// one failing test should report its own failure, not turn every other test
    /// in the file red behind it.
    static SESSION: Mutex<()> = Mutex::new(());

    fn exclusive() -> MutexGuard<'static, ()> {
        SESSION
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn out_slice(ptr: *const u8) -> Vec<u8> {
        let n = out_len() as usize;
        // SAFETY: single-threaded test; the caller just wrote OUT.
        unsafe { std::slice::from_raw_parts(ptr, n).to_vec() }
    }

    fn json(ptr: *const u8) -> serde_json::Value {
        serde_json::from_slice(&out_slice(ptr)).expect("exports emit valid JSON")
    }

    #[test]
    fn cabi_rules_tutor_and_outcome() {
        let _guard = exclusive();
        new_game(7, 0);

        // Fresh board: 24 men, A (1) to move, the counter at zero.
        let view = json(board_json());
        assert_eq!(view["toMove"], serde_json::json!(1));
        assert_eq!(view["result"], serde_json::json!(-1));
        assert_eq!(view["noProgress"], serde_json::json!(0));
        assert_eq!(view["squares"], serde_json::json!(32));
        assert_eq!(view["cells"].as_array().expect("cells").len(), 32);

        // The seven textbook opening moves, each carrying its path — the front-end
        // must never have to derive legality itself.
        let legal = json(legal_moves_json());
        let moves = legal.as_array().expect("an array of move objects");
        assert_eq!(moves.len(), 7, "the seven textbook opening moves");
        for m in moves {
            assert!(m["code"].is_number());
            assert_eq!(
                m["path"].as_array().expect("a path").len(),
                1,
                "an opening move is a single step"
            );
            assert_eq!(m["captures"].as_array().expect("captures").len(), 0);
            assert_eq!(m["crowns"], serde_json::json!(false));
        }

        // render_text tells a player how to name a move.
        let text: String = serde_json::from_value(json(render_text())).expect("a string");
        assert!(text.contains("11-15"), "names the move format");

        // An illegal move is rejected (1) and a malformed code is rejected (2) —
        // neither is a panic, because a wasm panic aborts the module.
        assert_eq!(play(0), 1, "square 1 to square 1 is not a move");
        assert_eq!(play(0x7FFF_FFFF), 2, "a code that cannot be a move");
        assert_eq!(
            play(u32::from(checkers_core::MAX_MOVE_CODE) + 1),
            2,
            "one past the largest valid code"
        );

        // Play the first offered move; the turn passes and the hash moves with it.
        let before = json(current_hash());
        let first = moves[0]["code"].as_u64().expect("a code") as u32;
        assert_eq!(play(first), 0);
        let after = json(board_json());
        assert_eq!(after["toMove"], serde_json::json!(2), "now B to move");
        assert_ne!(json(current_hash()), before, "the state hash moved");

        // The live engine returns a legal move for B, not a sentinel.
        let mv = live_move(3);
        assert_ne!(mv, MOVE_OVER);
        let b_legal = json(legal_moves_json());
        assert!(
            b_legal
                .as_array()
                .expect("moves")
                .iter()
                .any(|m| m["code"].as_u64() == Some(u64::from(mv))),
            "live_move returned a legal code"
        );

        // tutor_json early: capped, a best move, and the shared TutorFactMove
        // superset fields plus checkers' own one-ply fact.
        let t = json(tutor_json());
        assert_eq!(t["exact"], serde_json::json!(false), "early is capped");
        assert!(t["bestCol"].is_number(), "there is a best move");
        let first_fact = &t["moves"][0];
        assert_eq!(first_fact["immediateWin"], serde_json::json!(false));
        assert_eq!(first_fact["blocksOpponentWin"], serde_json::json!(false));
        assert!(first_fact.get("captures").is_some(), "carries the fact");
        assert!(first_fact.get("quality").is_some());
        assert!(
            first_fact.get("exact").is_some(),
            "per move, not per report"
        );

        // assess_json of an illegal code is null, not a panic.
        assert!(json(assess_json(0)).is_null());
        assert!(json(assess_json(0x7FFF_FFFF)).is_null());

        // outcome_json is a verifiable pond envelope of kind "checkers".
        let rec = json(outcome_json(0));
        assert_eq!(rec["kind"], serde_json::json!("checkers"));
        assert_eq!(rec["payload"]["assistance"], serde_json::Value::Null);

        // A declared assistance flag is honest.
        mark_assistance();
        let rec = json(outcome_json(1));
        assert_eq!(rec["payload"]["assistance"], serde_json::json!(true));
    }

    #[test]
    fn a_multi_jump_is_one_move_the_host_can_animate() {
        let _guard = exclusive();
        // The reason `legal_moves_json` returns objects: a chain has to reach the
        // front-end as a path it can step through, or the UI ends up
        // re-implementing the capture rules in TypeScript.
        new_game(1, 0);
        // A real line, taken from Phase 9's native self-play: 9-13, 22-17, and
        // then 13x22 is forced. (Each is asserted legal by `play` returning 0, so
        // a mis-chosen fixture fails loudly rather than testing nothing.)
        let code = |from: u8, to: u8| {
            u32::from(
                Move {
                    from: from - 1,
                    to: to - 1,
                    variant: 0,
                }
                .code(),
            )
        };
        assert_eq!(play(code(9, 13)), 0);
        assert_eq!(play(code(22, 17)), 0);

        let legal = json(legal_moves_json());
        let moves = legal.as_array().expect("moves");
        assert_eq!(moves.len(), 1, "capture is mandatory, so there is one move");
        let jump = &moves[0];
        assert_eq!(jump["captures"].as_array().expect("captures").len(), 1);
        assert_eq!(jump["path"].as_array().expect("path").len(), 1);
        assert_eq!(jump["from"], serde_json::json!(12), "from square 13");
        assert_eq!(jump["to"], serde_json::json!(21), "to square 22");
        assert_eq!(jump["captures"][0], serde_json::json!(16), "over square 17");
        // The host can play exactly what it was handed, which is the whole point
        // of shipping the code alongside the path.
        assert_eq!(play(jump["code"].as_u64().expect("a code") as u32), 0);
    }

    #[test]
    fn exports_answer_before_a_game_exists_instead_of_panicking() {
        let _guard = exclusive();
        // SAFETY: single-threaded test; clears the held session.
        unsafe {
            *core::ptr::addr_of_mut!(STATE) = None;
        }
        assert_eq!(result_code(), -2);
        assert_eq!(play(0), 2);
        assert_eq!(live_move(3), MOVE_OVER);
        assert_eq!(oracle_best(3), MOVE_OVER);
        assert!(json(board_json()).is_null());
        assert!(json(tutor_json()).is_null());
        assert!(json(assess_json(0)).is_null());
        assert!(json(outcome_json(0)).is_null());
        assert_eq!(json(legal_moves_json()), serde_json::json!([]));
        assert_eq!(json(current_hash()), serde_json::json!(""));
        assert_eq!(json(render_text()), serde_json::json!(""));
        mark_assistance(); // must be a no-op, not a panic
    }
}
