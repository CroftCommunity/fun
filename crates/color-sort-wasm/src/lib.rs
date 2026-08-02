//! Browser binding over [`color_sort_core`] + [`color_sort_solver`] — raw C-ABI
//! + serde-JSON, no `wasm-bindgen` (the same pattern as `twenty48-wasm`).
//!
//! The module holds **one game** (one puzzle per tab). Daily deals come from the
//! embedded winnable-daily pack (solver-certified, `par` baked); endless deals
//! are generated + certified at runtime (a few ms at these sizes). Input is a
//! pour — the host calls [`pour`] with tube indices; the core decides legality.
//! Reads (board / hash / outcome / hint) are JSON written to one output buffer
//! the host reads via the return pointer + [`out_len`].
//!
//! **Never panics** (a wasm panic aborts the module): every fallible path maps
//! to a status code or an empty/`"null"` buffer.

use std::sync::OnceLock;

use color_sort_core::{
    daily, endless, pack_seed, ui_moves, ColorSort, DealParams, Game, Move, State,
};
use color_sort_solver::{find_win, generate};
use pond_outcome::{attest, Outcome};
use serde::{Deserialize, Serialize};

// Generation/solve budgets. The heuristic search solves the largest size in a
// few ms, so these are comfortable ceilings, not a tuned limit (brief §3).
const NODE_BUDGET: u64 = 500_000;
const MAX_ATTEMPTS: u16 = 256;

// --- embedded winnable-daily pack ----------

static PACK_JSON: &[u8] = include_bytes!("../../../games/color-sort/daily-pack.json");

#[derive(Deserialize)]
struct PackEntry {
    base: u32,
    attempt: u16,
    par: u32,
}
#[derive(Deserialize)]
struct PackPayload {
    colors: u8,
    empties: u8,
    entries: Vec<PackEntry>,
}
#[derive(Deserialize)]
struct PackEnvelope {
    payload: PackPayload,
}

/// The embedded daily pack, parsed once. Never panics: a parse failure yields an
/// empty schedule (daily mode then falls back to a generated deal in the host).
fn pack() -> &'static PackPayload {
    static PACK: OnceLock<PackPayload> = OnceLock::new();
    PACK.get_or_init(|| {
        serde_json::from_slice::<PackEnvelope>(PACK_JSON)
            .map(|e| e.payload)
            .unwrap_or(PackPayload {
                colors: daily::COLORS,
                empties: daily::EMPTIES,
                entries: Vec::new(),
            })
    })
}

// --- the held session ----------

struct Session {
    game: Game,
    seed: u64,
    par: u32,
    assistance_used: bool,
}

static mut STATE: Option<Session> = None;
static mut OUT: Vec<u8> = Vec::new();

fn session_mut() -> Option<&'static mut Session> {
    // SAFETY: single-threaded wasm; host calls are sequential.
    unsafe { (*core::ptr::addr_of_mut!(STATE)).as_mut() }
}

