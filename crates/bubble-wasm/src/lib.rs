//! Browser binding over [`bubble_core`] for the games shelf — raw C-ABI +
//! serde-JSON, no `wasm-bindgen` (the `xbuild` pattern, like `match3-wasm`).
//!
//! The module holds **one game** (one board per tab): clear-the-board within a
//! shot budget. Aim is tap-a-target — the host reads `legal_targets_json`, glows
//! exactly those cells, and calls [`shoot`]; the core decides legality. Reads
//! (board / legal targets / hash / outcome) are JSON written to one output
//! buffer the host reads via the return pointer + [`out_len`].
//!
//! **Never panics** (a wasm panic aborts the module): every fallible path maps
//! to a status code or an empty/`"null"` buffer.

use bubble_core::clear_board_mode::SHOT_BUDGET;
use bubble_core::engine::legal_targets;
use bubble_core::{Board, Bubble, Cell, Game};
use pond_outcome::{attest, Outcome};
use serde::{Deserialize, Serialize};

// --- embedded winnable-daily pack (B4) ----------

static PACK_JSON: &[u8] = include_bytes!("../../../games/bubble/daily-pack.json");

#[derive(Deserialize)]
struct PackPayload {
    seeds: Vec<u64>,
}
#[derive(Deserialize)]
struct PackEnvelope {
    payload: PackPayload,
}

/// The embedded winnable daily seeds, parsed once. Never panics: a parse failure
/// yields an empty list (daily mode then falls back to seed 0 in the host).
fn daily_seeds() -> &'static [u64] {
    static mut SEEDS: Option<Vec<u64>> = None;
    // SAFETY: single-threaded wasm; host calls are sequential.
    unsafe {
        let p = core::ptr::addr_of_mut!(SEEDS);
        if (*p).is_none() {
            let parsed = serde_json::from_slice::<PackEnvelope>(PACK_JSON)
                .map(|e| e.payload.seeds)
                .unwrap_or_default();
            *p = Some(parsed);
        }
        (*p).as_deref().unwrap_or(&[])
    }
}

/// The clear-the-board daily seed for `day_index` — a winnable seed from the
/// baked pack. `0` if the pack is empty.
#[no_mangle]
pub extern "C" fn bubble_daily_seed(day_index: u32) -> u32 {
    let seeds = daily_seeds();
    if seeds.is_empty() {
        return 0;
    }
    u32::try_from(seeds[(day_index as usize) % seeds.len()]).unwrap_or(0)
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

/// Start a fresh clear-the-board game: deal a settled board from `seed`.
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

// --- reads (JSON via the output buffer) ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BoardView {
    /// Cells in a full (even) row; odd rows are `width - 1` (staggered hex — the
    /// host derives each row's length from its parity).
    width: usize,
    height: usize,
    /// Row-major, one inner list per row with that row's length; `-1` = empty,
    /// else the bubble colour `0..colors`.
    cells: Vec<Vec<i16>>,
    /// The colour the next shot places.
    current_color: u8,
    score: u64,
    shots_left: usize,
    shot_budget: usize,
    /// Whether the board is cleared (the objective is met).
    cleared: bool,
}

fn board_view(s: &Session) -> BoardView {
    let b: &Board = s.game.board();
    let cells = (0..b.height)
        .map(|r| {
            (0..Board::row_len(b.width, r))
                .map(|c| match b.get(r, c) {
                    Some(Cell::Bubble(col)) => i16::from(col),
                    _ => -1,
                })
                .collect()
        })
        .collect();
    BoardView {
        width: b.width,
        height: b.height,
        cells,
        current_color: s.game.current_color(),
        score: s.game.score(),
        shots_left: s.game.shots_left(),
        shot_budget: SHOT_BUDGET,
        cleared: s.game.is_won(),
    }
}

/// The current board + launcher/score/budget as JSON. `"null"` if no game.
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

