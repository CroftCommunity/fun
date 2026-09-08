//! Canonical state hash — the verifiable-outcome anchor.

use sha2::{Digest, Sha256};

use crate::board::Board;

/// Lowercase-hex SHA-256 over a canonical encoding: a domain tag, the board
/// dimensions, the count of arrows still present, then the row-major occupancy
/// (`i32` LE per cell: arrow id, or `-1` for empty). Integer fields are
/// little-endian, so the hash is byte-identical on native and `wasm32`. A
/// cleared board (all `-1`) hashes to one fixed value per size.
#[must_use]
pub fn state_hash(board: &Board) -> String {
    let mut h = Sha256::new();
    h.update(b"loose\x00");
    h.update(board.width().to_le_bytes());
    h.update(board.height().to_le_bytes());
    h.update((board.remaining() as u32).to_le_bytes());
    h.update(board.occupancy_bytes());
    hex::encode(h.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::Game;

    /// The encoding is a contract (RULES.md § State hash; xbuild replays it in
    /// wasm32 against natively-recorded values), so it is pinned here as data:
    /// level 1 fresh, level 1 cleared, and a 5×2 board with two arrows. A change
    /// to the domain tag, the dimensions, the count or the occupancy bytes moves
    /// every one of these. Recorded 2026-09-08 from the generator.
    #[test]
    fn state_hash_golden_vectors() {
        let mut g = Game::level(1);
        assert_eq!(
            g.current_hash(),
            "e1a098c0b39617c1531527c35cc2cbd8cb0952d95594b567bf6d331948f94f31"
        );
        let mut board = g.board().clone();
        board.greedy_solve();
        assert!(board.is_cleared());
        assert_eq!(
            state_hash(&board),
            "1bb1333ed0a6cdae3ac3b2c98a94ed39c56932aa57c1bc08bc8eb7b3df2b6c01"
        );
        let _ = &mut g;

        let small = crate::board::Board::new(
            5,
            2,
            vec![
                crate::board::Arrow {
                    cells: vec![[0, 0], [1, 0]],
                    dir: [1, 0],
                },
                crate::board::Arrow {
                    cells: vec![[0, 1], [1, 1]],
                    dir: [1, 0],
                },
            ],
        );
        assert_eq!(
            state_hash(&small),
            "74bf79af8c89321a499352a4a3052540394cf5bf528554dc87d0d2c70547d500"
        );
        // Turned on its side the same two arrows are a different board.
        let tall = crate::board::Board::new(
            2,
            5,
            vec![
                crate::board::Arrow {
                    cells: vec![[0, 0], [0, 1]],
                    dir: [0, 1],
                },
                crate::board::Arrow {
                    cells: vec![[1, 0], [1, 1]],
                    dir: [0, 1],
                },
            ],
        );
        assert_ne!(state_hash(&small), state_hash(&tall));
    }
}