fn set_session(s: Session) {
    // SAFETY: single-threaded; replaces the held session.
    unsafe {
        *core::ptr::addr_of_mut!(STATE) = Some(s);
    }
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

// --- deal helpers ----------

/// A deterministic 32-bit base seed for endless level `level` (splitmix-mixed so
/// adjacent levels do not cluster). Deal params combine base with the attempt.
fn endless_base(level: u32) -> u32 {
    let mut z = u64::from(level).wrapping_add(0x9E37_79B9_7F4A_7C15);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    (z ^ (z >> 31)) as u32
}

/// Start a session for a certified `(base, colors, empties)`: generate its
/// winnable attempt + par, then deal. Falls back to attempt 0 (par 0) if the
/// budget is exhausted (never reached at these sizes; keeps the binding total).
fn start_generated(base: u32, colors: u8, empties: u8) {
    let (attempt, par) = match generate(base, colors, empties, NODE_BUDGET, MAX_ATTEMPTS) {
        Some(g) => (g.attempt, u32::try_from(g.moves.len()).unwrap_or(0)),
        None => (0, 0),
    };
    let params = DealParams {
        base,
        attempt,
        colors,
        empties,
    };
    let seed = pack_seed(params);
    set_session(Session {
        game: Game::new(seed),
        seed,
        par,
        assistance_used: false,
    });
}

/// Start today's daily deal for `day_index` from the baked pack (par baked). If
/// the pack is empty (parse failure), fall back to a generated daily-size deal.
#[no_mangle]
pub extern "C" fn new_daily(day_index: u32) {
    let p = pack();
    if p.entries.is_empty() {
        start_generated(0, daily::COLORS, daily::EMPTIES);
        return;
    }
    let entry = &p.entries[(day_index as usize) % p.entries.len()];
    let params = DealParams {
        base: entry.base,
        attempt: entry.attempt,
        colors: p.colors,
        empties: p.empties,
    };
    let seed = pack_seed(params);
    set_session(Session {
        game: Game::new(seed),
        seed,
        par: entry.par,
        assistance_used: false,
    });
}

/// Start endless level `level` (1-based): `n` ramps by level, `k = 2`, generated
/// + certified at runtime.
#[no_mangle]
pub extern "C" fn new_endless(level: u32) {
    start_generated(
        endless_base(level),
        endless::colors_for(level),
        endless::EMPTIES,
    );
}

/// Start a free-play deal for an explicit `base` seed at `colors`/`empties`
/// (the `?seed=` path). Certified winnable at deal time.
#[no_mangle]
pub extern "C" fn new_seed(base: u32, colors: u32, empties: u32) {
    let colors = u8::try_from(colors).unwrap_or(daily::COLORS).clamp(2, 12);
    let empties = u8::try_from(empties).unwrap_or(daily::EMPTIES).clamp(1, 4);
    start_generated(base, colors, empties);
}

/// Start a game from an already-packed outcome seed (the verifier / `?r=` path):
/// reconstructs the exact deal with no solver, par unknown (`0`).
#[no_mangle]
pub extern "C" fn new_packed(seed_lo: u32, seed_hi: u32) {
    let seed = (u64::from(seed_hi) << 32) | u64::from(seed_lo);
    set_session(Session {
        game: Game::new(seed),
        seed,
        par: 0,
        assistance_used: false,
    });
}

// --- reads ----------

#[derive(Serialize)]
struct MoveView {
    from: usize,
    to: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BoardView {
    /// Each tube bottom→top, a colour id `0..colors` (empty tube = `[]`).
    tubes: Vec<Vec<u8>>,
    colors: u8,
    cap: u8,
    /// Per-tube: full-and-monochrome (locked, capped, untappable).
    locked: Vec<bool>,
    /// The UI-legal pours (the board glows the targets for a selected source).
    moves: Vec<MoveView>,
    won: bool,
    deadlocked: bool,
    par: u32,
    move_count: u32,
}

fn board_view(s: &Session) -> BoardView {
    let st: &State = s.game.state();
    let locked = (0..st.tube_count()).map(|t| st.is_locked(t)).collect();
    let moves = ui_moves(st)
        .into_iter()
        .map(|m| MoveView {
            from: m.from,
            to: m.to,
        })
        .collect();
    BoardView {
        tubes: st.tubes.clone(),
        colors: st.colors,
        cap: st.cap,
        locked,
        moves,
        won: s.game.is_won(),
        deadlocked: s.game.is_deadlocked(),
        par: s.par,
        move_count: u32::try_from(s.game.move_count()).unwrap_or(u32::MAX),
    }
}

/// The current board as JSON. `"null"` if no game.
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

/// `1` if the puzzle is solved.
#[no_mangle]
pub extern "C" fn is_won() -> u32 {
    u32::from(session_mut().is_some_and(|s| s.game.is_won()))
}

/// `1` if no non-blocked pour remains and the puzzle is unsolved (deadlocked).
#[no_mangle]
pub extern "C" fn is_deadlocked_() -> u32 {
    u32::from(session_mut().is_some_and(|s| s.game.is_deadlocked()))
}

/// A hint: solve from the current state and return the first move as JSON
/// `{"from":a,"to":b}`. `"null"` if already won or unsolvable from here. Using a
/// hint counts as assistance (the host also calls [`mark_assistance`]).
#[no_mangle]
pub extern "C" fn hint() -> *const u8 {
    let Some(s) = session_mut() else {
        return set_out_str("null");
    };
    if s.game.is_won() {
        return set_out_str("null");
    }
    match find_win(s.game.state(), NODE_BUDGET).and_then(|line| line.into_iter().next()) {
        Some(mv) => set_out_str(&format!("{{\"from\":{},\"to\":{}}}", mv.from, mv.to)),
        None => set_out_str("null"),
    }
}

// --- moves (status: 0 applied / 1 illegal / 2 over) ----------

/// Pour from tube `from` to tube `to`. An illegal (no-change) pour leaves the
/// state unchanged; a pour after a win is rejected.
#[no_mangle]
pub extern "C" fn pour(from: u32, to: u32) -> u32 {
    let Some(s) = session_mut() else { return 2 };
    let mv = Move {
        from: from as usize,
        to: to as usize,
    };
    match s.game.play(mv) {
        Ok(_) => 0,
        Err(color_sort_core::MoveError::Illegal) => 1,
        Err(color_sort_core::MoveError::GameOver) => 2,
    }
}

/// Undo the last pour (Free mode). `1` if a pour was undone, else `0`.
#[no_mangle]
pub extern "C" fn undo() -> u32 {
    u32::from(session_mut().is_some_and(|s| s.game.undo()))
}

/// Restart the same deal (the deal is unchanged — regenerates nothing).
#[no_mangle]
pub extern "C" fn restart() {
    if let Some(s) = session_mut() {
        s.game.restart();
    }
}

/// Mark the game assisted (an undo or hint was used), so the outcome reflects it.
#[no_mangle]
pub extern "C" fn mark_assistance() {
    if let Some(s) = session_mut() {
        s.assistance_used = true;
    }
}

// --- outcome ----------

/// The outcome record for the current game as a `pond-docformat` envelope JSON
/// (`kind = "color-sort"`). `declare`: 1 = include the self-declared assistance
/// flag, 0 = omit. Verifiable by replaying `(packed seed, moves)` through
/// `color_sort_core::ColorSort`.
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
        Outcome::Abandoned
    };
    let record = attest::<ColorSort>(s.seed, s.game.moves().to_vec(), result, assistance);
    match pond_outcome::to_doc::<ColorSort>(&record) {
        Ok(bytes) => set_out(bytes),
        Err(_) => set_out_str("null"),
    }
}

