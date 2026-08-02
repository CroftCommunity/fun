//! Browser binding over [`blockdoku_core`] for the games shelf — raw C-ABI +
//! serde-JSON, no `wasm-bindgen` (the same pattern as `twenty48-wasm`).
//!
//! The module holds **one game** (one board per tab): place tray pieces on the
//! 9×9 grid; completing a row / column / 3×3 box clears it; endless score-attack.
//! Input is a typed integer move — the host calls [`play_place`] with a slot and
//! anchor; the **core decides legality** (an illegal placement is a no-op). Reads
//! (board / tray / legal moves / hash / outcome) are JSON written to one output
//! buffer the host reads via the return pointer + [`out_len`].
//!
//! Seeds crossing this boundary are **config-packed** ([`blockdoku_core::config`]):
//! the deal options travel in the high bits, so `new_game` and the outcome record
//! share one `u64` and every configuration stays verifiable.
//!
//! **Never panics** (a wasm panic aborts the module): every fallible path maps to
//! a status code or an empty/`"null"` buffer.

use std::sync::OnceLock;

use blockdoku_core::config::unpack_seed;
use blockdoku_core::game::{Blockdoku, GameResult, GameState, Move};
use blockdoku_core::shapes::by_key;
use pond_outcome::{attest, Outcome};
use serde::Serialize;

// --- embedded daily seed-pack (B9) ----------

static PACK_JSON: &[u8] = include_bytes!("../../../games/blockdoku/daily-pack.json");

#[derive(serde::Deserialize)]
struct PackPayload {
    seeds: Vec<u64>,
}
#[derive(serde::Deserialize)]
struct PackEnvelope {
    payload: PackPayload,
}

fn daily_seeds() -> &'static [u64] {
    static SEEDS: OnceLock<Vec<u64>> = OnceLock::new();
    SEEDS
        .get_or_init(|| {
            serde_json::from_slice::<PackEnvelope>(PACK_JSON)
                .map(|e| e.payload.seeds)
                .unwrap_or_default()
        })
        .as_slice()
}

/// The daily **base** seed for `day_index` from the baked pack (`0` if empty).
/// The host packs it with the current options before calling [`new_game`].
#[no_mangle]
pub extern "C" fn daily_seed(day_index: u32) -> u32 {
    let seeds = daily_seeds();
    if seeds.is_empty() {
        return 0;
    }
    u32::try_from(seeds[(day_index as usize) % seeds.len()]).unwrap_or(0)
}

// --- the held session ----------

