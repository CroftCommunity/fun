//! Zobrist position keys — the repetition history's unit (RULES §10, §11) and
//! later the solver's transposition-table key.
//!
//! The 781 keys (12 piece-square tables × 64 + 1 side + 4 castling rights + 8
//! en-passant files) come from a `const fn` splitmix64 over a fixed seed,
//! evaluated at **compile time**: no `rand` dependency, no runtime table init,
//! and `native == wasm` by construction. The seed, the generator, and the
//! first and last keys are recorded in `RULES.md` §15 so a reader can
//! regenerate the table — a changed seed is a deliberate red across every
//! pinned vector, never a silent re-hash.
//!
//! A position's key covers piece placement, the side to move, the castling
//! rights, and the en-passant file **only when the capture is actually
//! legal** (FIDE 9.2.2 / 9.2.3.1 — the possibility, not the square). That
//! judgement needs move legality, so it lives with the game module
//! ([`crate::game`] passes it in); this module only owns the table and the
//! fold.

use crate::board::{Board, Color};

/// A Zobrist position key.
pub type Key = u64;

/// The generator seed — recorded in RULES §15; changing it re-keys everything.
const SEED: u64 = 0xC40F_7C55_2026_0830;

/// 12 piece-square tables × 64 squares.
const PIECE_KEYS: usize = 12 * 64;
/// Piece-square keys + side-to-move + 4 castling bits + 8 ep files.
pub const KEY_COUNT: usize = PIECE_KEYS + 1 + 4 + 8;

/// One splitmix64 step: the next state and the output value.
const fn splitmix64(state: u64) -> (u64, u64) {
    let next = state.wrapping_add(0x9E37_79B9_7F4A_7C15);
    let mut z = next;
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    (next, z ^ (z >> 31))
}

const fn build_keys() -> [Key; KEY_COUNT] {
    let mut keys = [0u64; KEY_COUNT];
    let mut state = SEED;
    let mut i = 0;
    while i < KEY_COUNT {
        let (next, value) = splitmix64(state);
        state = next;
        keys[i] = value;
        i += 1;
    }
    keys
}

/// The 781 keys, in table order: piece-square (piece-index-major), then the
/// side-to-move key, the four castling keys (`K Q k q`), the eight ep files.
pub const KEYS: [Key; KEY_COUNT] = build_keys();

/// The key contribution of `cell` standing on `sq`, or 0 for an empty cell.
///
/// Piece index: white P N B R Q K = 0..6, black = 6..12 — derived from the
/// cell encoding (RULES §2).
#[must_use]
pub fn piece_square_key(cell: u8, sq: u8) -> Key {
    if cell == 0 {
        return 0;
    }
    let kind = (cell & 7) - 1;
    let color_offset = if cell & 8 == 0 { 0 } else { 6 };
    KEYS[(usize::from(color_offset + kind)) * 64 + usize::from(sq)]
}

/// The position key of `board`, with the caller-judged en-passant possibility
/// (RULES §10: the ep file joins the key only when the capture is legal —
/// `crate::game` decides that, because it needs move legality).
#[must_use]
pub fn position_key(board: &Board, ep_capturable: bool) -> Key {
    let mut key = 0u64;
    for (sq, &cell) in board.cells.iter().enumerate() {
        key ^= piece_square_key(cell, sq as u8);
    }
    if board.side == Color::Black {
        key ^= KEYS[PIECE_KEYS];
    }
    for bit in 0..4u8 {
        if board.castling & (1 << bit) != 0 {
            key ^= KEYS[PIECE_KEYS + 1 + usize::from(bit)];
        }
    }
    if ep_capturable {
        if let Some(ep) = board.ep {
            key ^= KEYS[PIECE_KEYS + 5 + usize::from(ep % 8)];
        }
    }
    key
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn the_table_has_no_zero_and_no_duplicate_keys() {
        // RULES §15: a zero key would make a piece invisible to the fold; a
        // duplicate would alias two different facts.
        assert!(KEYS.iter().all(|&k| k != 0), "no key is zero");
        let distinct: HashSet<u64> = KEYS.iter().copied().collect();
        assert_eq!(distinct.len(), KEY_COUNT, "all keys distinct");
    }

    #[test]
    fn the_first_and_last_keys_match_the_rules_literals() {
        // RULES §15 pins these two values beside the seed, so a reader can
        // regenerate the table and a changed seed is a deliberate red.
        assert_eq!(KEYS[0], 0x76E9_A102_2C52_26D8, "KEYS[0] vs RULES §15");
        assert_eq!(
            KEYS[KEY_COUNT - 1],
            0x45D0_CCC9_5E0D_7B5B,
            "KEYS[780] vs RULES §15"
        );
    }

    #[test]
    fn the_key_reads_every_field_of_the_position() {
        use crate::board::START_FEN;
        let start = Board::from_fen(START_FEN).expect("start parses");
        let base = position_key(&start, false);
        assert_ne!(base, 0);

        // Side to move.
        let mut other = start;
        other.side = Color::Black;
        assert_ne!(position_key(&other, false), base, "side is keyed");

        // A castling right.
        let mut no_wk = start;
        no_wk.castling &= !crate::board::CASTLE_WK;
        assert_ne!(position_key(&no_wk, false), base, "castling is keyed");

        // A piece.
        let mut moved = start;
        moved.cells[16] = moved.cells[8];
        moved.cells[8] = 0;
        assert_ne!(position_key(&moved, false), base, "placement is keyed");

        // The ep file — but only when the caller says the capture is legal
        // (RULES §10): an uncapturable ep square changes nothing.
        let mut with_ep = start;
        with_ep.ep = Some(20);
        assert_eq!(
            position_key(&with_ep, false),
            base,
            "uncapturable ep is not keyed"
        );
        assert_ne!(position_key(&with_ep, true), base, "capturable ep is keyed");
    }

    #[test]
    fn the_fold_follows_the_documented_table_order_exactly() {
        // RULES §15's contract as xor relations, so the fold operation itself
        // (xor, never or/and) and every index are pinned to the table order.
        use crate::board::START_FEN;
        let start = Board::from_fen(START_FEN).expect("start parses");
        let base = position_key(&start, false);
        for bit in 0..4u8 {
            let mut b = start;
            b.castling &= !(1 << bit);
            assert_eq!(
                position_key(&b, false),
                base ^ KEYS[PIECE_KEYS + 1 + usize::from(bit)],
                "castling bit {bit} moves the key by exactly its entry"
            );
        }
        for file in [0u8, 7] {
            let mut b = start;
            b.ep = Some(40 + file); // rank index 5: the White-to-move ep rank
            assert_eq!(
                position_key(&b, true),
                base ^ KEYS[PIECE_KEYS + 5 + usize::from(file)],
                "ep file {file} moves the key by exactly its entry"
            );
            assert_eq!(position_key(&b, false), base, "and only when capturable");
        }
    }
}