/// The packed deal seed of the current game (lo 32 bits), for the host to build
/// its share/replay without re-deriving it. `0` if no game.
#[no_mangle]
pub extern "C" fn seed_lo() -> u32 {
    session_mut().map_or(0, |s| (s.seed & 0xFFFF_FFFF) as u32)
}

/// The packed deal seed of the current game (hi 32 bits). `0` if no game.
#[no_mangle]
pub extern "C" fn seed_hi() -> u32 {
    session_mut().map_or(0, |s| (s.seed >> 32) as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn out_json() -> serde_json::Value {
        let ptr = board_json();
        let n = out_len() as usize;
        // SAFETY: single-threaded test; board_json just wrote OUT.
        let bytes = unsafe { std::slice::from_raw_parts(ptr, n) };
        serde_json::from_slice(bytes).expect("board json")
    }

    // One test: the C-ABI holds global mutable statics, so the whole surface is
    // exercised sequentially in a single test to avoid cross-thread races.
    #[test]
    fn cabi_surface() {
        // No session yet: reads are total (never panic).
        assert_eq!(is_won(), 0);
        let _ = is_deadlocked_();
        assert_eq!(seed_lo(), 0);

        new_daily(0);
        let view = out_json();
        assert_eq!(view["colors"], serde_json::json!(10));
        assert_eq!(view["cap"], serde_json::json!(4));
        assert_eq!(view["tubes"].as_array().unwrap().len(), 12, "10 + 2 tubes");
        assert!(view["par"].as_u64().unwrap() > 0, "daily par is baked");
        assert_eq!(view["won"], serde_json::json!(false));

        // A hint is a legal move; playing it applies.
        let hptr = hint();
        let hn = out_len() as usize;
        let hjson: serde_json::Value =
            serde_json::from_slice(unsafe { std::slice::from_raw_parts(hptr, hn) }).unwrap();
        assert!(hjson["from"].is_number(), "hint returns a move");
        let (from, to) = (
            hjson["from"].as_u64().unwrap() as u32,
            hjson["to"].as_u64().unwrap() as u32,
        );
        assert_eq!(pour(from, to), 0, "the hinted pour applies");
        assert_eq!(out_json()["moveCount"], serde_json::json!(1));

        // Undo reverts.
        assert_eq!(undo(), 1);
        assert_eq!(out_json()["moveCount"], serde_json::json!(0));

        // An out-of-range pour is rejected, not a panic.
        assert_eq!(pour(999, 0), 1);

        // Outcome parses to a color-sort envelope.
        let optr = outcome_json(1);
        let on = out_len() as usize;
        let rec: serde_json::Value =
            serde_json::from_slice(unsafe { std::slice::from_raw_parts(optr, on) }).unwrap();
        assert_eq!(rec["kind"], serde_json::json!("color-sort"));

        // Endless generates a smaller board at level 1 and is playable.
        new_endless(1);
        let view = out_json();
        assert_eq!(view["colors"], serde_json::json!(4), "level 1 is 4 colours");
        assert!(
            !view["moves"].as_array().unwrap().is_empty(),
            "has legal moves"
        );
    }
}
