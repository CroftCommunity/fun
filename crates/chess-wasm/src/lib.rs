//! Browser binding over [`chess_core`] + [`chess_solver`] — raw C-ABI +
//! serde-JSON, no `wasm-bindgen` (the same pattern as `checkers-wasm`).
//!
//! The module holds **one** chess game. Rules exports let the host read legal
//! moves / play a move / read the board, FEN, hash, result, and render text
//! (for an LLM prompt). The **shipped opponent** is [`live_move`] (a
//! difficulty-tuned band over the search). Tutor exports ([`assess_json`],
//! [`coach_json`], [`tutor_json`]) expose engine-grounded coaching facts with
//! the honest `exact` flag, and — chess being the first shelf game to ship a
//! deepening search — the **depth actually reached and the nodes consumed**,
//! so a slow move on a phone is read against numbers the phone produced.
//!
//! **Never panics** (a wasm panic aborts the module): every fallible path maps
//! to a status code or an empty/`"null"` buffer.
//!
//! ## What is chess's own here
//!
//! - [`legal_moves_json`] returns objects with `from` / `to` / `promo`
//!   unpacked, so the UI never re-derives the 15-bit code's layout — and a
//!   promotion square appears as four entries the picker chooses among.
//! - [`board_json`] carries `lastSan`, computed at [`play`] time from the
//!   pre-move position: the seat's sub-label reads "Nf3+" from the one call
//!   it already makes. [`san_json`] stays for the one caller that names a move
//!   *not yet played* — the Hint ring.
//! - [`fen`] for debugging, the guide, and the recorded follow-up (an external
//!   engine level) that would speak UCI.

#![warn(missing_docs)]

use adversary_core::{Adversary, MatchResult};
use chess_core::board::{color_of, kind_of};
use chess_core::{
    attacked, king_square, result, san_of, Chess, Color, Move, PieceKind, Position, MAX_MOVE_CODE,
};
use chess_solver::{
    assess, assess_for_move, choose, search_root, Level, MoveClass, TutorMove, TutorReport,
};
use pond_outcome::{attest, Outcome};
use rand_chacha::rand_core::SeedableRng;
use rand_chacha::ChaCha20Rng;
use serde::Serialize;

/// Returned by [`live_move`] / [`oracle_best`] when the game is over / no game.
const MOVE_OVER: u32 = 0xFFFF_FFFF;

/// The analysis oracle searches as the strongest shipped level does.
const ORACLE_LEVEL: Level = Level::Expert;

// --- the held session ----------

struct Session {
    seed: u64,
    pos: Position,
    moves: Vec<Move>,
    rng: ChaCha20Rng,
    assisted: bool,
    /// The last move played and its SAN, from the position it was played in.
    last: Option<(Move, String)>,
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

/// Start a fresh game for `seed` (the standard start; White / Side A moves
/// first — the seed is reserved for Chess960 and today only seeds the
/// opponent's difficulty RNG).
#[no_mangle]
pub extern "C" fn new_game(seed_lo: u32, seed_hi: u32) {
    let seed = (u64::from(seed_hi) << 32) | u64::from(seed_lo);
    // SAFETY: single-threaded; replaces the held session.
    unsafe {
        *core::ptr::addr_of_mut!(STATE) = Some(Session {
            seed,
            pos: <Chess as Adversary>::initial(seed),
            moves: Vec::new(),
            rng: ChaCha20Rng::seed_from_u64(seed),
            assisted: false,
            last: None,
        });
    }
}

// --- reads ----------

fn result_of(pos: &Position) -> i8 {
    match result(pos) {
        None => -1,
        Some(MatchResult::WinA) => 1,
        Some(MatchResult::WinB) => 2,
        Some(MatchResult::Draw) => 0,
    }
}

/// One legal move with its code unpacked (RULES §3) so the UI never re-derives
/// the layout; a promotion square appears as four entries differing in `promo`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MoveView {
    /// The packed `(from, to, promo)` wire code — what [`play`] takes.
    code: u16,
    /// 0-based origin square (a1 = 0 … h8 = 63).
    from: u8,
    /// 0-based destination square.
    to: u8,
    /// `0` none; `1..=4` = knight, bishop, rook, queen.
    promo: u8,
}

