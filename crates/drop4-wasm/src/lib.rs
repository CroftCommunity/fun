//! Browser binding over [`drop4_core`] + [`drop4_solver`] — raw C-ABI +
//! serde-JSON, no `wasm-bindgen` (the same pattern as `twenty48-wasm`).
//!
//! The module holds **one** Drop 4 match. Rules exports let the host read legal
//! columns / play / read the board, hash, result, and render text (for an LLM
//! prompt). The **shipped opponent** is [`live_move`] — a depth-capped
//! heuristic engine fast from any position. Oracle exports expose the exact
//! solver as an opponent ([`oracle_best`], at a difficulty `level`) and as the
//! per-move judgment source for a hybrid difficulty band
//! ([`oracle_move_values_json`]). Reads are JSON written to one output buffer
//! the host reads via the return pointer + [`out_len`].
//!
//! **Never panics** (a wasm panic aborts the module): every fallible path maps
//! to a status code or an empty/`"null"` buffer.
//!
//! Speed note: the exact oracle is fast in the endgame but a full solve from an
//! early position is expensive — live play from the opening needs an opening
//! book or a depth cap (a follow-up), so the host should call the oracle from
//! book/endgame positions until then.

use adversary_core::{Adversary, MatchResult, Side};
use drop4_core::{apply_move, legal_cols, Board, Col, Drop4, HEIGHT, WIDTH};
use drop4_solver::{choose_capped, Level, Solver};
use pond_outcome::{attest, Outcome};
use rand_chacha::rand_core::SeedableRng;
use rand_chacha::ChaCha20Rng;
use serde::Serialize;

// --- the held session ----------