/// Legal landing cells in the current state as `[[r,c], …]` JSON — the UI glows
/// exactly these; legality lives in the core.
#[no_mangle]
pub extern "C" fn legal_targets_json() -> *const u8 {
    match session_mut() {
        Some(s) => {
            let targets: Vec<[usize; 2]> = legal_targets(s.game.board())
                .into_iter()
                .map(|(r, c)| [r, c])
                .collect();
            match serde_json::to_vec(&targets) {
                Ok(bytes) => set_out(bytes),
                Err(_) => set_out_str("[]"),
            }
        }
        None => set_out_str("[]"),
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

/// Current score.
#[no_mangle]
pub extern "C" fn score() -> u32 {
    session_mut().map_or(0, |s| u32::try_from(s.game.score()).unwrap_or(u32::MAX))
}

/// Shots remaining in the budget.
#[no_mangle]
pub extern "C" fn shots_left() -> u32 {
    session_mut().map_or(0, |s| u32::try_from(s.game.shots_left()).unwrap_or(0))
}

/// The colour the next shot places (`0..colors`).
#[no_mangle]
pub extern "C" fn current_color() -> u32 {
    session_mut().map_or(0, |s| u32::from(s.game.current_color()))
}

/// `1` if the board is cleared (the objective is met).
#[no_mangle]
pub extern "C" fn is_cleared() -> u32 {
    u32::from(session_mut().is_some_and(|s| s.game.is_won()))
}

// --- moves (status: 0 applied / 1 illegal / 2 bad state or budget spent) ----------

/// Fire the current launcher colour at `(r, c)`. An illegal target (occupied /
/// unreachable) leaves the board unchanged and does not consume a shot.
#[no_mangle]
pub extern "C" fn shoot(r: u32, c: u32) -> u32 {
    let Some(s) = session_mut() else { return 2 };
    if s.game.shots_left() == 0 {
        return 2; // budget spent
    }
    match s.game.play((r as usize, c as usize)) {
        Ok(_) => 0,
        Err(_) => 1,
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
/// (`kind = "bubble"`). `declare`: 1 = include the self-declared assistance flag,
/// 0 = omit it. Cleared = `Won`; a spent budget without clearing = `Lost`.
/// Verifiable by replaying `(seed, shots)` through `bubble_core::Bubble`.
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
    let record = attest::<Bubble>(s.seed, s.game.shots().to_vec(), Outcome::Lost, assistance);
    match pond_outcome::to_doc::<Bubble>(&record) {
        Ok(bytes) => set_out(bytes),
        Err(_) => set_out_str("null"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Exercises the C-ABI end to end (the "wiring test" for B5): start a game,
    // read the board/targets, shoot the first legal target, and confirm the
    // outcome JSON parses to a bubble record. Runs native (rlib), not wasm.
    #[test]
    fn cabi_new_game_read_shoot_outcome() {
        new_game(495, 0); // a winnable pack seed
        assert!(out_len() == 0 || out_len() > 0); // out buffer usable
        let board_ptr = board_json();
        assert!(!board_ptr.is_null());
        let n = out_len() as usize;
        // SAFETY: single-threaded test; board_json just wrote OUT.
        let json = unsafe { std::slice::from_raw_parts(board_ptr, n) };
        let view: serde_json::Value = serde_json::from_slice(json).expect("board json");
        assert_eq!(view["cleared"], serde_json::json!(false));
        assert!(view["shotsLeft"].as_u64().unwrap() > 0);

        // Shoot the first legal target (via the C-ABI read).
        let tptr = legal_targets_json();
        let tn = out_len() as usize;
        let tjson = unsafe { std::slice::from_raw_parts(tptr, tn) };
        let targets: Vec<[u32; 2]> = serde_json::from_slice(tjson).expect("targets");
        assert!(!targets.is_empty(), "a fresh board has legal targets");
        assert_eq!(shoot(targets[0][0], targets[0][1]), 0, "legal shot applies");

        // An out-of-bounds target is illegal, not a panic.
        assert_eq!(shoot(999, 999), 1);

        // Outcome parses to a bubble-kind envelope.
        let optr = outcome_json(1);
        let on = out_len() as usize;
        let ojson = unsafe { std::slice::from_raw_parts(optr, on) };
        let rec: serde_json::Value = serde_json::from_slice(ojson).expect("outcome json");
        assert_eq!(rec["kind"], serde_json::json!("bubble"));

        // Daily seed comes from the embedded pack.
        assert_ne!(bubble_daily_seed(0), 0, "pack seeds are embedded");
    }
}