fn move_views(pos: &Position) -> Vec<MoveView> {
    <Chess as Adversary>::legal_moves(pos)
        .into_iter()
        .map(|mv| MoveView {
            code: mv.code(),
            from: mv.from,
            to: mv.to,
            promo: mv.promo,
        })
        .collect()
}

/// Points of `color`'s material still on the board (Q 9, R 5, B 3, N 3, P 1).
fn material_points(pos: &Position, color: Color) -> u32 {
    pos.board
        .cells
        .iter()
        .filter(|&&c| color_of(c) == Some(color))
        .map(|&c| match kind_of(c) {
            Some(PieceKind::Pawn) => 1,
            Some(PieceKind::Knight | PieceKind::Bishop) => 3,
            Some(PieceKind::Rook) => 5,
            Some(PieceKind::Queen) => 9,
            _ => 0,
        })
        .sum()
}

/// The full starting material, in points.
const START_POINTS: u32 = 39;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BoardView {
    /// 64 cells, a1 = index 0 … h8 = 63 (RULES §2 encoding: `0` empty,
    /// `1..=6` white P N B R Q K, `9..=14` black).
    cells: Vec<u8>,
    /// Side to move: `1` = White / Side A, `2` = Black / Side B.
    to_move: u8,
    /// Castling rights, the four `CASTLE_*` bits (`K`=1, `Q`=2, `k`=4, `q`=8).
    castling: u8,
    /// The en-passant square, or `null`.
    ep: Option<u8>,
    /// Plies since the last pawn move or capture; the game is drawn at 100.
    halfmove: u16,
    /// Starts at 1, increments after Black moves.
    fullmove: u16,
    /// Whether the side to move is in check.
    in_check: bool,
    /// The last move's packed code, or `null` before the first move.
    last_move: Option<u16>,
    /// The last move in SAN (`"Nf3+"`), computed when it was played; `null`
    /// before the first move.
    last_san: Option<String>,
    /// Points of material each side has captured, `[white, black]`.
    captured: [u32; 2],
    /// Every legal move, unpacked. Empty when the game is over.
    legal: Vec<MoveView>,
    /// `-1` ongoing, `0` draw, `1` White won, `2` Black won.
    result: i8,
}

fn board_view(s: &Session) -> BoardView {
    let b = &s.pos.board;
    BoardView {
        cells: b.cells.to_vec(),
        to_move: match b.side {
            Color::White => 1,
            Color::Black => 2,
        },
        castling: b.castling,
        ep: b.ep,
        halfmove: b.halfmove,
        fullmove: b.fullmove,
        in_check: attacked(b, king_square(b, b.side), b.side.other()),
        last_move: s.last.as_ref().map(|(mv, _)| mv.code()),
        last_san: s.last.as_ref().map(|(_, san)| san.clone()),
        captured: [
            START_POINTS.saturating_sub(material_points(&s.pos, Color::Black)),
            START_POINTS.saturating_sub(material_points(&s.pos, Color::White)),
        ],
        legal: move_views(&s.pos),
        result: result_of(&s.pos),
    }
}

/// The current board as JSON (see `BoardView`). `"null"` if no game.
#[no_mangle]
pub extern "C" fn board_json() -> *const u8 {
    match session_mut() {
        Some(s) => set_out_json(&board_view(s)),
        None => set_out_str("null"),
    }
}

/// Every legal move as JSON `[{code, from, to, promo}]`. `[]` if the game is
/// over or there is no game.
#[no_mangle]
pub extern "C" fn legal_moves_json() -> *const u8 {
    match session_mut() {
        Some(s) => set_out_json(&move_views(&s.pos)),
        None => set_out_str("[]"),
    }
}

/// The current position's FEN (quoted JSON string). `""` if no game.
#[no_mangle]
pub extern "C" fn fen() -> *const u8 {
    match session_mut() {
        Some(s) => set_out_json(&s.pos.board.to_fen()),
        None => set_out_str("\"\""),
    }
}

/// The SAN of the legal move `code` in the current position (quoted JSON
/// string) — for a move **not yet played** (the Hint ring). `""` if no game
/// or `code` is not a legal move here.
#[no_mangle]
pub extern "C" fn san_json(code: u32) -> *const u8 {
    let Some(s) = session_mut() else {
        return set_out_str("\"\"");
    };
    let Some(mv) = u16::try_from(code).ok().and_then(Move::from_code) else {
        return set_out_str("\"\"");
    };
    if !<Chess as Adversary>::legal_moves(&s.pos).contains(&mv) {
        return set_out_str("\"\"");
    }
    set_out_json(&san_of(&s.pos, mv))
}

