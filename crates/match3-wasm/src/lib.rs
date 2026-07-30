//! Browser binding over [`match3_core`] for the games shelf — raw C-ABI +
//! serde-JSON, no `wasm-bindgen` (the `xbuild` pattern, like `solitaire-wasm`).
//!
//! The module holds **one game** (one board per tab). The objective is
//! Candy-Crush-style: a fixed **move budget** of legal swaps; when it runs out
//! the score is graded into 0–3 **stars** at flat thresholds, and a run "passes"
//! (`Won`) at ≥1★. Reads (board / legal swaps / hash / outcome) are JSON written
//! to one output buffer the host reads via `out_ptr`/`out_len`.
//!
//! **Never panics** (a wasm panic aborts the module): every fallible path maps
//! to a status code or an empty/`"null"` buffer.

use match3_core::{deal, legal_swaps, Cell, Game as M3Game};
use pond_outcome::{attest, Game, Outcome, Replayed};
use serde::Serialize;

// --- level config (provisional — tunable balance, see plans/2026-07-30-match3-playable.md) ---
const WIDTH: usize = 8;
const HEIGHT: usize = 8;
const COLORS: usize = 6;
const MOVE_BUDGET: usize = 20;
/// Score thresholds for 1★ / 2★ / 3★. Flat for v1.
const STARS: [u64; 3] = [500, 1000, 1600];

fn star_count(score: u64) -> u8 {
    u8::try_from(STARS.iter().filter(|&&t| score >= t).count()).unwrap_or(3)
}

// --- the held session ----------

struct Session {
    seed: u64,
    game: M3Game,
    /// Applied legal swaps `[from_row, from_col, to_row, to_col]` — the outcome proof.
    swaps: Vec<[u8; 4]>,
    assistance_used: bool,
}

static mut STATE: Option<Session> = None;
static mut OUT: Vec<u8> = Vec::new();

fn session_mut() -> Option<&'static mut Session> {
    // SAFETY: single-threaded wasm; host calls are sequential. Raw-pointer
    // access avoids a reference to the `static mut`.
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

/// Start a fresh game: deal a settled board from `seed` and reset the budget.
#[no_mangle]
pub extern "C" fn new_game(seed_lo: u32, seed_hi: u32) {
    let seed = (u64::from(seed_hi) << 32) | u64::from(seed_lo);
    let board = deal(seed, WIDTH, HEIGHT, COLORS);
    let session = Session {
        seed,
        game: M3Game::new(board, seed, COLORS),
        swaps: Vec::new(),
        assistance_used: false,
    };
    // SAFETY: single-threaded; replaces the held session.
    unsafe {
        *core::ptr::addr_of_mut!(STATE) = Some(session);
    }
}

// --- reads (JSON via the output buffer) ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BoardView {
    width: usize,
    height: usize,
    /// Row-major gem colours `0..COLORS` (v1 boards are all gems).
    cells: Vec<Vec<u8>>,
    score: u64,
    moves_left: usize,
    move_budget: usize,
    targets: [u64; 3],
    stars: u8,
    won: bool,
}

fn board_view(s: &Session) -> BoardView {
    let b = &s.game.board;
    let cells = (0..b.height)
        .map(|r| {
            (0..b.width)
                .map(|c| match b.get(r, c) {
                    Cell::Gem(g) => g,
                    _ => 0, // v1: boards are all gems at rest
                })
                .collect()
        })
        .collect();
    BoardView {
        width: b.width,
        height: b.height,
        cells,
        score: s.game.score,
        moves_left: MOVE_BUDGET.saturating_sub(s.swaps.len()),
        move_budget: MOVE_BUDGET,
        targets: STARS,
        stars: star_count(s.game.score),
        won: s.game.score >= STARS[0],
    }
}

/// The current board + score/budget/stars as JSON. `"null"` if no game started.
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

/// Legal swaps in the current state as `[[r1,c1,r2,c2], …]` JSON.
#[no_mangle]
pub extern "C" fn legal_moves_json() -> *const u8 {
    match session_mut() {
        Some(s) => {
            let swaps: Vec<[usize; 4]> = legal_swaps(&s.game.board)
                .into_iter()
                .map(|(f, t)| [f.0, f.1, t.0, t.1])
                .collect();
            match serde_json::to_vec(&swaps) {
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
        Some(s) => set_out_str(&format!("\"{}\"", s.game.state_hash())),
        None => set_out_str("\"\""),
    }
}

/// Current score.
#[no_mangle]
pub extern "C" fn score() -> u32 {
    session_mut().map_or(0, |s| u32::try_from(s.game.score).unwrap_or(u32::MAX))
}

/// Legal swaps remaining in the move budget.
#[no_mangle]
pub extern "C" fn moves_left() -> u32 {
    session_mut().map_or(0, |s| {
        u32::try_from(MOVE_BUDGET.saturating_sub(s.swaps.len())).unwrap_or(0)
    })
}

/// `1` if the score has passed the 1★ threshold.
#[no_mangle]
pub extern "C" fn is_won() -> u32 {
    u32::from(session_mut().is_some_and(|s| s.game.score >= STARS[0]))
}

// --- moves (status: 0 applied / 1 illegal / 2 bad state or budget spent) ----------

/// Play a swap of two adjacent gems. Illegal swaps (non-adjacent, non-gem, or no
/// resulting match) leave the board unchanged and do not consume the budget.
#[no_mangle]
pub extern "C" fn play_swap(r1: u32, c1: u32, r2: u32, c2: u32) -> u32 {
    let Some(s) = session_mut() else { return 2 };
    if s.swaps.len() >= MOVE_BUDGET {
        return 2; // budget spent
    }
    let from = (r1 as usize, c1 as usize);
    let to = (r2 as usize, c2 as usize);
    if from.0 >= HEIGHT || from.1 >= WIDTH || to.0 >= HEIGHT || to.1 >= WIDTH {
        return 2;
    }
    if s.game.play_move(from, to).legal {
        s.swaps.push([r1 as u8, c1 as u8, r2 as u8, c2 as u8]);
        0
    } else {
        1
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

/// The `pond-outcome` [`Game`] impl for match-3 — replay `(seed, swaps)` by
/// dealing the board and applying the swaps, grading the final score.
struct Match3;
impl Game for Match3 {
    type Move = [u8; 4];
    const KIND: &'static str = "match3";
    const VERSION: u32 = 1;
    fn replay(seed: u64, moves: &[[u8; 4]]) -> Replayed {
        let board = deal(seed, WIDTH, HEIGHT, COLORS);
        let mut game = M3Game::new(board, seed, COLORS);
        for m in moves {
            let _ = game.play_move(
                (m[0] as usize, m[1] as usize),
                (m[2] as usize, m[3] as usize),
            );
        }
        let s = game.score;
        Replayed::scored(game.state_hash(), s >= STARS[0], s, star_count(s))
    }
}

/// The outcome record for the current game, as a `pond-docformat` envelope JSON.
/// `declare`: 1 = include the (self-declared) assistance flag, 0 = omit it. A
/// completed run under the 1★ target is `Lost`; at or above it is `Won`.
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
    let record = attest::<Match3>(s.seed, s.swaps.clone(), Outcome::Lost, assistance);
    match pond_outcome::to_doc::<Match3>(&record) {
        Ok(bytes) => set_out(bytes),
        Err(_) => set_out_str("null"),
    }
}
