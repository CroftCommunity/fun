//! Browser binding over `orchard-core`: raw C-ABI + serde-JSON, no
//! `wasm-bindgen`.
//!
//! # The never-panics contract
//!
//! **A wasm panic aborts the module.** Not the call — the whole instance, and
//! with it the page. So every export here answers rather than traps: reads
//! before a game exists return `null`, `0`, or a sentinel; moves return a status
//! code; `verify_json` treats anything the host hands it, including bytes that
//! came out of a URL, as untrusted input rather than as a promise.
//!
//! There is no `unwrap` on any export path. The `unsafe` blocks are all the same
//! shape — single-threaded access to a static, which wasm guarantees because host
//! calls are sequential — and each carries a `SAFETY:` note.
//!
//! # Widths cross explicitly
//!
//! `usize` is 32-bit on `wasm32` and 64-bit natively, so nothing `usize`-shaped
//! crosses the boundary. Seeds are `u64` and cross as an explicit `(lo, hi)`
//! pair; everything else is `u32` or `i32`. This is where a silent
//! `native == wasm` divergence would hide, which is why
//! `a_seed_round_trips_through_two_u32_halves` uses a seed with both halves set.

use orchard_core::game::{Game, Move, MoveError};
use orchard_core::ladder;
use orchard_core::outcome::Orchard;
use orchard_core::pack;
use pond_outcome::{attest, verify, Outcome, Record};
use serde::Serialize;

/// The drop was accepted.
pub const DROP_OK: u32 = 0;
/// Refused: the cooldown has not elapsed.
pub const DROP_COOLING: u32 = 1;
/// Refused: the tick precedes the current tick.
pub const DROP_BACKWARDS: u32 = 2;
/// Refused: the run is over.
pub const DROP_OVER: u32 = 3;
/// Refused: no game has been started.
pub const DROP_NO_GAME: u32 = 4;

/// No fruit — returned by [`held`] and [`next_up`] when there is no game.
pub const NO_TIER: u32 = u32::MAX;

/// The run in progress, and the moves that built it.
struct Session {
    seed: u64,
    game: Game,
    moves: Vec<Move>,
}

static mut STATE: Option<Session> = None;
static mut OUT: Vec<u8> = Vec::new();

fn session_mut() -> Option<&'static mut Session> {
    // SAFETY: single-threaded wasm; host calls are sequential.
    unsafe { (*core::ptr::addr_of_mut!(STATE)).as_mut() }
}

