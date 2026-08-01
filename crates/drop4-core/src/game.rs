//! Drop 4 rules: legal drops, four-in-a-row win detection, draw, and the
//! [`Adversary`] + [`pond_outcome::Game`] impls that make a match a
//! verifiable-by-replay outcome.

use adversary_core::{Adversary, MatchResult, Side};
use serde::{Deserialize, Serialize};

use crate::board::{cell_of, side_of_cell, Board, HEIGHT, WIDTH};
use crate::hash::state_hash;

/// A move: drop a disc into column `0..WIDTH`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Col(pub u8);

/// The Drop 4 game marker (zero-sized) the trait impls hang off.
#[derive(Debug, Clone, Copy)]
pub struct Drop4;

// --- rules helpers ---

/// The four line directions to scan from a cell: →, ↑, ↗, ↘.
const DIRS: [(isize, isize); 4] = [(1, 0), (0, 1), (1, 1), (1, -1)];

/// The side owning a four-in-a-row, if any exists on `board`. Returns the first
/// line found in scan order; a legal Drop 4 game has at most one winner.
#[must_use]
pub fn winner(board: &Board) -> Option<Side> {
    for r in 0..HEIGHT {
        for c in 0..WIDTH {
            let v = board.get(c, r);
            let Some(side) = side_of_cell(v) else {
                continue;
            };
            for (dc, dr) in DIRS {
                let mut run = 1;
                let (mut cc, mut rr) = (c as isize + dc, r as isize + dr);
                while cc >= 0
                    && rr >= 0
                    && (cc as usize) < WIDTH
                    && (rr as usize) < HEIGHT
                    && board.get(cc as usize, rr as usize) == v
                {
                    run += 1;
                    if run >= 4 {
                        return Some(side);
                    }
                    cc += dc;
                    rr += dr;
                }
            }
        }
    }
    None
}

/// The columns a disc can still be dropped into. Empty when the board already
/// has a winner (the match is over) or is full.
#[must_use]
pub fn legal_cols(board: &Board) -> Vec<Col> {
    if winner(board).is_some() {
        return Vec::new();
    }
    (0..WIDTH)
        .filter(|&c| board.can_drop(c))
        .map(|c| Col(c as u8))
        .collect()
}

/// The position after dropping in `col` (assumes `col` is legal — the disc
/// lands on the lowest empty row and the turn passes to the other side).
#[must_use]
pub fn apply_move(board: &Board, col: Col) -> Board {
    let mut next = *board;
    let c = col.0 as usize;
    let row = next.height(c);
    next.cells[row * WIDTH + c] = cell_of(next.to_move);
    next.to_move = next.to_move.other();
    next
}

// --- trait wiring (real) ---

impl Adversary for Drop4 {
    type Position = Board;
    type Move = Col;
    const KIND: &'static str = "drop4";

    fn initial(_seed: u64) -> Board {
        // The standard empty board. `seed` is reserved for future start
        // variants (handicaps, rotated boards); today every seed opens empty.
        Board::empty()
    }

    fn side_to_move(pos: &Board) -> Side {
        pos.to_move
    }

    fn legal_moves(pos: &Board) -> Vec<Col> {
        legal_cols(pos)
    }

    fn apply(pos: &Board, mv: Col) -> Board {
        apply_move(pos, mv)
    }

    fn result(pos: &Board) -> Option<MatchResult> {
        if let Some(side) = winner(pos) {
            Some(MatchResult::win_for(side))
        } else if pos.is_full() {
            Some(MatchResult::Draw)
        } else {
            None
        }
    }

    fn state_hash(pos: &Board) -> String {
        state_hash(pos)
    }

    fn render_text(pos: &Board) -> String {
        let mut s = String::new();
        for row in (0..HEIGHT).rev() {
            for col in 0..WIDTH {
                let ch = match side_of_cell(pos.get(col, row)) {
                    Some(Side::A) => 'X',
                    Some(Side::B) => 'O',
                    None => '.',
                };
                if col > 0 {
                    s.push(' ');
                }
                s.push(ch);
            }
            s.push('\n');
        }
        for col in 0..WIDTH {
            if col > 0 {
                s.push(' ');
            }
            s.push_str(&col.to_string());
        }
        s.push('\n');
        let mover = match pos.to_move {
            Side::A => "X",
            Side::B => "O",
        };
        s.push_str(&format!(
            "To move: {mover}. Reply with one column number (0-{}).",
            WIDTH - 1
        ));
        s
    }

