//! Browser binding over [`twenty48_core`] for the games shelf — raw C-ABI +
//! serde-JSON, no `wasm-bindgen` (the same pattern as `wyrdle-wasm`).
//!
//! The module holds **one game** (one board per tab): slide the 4×4 grid to
//! merge tiles up to 2048. Input is directional — the host calls [`move_`] with a
//! direction code; the core decides legality (a move that changes nothing is a
//! no-op). Reads (board / hash / outcome) are JSON written to one output buffer
//! the host reads via the return pointer + [`out_len`].
//!
//! **Never panics** (a wasm panic aborts the module): every fallible path maps
//! to a status code or an empty/`"null"` buffer.

use std::sync::OnceLock;

use pond_outcome::{attest, Outcome};
use serde::{Deserialize, Serialize};
use twenty48_core::{Direction, Game, Twenty48};

// --- embedded daily seed-pack (T3) ----------

static PACK_JSON: &[u8] = include_bytes!("../../../games/2048/daily-pack.json");

#[derive(Deserialize)]
struct PackPayload {
    seeds: Vec<u64>,
}
#[derive(Deserialize)]
struct PackEnvelope {
    payload: PackPayload,
}

/// The embedded daily seeds, parsed once. Never panics: a parse failure yields
/// an empty list (daily mode then falls back to seed 0 in the host).
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

/// The daily seed for `day_index` — a seed from the baked pack. `0` if empty.
#[no_mangle]
pub extern "C" fn daily_seed(day_index: u32) -> u32 {
    let seeds = daily_seeds();
    if seeds.is_empty() {
        return 0;
    }
    u32::try_from(seeds[(day_index as usize) % seeds.len()]).unwrap_or(0)
}

// --- direction codes ----------

fn dir_from(code: u32) -> Option<Direction> {
    match code {
        0 => Some(Direction::Up),
        1 => Some(Direction::Down),
        2 => Some(Direction::Left),
        3 => Some(Direction::Right),
        _ => None,
    }
}

fn dir_code(dir: Direction) -> u32 {
    match dir {
        Direction::Up => 0,
        Direction::Down => 1,
        Direction::Left => 2,
        Direction::Right => 3,
    }
}

// --- the held session ----------

struct Session {
    seed: u64,
    game: Game,
    assistance_used: bool,
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

/// Length in bytes of the last value written to the output buffer.
#[no_mangle]
pub extern "C" fn out_len() -> u32 {
    // SAFETY: single-threaded read of the static buffer's length.
    unsafe { u32::try_from((*core::ptr::addr_of!(OUT)).len()).unwrap_or(0) }
}

// --- lifecycle ----------

/// Start a fresh game for `seed` (deals the opening tiles).
#[no_mangle]
pub extern "C" fn new_game(seed_lo: u32, seed_hi: u32) {
    let seed = (u64::from(seed_hi) << 32) | u64::from(seed_lo);
    // SAFETY: single-threaded; replaces the held session.
    unsafe {
        *core::ptr::addr_of_mut!(STATE) = Some(Session {
            seed,
            game: Game::new(seed),
            assistance_used: false,
        });
    }
}

// --- reads ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BoardView {
    width: usize,
    height: usize,
    /// Row-major rows of tile exponents (`0` = empty, else value `2^v`).
    cells: Vec<Vec<u8>>,
    score: u64,
    max_tile: u64,
    won: bool,
    stuck: bool,
    game_over: bool,
}

fn board_view(s: &Session) -> BoardView {
    let b = s.game.board();
    let cells = (0..b.height)
        .map(|r| (0..b.width).map(|c| b.get(r, c)).collect())
        .collect();
    BoardView {
        width: b.width,
        height: b.height,
        cells,
        score: s.game.score(),
        max_tile: s.game.max_tile(),
        won: s.game.is_won(),
        stuck: s.game.is_stuck(),
        game_over: s.game.is_over(),
    }
}

/// The current board + score + won/stuck as JSON. `"null"` if no game.
#[no_mangle]
pub extern "C" fn board_json() -> *const u8 {
    match session_mut() {
        Some(s) => match serde_json::to_vec(&board_view(s)) {
            Ok(bytes) => set_out(bytes),
            Err(_) => set_out_str("null"),
        },
        None => set_out_str("null"),
    }
}

