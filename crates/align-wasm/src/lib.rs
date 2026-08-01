//! Browser binding over [`align_core`] for the games shelf — raw C-ABI +
//! serde-JSON, no `wasm-bindgen` (the same pattern as `twenty48-wasm`).
//!
//! The module holds **one run** (one board per tab). The host drives it by
//! stamping frames: apply queued atomic actions via [`input`], then call [`tick`]
//! once per fixed timestep. The core decides legality; a rejected action is a
//! no-op. Reads (board / hash / hint / outcome) are JSON written to one output
//! buffer the host reads via the return pointer + [`out_len`].
//!
//! **Never panics** (a wasm panic aborts the module): every fallible path maps to
//! a status code or an empty/`"null"` buffer.

use std::sync::OnceLock;

use align_core::action::Action;
use align_core::engine::Engine;
use align_core::game::{moves_of, Align};
use align_core::mode::ModeConfig;
use pond_outcome::{attest, Outcome};
use serde::{Deserialize, Serialize};

// --- embedded daily seed-pack ----------

static PACK_JSON: &[u8] = include_bytes!("../../../games/align/daily-pack.json");

#[derive(Deserialize)]
struct PackPayload {
    seeds: Vec<u64>,
}
#[derive(Deserialize)]
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

/// The daily seed for `day_index` (from the baked pack). `0` if empty.
#[no_mangle]
pub extern "C" fn daily_seed(day_index: u32) -> u32 {
    let seeds = daily_seeds();
    if seeds.is_empty() {
        return 0;
    }
    u32::try_from(seeds[(day_index as usize) % seeds.len()]).unwrap_or(0)
}

// --- action codes ----------

fn action_from(code: u32) -> Option<Action> {
    match code {
        0 => Some(Action::ShiftL),
        1 => Some(Action::ShiftR),
        2 => Some(Action::RotCW),
        3 => Some(Action::RotCCW),
        4 => Some(Action::Rot180),
        5 => Some(Action::SoftStep),
        6 => Some(Action::HardDrop),
        7 => Some(Action::Hold),
        8 => Some(Action::Quit),
        _ => None,
    }
}

// --- the held session ----------