    fn move_to_text(mv: Col) -> String {
        mv.0.to_string()
    }

    fn parse_move(pos: &Board, s: &str) -> Option<Col> {
        // Take the first run of ASCII digits anywhere in the reply.
        let digits: String = s
            .chars()
            .skip_while(|c| !c.is_ascii_digit())
            .take_while(|c| c.is_ascii_digit())
            .collect();
        let col: usize = digits.parse().ok()?;
        let mv = Col(u8::try_from(col).ok()?);
        legal_cols(pos).contains(&mv).then_some(mv)
    }
}

impl pond_outcome::Game for Drop4 {
    type Move = Col;
    const KIND: &'static str = "drop4";
    const VERSION: u32 = 1;

    fn replay(seed: u64, moves: &[Col]) -> pond_outcome::Replayed {
        let mut pos = <Drop4 as Adversary>::initial(seed);
        for &mv in moves {
            // A tampered move (illegal, or after the match ended) is a no-op,
            // so the hash diverges from the honest match and verification fails.
            if legal_cols(&pos).contains(&mv) {
                pos = apply_move(&pos, mv);
            }
        }
        // `won` here means "Side A (the opening player) won". The shelf game
        // (Phase 6) assigns the human to a known side and interprets
        // accordingly; the harness scores on `result()` directly, not on `won`.
        let won = matches!(<Drop4 as Adversary>::result(&pos), Some(MatchResult::WinA));
        pond_outcome::Replayed::new(state_hash(&pos), won)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::board::CELLS;
    use pond_outcome::{attest, verify, Outcome};

    fn play(seed: u64, cols: &[u8]) -> Board {
        let mut pos = <Drop4 as Adversary>::initial(seed);
        for &c in cols {
            pos = <Drop4 as Adversary>::apply(&pos, Col(c));
        }
        pos
    }

    #[test]
    fn new_game_has_seven_legal_columns_side_a_to_move() {
        let pos = <Drop4 as Adversary>::initial(0);
        assert_eq!(<Drop4 as Adversary>::side_to_move(&pos), Side::A);
        assert_eq!(<Drop4 as Adversary>::legal_moves(&pos).len(), WIDTH);
    }

    #[test]
    fn dropping_stacks_and_alternates_sides() {
        let pos = play(0, &[3, 3]);
        assert_eq!(side_of_cell(pos.get(3, 0)), Some(Side::A));
        assert_eq!(side_of_cell(pos.get(3, 1)), Some(Side::B));
        assert_eq!(<Drop4 as Adversary>::side_to_move(&pos), Side::A);
    }

    #[test]
    fn a_full_column_is_not_legal() {
        // 6 drops into column 0 fill it (heights alternate A/B but stack in c0).
        let pos = play(0, &[0, 0, 0, 0, 0, 0]);
        assert!(!<Drop4 as Adversary>::legal_moves(&pos).contains(&Col(0)));
        assert_eq!(<Drop4 as Adversary>::legal_moves(&pos).len(), WIDTH - 1);
    }

    #[test]
    fn vertical_four_wins_for_a() {
        // A: c0 four times (rows 0..3); B: c1 in between.
        let pos = play(0, &[0, 1, 0, 1, 0, 1, 0]);
        assert_eq!(winner(&pos), Some(Side::A));
        assert_eq!(<Drop4 as Adversary>::result(&pos), Some(MatchResult::WinA));
        // Terminal: no legal moves.
        assert!(<Drop4 as Adversary>::legal_moves(&pos).is_empty());
    }

    #[test]
    fn horizontal_four_wins_for_a() {
        // A fills c0..c3 on the bottom row; B stacks c0 twice above? No —
        // interleave B into a high column (c6) so it never blocks the row.
        let pos = play(0, &[0, 6, 1, 6, 2, 6, 3]);
        assert_eq!(winner(&pos), Some(Side::A));
        assert_eq!(<Drop4 as Adversary>::result(&pos), Some(MatchResult::WinA));
    }

    #[test]
    fn diagonal_win_detected() {
        // Build an ascending diagonal for A at (0,0),(1,1),(2,2),(3,3).
        // Supports (fillers) placed by B where needed.
        // Moves (col): A0, B1, A1, B2, A2, B3, A_junk?, ... build precisely:
        // We want:
        //   c0: A            -> (0,0)=A
        //   c1: B then A     -> (1,0)=B,(1,1)=A
        //   c2: B,B,A? need (2,2)=A so two under it. (2,0)=B,(2,1)=B,(2,2)=A
        //   c3: B,B,B,A      -> (3,3)=A
        let pos = play(
            0,
            &[
                0, // A (0,0)
                1, // B (1,0)
                1, // A (1,1)
                2, // B (2,0)
                4, // A filler (4,0)
                2, // B (2,1)
                2, // A (2,2)
                3, // B (3,0)
                5, // A filler (5,0)
                3, // B (3,1)
                6, // A filler (6,0)
                3, // B (3,2)
                3, // A (3,3)  -> completes diagonal (0,0)(1,1)(2,2)(3,3)
            ],
        );
        assert_eq!(winner(&pos), Some(Side::A));
    }

    #[test]
    fn full_board_no_line_is_a_draw() {
        // A concrete full-board coloring with no four-in-a-row in any direction
        // (computed by exhaustive fill; row-major, row 0 = bottom). Built as a
        // Board directly — the draw/winner detectors don't require reachability.
        #[rustfmt::skip]
        let cells: [u8; CELLS] = [
            1, 1, 1, 2, 1, 1, 1,
            1, 1, 1, 2, 1, 1, 1,
            1, 1, 2, 1, 2, 1, 1,
            2, 2, 2, 1, 2, 2, 2,
            1, 1, 1, 2, 1, 1, 1,
            1, 1, 1, 2, 1, 1, 1,
        ];
        let pos = Board {
            cells,
            to_move: Side::A,
        };
        assert!(pos.is_full(), "draw fixture must fill the board");
        assert_eq!(winner(&pos), None, "draw fixture must have no line");
        assert_eq!(<Drop4 as Adversary>::result(&pos), Some(MatchResult::Draw));
        assert!(
            <Drop4 as Adversary>::legal_moves(&pos).is_empty(),
            "a drawn full board has no legal moves"
        );
    }

    #[test]
    fn state_hash_is_stable_and_move_sensitive() {
        let a = <Drop4 as Adversary>::initial(0);
        let b = <Drop4 as Adversary>::initial(0);
        assert_eq!(
            <Drop4 as Adversary>::state_hash(&a),
            <Drop4 as Adversary>::state_hash(&b)
        );
        let moved = <Drop4 as Adversary>::apply(&a, Col(3));
        assert_ne!(
            <Drop4 as Adversary>::state_hash(&a),
            <Drop4 as Adversary>::state_hash(&moved)
        );
    }

    #[test]
    fn parse_move_takes_a_legal_column_and_rejects_others() {
        let pos = <Drop4 as Adversary>::initial(0);
        assert_eq!(
            <Drop4 as Adversary>::parse_move(&pos, "I'll play 3"),
            Some(Col(3))
        );
        assert_eq!(<Drop4 as Adversary>::parse_move(&pos, "3"), Some(Col(3)));
        assert_eq!(<Drop4 as Adversary>::parse_move(&pos, "9"), None); // out of range
        assert_eq!(<Drop4 as Adversary>::parse_move(&pos, "nope"), None);
        // A full column is not a legal parse target.
        let full = play(0, &[0, 0, 0, 0, 0, 0]);
        assert_eq!(<Drop4 as Adversary>::parse_move(&full, "0"), None);
    }

    #[test]
    fn render_text_shows_board_and_prompt() {
        let pos = play(0, &[3]);
        let t = <Drop4 as Adversary>::render_text(&pos);
        assert!(t.contains('X'), "A's disc renders as X");
        assert!(t.contains("column"), "prompt explains the move");
    }

    #[test]
    fn match_record_verifies_and_tamper_is_detected() {
        // An honest A-vertical win in c0 (A: 0,0,0,0; B: 1,1,1).
        let moves = vec![Col(0), Col(1), Col(0), Col(1), Col(0), Col(1), Col(0)];
        let record = attest::<Drop4>(0, moves.clone(), Outcome::Abandoned, Some(false));
        assert!(verify::<Drop4>(&record).ok, "honest match record verifies");
        assert_eq!(record.result, Outcome::Won, "A wins => won=true");

        // Tamper a move → replay diverges → verify fails.
        let mut bad = record.clone();
        bad.moves[6] = Col(5);
        assert!(!verify::<Drop4>(&bad).ok, "tampered move list fails verify");
    }
}
