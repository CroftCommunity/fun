//! Browser binding over [`looseends_core`] for the games shelf — raw C-ABI +
//! serde-JSON, no `wasm-bindgen` (the same pattern as `twenty48-wasm`).
//!
//! The module holds **one game** (one board per tab). The host starts a campaign
//! level or a daily board, reads the board as JSON, and taps arrows by id; the
//! **core decides legality** (FREE releases, BLOCKED is a no-op the host counts
//! as a lost droplet). Reads (board / hash / outcome) are JSON written to one
//! output buffer the host reads via the return pointer + [`out_len`].
//!
//! **Never panics** (a wasm panic aborts the module): every fallible path maps
//! to a status code or an empty / `"null"` buffer.

use looseends_core::{score, stars, Board, Game, LooseEnds, Tap};
use pond_outcome::{attest, Outcome};
use serde::Serialize;

// --- the held session ----------

struct Session {
    game: Game,
}

static mut STATE: Option<Session> = None;
static mut OUT: Vec<u8> = Vec::new();

fn session() -> Option<&'static Session> {
    // SAFETY: single-threaded wasm; host calls are sequential.
    unsafe { (*core::ptr::addr_of!(STATE)).as_ref() }
}
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

/// Start campaign level `n` (`1..=100`).
#[no_mangle]
pub extern "C" fn new_level(n: u32) {
    // SAFETY: single-threaded; replaces the held session.
    unsafe {
        *core::ptr::addr_of_mut!(STATE) = Some(Session {
            game: Game::level(n),
        });
    }
}

/// Start the daily board for a precomputed daily `seed`. The host derives the
/// seed as `FNV-1a("loose-ends-daily-" + "YYYY-MM-DD")` — the same integer-exact
/// hash the core uses (`looseends_core::daily_seed`), mirrored in the TS wrapper.
#[no_mangle]
pub extern "C" fn new_daily(seed: u32) {
    // SAFETY: single-threaded; replaces the held session.
    unsafe {
        *core::ptr::addr_of_mut!(STATE) = Some(Session {
            game: Game::daily(seed),
        });
    }
}

// --- reads ----------