/// The canonical `state_hash` of the current state (quoted JSON string).
#[no_mangle]
pub extern "C" fn current_hash() -> *const u8 {
    match session_mut() {
        Some(s) => set_out_json(&<Chess as Adversary>::state_hash(&s.pos)),
        None => set_out_str("\"\""),
    }
}

/// `-1` ongoing, `0` draw, `1` White won, `2` Black won, `-2` no game.
#[no_mangle]
pub extern "C" fn result_code() -> i32 {
    match session_mut() {
        Some(s) => i32::from(result_of(&s.pos)),
        None => -2,
    }
}

/// A human/LLM-readable rendering of the board + whose turn (JSON string).
#[no_mangle]
pub extern "C" fn render_text() -> *const u8 {
    match session_mut() {
        Some(s) => set_out_json(&<Chess as Adversary>::render_text(&s.pos)),
        None => set_out_str("\"\""),
    }
}

// --- moves (status: 0 applied / 1 illegal / 2 over or bad) ----------

/// Play the move named by packed `code` for the side to move. `1` if `code` is
/// not a legal move here; `2` if the game is over / no game / the code is not
/// a structurally valid move.
#[no_mangle]
pub extern "C" fn play(code: u32) -> u32 {
    let Some(s) = session_mut() else { return 2 };
    if result(&s.pos).is_some() {
        return 2;
    }
    let Ok(packed) = u16::try_from(code) else {
        return 2;
    };
    if packed > MAX_MOVE_CODE {
        return 2;
    }
    let Some(mv) = Move::from_code(packed) else {
        return 2;
    };
    if !<Chess as Adversary>::legal_moves(&s.pos).contains(&mv) {
        return 1;
    }
    let san = san_of(&s.pos, mv);
    s.pos = <Chess as Adversary>::apply(&s.pos, mv);
    s.moves.push(mv);
    s.last = Some((mv, san));
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
/// (`0xFFFF_FFFF`) if the game is over / no game.
#[no_mangle]
pub extern "C" fn live_move(level: u32) -> u32 {
    let Some(s) = session_mut() else {
        return MOVE_OVER;
    };
    let pos = s.pos;
    move_code(choose(&pos, level_from(level), &mut s.rng))
}

/// The analysis oracle's best move at the strongest level (a packed code, or
/// `MOVE_OVER`). Heuristic at the horizon, proven where a terminal is reachable.
#[no_mangle]
pub extern "C" fn oracle_best(_level: u32) -> u32 {
    let Some(s) = session_mut() else {
        return MOVE_OVER;
    };
    if result(&s.pos).is_some() {
        return MOVE_OVER;
    }
    let report = search_root(&s.pos, ORACLE_LEVEL.depth(), ORACLE_LEVEL.budget());
    move_code(
        report
            .moves
            .iter()
            .max_by_key(|&&(_, sc)| sc.value)
            .map(|&(mv, _)| mv),
    )
}

#[derive(Serialize)]
struct MoveValue {
    col: u16,
    value: i32,
}

#[derive(Serialize)]
struct OracleView {
    moves: Vec<MoveValue>,
    /// The depth the deepening search actually reached (a ceiling, not a
    /// promise), and the nodes it consumed — the numbers a slow move is read
    /// against.
    depth: u32,
    nodes: u64,
}

/// The value of every legal move (the analysis oracle's judgment) as JSON
/// `{moves: [{col, value}], depth, nodes}`. Higher is better for the side to
/// move. Empty `moves` if none.
#[no_mangle]
pub extern "C" fn oracle_move_values_json() -> *const u8 {
    let Some(s) = session_mut() else {
        return set_out_str("{\"moves\":[],\"depth\":0,\"nodes\":0}");
    };
    let report = search_root(&s.pos, ORACLE_LEVEL.depth(), ORACLE_LEVEL.budget());
    let view = OracleView {
        moves: report
            .moves
            .iter()
            .map(|&(mv, sc)| MoveValue {
                col: mv.code(),
                value: sc.value,
            })
            .collect(),
        depth: report.depth,
        nodes: report.nodes,
    };
    set_out_json(&view)
}

// --- tutor (engine-grounded coaching facts) ----------

fn quality_str(q: MoveClass) -> &'static str {
    match q {
        MoveClass::Optimal => "optimal",
        MoveClass::ResultPreserving => "resultPreserving",
        MoveClass::Blunder => "blunder",
    }
}

