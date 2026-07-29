//! Native+wasm cross-build determinism harness (master-plan Phase 2).
//!
//! Raw C-ABI exports (no wasm-bindgen — deliberately minimal) that compute
//! `solitaire-core` state hashes. Built to `wasm32-unknown-unknown` and driven
//! by `check.mjs` under node, which asserts the wasm-computed hashes equal the
//! locked *native* golden hashes in `solitaire-core/vectors/`. Byte-identical
//! hashes across targets are the property Rust→wasm was chosen to buy.
//!
//! Each export computes a 64-char lowercase-hex hash and returns a pointer to a
//! static 64-byte buffer; the host reads 64 bytes at that pointer. `hash_len`
//! reports the length.

use solitaire_core::{state_hash, GameState, Move};

/// Length in bytes of the hex hash the buffer holds.
#[no_mangle]
pub extern "C" fn hash_len() -> u32 {
    64
}

/// State hash of the deal for `seed` (vector `01-deal-only`).
#[no_mangle]
pub extern "C" fn deal_hash(seed_lo: u32, seed_hi: u32) -> *const u8 {
    let seed = (u64::from(seed_hi) << 32) | u64::from(seed_lo);
    write_hash(&state_hash(&GameState::new_game(seed)))
}

/// State hash after the 28-draw recycle cycle for `seed` (vector `02-draw-cycle`).
#[no_mangle]
pub extern "C" fn draw_cycle_hash(seed_lo: u32, seed_hi: u32) -> *const u8 {
    let seed = (u64::from(seed_hi) << 32) | u64::from(seed_lo);
    let mut game = GameState::new_game(seed);
    for _ in 0..28 {
        // Draw is always legal while stock or waste is non-empty; a rejection
        // here would diverge the hash and the cross-build check would catch it.
        let _ = game.play_move(Move::Draw);
    }
    write_hash(&state_hash(&game))
}

static mut BUF: [u8; 64] = [0; 64];

/// Copy a 64-char hex hash into the static buffer and return its pointer.
fn write_hash(hex: &str) -> *const u8 {
    debug_assert_eq!(hex.len(), 64);
    // SAFETY: the target is single-threaded wasm (and the native rlib is only
    // used single-threaded by tests); the host reads BUF only between calls,
    // and each call fully overwrites all 64 bytes before returning the pointer.
    // Raw pointers (not references) avoid the `static_mut_refs` lint.
    unsafe {
        let p = core::ptr::addr_of_mut!(BUF).cast::<u8>();
        core::ptr::copy_nonoverlapping(hex.as_ptr(), p, 64);
        p.cast_const()
    }
}