/// The canonical `state_hash` of the current state (quoted JSON string).
#[no_mangle]
pub extern "C" fn current_hash() -> *const u8 {
    match session_mut() {
        Some(s) => set_out_str(&format!("\"{}\"", s.game.current_hash())),
        None => set_out_str("\"\""),
    }
}

/// `1` if the 2048 tile has been made.
#[no_mangle]
pub extern "C" fn is_won() -> u32 {
    u32::from(session_mut().is_some_and(|s| s.game.is_won()))
}

/// `1` if the board is full with no move (stuck).
#[no_mangle]
pub extern "C" fn is_stuck() -> u32 {
    u32::from(session_mut().is_some_and(|s| s.game.is_stuck()))
}

/// A hint direction code (0 Up / 1 Down / 2 Left / 3 Right), or `0xFFFF_FFFF` if
/// the game is over / no session. Using a hint counts as assistance (the host
/// also calls [`mark_assistance`]).
#[no_mangle]
pub extern "C" fn hint() -> u32 {
    match session_mut().and_then(|s| s.game.hint()) {
        Some(dir) => dir_code(dir),
        None => 0xFFFF_FFFF,
    }
}

// --- moves (status: 0 applied / 1 illegal / 2 over or bad) ----------

/// Slide in `dir` (0 Up / 1 Down / 2 Left / 3 Right). A move that changes nothing
/// (illegal) leaves the board unchanged and spawns nothing.
#[no_mangle]
pub extern "C" fn move_(dir: u32) -> u32 {
    let Some(s) = session_mut() else { return 2 };
    let Some(direction) = dir_from(dir) else {
        return 2;
    };
    match s.game.play(direction) {
        Ok(()) => 0,
        Err(twenty48_core::MoveError::Illegal) => 1,
        Err(twenty48_core::MoveError::GameOver) => 2,
    }
}

/// Mark the game assisted (a hint was shown), so the outcome reflects it.
#[no_mangle]
pub extern "C" fn mark_assistance() {
    if let Some(s) = session_mut() {
        s.assistance_used = true;
    }
}

// --- outcome ----------

/// The outcome record for the current game as a `pond-docformat` envelope JSON
/// (`kind = "2048"`). `declare`: 1 = include the self-declared assistance flag,
/// 0 = omit. Verifiable by replaying `(seed, directions)` through
/// `twenty48_core::Twenty48`.
#[no_mangle]
pub extern "C" fn outcome_json(declare: u32) -> *const u8 {
    let Some(s) = session_mut() else {
        return set_out_str("null");
    };
    let assistance = if declare == 1 {
        Some(s.assistance_used)
    } else {
        None
    };
    let result = if s.game.is_won() {
        Outcome::Won
    } else {
        Outcome::Lost
    };
    let record = attest::<Twenty48>(s.seed, s.game.moves().to_vec(), result, assistance);
    match pond_outcome::to_doc::<Twenty48>(&record) {
        Ok(bytes) => set_out(bytes),
        Err(_) => set_out_str("null"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cabi_new_move_outcome() {
        new_game(2325, 0); // the committed fixture seed
        let bptr = board_json();
        let n = out_len() as usize;
        // SAFETY: single-threaded test; board_json just wrote OUT.
        let json = unsafe { std::slice::from_raw_parts(bptr, n) };
        let view: serde_json::Value = serde_json::from_slice(json).expect("board json");
        assert_eq!(view["width"], serde_json::json!(4));
        // A fresh board has two spawned tiles.
        let filled: usize = view["cells"]
            .as_array()
            .unwrap()
            .iter()
            .flat_map(|row| row.as_array().unwrap())
            .filter(|v| v.as_u64().unwrap() != 0)
            .count();
        assert_eq!(filled, 2, "opening deal is two tiles");

        // A hint is a legal direction; playing it applies.
        let h = hint();
        assert!(h <= 3, "hint is a direction code");
        assert_eq!(move_(h), 0, "the hinted move applies");

        // An out-of-range direction code is rejected, not a panic.
        assert_eq!(move_(99), 2);

        // Outcome parses to a 2048-kind envelope.
        let optr = outcome_json(1);
        let on = out_len() as usize;
        let ojson = unsafe { std::slice::from_raw_parts(optr, on) };
        let rec: serde_json::Value = serde_json::from_slice(ojson).expect("outcome json");
        assert_eq!(rec["kind"], serde_json::json!("2048"));

        // Daily seed comes from the embedded pack.
        assert_ne!(daily_seed(0), 0, "pack seeds are embedded");
    }
}