#[derive(Serialize)]
struct ArrowView {
    cells: Vec<[i32; 2]>,
    dir: [i32; 2],
    present: bool,
    free: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BoardView {
    width: i32,
    height: i32,
    arrows: Vec<ArrowView>,
    remaining: usize,
    total: usize,
    won: bool,
}

fn board_view(board: &Board) -> BoardView {
    let arrows = board
        .arrows()
        .iter()
        .enumerate()
        .map(|(id, a)| ArrowView {
            cells: a.cells.clone(),
            dir: a.dir,
            present: board.is_present(id),
            free: board.is_free(id),
        })
        .collect();
    BoardView {
        width: board.width(),
        height: board.height(),
        arrows,
        remaining: board.remaining(),
        total: board.arrows().len(),
        won: board.is_cleared(),
    }
}

/// The current board (arrow geometry + present/free flags) as JSON. `"null"` if
/// no game.
#[no_mangle]
pub extern "C" fn board_json() -> *const u8 {
    match session() {
        Some(s) => match serde_json::to_vec(&board_view(s.game.board())) {
            Ok(bytes) => set_out(bytes),
            Err(_) => set_out_str("null"),
        },
        None => set_out_str("null"),
    }
}

/// The canonical `state_hash` of the current state (quoted JSON string).
#[no_mangle]
pub extern "C" fn current_hash() -> *const u8 {
    match session() {
        Some(s) => set_out_str(&format!("\"{}\"", s.game.current_hash())),
        None => set_out_str("\"\""),
    }
}

/// `1` if every arrow has been cleared (a win).
#[no_mangle]
pub extern "C" fn is_won() -> u32 {
    u32::from(session().is_some_and(|s| s.game.is_won()))
}

/// The number of arrows still on the board.
#[no_mangle]
pub extern "C" fn remaining() -> u32 {
    session().map_or(0, |s| s.game.board().remaining() as u32)
}

/// A FREE arrow id to highlight as a hint, or `0xFFFF_FFFF` if none / no game.
#[no_mangle]
pub extern "C" fn hint() -> u32 {
    session().and_then(|s| s.game.hint()).unwrap_or(0xFFFF_FFFF)
}

/// Stars for `mistakes` + `hints` (0–3), delegated to the core grading.
#[no_mangle]
pub extern "C" fn stars_for(mistakes: u32, hints: u32) -> u32 {
    u32::from(stars(mistakes, hints))
}

/// Score for `mistakes` + `hints`, delegated to the core grading.
#[no_mangle]
pub extern "C" fn score_for(mistakes: u32, hints: u32) -> u32 {
    score(mistakes, hints)
}

// --- taps (status: 0 released / 1 blocked / 2 gone or no game) ----------

/// Tap arrow `id`. A FREE arrow is released (status 0); a BLOCKED arrow is a
/// no-op (status 1, the host charges a droplet); an already-gone / unknown id is
/// status 2.
#[no_mangle]
pub extern "C" fn tap(id: u32) -> u32 {
    let Some(s) = session_mut() else { return 2 };
    match s.game.tap(id) {
        Tap::Released => 0,
        Tap::Blocked => 1,
        Tap::Gone => 2,
    }
}

// --- outcome ----------

/// The outcome record for the current game as a `pond-docformat` envelope JSON
/// (`kind = "looseends"`). `declare`: 1 = include the self-declared assistance
/// flag, 0 = omit. Verifiable by replaying `(packed_seed, moves)` through
/// `looseends_core::LooseEnds` — the packed seed regenerates the exact board.
#[no_mangle]
pub extern "C" fn outcome_json(declare: u32, assisted: u32) -> *const u8 {
    let Some(s) = session() else {
        return set_out_str("null");
    };
    let assistance = if declare == 1 {
        Some(assisted == 1)
    } else {
        None
    };
    let result = if s.game.is_won() {
        Outcome::Won
    } else {
        Outcome::Abandoned
    };
    let record = attest::<LooseEnds>(
        s.game.packed_seed(),
        s.game.moves().to_vec(),
        result,
        assistance,
    );
    match pond_outcome::to_doc::<LooseEnds>(&record) {
        Ok(bytes) => set_out(bytes),
        Err(_) => set_out_str("null"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read(ptr: *const u8) -> serde_json::Value {
        let n = out_len() as usize;
        // SAFETY: single-threaded test; the caller just wrote OUT.
        let bytes = unsafe { std::slice::from_raw_parts(ptr, n) };
        serde_json::from_slice(bytes).expect("json")
    }

    #[test]
    fn cabi_level_tap_and_outcome() {
        new_level(1);
        let view = read(board_json());
        assert_eq!(view["width"], serde_json::json!(5));
        assert_eq!(view["total"], serde_json::json!(3));

        // A hint is a free arrow; tapping it releases (status 0).
        let h = hint();
        assert!(h <= 2, "hint is a valid arrow id");
        assert_eq!(tap(h), 0, "the hinted arrow releases");
        // Re-tapping the gone arrow is status 2.
        assert_eq!(tap(h), 2);

        // Grading delegates to the core.
        assert_eq!(stars_for(0, 0), 3);
        assert_eq!(score_for(1, 0), 1200);

        // Outcome parses to a looseends-kind envelope.
        let rec = read(outcome_json(1, 0));
        assert_eq!(rec["kind"], serde_json::json!("looseends"));
    }

    #[test]
    fn daily_board_starts_from_seed() {
        // The host passes the FNV daily seed; the board is non-empty.
        new_daily(looseends_core::daily_seed("2026-08-02"));
        assert!(remaining() > 0);
        let view = read(board_json());
        assert_eq!(view["width"], serde_json::json!(9));
    }

    #[test]
    fn no_game_is_safe() {
        // SAFETY: single-threaded test; clear the session.
        unsafe {
            *core::ptr::addr_of_mut!(STATE) = None;
        }
        assert_eq!(tap(0), 2);
        assert_eq!(is_won(), 0);
        assert_eq!(remaining(), 0);
        assert_eq!(hint(), 0xFFFF_FFFF);
        assert_eq!(read(board_json()), serde_json::json!(null));
    }
}