/// The per-move tutor view — a structural superset of the shared TS
/// `TutorFactMove` (`col`, `value`, `quality`, `immediateWin`,
/// `blocksOpponentWin`), so `hybrid-player.ts`'s `buildBand` reuses unchanged,
/// plus chess's own one-ply facts.
// The booleans are the shared wire shape plus chess's one-ply facts, each read
// by name on the TS side — not a state machine in disguise.
#[allow(clippy::struct_excessive_bools)]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AssessView {
    col: u16,
    /// The move in SAN — what a player reads.
    san: String,
    value: i32,
    best_value: i32,
    regret: i32,
    /// `"optimal"` / `"resultPreserving"` / `"blunder"`.
    quality: &'static str,
    /// This move mates on the spot.
    immediate_win: bool,
    /// Carried `false` (the shared shape requires the field).
    blocks_opponent_win: bool,
    /// This move gives check.
    gives_check: bool,
    /// The captured piece kind (`0` none; `1..=6` P N B R Q K).
    captures: u8,
    /// The promotion piece code (`0` none; `1..=4` N B R Q).
    promotes: u8,
    /// This move castles.
    castles: bool,
    /// `true` when this move's value is a proven one (its line ends in a real
    /// terminal); `false` when it is a horizon judgement, so the UI hedges.
    exact: bool,
}

fn assess_view(m: &TutorMove) -> AssessView {
    AssessView {
        col: m.col,
        san: m.san.clone(),
        value: m.value,
        best_value: m.best_value,
        regret: m.regret,
        quality: quality_str(m.quality),
        immediate_win: m.immediate_win,
        blocks_opponent_win: m.blocks_opponent_win,
        gives_check: m.gives_check,
        captures: m.captures,
        promotes: m.promotes,
        castles: m.castles,
        exact: m.exact,
    }
}

/// Engine-grounded assessment of the candidate move `code` at the current
/// position. `"null"` if there is no game or `code` is not a legal move.
///
/// The **analysis** budget, deliberately: this export is what the scoring
/// harness grades through, and a grader that searches no deeper than the
/// player it grades is not an oracle. The UI's tap path reads [`coach_json`].
#[no_mangle]
pub extern "C" fn assess_json(code: u32) -> *const u8 {
    let Some(s) = session_mut() else {
        return set_out_str("null");
    };
    let Ok(packed) = u16::try_from(code) else {
        return set_out_str("null");
    };
    let report = assess(&s.pos);
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
    /// The depth the search actually reached, and the nodes it consumed.
    depth: u32,
    nodes: u64,
}

fn report_json(report: &TutorReport) -> *const u8 {
    let view = TutorView {
        moves: report.moves.iter().map(assess_view).collect(),
        best_col: report.best_col,
        exact: report.exact,
        depth: report.depth,
        nodes: report.nodes,
    };
    set_out_json(&view)
}

/// The whole-position report at the **per-move coach** budget — what the UI
/// reads on a tap. Same shape as [`tutor_json`], deliberately cheaper: a
/// shallower search hedges more often; it never grades dishonestly, because a
/// blunder still needs two proofs. `"null"` if no game. Never panics.
#[no_mangle]
pub extern "C" fn coach_json() -> *const u8 {
    let Some(s) = session_mut() else {
        return set_out_str("null");
    };
    report_json(&assess_for_move(&s.pos))
}

/// The whole-position tutor report at the **panel** budget: every legal
/// move's assessment, the best move, whether the whole report is `exact`, and
/// the depth/nodes reached. Opened deliberately, never on a tap. `"null"` if
/// no game; an empty `moves` for a terminal position. Never panics.
#[no_mangle]
pub extern "C" fn tutor_json() -> *const u8 {
    let Some(s) = session_mut() else {
        return set_out_str("null");
    };
    report_json(&assess(&s.pos))
}

// --- assistance + outcome ----------

/// Record that the player used a hint or an undo this game (assistance).
#[no_mangle]
pub extern "C" fn mark_assistance() {
    if let Some(s) = session_mut() {
        s.assisted = true;
    }
}