struct Session {
    seed: u64,
    mode: ModeConfig,
    engine: Engine,
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

/// Start a fresh run for `seed` under `mode` (0 Marathon, 1 Sprint) + `start_level`.
#[no_mangle]
pub extern "C" fn new_game(seed_lo: u32, seed_hi: u32, mode: u32, start_level: u32) {
    let seed = (u64::from(seed_hi) << 32) | u64::from(seed_lo);
    let cfg = ModeConfig::from_ids(mode, start_level);
    // SAFETY: single-threaded; replaces the held session.
    unsafe {
        *core::ptr::addr_of_mut!(STATE) = Some(Session {
            seed,
            mode: cfg,
            engine: Engine::new(seed, cfg),
            assistance_used: false,
        });
    }
}

/// Advance one fixed timestep.
#[no_mangle]
pub extern "C" fn tick() {
    if let Some(s) = session_mut() {
        s.engine.tick();
    }
}

/// Apply an atomic action (0 ShiftL / 1 ShiftR / 2 RotCW / 3 RotCCW / 4 Rot180 /
/// 5 SoftStep / 6 HardDrop / 7 Hold / 8 Quit). Returns 0 applied / 1 rejected /
/// 2 over-or-bad.
#[no_mangle]
pub extern "C" fn input(code: u32) -> u32 {
    let Some(s) = session_mut() else { return 2 };
    let Some(action) = action_from(code) else {
        return 2;
    };
    match s.engine.input(action) {
        align_core::engine::InputResult::Applied => 0,
        align_core::engine::InputResult::Rejected => 1,
        align_core::engine::InputResult::Over => 2,
    }
}

// --- reads ----------

#[derive(Serialize)]
struct CellXY(i32, i32);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ActivePieceView {
    color: u8,
    cells: Vec<CellXY>,
    ghost: Vec<CellXY>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BoardView {
    width: usize,
    height: usize,
    visible: usize,
    /// Colour ids, bottom-to-top (`rows[0]` is the board's bottom row).
    rows: Vec<Vec<u8>>,
    active: Option<ActivePieceView>,
    hold: u8,
    hold_locked: bool,
    next: Vec<u8>,
    score: u64,
    level: u32,
    lines: u32,
    goal_lines: u32,
    combo: u32,
    b2b: bool,
    tick: u32,
    over: bool,
    won: bool,
    label: &'static str,
}

fn board_view(s: &Session) -> BoardView {
    let e = &s.engine;
    let b = e.board();
    let (w, h) = (align_core::board::WIDTH, align_core::board::HEIGHT);
    let rows = (0..h)
        .map(|y| (0..w).map(|x| b.get(x as i32, y as i32)).collect())
        .collect();
    let active = e.active_view().map(|a| ActivePieceView {
        color: a.color,
        cells: a.cells.iter().map(|&(x, y)| CellXY(x, y)).collect(),
        ghost: a.ghost.iter().map(|&(x, y)| CellXY(x, y)).collect(),
    });
    BoardView {
        width: w,
        height: h,
        visible: align_core::board::VISIBLE,
        rows,
        active,
        hold: e.hold_color(),
        hold_locked: e.hold_used(),
        next: e.preview(),
        score: e.score(),
        level: e.level(),
        lines: e.lines(),
        goal_lines: s.mode.goal_lines,
        combo: e.combo(),
        b2b: e.b2b(),
        tick: e.tick_count(),
        over: e.is_over(),
        won: e.is_won(),
        label: e.last_label().text(),
    }
}

/// The full render state as JSON. `"null"` if no run.
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

/// The canonical `state_hash` (quoted JSON string).
#[no_mangle]
pub extern "C" fn current_hash() -> *const u8 {
    match session_mut() {
        Some(s) => set_out_str(&format!("\"{}\"", s.engine.current_hash())),
        None => set_out_str("\"\""),
    }
}

/// `1` if the run is over.
#[no_mangle]
pub extern "C" fn is_over() -> u32 {
    u32::from(session_mut().is_some_and(|s| s.engine.is_over()))
}

/// `1` if the run reached its goal.
#[no_mangle]
pub extern "C" fn is_won() -> u32 {
    u32::from(session_mut().is_some_and(|s| s.engine.is_won()))
}

/// A hint placement (the four suggested cells as `[[x,y],…]`), or `"null"`.
/// Using a hint counts as assistance (the host also calls [`mark_assistance`]).
#[no_mangle]
pub extern "C" fn hint_json() -> *const u8 {
    match session_mut().and_then(|s| s.engine.hint()) {
        Some(cells) => {
            let v: Vec<CellXY> = cells.iter().map(|&(x, y)| CellXY(x, y)).collect();
            match serde_json::to_vec(&v) {
                Ok(bytes) => set_out(bytes),
                Err(_) => set_out_str("null"),
            }
        }
        None => set_out_str("null"),
    }
}

/// Mark the run assisted (a hint was shown).
#[no_mangle]
pub extern "C" fn mark_assistance() {
    if let Some(s) = session_mut() {
        s.assistance_used = true;
    }
}

// --- outcome ----------

/// The outcome record as a `pond-docformat` envelope JSON (`kind = "align"`).
/// `declare`: 1 = include the self-declared assistance flag, 0 = omit.
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
    let result = if s.engine.is_won() {
        Outcome::Won
    } else {
        Outcome::Lost
    };
    let record = attest::<Align>(s.seed, moves_of(&s.engine), result, assistance);
    match pond_outcome::to_doc::<Align>(&record) {
        Ok(bytes) => set_out(bytes),
        Err(_) => set_out_str("null"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read_out(ptr: *const u8) -> Vec<u8> {
        let n = out_len() as usize;
        // SAFETY: single-threaded test; the call just wrote OUT.
        unsafe { std::slice::from_raw_parts(ptr, n).to_vec() }
    }

    #[test]
    fn cabi_new_tick_input_outcome() {
        new_game(2325, 0, 0, 1);
        let view: serde_json::Value =
            serde_json::from_slice(&read_out(board_json())).expect("board json");
        assert_eq!(view["width"], serde_json::json!(10));
        assert_eq!(view["height"], serde_json::json!(40));
        assert!(view["active"].is_object(), "a piece is active");

        // A tick advances the tick counter.
        let t0 = view["tick"].as_u64().unwrap();
        tick();
        let view2: serde_json::Value =
            serde_json::from_slice(&read_out(board_json())).expect("board json");
        assert_eq!(view2["tick"].as_u64().unwrap(), t0 + 1);

        // A legal action applies; an out-of-range code is rejected, not a panic.
        assert_eq!(input(1), 0, "shift right applies");
        assert_eq!(input(99), 2, "bad code rejected");

        // Hint returns four cells.
        let hint: serde_json::Value =
            serde_json::from_slice(&read_out(hint_json())).expect("hint json");
        assert_eq!(
            hint.as_array().unwrap().len(),
            4,
            "hint is a 4-cell placement"
        );

        // A hard drop locks + spawns; state stays consistent.
        assert_eq!(input(6), 0, "hard drop applies");

        // Outcome parses to an align-kind envelope.
        let rec: serde_json::Value =
            serde_json::from_slice(&read_out(outcome_json(1))).expect("outcome json");
        assert_eq!(rec["kind"], serde_json::json!("align"));

        // Daily seed comes from the embedded pack.
        assert_ne!(daily_seed(0), 0, "pack seeds are embedded");
    }
}