struct Session {
    packed_seed: u64,
    game: GameState,
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

/// Start a fresh game from a **config-packed** seed (deals the opening tray).
#[no_mangle]
pub extern "C" fn new_game(seed_lo: u32, seed_hi: u32) {
    let packed = (u64::from(seed_hi) << 32) | u64::from(seed_lo);
    let (base, options) = unpack_seed(packed);
    // SAFETY: single-threaded; replaces the held session.
    unsafe {
        *core::ptr::addr_of_mut!(STATE) = Some(Session {
            packed_seed: packed,
            game: GameState::new_game(base, options),
        });
    }
}

// --- reads ----------

fn result_str(r: Option<GameResult>) -> Option<&'static str> {
    r.map(|r| match r {
        GameResult::Stuck => "stuck",
        GameResult::MoveLimit => "moveLimit",
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BoardView {
    size: usize,
    /// Row-major occupancy (`0` empty / `1` filled).
    cells: Vec<Vec<u8>>,
    score: u64,
    streak: u32,
    combo: u32,
    game_over: bool,
    result: Option<&'static str>,
}

fn board_view(s: &Session) -> BoardView {
    let b = s.game.board();
    let cells = (0..blockdoku_core::SIZE)
        .map(|r| (0..blockdoku_core::SIZE).map(|c| b.get(r, c)).collect())
        .collect();
    BoardView {
        size: blockdoku_core::SIZE,
        cells,
        score: s.game.score(),
        streak: s.game.streak(),
        combo: s.game.combo(),
        game_over: s.game.is_over(),
        result: result_str(s.game.result()),
    }
}

/// The current board + score + status as JSON. `"null"` if no game.
#[no_mangle]
pub extern "C" fn board_json() -> *const u8 {
    match session_mut() {
        Some(s) => set_out_json(&board_view(s)),
        None => set_out_str("null"),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PieceView {
    slot: usize,
    key: &'static str,
    name: &'static str,
    tier: &'static str,
    points: u32,
    rows: usize,
    cols: usize,
    /// The shape's occupancy matrix, row-major.
    cells: Vec<Vec<u8>>,
}

fn piece_view(slot: usize, key: &'static str) -> Option<PieceView> {
    let shape = by_key(key)?;
    let cells = shape.cells.iter().map(|row| row.to_vec()).collect();
    Some(PieceView {
        slot,
        key: shape.key,
        name: shape.name,
        tier: match shape.tier {
            blockdoku_core::Tier::Standard => "standard",
            blockdoku_core::Tier::Wild => "wild",
            blockdoku_core::Tier::Magic => "magic",
        },
        points: shape.points,
        rows: shape.rows(),
        cols: shape.cols(),
        cells,
    })
}

/// The tray as JSON: an array of three slots, each a piece view or `null`.
#[no_mangle]
pub extern "C" fn tray_json() -> *const u8 {
    match session_mut() {
        Some(s) => {
            let tray: Vec<Option<PieceView>> = s
                .game
                .tray()
                .iter()
                .enumerate()
                .map(|(slot, key)| key.and_then(|k| piece_view(slot, k)))
                .collect();
            set_out_json(&tray)
        }
        None => set_out_str("[]"),
    }
}

/// The canonical legal moves as JSON (`[{slot,row,col}, ...]`) — the exact set
/// the UI glows. `[]` if no game / game over.
#[no_mangle]
pub extern "C" fn legal_moves_json() -> *const u8 {
    match session_mut() {
        Some(s) => set_out_json(&s.game.legal_moves()),
        None => set_out_str("[]"),
    }
}

/// The canonical `state_hash` of the current state (quoted JSON string).
#[no_mangle]
pub extern "C" fn current_hash() -> *const u8 {
    match session_mut() {
        Some(s) => set_out_str(&format!("\"{}\"", s.game.state_hash())),
        None => set_out_str("\"\""),
    }
}

/// `1` if the game has ended.
#[no_mangle]
pub extern "C" fn is_over() -> u32 {
    u32::from(session_mut().is_some_and(|s| s.game.is_over()))
}

// --- moves (status: 0 applied / 1 illegal / 2 over or bad) ----------

/// Place tray slot `slot` with its top-left at `(row, col)`. An illegal placement
/// leaves the board unchanged.
#[no_mangle]
pub extern "C" fn play_place(slot: u32, row: u32, col: u32) -> u32 {
    let Some(s) = session_mut() else { return 2 };
    let mv = Move {
        slot: slot as usize,
        row: row as usize,
        col: col as usize,
    };
    match s.game.play_move(mv) {
        Ok(()) => 0,
        Err(blockdoku_core::MoveError::Illegal) => 1,
        Err(_) => 2,
    }
}

/// Mark the game assisted (a hint/undo was used), so the outcome reflects it.
#[no_mangle]
pub extern "C" fn mark_assistance() {
    if let Some(s) = session_mut() {
        s.game.mark_assistance();
    }
}

// --- outcome ----------

/// The outcome record for the current game as a `pond-docformat` envelope JSON
/// (`kind = "blockdoku"`). `declare`: 1 = include the self-declared assistance
/// flag, 0 = omit. Verifiable by replaying the config-packed `(seed, moves)`.
#[no_mangle]
pub extern "C" fn outcome_json(declare: u32) -> *const u8 {
    let Some(s) = session_mut() else {
        return set_out_str("null");
    };
    let assistance = if declare == 1 {
        Some(s.game.assistance_used())
    } else {
        None
    };
    let result = match s.game.result() {
        Some(GameResult::Stuck) => Outcome::Stuck,
        Some(GameResult::MoveLimit) => Outcome::Lost,
        None => Outcome::Abandoned,
    };
    let record = attest::<Blockdoku>(s.packed_seed, s.game.moves().to_vec(), result, assistance);
    match pond_outcome::to_doc::<Blockdoku>(&record) {
        Ok(bytes) => set_out(bytes),
        Err(_) => set_out_str("null"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use blockdoku_core::config::pack_seed;
    use blockdoku_core::deal::DealOptions;

    fn read(ptr: *const u8) -> Vec<u8> {
        let n = out_len() as usize;
        // SAFETY: single-threaded test; the caller just wrote OUT.
        unsafe { std::slice::from_raw_parts(ptr, n).to_vec() }
    }

    #[test]
    fn cabi_new_place_outcome() {
        let packed = pack_seed(2325, DealOptions::default());
        new_game(
            u32::try_from(packed & 0xffff_ffff).unwrap(),
            u32::try_from(packed >> 32).unwrap(),
        );

        // Board: 9x9, empty, playing.
        let bv: serde_json::Value = serde_json::from_slice(&read(board_json())).unwrap();
        assert_eq!(bv["size"], serde_json::json!(9));
        assert_eq!(bv["gameOver"], serde_json::json!(false));

        // Tray: three pieces.
        let tray: serde_json::Value = serde_json::from_slice(&read(tray_json())).unwrap();
        assert_eq!(tray.as_array().unwrap().len(), 3);

        // Legal moves is a non-empty list on a fresh board.
        let lm: serde_json::Value = serde_json::from_slice(&read(legal_moves_json())).unwrap();
        let first = lm.as_array().unwrap()[0].clone();
        assert!(!lm.as_array().unwrap().is_empty());

        // Play the first legal move; it applies.
        let slot = first["slot"].as_u64().unwrap() as u32;
        let row = first["row"].as_u64().unwrap() as u32;
        let col = first["col"].as_u64().unwrap() as u32;
        assert_eq!(play_place(slot, row, col), 0);

        // An out-of-range slot is rejected, not a panic.
        assert_eq!(play_place(99, 0, 0), 2);

        // Outcome parses to a blockdoku-kind envelope with a score.
        let rec: serde_json::Value = serde_json::from_slice(&read(outcome_json(1))).unwrap();
        assert_eq!(rec["kind"], serde_json::json!("blockdoku"));

        // Daily seed comes from the embedded pack.
        assert_ne!(daily_seed(0), 0, "pack seeds are embedded");
    }
}
