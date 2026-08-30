//! Browser binding over [`mahjong_core`] + [`mahjong_solver`] for the games
//! shelf — raw C-ABI + serde-JSON, no `wasm-bindgen` (the `looseends-wasm`
//! pattern).
//!
//! The module holds **one game**. The host starts a level, a daily (it passes
//! the FNV seed of the date key, mirrored in the TS wrapper), a free deal, or a
//! packed origin (the `?r=` re-verification path); reads the board as JSON;
//! plays pairs by slot id, shuffles, undoes. **The core decides FREE and the
//! match** — an illegal pair is a status, never a change. Reads are JSON in one
//! output buffer the host reads via the returned pointer + [`out_len`].
//!
//! **Never panics**: every fallible path maps to a status code or an empty /
//! `"null"` buffer.

#![warn(missing_docs)]

use mahjong_core::{daily_origin, level_origin, Game, LayoutId, Mahjong, Move, Origin, SHUFFLE};
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
fn set_session(game: Option<Game>) {
    // SAFETY: single-threaded; replaces the held session.
    unsafe {
        *core::ptr::addr_of_mut!(STATE) = game.map(|game| Session { game });
    }
}
#[cfg(test)]
fn clear_session() {
    set_session(None);
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

/// Start campaign level `n` (`1..`). A deal that cannot be built (never
/// observed) leaves no game rather than panicking.
#[no_mangle]
pub extern "C" fn new_level(n: u32) {
    set_session(Game::new(level_origin(n)).ok());
}

/// Start the daily Turtle for a precomputed daily `seed` — the host derives it
/// as `FNV-1a("mahjong-daily-" + "YYYY-MM-DD")`, the same integer-exact hash
/// `mahjong_core::daily_seed` uses, mirrored in the TS wrapper.
#[no_mangle]
pub extern "C" fn new_daily(seed: u32) {
    let _ = daily_origin;
    set_session(
        Game::new(Origin {
            layout: LayoutId::Turtle,
            seed,
        })
        .ok(),
    );
}

/// Start a free deal: `layout` is the layout byte (`0` Pond … `4` Turtle), `seed`
/// the RNG seed. An unknown layout leaves no game.
#[no_mangle]
pub extern "C" fn new_seed(layout: u32, seed: u32) {
    let game = LayoutId::from_u8(layout.min(255) as u8)
        .and_then(|layout| Game::new(Origin { layout, seed }).ok());
    set_session(game);
}

/// Rebuild a game from a record's packed origin (`lo`/`hi` halves) — the
/// re-verification path: replay the record's moves through [`play_code`] and
/// compare [`current_hash`] / [`is_won`] to what it claims.
#[no_mangle]
pub extern "C" fn new_packed(lo: u32, hi: u32) {
    let packed = (u64::from(hi) << 32) | u64::from(lo);
    set_session(Game::from_packed(packed));
}

/// The low 32 bits of the current game's packed origin (`0` with no game).
#[no_mangle]
pub extern "C" fn seed_lo() -> u32 {
    session().map_or(0, |s| s.game.packed_seed() as u32)
}

/// The high 32 bits of the current game's packed origin.
#[no_mangle]
pub extern "C" fn seed_hi() -> u32 {
    session().map_or(0, |s| (s.game.packed_seed() >> 32) as u32)
}

// --- reads ----------

#[derive(Serialize)]
struct SlotView {
    x: u8,
    y: u8,
    z: u8,
    face: u8,
    present: bool,
    free: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BoardView {
    layout: &'static str,
    layout_id: u8,
    width: u8,
    height: u8,
    slots: Vec<SlotView>,
    remaining: usize,
    total: usize,
    move_count: usize,
    pairs: usize,
    won: bool,
    stuck: bool,
}

fn layout_slug(id: LayoutId) -> &'static str {
    match id {
        LayoutId::Pond => "pond",
        LayoutId::Bridge => "bridge",
        LayoutId::Fortress => "fortress",
        LayoutId::Steps => "steps",
        LayoutId::Turtle => "turtle",
    }
}

fn board_view(game: &Game) -> BoardView {
    let b = game.board();
    let l = b.layout();
    let slots = l
        .slots
        .iter()
        .enumerate()
        .map(|(i, s)| SlotView {
            x: s.x,
            y: s.y,
            z: s.z,
            face: b.face(i).0,
            present: b.is_present(i),
            free: b.is_free(i),
        })
        .collect();
    BoardView {
        layout: layout_slug(l.id),
        layout_id: l.id as u8,
        width: l.width,
        height: l.height,
        slots,
        remaining: b.remaining(),
        total: l.len(),
        move_count: game.moves().len(),
        pairs: b.legal_moves().len(),
        won: b.is_cleared(),
        stuck: b.is_stuck(),
    }
}

/// The current board (layout geometry, faces, present/free flags, counts) as
/// JSON. `"null"` if no game.
#[no_mangle]
pub extern "C" fn board_json() -> *const u8 {
    match session() {
        Some(s) => set_out_json(&board_view(&s.game)),
        None => set_out_str("null"),
    }
}

/// The free tiles that could pair with `slot`, as a JSON array of slot ids
/// (empty for a blocked, gone or unknown slot, or no game).
#[no_mangle]
pub extern "C" fn matches_json(slot: u32) -> *const u8 {
    let ids: Vec<usize> = session()
        .filter(|s| (slot as usize) < s.game.board().layout().len())
        .map(|s| s.game.board().matches_for(slot as usize))
        .unwrap_or_default();
    set_out_json(&ids)
}

/// The canonical `state_hash` (a quoted JSON string; `""` with no game).
#[no_mangle]
pub extern "C" fn current_hash() -> *const u8 {
    match session() {
        Some(s) => set_out_str(&format!("\"{}\"", s.game.current_hash())),
        None => set_out_str("\"\""),
    }
}

/// `1` if the board is cleared.
#[no_mangle]
pub extern "C" fn is_won() -> u32 {
    u32::from(session().is_some_and(|s| s.game.is_won()))
}

/// Tiles still on the board.
#[no_mangle]
pub extern "C" fn remaining() -> u32 {
    session().map_or(0, |s| s.game.board().remaining() as u32)
}

#[derive(Serialize)]
struct HintView {
    a: usize,
    b: usize,
    proven: bool,
}

/// A hint as JSON `{ a, b, proven }`, or `null` when cleared, stuck, or no
/// game. `budget` is the solver's node budget: the pair is `proven` when a
/// winning line was found within it, else it is the heuristic's best guess.
#[no_mangle]
pub extern "C" fn hint_json(budget: u32) -> *const u8 {
    match session().and_then(|s| mahjong_solver::hint(s.game.board(), u64::from(budget))) {
        Some(h) => set_out_json(&HintView {
            a: h.a,
            b: h.b,
            proven: h.proven,
        }),
        None => set_out_str("null"),
    }
}

// --- moves (status: 0 applied / 1 refused / 2 no game) ----------

fn apply(mv: Move) -> u32 {
    let Some(s) = session_mut() else { return 2 };
    u32::from(s.game.play(mv).is_err())
}

/// Remove the pair `(a, b)`. The core decides: `0` applied, `1` refused (not
/// free, no match, gone, unknown, the same slot twice), `2` no game.
#[no_mangle]
pub extern "C" fn play(a: u32, b: u32) -> u32 {
    if a > 0xFF || b > 0xFF {
        return u32::from(session().is_some());
    }
    apply(Move::pair(a as usize, b as usize))
}

/// Play a raw move code from a record (a pair code or the shuffle code) — the
/// replay path. Same statuses as [`play`].
#[no_mangle]
pub extern "C" fn play_code(code: u32) -> u32 {
    apply(Move::from_u32(code))
}

/// Re-deal the remaining tiles (recorded as a move). `1` on a cleared board.
#[no_mangle]
pub extern "C" fn shuffle() -> u32 {
    apply(SHUFFLE)
}

/// Take back the last move. `1` if one was undone.
#[no_mangle]
pub extern "C" fn undo() -> u32 {
    session_mut().map_or(0, |s| u32::from(s.game.undo()))
}

/// Restart the current deal from its origin.
#[no_mangle]
pub extern "C" fn restart() {
    if let Some(s) = session_mut() {
        if let Ok(fresh) = Game::new(s.game.origin()) {
            s.game = fresh;
        }
    }
}

// --- outcome ----------

/// The outcome record as a `pond-docformat` envelope (`kind = "mahjong"`).
/// `declare`: 1 = carry the self-declared assistance flag (`assisted`), 0 =
/// omit it. `"null"` with no game.
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
    let record = attest::<Mahjong>(
        s.game.packed_seed(),
        s.game.moves().to_vec(),
        Outcome::Abandoned,
        assistance,
    );
    match pond_outcome::to_doc::<Mahjong>(&record) {
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
    fn read_str(ptr: *const u8) -> String {
        let n = out_len() as usize;
        // SAFETY: as above.
        let bytes = unsafe { std::slice::from_raw_parts(ptr, n) };
        std::str::from_utf8(bytes).expect("utf8").to_owned()
    }

    // One test: the C-ABI holds a single global session, so the checks run
    // sequentially (parallel tests would race the shared `STATE`).
    #[test]
    fn cabi_surface_is_correct_and_never_panics() {
        // --- no game: every call is safe ---
        clear_session();
        assert_eq!(play(0, 1), 2);
        assert_eq!(shuffle(), 2);
        assert_eq!(undo(), 0);
        assert_eq!(is_won(), 0);
        assert_eq!(remaining(), 0);
        assert_eq!(read(board_json()), serde_json::json!(null));
        assert_eq!(read(hint_json(1000)), serde_json::json!(null));
        assert_eq!(read(matches_json(0)), serde_json::json!([]));
        assert_eq!(read_str(current_hash()), "\"\"");
        assert_eq!(read(outcome_json(1, 0)), serde_json::json!(null));

        // --- a level: the board view, matches, play, refusal, undo ---
        new_level(1);
        let view = read(board_json());
        assert_eq!(view["layout"], serde_json::json!("pond"));
        assert_eq!(view["total"], serde_json::json!(36));
        assert_eq!(view["remaining"], serde_json::json!(36));
        assert_eq!(view["won"], serde_json::json!(false));
        assert_eq!(view["stuck"], serde_json::json!(false));
        assert!(
            view["pairs"].as_u64().unwrap() > 0,
            "a fresh deal has legal pairs"
        );
        let slots = view["slots"].as_array().unwrap();
        assert_eq!(slots.len(), 36);
        assert!(slots
            .iter()
            .all(|s| s["present"] == serde_json::json!(true)));
        let free_slot = slots
            .iter()
            .position(|s| s["free"] == serde_json::json!(true))
            .unwrap();
        let blocked = slots
            .iter()
            .position(|s| s["free"] == serde_json::json!(false))
            .unwrap();

        // A blocked tile is refused; the board is unchanged.
        let h0 = read_str(current_hash());
        assert_eq!(play(free_slot as u32, blocked as u32), 1);
        assert_eq!(read_str(current_hash()), h0);
        assert_eq!(
            play(free_slot as u32, free_slot as u32),
            1,
            "the same slot twice"
        );
        assert_eq!(play(999, 1), 1, "an unknown slot");

        // A legal pair from the hint is played; remaining drops by two.
        let hint = read(hint_json(20_000));
        let (a, b) = (
            hint["a"].as_u64().unwrap() as u32,
            hint["b"].as_u64().unwrap() as u32,
        );
        assert_eq!(
            hint["proven"],
            serde_json::json!(true),
            "a fresh Pond is proven within budget"
        );
        let m = read(matches_json(a));
        assert!(m
            .as_array()
            .unwrap()
            .iter()
            .any(|x| x.as_u64() == Some(u64::from(b))));
        assert_eq!(play(a, b), 0);
        assert_eq!(remaining(), 34);
        assert_eq!(play(a, b), 1, "a gone pair is refused");
        assert_eq!(undo(), 1);
        assert_eq!(remaining(), 36);
        assert_eq!(read_str(current_hash()), h0);
        assert_eq!(undo(), 0, "nothing left to undo");

        // --- shuffle: recorded, faces move, slots do not ---
        assert_eq!(play(a, b), 0);
        assert_eq!(shuffle(), 0);
        assert_eq!(remaining(), 34);
        let view = read(board_json());
        assert_eq!(view["moveCount"], serde_json::json!(2));
        assert_eq!(
            view["slots"][a as usize]["present"],
            serde_json::json!(false)
        );

        // --- the outcome envelope + the packed re-verification path ---
        let lo = seed_lo();
        let hi = seed_hi();
        let rec = read(outcome_json(1, 1));
        assert_eq!(rec["kind"], serde_json::json!("mahjong"));
        assert_eq!(rec["payload"]["result"], serde_json::json!("Abandoned"));
        assert_eq!(rec["payload"]["assistance"], serde_json::json!(true));
        let moves: Vec<u32> = rec["payload"]["moves"]
            .as_array()
            .unwrap()
            .iter()
            .map(|m| m.as_u64().unwrap() as u32)
            .collect();
        let want = read_str(current_hash());
        new_packed(lo, hi);
        for m in moves {
            let _ = play_code(m);
        }
        assert_eq!(
            read_str(current_hash()),
            want,
            "replay from the packed origin reproduces the hash"
        );

        // --- a daily and a free deal, and a full solve to a win ---
        new_daily(mahjong_core::daily_seed("2026-08-30"));
        assert_eq!(read(board_json())["layout"], serde_json::json!("turtle"));
        assert_eq!(remaining(), 144);
        new_seed(0, 5);
        assert_eq!(remaining(), 36);
        loop {
            let h = read(hint_json(20_000));
            if h.is_null() {
                break;
            }
            assert_eq!(
                play(
                    h["a"].as_u64().unwrap() as u32,
                    h["b"].as_u64().unwrap() as u32
                ),
                0
            );
        }
        assert_eq!(is_won(), 1, "hints walk a fresh Pond to a clear");
        assert_eq!(shuffle(), 1, "nothing to shuffle on a cleared board");
        let rec = read(outcome_json(0, 0));
        assert_eq!(rec["payload"]["result"], serde_json::json!("Won"));
        assert_eq!(rec["payload"]["assistance"], serde_json::json!(null));

        // --- a bad packed origin is a refusal, not a panic ---
        new_packed(0, 200);
        assert_eq!(read(board_json()), serde_json::json!(null));
        assert_eq!(play(0, 1), 2);
    }
}
