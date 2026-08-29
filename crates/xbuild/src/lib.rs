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

use cribbage_core::{
    replay as cribbage_replay, state_hash as cribbage_state_hash, Move as CribMove,
};
use dots_core::{apply_move, legal_edges, state_hash as dots_state_hash, Board, Edge};
use furrow_core::{
    apply_move as furrow_apply, legal_pits, state_hash as furrow_state_hash, Board as FurrowBoard,
    Pit,
};
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

/// Dots and Boxes: the state hash after replaying the first `len` bytes of the
/// input buffer as edge moves (vectors `dots-core/vectors/*.json`).
///
/// Dots is the first **adversarial** game enrolled here. Its move list has to
/// cross the boundary, so the host writes edge bytes into the buffer at
/// [`dots_in_ptr`] and passes the count -- there is no allocator in a
/// freestanding wasm module to pass a slice through.
#[no_mangle]
pub extern "C" fn dots_replay_hash(len: u32) -> *const u8 {
    let n = (len as usize).min(IN_CAP);
    // SAFETY: single-threaded wasm; the host fills IN before this call and does
    // not touch it during. Raw pointers avoid the `static_mut_refs` lint.
    let moves: [u8; IN_CAP] = unsafe { *core::ptr::addr_of!(IN) };
    let mut pos = Board::empty();
    for &e in &moves[..n] {
        let mv = Edge(e);
        // Replay skips anything illegal, exactly as `pond_outcome::verify` does,
        // so wasm and native agree on tampered lists too.
        if legal_edges(&pos).contains(&mv) {
            pos = apply_move(&pos, mv);
        }
    }
    write_hash(&dots_state_hash(&pos))
}

/// Pointer to the move-input buffer the host writes edge bytes into.
#[no_mangle]
pub extern "C" fn dots_in_ptr() -> *const u8 {
    // Taking the address of a `static mut` is safe; only reading through it is
    // not (see `dots_replay_hash`).
    core::ptr::addr_of!(IN).cast::<u8>()
}

/// Capacity of the move-input buffer (a 3x3 game is at most 24 moves).
#[no_mangle]
pub extern "C" fn dots_in_cap() -> u32 {
    IN_CAP as u32
}

/// Furrow (mancala): the state hash after replaying the first `len` bytes of the
/// input buffer as pit moves (vectors `furrow-core/vectors/*.json`).
///
/// This is the cross-check that earns its keep. Every other core enrolled here
/// writes one or two cells per move; a sow writes as many as thirteen, and the
/// vectors deliberately walk extra-turn chains, captures and the end-of-game
/// sweep -- the paths where a `usize` reaching the hashed path would actually
/// show up as a native/wasm divergence rather than hiding.
#[no_mangle]
pub extern "C" fn furrow_replay_hash(len: u32) -> *const u8 {
    let n = (len as usize).min(IN_CAP);
    // SAFETY: single-threaded wasm; the host fills IN before this call and does
    // not touch it during. Raw pointers avoid the `static_mut_refs` lint.
    let moves: [u8; IN_CAP] = unsafe { *core::ptr::addr_of!(IN) };
    let mut pos = FurrowBoard::opening();
    for &p in &moves[..n] {
        let mv = Pit(p);
        // Replay skips anything illegal, exactly as `pond_outcome::verify` does,
        // so wasm and native agree on tampered lists too.
        if legal_pits(&pos).contains(&mv) {
            pos = furrow_apply(&pos, mv);
        }
    }
    write_hash(&furrow_state_hash(&pos))
}

/// Cribbage: the state hash after replaying the first `len` bytes of the input
/// buffer as move codes from `seed` (vectors `cribbage-core/vectors/*.json`).
///
/// The first core enrolled whose deal is **reshuffled from the seed every
/// deal** and whose moves include declarations (a go, a claim) as well as
/// cards. A `usize` reaching the RNG index or the hash would show here as a
/// different deal, not a different cell.
#[no_mangle]
pub extern "C" fn cribbage_replay_hash(seed_lo: u32, seed_hi: u32, len: u32) -> *const u8 {
    let seed = (u64::from(seed_hi) << 32) | u64::from(seed_lo);
    let n = (len as usize).min(IN_CAP);
    // SAFETY: single-threaded wasm; the host fills IN before this call and does
    // not touch it during. Raw pointers avoid the `static_mut_refs` lint.
    let codes: [u8; IN_CAP] = unsafe { *core::ptr::addr_of!(IN) };
    // An unknown code is dropped, as a refused move is: replay is skip-if-refused.
    let moves: Vec<CribMove> = codes[..n]
        .iter()
        .filter_map(|&c| CribMove::from_code(c))
        .collect();
    write_hash(&cribbage_state_hash(&cribbage_replay(seed, &moves)))
}

/// Pointer to the shared move-input buffer, under its game-neutral name.
///
/// The same bytes [`dots_in_ptr`] returns: one buffer serves every enrolled
/// game, because the host fills it immediately before each call and reads
/// nothing back out of it. The dots-specific names predate the second caller and
/// are kept so the check script's dots half does not re-lock.
#[no_mangle]
pub extern "C" fn move_in_ptr() -> *const u8 {
    core::ptr::addr_of!(IN).cast::<u8>()
}

/// Capacity of the shared move-input buffer.
#[no_mangle]
pub extern "C" fn move_in_cap() -> u32 {
    IN_CAP as u32
}

// 256: a full cribbage game is ~160 move codes (the longest list enrolled).
const IN_CAP: usize = 256;
static mut IN: [u8; IN_CAP] = [0; IN_CAP];

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
