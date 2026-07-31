//! Browser binding over [`bubble_core`] for the games shelf — raw C-ABI +
//! serde-JSON, no `wasm-bindgen` (the `xbuild` pattern, like `match3-wasm`).
//!
//! The module holds **one game** (one board per tab): clear-the-board within a
//! shot budget. Aim is a quantized [`Angle`] — the host reads `trajectory_json`
//! to draw the aim preview (fixed-point flight path + resolved landing) and
//! calls [`shoot`] with the angle; the core resolves the landing. Reads (board /
//! trajectory / hash / outcome) are JSON written to one output buffer the host
//! reads via the return pointer + [`out_len`].
//!
//! **Never panics** (a wasm panic aborts the module): every fallible path maps
//! to a status code or an empty/`"null"` buffer.

use bubble_core::clear_board_mode::SHOT_BUDGET;
use bubble_core::{resolve_shot, Angle, Board, Bubble, Cell, Game};
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GeomView {
    /// Bubble diameter in the core's sub-pixel space.
    diam: i32,
    /// Bubble radius.
    radius: i32,
    /// Row vertical spacing.
    row_h: i32,
    /// Legal aim fan lower bound (whole degrees).
    fan_lo: u16,
    /// Legal aim fan upper bound (whole degrees).
    fan_hi: u16,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TrajectoryView {
    /// Fixed-point flight-path vertices `[x, y]` in the core's sub-pixel space
    /// (launcher → each wall bounce → stop). Presentational — never hashed.
    points: Vec<[i32; 2]>,
    /// The resolved landing cell `[r, c]`.
    landing: [usize; 2],
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

/// The fixed sub-pixel geometry + the legal aim fan as JSON — the single source
/// of truth for the UI's canvas layout and its angle control range.
#[no_mangle]
pub extern "C" fn geom_json() -> *const u8 {
    let (fan_lo, fan_hi) = bubble_core::fan();
    let view = GeomView {
        diam: bubble_core::aim::DIAM,
        radius: bubble_core::aim::RADIUS,
        row_h: bubble_core::aim::ROW_H,
        fan_lo,
        fan_hi,
    };
    match serde_json::to_vec(&view) {
        Ok(bytes) => set_out(bytes),
        Err(_) => set_out_str("null"),
    }
}

/// The resolved trajectory for aiming `angle` (whole degrees): the fixed-point
/// flight path (launcher → wall bounces → stop, sub-pixel `[x,y]` vertices) and
/// the landing cell `[r,c]`, as JSON. The host draws the preview along `points`
/// and animates the projectile to `landing`; the core owns both, so the animated
/// bubble lands exactly where a shot at this angle will (RULES.md "Aim").
#[no_mangle]
pub extern "C" fn trajectory_json(angle: u32) -> *const u8 {
    let Some(s) = session_mut() else {
        return set_out_str("null");
    };
    let deg = u16::try_from(angle).unwrap_or(u16::MAX);
    let landing = resolve_shot(s.game.board(), Angle(deg));
    let view = TrajectoryView {
        points: landing.path.iter().map(|&(x, y)| [x, y]).collect(),
        landing: [landing.pos.0, landing.pos.1],
    };
    match serde_json::to_vec(&view) {
        Ok(bytes) => set_out(bytes),
        Err(_) => set_out_str("null"),
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

// --- moves (status: 0 applied / 2 bad state or budget spent) ----------

/// Fire the current launcher colour along `angle` (whole degrees). The core
/// resolves the landing and applies the shot — there is no illegal case (every
/// angle lands somewhere). Returns `2` if there is no game or the budget is
/// spent (no shot taken), else `0`.
#[no_mangle]
pub extern "C" fn shoot(angle: u32) -> u32 {
    let Some(s) = session_mut() else { return 2 };
    if s.game.shots_left() == 0 {
        return 2; // budget spent
    }
    let deg = u16::try_from(angle).unwrap_or(u16::MAX);
    s.game.play(Angle(deg));
    0
}

/// A suggested aim angle: the reachable shot that pops/drops the most from the
/// current board (lowest angle on a tie), or the fan midpoint if nothing pops.
/// `0` if there is no game. A hint is assistance — the host declares it via
/// [`mark_assistance`].
#[no_mangle]
pub extern "C" fn hint_angle() -> u32 {
    let Some(s) = session_mut() else { return 0 };
    let (lo, hi) = bubble_core::fan();
    let mut best_gain = 0usize;
    let mut best = lo + (hi - lo) / 2; // fan midpoint default when nothing pops
    for deg in lo..=hi {
        let mut probe = s.game.clone();
        let rep = probe.play(Angle(deg));
        let gain = rep.popped + rep.dropped;
        if gain > best_gain {
            best_gain = gain;
            best = deg;
        }
    }
    u32::from(best)
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

    // Exercises the C-ABI end to end (the "wiring test" for V4): start a game,
    // read the board, read a trajectory for an angle, shoot that angle, and
    // confirm the board changed to the resolved landing and the outcome JSON
    // parses to a bubble v2 record. Runs native (rlib), not wasm.
    #[test]
    fn cabi_new_game_trajectory_shoot_outcome() {
        new_game(495, 0); // any seed — geometry is seed-independent for a fresh deal
        let board_ptr = board_json();
        assert!(!board_ptr.is_null());
        let n = out_len() as usize;
        // SAFETY: single-threaded test; board_json just wrote OUT.
        let json = unsafe { std::slice::from_raw_parts(board_ptr, n) };
        let view: serde_json::Value = serde_json::from_slice(json).expect("board json");
        assert_eq!(view["cleared"], serde_json::json!(false));
        assert!(view["shotsLeft"].as_u64().unwrap() > 0);

        // Read the trajectory for a straight-up shot: a path with a stop point
        // and a landing cell.
        let tptr = trajectory_json(90);
        let tn = out_len() as usize;
        let tjson = unsafe { std::slice::from_raw_parts(tptr, tn) };
        let traj: serde_json::Value = serde_json::from_slice(tjson).expect("trajectory json");
        let landing = &traj["landing"];
        assert!(
            traj["points"].as_array().unwrap().len() >= 2,
            "path has vertices"
        );
        let (lr, lc) = (
            landing[0].as_u64().unwrap() as usize,
            landing[1].as_u64().unwrap() as usize,
        );

        // Fire that angle; the landing cell must now hold a bubble.
        assert_eq!(shoot(90), 0, "an in-fan angle applies");
        let board_ptr = board_json();
        let n = out_len() as usize;
        let json = unsafe { std::slice::from_raw_parts(board_ptr, n) };
        let view: serde_json::Value = serde_json::from_slice(json).expect("board json");
        assert_ne!(
            view["cells"][lr][lc],
            serde_json::json!(-1),
            "the resolved landing cell is now filled"
        );

        // Outcome parses to a bubble-kind v2 envelope.
        let optr = outcome_json(1);
        let on = out_len() as usize;
        let ojson = unsafe { std::slice::from_raw_parts(optr, on) };
        let rec: serde_json::Value = serde_json::from_slice(ojson).expect("outcome json");
        assert_eq!(rec["kind"], serde_json::json!("bubble"));
        assert_eq!(rec["version"], serde_json::json!(2), "bubble record is v2");

        // Daily seed comes from the embedded pack.
        assert_ne!(bubble_daily_seed(0), 0, "pack seeds are embedded");
    }

    #[test]
    fn cabi_geom_and_hint() {
        new_game(495, 0);
        // Geometry + fan are exposed for the UI.
        let gptr = geom_json();
        let gn = out_len() as usize;
        let gjson = unsafe { std::slice::from_raw_parts(gptr, gn) };
        let g: serde_json::Value = serde_json::from_slice(gjson).expect("geom json");
        assert_eq!(g["diam"], serde_json::json!(256));
        assert_eq!(g["radius"], serde_json::json!(128));
        assert_eq!(g["rowH"], serde_json::json!(222));
        let (lo, hi) = (g["fanLo"].as_u64().unwrap(), g["fanHi"].as_u64().unwrap());
        assert!(lo < hi, "fan is a non-empty range");

        // A hint is an in-fan angle that applies as a legal shot.
        let h = hint_angle();
        assert!(u64::from(h) >= lo && u64::from(h) <= hi, "hint {h} within the fan");
        assert_eq!(shoot(h), 0, "the hinted angle applies");
    }
}