struct Session {
    seed: u64,
    board: Board,
    moves: Vec<Col>,
    rng: ChaCha20Rng,
    solver: Option<Solver>,
    /// Self-declared assistance (a hint was used). Recorded in the outcome only
    /// when the host declares it (see [`outcome_json`]).
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

/// Start a fresh Drop 4 match for `seed` (the standard empty board; Side A / X
/// moves first). `seed` seeds the opponent's difficulty RNG.
#[no_mangle]
pub extern "C" fn new_game(seed_lo: u32, seed_hi: u32) {
    let seed = (u64::from(seed_hi) << 32) | u64::from(seed_lo);
    // SAFETY: single-threaded; replaces the held session.
    unsafe {
        *core::ptr::addr_of_mut!(STATE) = Some(Session {
            seed,
            board: <Drop4 as Adversary>::initial(seed),
            moves: Vec::new(),
            rng: ChaCha20Rng::seed_from_u64(seed),
            solver: None,
            assisted: false,
        });
    }
}

// --- reads ----------

fn result_of(board: &Board) -> i8 {
    match <Drop4 as Adversary>::result(board) {
        None => -1,
        Some(MatchResult::WinA) => 1,
        Some(MatchResult::WinB) => 2,
        Some(MatchResult::Draw) => 0,
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BoardView {
    width: usize,
    height: usize,
    /// Row-major rows, **row 0 = bottom**. `0` empty, `1` = A/X, `2` = B/O.
    cells: Vec<Vec<u8>>,
    /// Side to move: `1` = A/X, `2` = B/O.
    to_move: u8,
    /// Columns that can still be played.
    legal: Vec<u8>,
    /// `-1` ongoing, `0` draw, `1` A won, `2` B won.
    result: i8,
}

fn board_view(s: &Session) -> BoardView {
    let b = &s.board;
    let cells = (0..HEIGHT)
        .map(|r| (0..WIDTH).map(|c| b.get(c, r)).collect())
        .collect();
    BoardView {
        width: WIDTH,
        height: HEIGHT,
        cells,
        to_move: match b.to_move {
            Side::A => 1,
            Side::B => 2,
        },
        legal: legal_cols(b).iter().map(|c| c.0).collect(),
        result: result_of(b),
    }
}

/// The current board (cells, side to move, legal columns, result) as JSON.
/// `"null"` if no game.
#[no_mangle]
pub extern "C" fn board_json() -> *const u8 {
    match session_mut() {
        Some(s) => set_out_json(&board_view(s)),
        None => set_out_str("null"),
    }
}

/// The legal columns as a JSON array. `[]` if none / no game.
#[no_mangle]
pub extern "C" fn legal_moves_json() -> *const u8 {
    match session_mut() {
        Some(s) => {
            let cols: Vec<u8> = legal_cols(&s.board).iter().map(|c| c.0).collect();
            set_out_json(&cols)
        }
        None => set_out_str("[]"),
    }
}

/// The canonical `state_hash` of the current state (quoted JSON string).
#[no_mangle]
pub extern "C" fn current_hash() -> *const u8 {
    match session_mut() {
        Some(s) => set_out_json(&<Drop4 as Adversary>::state_hash(&s.board)),
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
        Some(s) => set_out_json(&<Drop4 as Adversary>::render_text(&s.board)),
        None => set_out_str("\"\""),
    }
}

// --- moves (status: 0 applied / 1 illegal / 2 over or bad) ----------

/// Drop a disc in `col` for the side to move. `1` if the column is full/illegal;
/// `2` if the match is already over or `col` is out of range.
#[no_mangle]
pub extern "C" fn play(col: u32) -> u32 {
    let Some(s) = session_mut() else { return 2 };
    if <Drop4 as Adversary>::result(&s.board).is_some() {
        return 2;
    }
    let Ok(c) = u8::try_from(col) else { return 2 };
    let mv = Col(c);
    if !legal_cols(&s.board).contains(&mv) {
        return 1;
    }
    s.board = apply_move(&s.board, mv);
    s.moves.push(mv);
    0
}

// --- oracle ----------

fn level_from(code: u32) -> Level {
    match code {
        0 => Level::Easy,
        1 => Level::Medium,
        2 => Level::Hard,
        _ => Level::Perfect,
    }
}

/// The opponent's move at difficulty `level` (0 Easy / 1 Medium / 2 Hard /
/// 3 Perfect) as a column index, or `0xFFFF_FFFF` if the match is over / no
/// game. Exact solver — see the speed note in the module docs.
#[no_mangle]
pub extern "C" fn oracle_best(level: u32) -> u32 {
    let Some(s) = session_mut() else {
        return 0xFFFF_FFFF;
    };
    let board = s.board;
    let solver = s.solver.get_or_insert_with(Solver::new);
    match solver.choose(&board, level_from(level), &mut s.rng) {
        Some(mv) => u32::from(mv.0),
        None => 0xFFFF_FFFF,
    }
}

/// The **live** opponent's move at difficulty `level` (0 Easy / 1 Medium /
/// 2 Hard / 3 Perfect) as a column index, or `0xFFFF_FFFF` if the match is
/// over / no game. This is the **shipped** opponent: a depth-capped heuristic
/// search that returns a move in well under a frame from any position, seeded by
/// the session RNG (unlike [`oracle_best`], which is exact but slow from the
/// opening — see the speed note in the module docs).
#[no_mangle]
pub extern "C" fn live_move(level: u32) -> u32 {
    let Some(s) = session_mut() else {
        return 0xFFFF_FFFF;
    };
    match choose_capped(&s.board, level_from(level), &mut s.rng) {
        Some(mv) => u32::from(mv.0),
        None => 0xFFFF_FFFF,
    }
}

#[derive(Serialize)]
struct MoveValue {
    col: u8,
    value: i32,
}

/// The exact value of every legal move (the Oracle's judgment) as JSON
/// `[{col, value}]` — the source for a hybrid difficulty band. Higher value is
/// better for the side to move. Exact solver — see the speed note.
#[no_mangle]
pub extern "C" fn oracle_move_values_json() -> *const u8 {
    let Some(s) = session_mut() else {
        return set_out_str("[]");
    };
    let board = s.board;
    let solver = s.solver.get_or_insert_with(Solver::new);
    let vals: Vec<MoveValue> = solver
        .move_values(&board)
        .into_iter()
        .map(|(c, v)| MoveValue { col: c.0, value: v })
        .collect();
    set_out_json(&vals)
}

// --- assistance ----------

/// Record that the player used a hint this match (assistance). Whether it is
/// carried in the outcome is the host's honest declaration — see [`outcome_json`].
#[no_mangle]
pub extern "C" fn mark_assistance() {
    if let Some(s) = session_mut() {
        s.assisted = true;
    }
}

// --- outcome ----------

/// The outcome record for the current match as a `pond-docformat` envelope JSON
/// (`kind = "drop4"`), verifiable by replaying `(seed, moves)` through
/// `drop4_core::Drop4`. `Won` when Side A (the opening player) won. When
/// `declare` is non-zero the self-declared assistance flag is included
/// (`Some(assisted)`); when `0` the declaration is opted out (`None`).
#[no_mangle]
pub extern "C" fn outcome_json(declare: u32) -> *const u8 {
    let Some(s) = session_mut() else {
        return set_out_str("null");
    };
    let result = match <Drop4 as Adversary>::result(&s.board) {
        Some(MatchResult::WinA) => Outcome::Won,
        Some(MatchResult::WinB | MatchResult::Draw) => Outcome::Lost,
        None => Outcome::Abandoned,
    };
    let assistance = if declare != 0 { Some(s.assisted) } else { None };
    let record = attest::<Drop4>(s.seed, s.moves.clone(), result, assistance);
    match pond_outcome::to_doc::<Drop4>(&record) {
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

    #[test]
    fn cabi_rules_oracle_and_outcome() {
        new_game(7, 0);

        // Fresh board: 7 legal columns, A (1) to move, ongoing.
        let view: serde_json::Value = serde_json::from_slice(&out_slice(board_json())).unwrap();
        assert_eq!(view["toMove"], serde_json::json!(1));
        assert_eq!(view["legal"].as_array().unwrap().len(), 7);
        assert_eq!(view["result"], serde_json::json!(-1));

        // render_text is a valid JSON string mentioning a column prompt.
        let text: String = serde_json::from_slice(&out_slice(render_text())).unwrap();
        assert!(text.contains("column"));

        // Play A:0 O:1 A:0 O:1 A:0 O:1 — A now has three in col 0, to move.
        for c in [0, 1, 0, 1, 0, 1] {
            assert_eq!(play(c), 0);
        }
        // A non-legal column is rejected as illegal (1), not a panic.
        assert_eq!(play(99), 1);

        // The exact oracle takes the immediate win in col 0 (fast: short-circuit).
        assert_eq!(oracle_best(3), 0, "Perfect takes the immediate win");

        // The live (depth-capped) engine — the shipped opponent — also takes the
        // immediate win in col 0, fast from any position.
        assert_eq!(live_move(3), 0, "live engine takes the immediate win");

        // Play the winning move; A (1) has won.
        assert_eq!(play(0), 0);
        assert_eq!(result_code(), 1);

        // Opting out of the assistance declaration leaves it `null`.
        let rec: serde_json::Value = serde_json::from_slice(&out_slice(outcome_json(0))).unwrap();
        assert_eq!(rec["kind"], serde_json::json!("drop4"));
        assert_eq!(rec["payload"]["assistance"], serde_json::Value::Null);

        // A declared assistance flag is honest: after `mark_assistance`, a
        // declared outcome carries `assistance: true`.
        mark_assistance();
        let rec: serde_json::Value = serde_json::from_slice(&out_slice(outcome_json(1))).unwrap();
        assert_eq!(rec["payload"]["assistance"], serde_json::json!(true));
    }
}