/// The outcome record for the current game as a `pond-docformat` envelope
/// JSON (`kind = "chess"`), verifiable by replaying `(seed, moves)` through
/// `chess_core::Chess`. `Won` when Side A (White) won. When `declare` is
/// non-zero the self-declared assistance flag is included; when `0` the
/// declaration is opted out (`null`).
#[no_mangle]
pub extern "C" fn outcome_json(declare: u32) -> *const u8 {
    let Some(s) = session_mut() else {
        return set_out_str("null");
    };
    let outcome = match result(&s.pos) {
        Some(MatchResult::WinA) => Outcome::Won,
        Some(MatchResult::WinB | MatchResult::Draw) => Outcome::Lost,
        None => Outcome::Abandoned,
    };
    let assistance = if declare != 0 { Some(s.assisted) } else { None };
    let record = attest::<Chess>(s.seed, s.moves.clone(), outcome, assistance);
    match pond_outcome::to_doc::<Chess>(&record) {
        Ok(bytes) => set_out(bytes),
        Err(_) => set_out_str("null"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Mutex, MutexGuard};

    /// One session in a `static mut`, tests in parallel threads: a lock, as
    /// checkers' binding has. Poisoning is ignored so one failure reports
    /// itself rather than reddening every other test behind it.
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

    fn code_of(uci: &str) -> u32 {
        let s = session_mut().expect("a game");
        u32::from(
            <Chess as Adversary>::parse_move(&s.pos, uci)
                .expect("test move is legal")
                .code(),
        )
    }

    #[test]
    fn a_game_through_the_exports_matches_the_committed_threefold_vector() {
        // The knight shuffle vector (Phase 2) replayed through play(): the
        // binding's hash must equal the natively recorded one, and the draw
        // must be reported.
        let _guard = exclusive();
        let vector: serde_json::Value =
            serde_json::from_str(include_str!("../../chess-core/vectors/02-threefold.json"))
                .expect("vector parses");
        new_game(0, 0);
        assert_eq!(json(board_json())["lastSan"], serde_json::Value::Null);
        for code in vector["moves"].as_array().expect("moves") {
            assert_eq!(play(code.as_u64().expect("code") as u32), 0);
        }
        assert_eq!(json(current_hash()), vector["final_state_hash"]);
        assert_eq!(result_code(), 0, "the threefold draw");
        // Every export on a terminal game answers its "over" value, enumerated.
        assert_eq!(live_move(3), MOVE_OVER);
        assert_eq!(oracle_best(3), MOVE_OVER);
        assert_eq!(
            play(code_of_unchecked("g1f3")),
            2,
            "no move after the terminal"
        );
        assert!(json(coach_json())["moves"]
            .as_array()
            .expect("array")
            .is_empty());
        assert!(json(tutor_json())["moves"]
            .as_array()
            .expect("array")
            .is_empty());
        assert_eq!(json(assess_json(0)), serde_json::Value::Null);
        assert!(json(legal_moves_json())
            .as_array()
            .expect("array")
            .is_empty());
        assert_eq!(json(board_json())["result"], 0);
        let outcome = out_slice(outcome_json(1));
        assert!(!outcome.is_empty() && outcome != b"null");
    }

    /// A code for a UCI move even when the game is over (the parse refuses
    /// through the trait, so pack it by hand).
    fn code_of_unchecked(uci: &str) -> u32 {
        let from = chess_core::board::square_from_text(&uci[0..2]).expect("sq");
        let to = chess_core::board::square_from_text(&uci[2..4]).expect("sq");
        u32::from(Move { from, to, promo: 0 }.code())
    }

    #[test]
    fn play_returns_each_of_its_three_values_from_its_own_input() {
        let _guard = exclusive();
        new_game(1, 0);
        assert_eq!(
            play(u32::from(MAX_MOVE_CODE) + 1),
            2,
            "structurally invalid"
        );
        assert_eq!(
            play(code_of_unchecked("e2e5")),
            1,
            "well-formed but illegal"
        );
        assert_eq!(play(code_of("e2e4")), 0, "legal");
        let b = json(board_json());
        assert_eq!(b["lastSan"], "e4");
        assert_eq!(b["toMove"], 2);
        assert_eq!(b["fullmove"], 1);
        assert_eq!(
            json(fen()).as_str().expect("fen"),
            "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1"
        );
    }

    #[test]
    fn board_json_reports_check_the_last_san_and_captured_material() {
        let _guard = exclusive();
        new_game(2, 0);
        for uci in ["e2e4", "e7e5", "d1h5", "b8c6", "h5f7"] {
            assert_eq!(play(code_of(uci)), 0);
        }
        let b = json(board_json());
        // Qxf7+ : a check, a pawn captured, SAN carries the suffix.
        assert_eq!(b["inCheck"], true);
        assert_eq!(b["lastSan"], "Qxf7+");
        assert_eq!(b["captured"][0], 1, "White has taken one point");
        assert_eq!(b["captured"][1], 0);
        assert_eq!(b["result"], -1);
        // Before the checking move it was not check.
        new_game(2, 0);
        assert_eq!(play(code_of("e2e4")), 0);
        assert_eq!(json(board_json())["inCheck"], false);
    }

    #[test]
    fn legal_moves_json_unpacks_a_promotion_square_as_four_entries() {
        let _guard = exclusive();
        new_game(3, 0);
        // Reach a promotion cheaply: play into a position through the exports
        // is long, so seed the session's position directly through the
        // binding's own state.
        {
            let s = session_mut().expect("game");
            s.pos = Position::from_board(
                chess_core::Board::from_fen("7k/4P3/8/8/8/8/8/4K3 w - - 0 1").expect("fen"),
            );
        }
        let legal = json(legal_moves_json());
        let promos: Vec<&serde_json::Value> = legal
            .as_array()
            .expect("array")
            .iter()
            .filter(|m| m["promo"].as_u64().expect("promo") != 0)
            .collect();
        assert_eq!(promos.len(), 4);
        assert!(promos.iter().all(|m| m["from"] == 52 && m["to"] == 60));
        let mut ps: Vec<u64> = promos
            .iter()
            .map(|m| m["promo"].as_u64().expect("p"))
            .collect();
        ps.sort_unstable();
        assert_eq!(ps, vec![1, 2, 3, 4]);
        // The promotion code round-trips through play and reads back as SAN.
        let queen = promos.iter().find(|m| m["promo"] == 4).expect("queen");
        assert_eq!(
            json(san_json(queen["code"].as_u64().expect("code") as u32)),
            "e8=Q+"
        );
        assert_eq!(play(queen["code"].as_u64().expect("code") as u32), 0);
        assert_eq!(json(board_json())["lastSan"], "e8=Q+");
    }

    #[test]
    fn the_reports_carry_depth_and_nodes_within_the_level_ceiling() {
        let _guard = exclusive();
        new_game(4, 0);
        let coach = json(coach_json());
        assert!(coach["depth"].as_u64().expect("depth") >= 1);
        assert!(coach["depth"].as_u64().expect("depth") <= u64::from(Level::Hard.depth()));
        assert!(coach["nodes"].as_u64().expect("nodes") > 0);
        assert_eq!(coach["moves"].as_array().expect("moves").len(), 20);
        let oracle = json(oracle_move_values_json());
        assert!(oracle["depth"].as_u64().expect("depth") <= u64::from(Level::Expert.depth()));
        assert_eq!(oracle["moves"].as_array().expect("moves").len(), 20);
        // The hint path: san_json names a move not yet played.
        let best = oracle_best(3);
        assert_ne!(best, MOVE_OVER);
        assert!(!json(san_json(best)).as_str().expect("san").is_empty());
    }

    #[test]
    #[cfg_attr(debug_assertions, ignore = "release only: panel-budget searches")]
    fn assess_json_grades_with_the_analysis_budget_not_the_tap_budget() {
        // Asserted by agreement, checkers' shape: for the same move in the same
        // position, assess_json and tutor_json must report the same `exact`.
        let _guard = exclusive();
        new_game(9, 0);
        let mut agreements = 0;
        for _ in 0..60 {
            if result_code() != -1 || agreements >= 30 {
                break;
            }
            let report = json(tutor_json());
            for m in report["moves"]
                .as_array()
                .cloned()
                .unwrap_or_default()
                .iter()
                .take(3)
            {
                let code = m["col"].as_u64().expect("a move code");
                let one = json(assess_json(code as u32));
                assert_eq!(one["exact"], m["exact"], "disagree about move {code}");
                assert_eq!(one["san"], m["san"]);
                agreements += 1;
            }
            let mv = live_move(3);
            if mv == MOVE_OVER || play(mv) != 0 {
                break;
            }
        }
        assert!(agreements >= 10, "the comparison must be non-vacuous");
    }
}