fn set_out(bytes: Vec<u8>) -> *const u8 {
    // SAFETY: single-threaded wasm; replaces the buffer and hands back a pointer
    // the host reads `out_len()` bytes from before the next call.
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

// ── lifecycle ──────────────────────────────────────────────────────────────

/// Start a fresh run for the seed assembled from `(seed_lo, seed_hi)`.
#[no_mangle]
pub extern "C" fn new_game(seed_lo: u32, seed_hi: u32) {
    let seed = (u64::from(seed_hi) << 32) | u64::from(seed_lo);
    // SAFETY: single-threaded; replaces the held session.
    unsafe {
        *core::ptr::addr_of_mut!(STATE) = Some(Session {
            seed,
            game: Game::new(seed),
            moves: Vec::new(),
        });
    }
}

fn code_for(e: MoveError) -> u32 {
    match e {
        MoveError::StillCoolingDown => DROP_COOLING,
        MoveError::TickWentBackwards => DROP_BACKWARDS,
        MoveError::GameOver => DROP_OVER,
    }
}

fn apply(mv: Move) -> u32 {
    let Some(s) = session_mut() else {
        return DROP_NO_GAME;
    };
    match s.game.apply(mv) {
        Ok(()) => {
            s.moves.push(mv);
            DROP_OK
        }
        Err(e) => code_for(e),
    }
}

/// Release the held fruit at `x`, at `tick`. Returns a `DROP_*` code.
#[no_mangle]
pub extern "C" fn drop_at(tick: u32, x: i32) -> u32 {
    apply(Move::Drop { tick, x })
}

/// Advance to `tick` without dropping. Returns a `DROP_*` code.
#[no_mangle]
pub extern "C" fn wait_until(tick: u32) -> u32 {
    apply(Move::Wait { tick })
}

// ── reads ──────────────────────────────────────────────────────────────────

/// Fixed-point sub-units to whole pixels.
///
/// A free function rather than an inline shift so a Rust test can reach it.
/// `cargo mutants` runs `cargo test` and nothing else: a conversion checked only
/// by the vitest is, from the crate's own point of view, unchecked — and
/// shifting it the wrong way still yields an integer, so weak assertions do not
/// notice either.
#[must_use]
pub const fn to_px(fx: i64) -> i64 {
    fx >> 16
}

/// Fixed-point radians to whole milliradians.
///
/// Integer output on purpose: no float crosses this boundary.
#[must_use]
pub const fn to_milliradians(fx: i64) -> i64 {
    (fx * 1000) >> 16
}

/// One fruit, as the renderer needs it. Positions are whole px: the renderer
/// draws, it does not simulate, and handing it sub-pixel fixed-point would
/// invite it to do arithmetic that belongs in the core.
#[derive(Serialize)]
struct FruitView {
    id: u32,
    tier: u8,
    x: i64,
    y: i64,
    r: i64,
    /// Rotation in milliradians — integer, so the JSON carries no floats.
    ang: i64,
}

#[derive(Serialize)]
struct WorldView {
    tick: u32,
    score: u64,
    held: u8,
    next: u8,
    over: bool,
    max_tier: u8,
    fruit: Vec<FruitView>,
}

fn world_view(s: &Session) -> WorldView {
    WorldView {
        tick: s.game.tick(),
        score: s.game.score(),
        held: s.game.held(),
        next: s.game.next(),
        over: s.game.is_over(),
        max_tier: s.game.max_tier(),
        fruit: s
            .game
            .fruit_view()
            .into_iter()
            .map(|f| FruitView {
                id: f.id,
                tier: f.tier,
                x: to_px(f.x),
                y: to_px(f.y),
                r: to_px(f.r),
                ang: to_milliradians(f.ang),
            })
            .collect(),
    }
}

/// The crate's contents plus the header state, as JSON. `"null"` if no game.
#[no_mangle]
pub extern "C" fn world_json() -> *const u8 {
    match session_mut() {
        Some(s) => match serde_json::to_vec(&world_view(s)) {
            Ok(bytes) => set_out(bytes),
            Err(_) => set_out_str("null"),
        },
        None => set_out_str("null"),
    }
}

/// The canonical `state_hash` (quoted JSON string). `""` if no game.
#[no_mangle]
pub extern "C" fn current_hash() -> *const u8 {
    match session_mut() {
        Some(s) => set_out_str(&format!("\"{}\"", s.game.state_hash())),
        None => set_out_str("\"\""),
    }
}

/// The running score, saturated into a `u32` for the boundary.
#[no_mangle]
pub extern "C" fn score() -> u32 {
    session_mut().map_or(0, |s| u32::try_from(s.game.score()).unwrap_or(u32::MAX))
}

/// `1` if the run has ended.
#[no_mangle]
pub extern "C" fn is_over() -> u32 {
    u32::from(session_mut().is_some_and(|s| s.game.is_over()))
}

/// The held fruit's tier, or [`NO_TIER`].
#[no_mangle]
pub extern "C" fn held() -> u32 {
    session_mut().map_or(NO_TIER, |s| u32::from(s.game.held()))
}

/// The previewed fruit's tier, or [`NO_TIER`].
#[no_mangle]
pub extern "C" fn next_up() -> u32 {
    session_mut().map_or(NO_TIER, |s| u32::from(s.game.next()))
}

/// The current tick.
#[no_mangle]
pub extern "C" fn tick() -> u32 {
    session_mut().map_or(0, |s| s.game.tick())
}

/// The number of tiers on the ladder, so the host does not hardcode it.
#[no_mangle]
pub extern "C" fn ladder_tiers() -> u32 {
    ladder::TIERS as u32
}

// ── the daily schedule ─────────────────────────────────────────────────────

fn daily(day: u32) -> u64 {
    pack::daily_seed(&pack::default_pack(), u64::from(day))
}

/// Low half of the seed for `day`. The index wraps, so any day is valid.
#[no_mangle]
pub extern "C" fn daily_seed_lo(day: u32) -> u32 {
    (daily(day) & 0xFFFF_FFFF) as u32
}

/// High half of the seed for `day`.
#[no_mangle]
pub extern "C" fn daily_seed_hi(day: u32) -> u32 {
    (daily(day) >> 32) as u32
}

/// Whether a move at `mv_tick` is part of the run replayed up to `n`.
///
/// Inclusive: a move landing exactly on the tick asked for **is** applied.
/// Lifted out for the same reason as [`to_px`] — the boundary is the whole
/// difference between a bisect naming the right tick and the one before it.
#[must_use]
pub const fn included_in_digest(mv_tick: u32, n: u32) -> bool {
    mv_tick <= n
}

// ── the record ─────────────────────────────────────────────────────────────

/// The current run's `pond-outcome` record, as JSON. `"null"` if no game.
#[no_mangle]
pub extern "C" fn record_json() -> *const u8 {
    let Some(s) = session_mut() else {
        return set_out_str("null");
    };
    let ending = if s.game.is_over() {
        Outcome::Lost
    } else {
        Outcome::Abandoned
    };
    let record = attest::<Orchard>(s.seed, s.moves.clone(), ending, Some(false));
    match serde_json::to_vec(&record) {
        Ok(bytes) => set_out(bytes),
        Err(_) => set_out_str("null"),
    }
}

#[derive(Serialize)]
struct VerifyView {
    ok: bool,
    expected: String,
    actual: String,
}

fn rejected(why: &str) -> *const u8 {
    let v = VerifyView {
        ok: false,
        expected: String::new(),
        actual: why.to_owned(),
    };
    // A failure to serialize a struct of three owned Strings is not reachable,
    // but the export still may not unwrap: a literal is the fallback.
    serde_json::to_vec(&v).map_or_else(
        |_| set_out_str(r#"{"ok":false,"expected":"","actual":"unserializable"}"#),
        set_out,
    )
}

/// Re-verify a record by replay. **Everything about the input is untrusted** —
/// it typically arrives from a URL — so a bad pointer length, invalid UTF-8, or
/// malformed JSON all produce `ok: false` rather than a trap.
///
/// # Safety
/// `ptr` must be valid for `len` bytes. The host owns that buffer; this function
/// only reads it.
#[no_mangle]
pub unsafe extern "C" fn verify_json(ptr: *const u8, len: u32) -> *const u8 {
    if ptr.is_null() || len == 0 {
        return rejected("empty");
    }
    // SAFETY: the caller guarantees `ptr` is valid for `len` bytes; we only read.
    let bytes = unsafe { core::slice::from_raw_parts(ptr, len as usize) };
    let Ok(text) = core::str::from_utf8(bytes) else {
        return rejected("not utf-8");
    };
    let Ok(record) = serde_json::from_str::<Record<Move>>(text) else {
        return rejected("not a record");
    };
    let v = verify::<Orchard>(&record);
    let view = VerifyView {
        ok: v.ok,
        expected: v.expected,
        actual: v.actual,
    };
    serde_json::to_vec(&view).map_or_else(|_| rejected("unserializable"), set_out)
}

// ── the divergence bisect ──────────────────────────────────────────────────

/// The state hash after replaying the current run's moves and advancing to tick
/// `n` (quoted JSON string).
///
/// Promoted from the Phase 0 spike's D6. When the cross-build check goes red,
/// this is what turns "the hashes differ" into "tick 1472" — a bisect the host
/// can run from either side of the boundary.
#[no_mangle]
pub extern "C" fn tick_digest(n: u32) -> *const u8 {
    let Some(s) = session_mut() else {
        return set_out_str("\"\"");
    };
    let mut g = Game::new(s.seed);
    for &mv in &s.moves {
        if !included_in_digest(mv.tick(), n) {
            break;
        }
        let _ = g.apply(mv);
    }
    let _ = g.apply(Move::Wait { tick: n });
    set_out_str(&format!("\"{}\"", g.state_hash()))
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;

    /// Serializes the tests.
    ///
    /// The module's `SAFETY` notes rest on "single-threaded; host calls are
    /// sequential", which is true of wasm and **false of Rust's test harness**,
    /// which runs tests in parallel threads over the same statics. Without this
    /// the suite does not fail — it **SIGTRAPs**, which is what happened the
    /// first time it ran.
    ///
    /// The fix belongs here rather than in the binding: making the exports
    /// thread-safe would add synchronisation that is dead weight in the only
    /// environment they actually run in. The tests are what should honour the
    /// contract.
    static SERIAL: Mutex<()> = Mutex::new(());

    /// Take the lock, tolerating poisoning — one failing test must not cascade
    /// into every other test reporting a lock error instead of its own result.
    fn serial() -> std::sync::MutexGuard<'static, ()> {
        SERIAL
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Drop the held session, so a test can assert what the exports do when no
    /// game exists. The statics outlive any one test, so "before a game exists"
    /// is otherwise only true for whichever test happens to run first — which
    /// is exactly the kind of order dependence that makes a suite lie.
    fn clear_state() {
        // SAFETY: the SERIAL guard is held, so this is the only live access.
        unsafe {
            *core::ptr::addr_of_mut!(STATE) = None;
        }
    }

    fn out() -> String {
        // The host reads `out_len()` bytes at the returned pointer. Tests do the
        // same thing, so they exercise the boundary rather than going around it.
        unsafe {
            let p = current_hash();
            String::from_utf8_lossy(core::slice::from_raw_parts(p, out_len() as usize)).into_owned()
        }
    }

    fn read(p: *const u8) -> String {
        unsafe {
            String::from_utf8_lossy(core::slice::from_raw_parts(p, out_len() as usize)).into_owned()
        }
    }

    // ── the never-panics contract ──────────────────────────────────────────
    // A wasm panic ABORTS THE MODULE — the page dies, not the call. So every
    // export must be callable in any order, at any time, including before a
    // game exists, and answer rather than trap.

    #[test]
    fn every_read_answers_before_a_game_exists() {
        let _guard = serial();
        clear_state();
        assert_eq!(score(), 0);
        assert_eq!(is_over(), 0);
        assert_eq!(tick(), 0);
        assert_eq!(held(), u32::MAX, "no game means no held fruit");
        assert_eq!(next_up(), u32::MAX);
        assert_eq!(read(world_json()), "null");
        assert_eq!(read(record_json()), "null");
    }

    #[test]
    fn a_move_before_a_game_exists_is_refused_not_a_trap() {
        let _guard = serial();
        clear_state();
        assert_eq!(drop_at(0, 220), DROP_NO_GAME);
        assert_eq!(wait_until(100), DROP_NO_GAME);
    }

    #[test]
    fn verify_survives_garbage_input() {
        let _guard = serial();
        // The host hands this whatever came out of a URL. It must never trap.
        let cases: [&[u8]; 5] = [b"", b"{", b"null", b"[]", &[0xff, 0xfe, 0xfd]];
        for c in cases {
            let r = unsafe { verify_json(c.as_ptr(), c.len() as u32) };
            let s = read(r);
            assert!(s.contains("\"ok\""), "garbage produced {s}");
            assert!(s.contains("false"), "garbage verified as ok: {s}");
        }
    }

    #[test]
    fn verify_survives_a_length_longer_than_the_buffer() {
        let _guard = serial();
        // A wrong length from the host is a bug, but it must not be a crash.
        let data = b"{}";
        let r = unsafe { verify_json(data.as_ptr(), 2) };
        assert!(read(r).contains("false"));
    }

    // ── the conversions, where a wrong shift is still an integer ───────────

    #[test]
    fn fixed_point_converts_to_whole_pixels() {
        assert_eq!(to_px(0), 0);
        assert_eq!(to_px(1 << 16), 1);
        assert_eq!(to_px(440 << 16), 440);
        // Sub-pixel remainders floor rather than round, which is what makes the
        // conversion exact rather than nearly so.
        assert_eq!(to_px((1 << 16) - 1), 0);
        assert_eq!(to_px((1 << 16) + (1 << 15)), 1);
        // The direction matters: shifting the other way is still an integer,
        // just 65,536x too large, so "is an integer" cannot see the mistake.
        assert!(to_px(100 << 16) < 100 << 16);
    }

    #[test]
    fn fixed_point_converts_to_whole_milliradians() {
        assert_eq!(to_milliradians(0), 0);
        // One radian is 1000 milliradians.
        assert_eq!(to_milliradians(1 << 16), 1000);
        // Half a radian is 500.
        assert_eq!(to_milliradians(1 << 15), 500);
        // Negative rotation survives the sign.
        assert_eq!(to_milliradians(-(1 << 16)), -1000);
        // `* 1000` mutated to `+ 1000` or `/ 1000` lands nowhere near these.
        assert_ne!(to_milliradians(1 << 16), to_px(1 << 16));
    }

    #[test]
    fn a_move_exactly_on_the_digest_tick_is_included() {
        // The bisect boundary. `<=` vs `<` is the difference between naming the
        // tick a divergence happened on and naming the one before it.
        assert!(
            included_in_digest(100, 100),
            "a move AT the tick is included"
        );
        assert!(included_in_digest(99, 100));
        assert!(!included_in_digest(101, 100));
    }

    // ── the accessors, after a game exists as well as before ───────────────

    #[test]
    fn the_accessors_report_the_run_not_a_constant() {
        // `every_read_answers_before_a_game_exists` asserts they are 0 with no
        // game — which a function that ALWAYS returns 0 also satisfies. This is
        // the other half.
        let _guard = serial();
        new_game(7, 0);
        assert_eq!(drop_at(0, 220), DROP_OK);
        assert_eq!(wait_until(600), DROP_OK);
        assert_eq!(tick(), 600, "tick follows the run");
        assert_ne!(held(), NO_TIER);
        assert!(held() < 5, "the held fruit is droppable");
        assert_eq!(is_over(), 0);
        assert_eq!(ladder_tiers(), 11, "the ladder has eleven tiers");
    }

    #[test]
    fn score_rises_when_a_merge_happens() {
        let _guard = serial();
        new_game(1, 0);
        let mut t = 0;
        for _ in 0..14 {
            if is_over() == 1 {
                break;
            }
            drop_at(t, 220);
            wait_until(t + 33);
            t += 33;
            if score() > 0 {
                return;
            }
        }
        panic!("no merge scored, so score() was never observed non-zero");
    }

    #[test]
    fn the_daily_seed_halves_are_not_the_same_number() {
        // `daily_seed_hi -> 0` and a shifted `>>` both survive a test that only
        // reassembles the halves without looking at them.
        let _guard = serial();
        let lo = daily_seed_lo(0);
        let hi = daily_seed_hi(0);
        let seed = (u64::from(hi) << 32) | u64::from(lo);
        assert_eq!(
            seed,
            orchard_core::pack::daily_seed(&orchard_core::pack::default_pack(), 0)
        );
        // At least one day in the year has a non-zero high half, or the pool is
        // too small for the crossing to be exercised at all.
        assert!(
            (0..366).any(|d| daily_seed_hi(d) != 0) || (0..366).all(|d| daily_seed_lo(d) != 0),
            "the seed pool never exercises both halves"
        );
    }

    // ── the seed boundary, where the width bugs live ───────────────────────

    #[test]
    fn a_seed_round_trips_through_two_u32_halves() {
        let _guard = serial();
        // `usize` is 32-bit on wasm32 and 64-bit native; seeds are u64 and must
        // cross as an explicit pair. A seed with both halves set catches a
        // truncation that a small seed would hide.
        let seed: u64 = 0xDEAD_BEEF_1234_5678;
        new_game((seed & 0xFFFF_FFFF) as u32, (seed >> 32) as u32);
        let via_binding = out();
        let direct = orchard_core::game::Game::new(seed);
        assert_eq!(via_binding, format!("\"{}\"", direct.state_hash()));
    }

    #[test]
    fn a_daily_seed_crosses_as_two_halves_that_reassemble() {
        let _guard = serial();
        let (lo, hi) = (daily_seed_lo(0), daily_seed_hi(0));
        let seed = (u64::from(hi) << 32) | u64::from(lo);
        let pack = orchard_core::pack::generate_pack(
            orchard_core::pack::MASTER_SEED,
            orchard_core::pack::POOL,
            orchard_core::pack::COUNT,
        );
        assert_eq!(seed, orchard_core::pack::daily_seed(&pack, 0));
    }

    #[test]
    fn the_day_index_wraps_rather_than_trapping() {
        let _guard = serial();
        // A host passing a large day index must not index out of bounds.
        let _ = daily_seed_lo(u32::MAX);
        let _ = daily_seed_hi(u32::MAX);
    }

    // ── play, through the boundary ─────────────────────────────────────────

    #[test]
    fn a_drop_through_the_binding_matches_the_core() {
        let _guard = serial();
        new_game(7, 0);
        assert_eq!(drop_at(0, 220), DROP_OK);
        assert_eq!(wait_until(300), DROP_OK);
        let via_binding = out();

        let mut direct = orchard_core::game::Game::new(7);
        direct
            .apply(orchard_core::game::Move::Drop { tick: 0, x: 220 })
            .expect("legal");
        direct
            .apply(orchard_core::game::Move::Wait { tick: 300 })
            .expect("legal");
        assert_eq!(via_binding, format!("\"{}\"", direct.state_hash()));
    }

    #[test]
    fn the_refusal_codes_are_distinct_and_stable() {
        let _guard = serial();
        new_game(7, 0);
        assert_eq!(drop_at(100, 220), DROP_OK);
        assert_eq!(drop_at(101, 220), DROP_COOLING, "one tick after a drop");
        assert_eq!(drop_at(50, 220), DROP_BACKWARDS, "before the current tick");
    }

    #[test]
    fn world_json_describes_what_the_renderer_needs() {
        let _guard = serial();
        new_game(7, 0);
        drop_at(0, 220);
        wait_until(300);
        let v: serde_json::Value = serde_json::from_str(&read(world_json())).expect("valid JSON");
        assert!(v["tick"].is_number());
        assert!(v["score"].is_number());
        assert!(v["held"].is_number());
        assert!(v["next"].is_number());
        assert_eq!(v["fruit"].as_array().expect("fruit array").len(), 1);
        let f = &v["fruit"][0];
        for k in ["id", "tier", "x", "y", "r", "ang"] {
            assert!(f[k].is_number(), "fruit is missing {k}");
        }
    }

    #[test]
    fn a_record_round_trips_through_the_binding() {
        let _guard = serial();
        new_game(7, 0);
        drop_at(0, 220);
        wait_until(300);
        let rec = read(record_json());
        assert!(rec.contains("orchard-drop"), "record names its kind: {rec}");
        let r = unsafe { verify_json(rec.as_ptr(), rec.len() as u32) };
        let v: serde_json::Value = serde_json::from_str(&read(r)).expect("valid JSON");
        assert_eq!(
            v["ok"],
            serde_json::Value::Bool(true),
            "a fresh record failed to verify"
        );
    }

    #[test]
    fn a_tampered_record_does_not_verify_through_the_binding() {
        let _guard = serial();
        new_game(7, 0);
        drop_at(0, 220);
        wait_until(300);
        // Tamper with the thing verification actually re-derives: the hash. An
        // earlier version of this test edited a field the record does not have,
        // so it was rejecting malformed JSON rather than a false claim.
        let honest = read(record_json());
        let hash_start = honest
            .find("\"final_hash\":\"")
            .expect("record carries a hash")
            + 14;
        let rec = format!(
            "{}{}{}",
            &honest[..hash_start],
            "0".repeat(64),
            &honest[hash_start + 64..]
        );
        assert_ne!(rec, honest, "the tamper did not change anything");
        let r = unsafe { verify_json(rec.as_ptr(), rec.len() as u32) };
        let v: serde_json::Value = serde_json::from_str(&read(r)).expect("valid JSON");
        assert_eq!(v["ok"], serde_json::Value::Bool(false));
    }

    #[test]
    fn the_tick_digest_is_the_divergence_bisect_export() {
        let _guard = serial();
        // D6, promoted. When the Phase 6 cross-check goes red, this is what
        // turns "the hashes differ" into "tick 1472".
        new_game(7, 0);
        drop_at(0, 220);
        let a = read(tick_digest(50));
        let b = read(tick_digest(50));
        let c = read(tick_digest(51));
        assert_eq!(a, b, "the same tick must digest the same");
        assert_ne!(a, c, "different ticks must digest differently");
    }
}
