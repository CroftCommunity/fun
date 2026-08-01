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
use bubble_core::{resolve_shot, Angle, Board, Bubble, BubbleLevels, Cell, Game, LevelGame};
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
    /// The most recent shot's pop/drop cells, so the host can animate the
    /// resolution (burst + fall) before re-rendering. `None` before any shot.
    last_shot: Option<bubble_core::engine::ShotReport>,
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
            last_shot: None,
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
    /// The on-deck colour — previewed as the next-piece indicator.
    next_color: u8,
    score: u64,
    shots_left: usize,
    shot_budget: usize,
    /// Whether the board is cleared (the objective is met).
    cleared: bool,
}

/// One removed cell for the resolution animation: `[row, col, colour]`.
type CellView = [i32; 3];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LastShotView {
    /// Cells the pop removed (burst animation), `[r, c, colour]` each.
    popped: Vec<CellView>,
    /// Cells that dropped as orphans (fall animation), `[r, c, colour]` each.
    dropped: Vec<CellView>,
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
            (0..b.row_len_at(r))
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
        next_color: s.game.next_color(),
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

/// The most recent shot's removed cells as JSON (`{popped, dropped}`, each a list
/// of `[r, c, colour]`) so the host can animate the burst + orphan-fall before
/// re-rendering. `{"popped":[],"dropped":[]}` before any shot. Presentational —
/// never hashed.
#[no_mangle]
pub extern "C" fn last_shot_json() -> *const u8 {
    let cells = |v: &[(bubble_core::Pos, u8)]| -> Vec<CellView> {
        v.iter()
            .map(|&((r, c), color)| {
                [
                    i32::try_from(r).unwrap_or(-1),
                    i32::try_from(c).unwrap_or(-1),
                    i32::from(color),
                ]
            })
            .collect()
    };
    let view = match session_mut().and_then(|s| s.last_shot.as_ref()) {
        Some(rep) => LastShotView {
            popped: cells(&rep.popped),
            dropped: cells(&rep.dropped),
        },
        None => LastShotView {
            popped: Vec::new(),
            dropped: Vec::new(),
        },
    };
    match serde_json::to_vec(&view) {
        Ok(bytes) => set_out(bytes),
        Err(_) => set_out_str("{\"popped\":[],\"dropped\":[]}"),
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

/// The on-deck colour (`0..colors`) — the next-piece preview.
#[no_mangle]
pub extern "C" fn next_color() -> u32 {
    session_mut().map_or(0, |s| u32::from(s.game.next_color()))
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
    s.last_shot = Some(s.game.play(Angle(deg)));
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
        let gain = rep.popped.len() + rep.dropped.len();
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

// --- levels mode (escalating, point-gated, descending-stack survival) --------
//
// A second, independent held session (its own `static mut`), so the host can run
// levels mode without disturbing the clear-board session above. Geometry
// (`geom_json`) is shared — the constants are mode-independent — but the board
// dimensions, level state, trajectory, and outcome are levels-specific.

struct LevelSession {
    seed: u64,
    game: LevelGame,
    assistance_used: bool,
    last_shot: Option<bubble_core::engine::ShotReport>,
    /// Whether the most recent shot pushed in a new top row (UI slide animation).
    last_inserted: bool,
}

static mut LEVEL_STATE: Option<LevelSession> = None;

fn level_session_mut() -> Option<&'static mut LevelSession> {
    // SAFETY: single-threaded wasm; host calls are sequential.
    unsafe { (*core::ptr::addr_of_mut!(LEVEL_STATE)).as_mut() }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LevelBoardView {
    width: usize,
    height: usize,
    /// Row-parity offset (0/1): row `r` is full when `(r + parityOffset)` is even.
    /// The host staggers/renders each row's half-cell indent from this.
    parity_offset: usize,
    /// Row-major, one inner list per row with that row's length; `-1` = empty.
    cells: Vec<Vec<i16>>,
    current_color: u8,
    next_color: u8,
    level: u32,
    level_score: u64,
    total_score: u64,
    target_score: u64,
    colors: usize,
    shots_to_insert: usize,
    deadline_rows: usize,
    /// Presentational per-level clock, seconds — a UI-only countdown, never a
    /// verified loss.
    time_limit_secs: u32,
    lost: bool,
    /// Whether the most recent shot pushed in a new top row (for the animation).
    last_inserted: bool,
}

fn level_board_view(s: &LevelSession) -> LevelBoardView {
    let b: &Board = s.game.board();
    let cells = (0..b.height)
        .map(|r| {
            (0..b.row_len_at(r))
                .map(|c| match b.get(r, c) {
                    Some(Cell::Bubble(col)) => i16::from(col),
                    _ => -1,
                })
                .collect()
        })
        .collect();
    LevelBoardView {
        width: b.width,
        height: b.height,
        parity_offset: b.parity_offset(),
        cells,
        current_color: s.game.current_color(),
        next_color: s.game.next_color(),
        level: s.game.level(),
        level_score: s.game.level_score(),
        total_score: s.game.total_score(),
        target_score: s.game.target_score(),
        colors: s.game.colors(),
        shots_to_insert: s.game.shots_to_insert(),
        deadline_rows: s.game.deadline_rows(),
        time_limit_secs: s.game.time_limit_secs(),
        lost: s.game.is_lost(),
        last_inserted: s.last_inserted,
    }
}

/// Start a fresh levels-mode run from `seed`.
#[no_mangle]
pub extern "C" fn new_level_game(seed_lo: u32, seed_hi: u32) {
    let seed = (u64::from(seed_hi) << 32) | u64::from(seed_lo);
    // SAFETY: single-threaded; replaces the held levels session.
    unsafe {
        *core::ptr::addr_of_mut!(LEVEL_STATE) = Some(LevelSession {
            seed,
            game: LevelGame::new(seed),
            assistance_used: false,
            last_shot: None,
            last_inserted: false,
        });
    }
}

/// The levels board + level/score/pressure/timer state as JSON. `"null"` if no
/// levels game.
#[no_mangle]
pub extern "C" fn level_board_json() -> *const u8 {
    match level_session_mut() {
        Some(s) => match serde_json::to_vec(&level_board_view(s)) {
            Ok(bytes) => set_out(bytes),
            Err(_) => set_out_str("null"),
        },
        None => set_out_str("null"),
    }
}

/// The resolved trajectory for aiming `angle` on the levels board (fixed-point
/// flight path + landing cell), as JSON. `"null"` if no levels game.
#[no_mangle]
pub extern "C" fn level_trajectory_json(angle: u32) -> *const u8 {
    let Some(s) = level_session_mut() else {
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

/// The most recent levels shot's removed cells + whether a row was inserted, as
/// JSON (`{popped, dropped, inserted}`). `{"popped":[],"dropped":[],"inserted":false}`
/// before any shot. Presentational.
#[no_mangle]
pub extern "C" fn level_last_shot_json() -> *const u8 {
    let cells = |v: &[(bubble_core::Pos, u8)]| -> Vec<CellView> {
        v.iter()
            .map(|&((r, c), color)| {
                [
                    i32::try_from(r).unwrap_or(-1),
                    i32::try_from(c).unwrap_or(-1),
                    i32::from(color),
                ]
            })
            .collect()
    };
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct LevelLastShotView {
        popped: Vec<CellView>,
        dropped: Vec<CellView>,
        inserted: bool,
    }
    let view = match level_session_mut() {
        Some(s) => match s.last_shot.as_ref() {
            Some(rep) => LevelLastShotView {
                popped: cells(&rep.popped),
                dropped: cells(&rep.dropped),
                inserted: s.last_inserted,
            },
            None => LevelLastShotView {
                popped: Vec::new(),
                dropped: Vec::new(),
                inserted: false,
            },
        },
        None => LevelLastShotView {
            popped: Vec::new(),
            dropped: Vec::new(),
            inserted: false,
        },
    };
    match serde_json::to_vec(&view) {
        Ok(bytes) => set_out(bytes),
        Err(_) => set_out_str("{\"popped\":[],\"dropped\":[],\"inserted\":false}"),
    }
}

/// Fire the current launcher colour along `angle` in levels mode. Returns `2` if
/// there is no levels game or the run is already lost (no shot taken), else `0`.
#[no_mangle]
pub extern "C" fn level_shoot(angle: u32) -> u32 {
    let Some(s) = level_session_mut() else {
        return 2;
    };
    if s.game.is_lost() {
        return 2;
    }
    let deg = u16::try_from(angle).unwrap_or(u16::MAX);
    s.last_shot = Some(s.game.play(Angle(deg)));
    s.last_inserted = s.game.last_inserted();
    0
}

/// A suggested aim angle for the levels board: the reachable shot that pops/drops
/// the most (lowest angle on a tie), else the fan midpoint. `0` if no game. A hint
/// is assistance — the host declares it via [`level_mark_assistance`].
#[no_mangle]
pub extern "C" fn level_hint_angle() -> u32 {
    let Some(s) = level_session_mut() else {
        return 0;
    };
    let (lo, hi) = bubble_core::fan();
    let mut best_gain = 0usize;
    let mut best = lo + (hi - lo) / 2;
    for deg in lo..=hi {
        let mut probe = s.game.clone();
        let rep = probe.play(Angle(deg));
        let gain = rep.popped.len() + rep.dropped.len();
        if gain > best_gain {
            best_gain = gain;
            best = deg;
        }
    }
    u32::from(best)
}

/// Mark the levels run assisted (a hint was shown).
#[no_mangle]
pub extern "C" fn level_mark_assistance() {
    if let Some(s) = level_session_mut() {
        s.assistance_used = true;
    }
}

/// `1` if the levels run has ended (a bubble crossed the deadline).
#[no_mangle]
pub extern "C" fn level_is_lost() -> u32 {
    u32::from(level_session_mut().is_some_and(|s| s.game.is_lost()))
}

/// The canonical `state_hash` of the current levels state (quoted JSON string) —
/// the anchor a share re-verifies against by replaying `(seed, shots)`.
#[no_mangle]
pub extern "C" fn level_current_hash() -> *const u8 {
    match level_session_mut() {
        Some(s) => set_out_str(&format!("\"{}\"", s.game.current_hash())),
        None => set_out_str("\"\""),
    }
}

/// The levels outcome record as a `pond-docformat` envelope JSON
/// (`kind = "bubble-levels"`). `declare`: 1 = include the assistance flag, 0 =
/// omit. The run is `Lost` (deadline) or `Abandoned`; never `Won` (endless
/// survival). Verifiable by replaying `(seed, shots)` through `BubbleLevels`.
#[no_mangle]
pub extern "C" fn level_outcome_json(declare: u32) -> *const u8 {
    let Some(s) = level_session_mut() else {
        return set_out_str("null");
    };
    let assistance = if declare == 1 {
        Some(s.assistance_used)
    } else {
        None
    };
    let if_unfinished = if s.game.is_lost() {
        Outcome::Lost
    } else {
        Outcome::Abandoned
    };
    let record = attest::<BubbleLevels>(s.seed, s.game.shots().to_vec(), if_unfinished, assistance);
    match pond_outcome::to_doc::<BubbleLevels>(&record) {
        Ok(bytes) => set_out(bytes),
        Err(_) => set_out_str("null"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Read the last output buffer as JSON.
    fn out_json(ptr: *const u8) -> serde_json::Value {
        let n = out_len() as usize;
        // SAFETY: single-threaded test; the preceding call just wrote OUT.
        let bytes = unsafe { std::slice::from_raw_parts(ptr, n) };
        serde_json::from_slice(bytes).expect("valid json")
    }

    // ONE C-ABI wiring test (V4/V5): the module holds a single `static mut`
    // game + output buffer (correct for single-threaded wasm), so all C-ABI
    // exercise must live in one test — the native harness runs `#[test]`s on
    // parallel threads and separate tests would race the shared state.
    // Covers: new_game → geom/hint reads → trajectory → shoot → board changed →
    // outcome is a bubble v2 record → embedded daily seed.
    #[test]
    fn cabi_end_to_end() {
        new_game(495, 0);

        // Geometry + fan are exposed for the UI (seed-independent constants).
        let g = out_json(geom_json());
        assert_eq!(g["diam"], serde_json::json!(256));
        assert_eq!(g["radius"], serde_json::json!(128));
        assert_eq!(g["rowH"], serde_json::json!(222));
        let (lo, hi) = (g["fanLo"].as_u64().unwrap(), g["fanHi"].as_u64().unwrap());
        assert!(lo < hi, "fan is a non-empty range");

        // A hint is an in-fan angle.
        let h = u64::from(hint_angle());
        assert!((lo..=hi).contains(&h), "hint {h} within the fan");

        // A fresh deal: not cleared, shots available.
        let before = out_json(board_json());
        assert_eq!(before["cleared"], serde_json::json!(false));
        let shots_before = before["shotsLeft"].as_u64().unwrap();
        assert!(shots_before > 0);
        // The board view previews both the loaded and the on-deck colour.
        assert!(before["currentColor"].is_u64(), "loaded colour is present");
        assert!(before["nextColor"].is_u64(), "on-deck colour is previewed");
        // No shot yet: the last-shot detail is empty.
        let ls0 = out_json(last_shot_json());
        assert_eq!(ls0["popped"].as_array().unwrap().len(), 0);
        assert_eq!(ls0["dropped"].as_array().unwrap().len(), 0);
        let hash_before = out_json(current_hash());

        // A straight-up trajectory has a launcher→stop path with a landing cell.
        let traj = out_json(trajectory_json(90));
        assert!(
            traj["points"].as_array().unwrap().len() >= 2,
            "path has vertices"
        );
        assert!(traj["landing"].is_array());

        // Firing that angle applies a shot: a shot is spent and the state hash
        // moves. (We assert the shot took effect, not that the landing cell is
        // still filled — a shot that completes a trio pops and empties it.)
        assert_eq!(shoot(90), 0, "an in-fan angle applies");
        let after = out_json(board_json());
        assert_eq!(
            after["shotsLeft"].as_u64().unwrap(),
            shots_before - 1,
            "a shot was spent"
        );
        assert_ne!(out_json(current_hash()), hash_before, "the state advanced");

        // After a shot, the last-shot detail is a well-formed {popped, dropped}
        // of [r, c, colour] triples (either may be empty for this angle/seed).
        let ls1 = out_json(last_shot_json());
        for key in ["popped", "dropped"] {
            for cell in ls1[key].as_array().expect("array") {
                assert_eq!(cell.as_array().unwrap().len(), 3, "[r,c,colour] triple");
            }
        }

        // The outcome is a bubble-kind v3 envelope (2-deep launcher bumped it).
        let rec = out_json(outcome_json(1));
        assert_eq!(rec["kind"], serde_json::json!("bubble"));
        assert_eq!(rec["version"], serde_json::json!(3), "bubble record is v3");

        // The daily seed comes from the embedded pack.
        assert_ne!(bubble_daily_seed(0), 0, "pack seeds are embedded");

        // --- levels mode (same single test — OUT is shared) ---
        new_level_game(7, 0);
        let lb = out_json(level_board_json());
        assert_eq!(lb["level"], serde_json::json!(1), "starts at level 1");
        assert_eq!(lb["totalScore"], serde_json::json!(0));
        assert!(
            lb["targetScore"].as_u64().unwrap() > 0,
            "a level target is surfaced"
        );
        assert!(
            lb["shotsToInsert"].as_u64().unwrap() > 0,
            "shots-until-insert surfaced"
        );
        assert!(
            lb["timeLimitSecs"].as_u64().unwrap() > 0,
            "presentational clock surfaced"
        );
        assert_eq!(
            lb["parityOffset"],
            serde_json::json!(0),
            "fresh board is offset 0"
        );
        assert_eq!(lb["lost"], serde_json::json!(false));

        // A levels trajectory resolves like the clear-board one.
        let ltraj = out_json(level_trajectory_json(90));
        assert!(ltraj["points"].as_array().unwrap().len() >= 2);
        assert!(ltraj["landing"].is_array());

        // A hint is in-fan; firing applies and advances the levels state.
        let lhint = u64::from(level_hint_angle());
        assert!(
            (lo..=hi).contains(&lhint),
            "levels hint {lhint} within the fan"
        );
        assert_eq!(level_shoot(90), 0, "a levels shot applies");
        let lb2 = out_json(level_board_json());
        assert!(
            lb2["totalScore"].as_u64().unwrap() >= lb["totalScore"].as_u64().unwrap(),
            "score is monotone non-decreasing"
        );
        // last-shot detail is well-formed {popped, dropped, inserted}.
        let lls = out_json(level_last_shot_json());
        assert!(lls["inserted"].is_boolean());
        for key in ["popped", "dropped"] {
            for cell in lls[key].as_array().expect("array") {
                assert_eq!(cell.as_array().unwrap().len(), 3, "[r,c,colour] triple");
            }
        }
        // Outcome is a bubble-levels v1 envelope, not Won (endless survival).
        let lrec = out_json(level_outcome_json(1));
        assert_eq!(lrec["kind"], serde_json::json!("bubble-levels"));
        assert_eq!(lrec["version"], serde_json::json!(1));
        assert_ne!(lrec["payload"]["result"], serde_json::json!("Won"));
    }
}
