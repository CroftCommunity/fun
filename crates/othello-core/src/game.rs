//! Othello rules: legal placements + flips, forced passes, terminal-by-count, and
//! the [`Adversary`] impl. ([`pond_outcome::Game`] is added in Phase 1b.)

use adversary_core::{Adversary, MatchResult, Side};
use serde::de::Error as _;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::board::{cell_of, side_of_cell, Board, CELLS, SIZE};
use crate::hash::state_hash;

/// A move: place a disc at a flat cell index `0..64`, or pass (only legal when
/// the side to move has no placement but the game is not yet over).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Move {
    /// Place a disc at flat index `row * SIZE + col`.
    Place(u8),
    /// Pass (forced — no legal placement, opponent still has one).
    Pass,
}

/// The compact `u8` code a `Pass` serializes to (board cells are `0..64`, so
/// `64` is the first free code). Placements serialize to their cell index.
const PASS_CODE: u8 = CELLS as u8;

// A `Move` serializes as a single `u8` — a placement to its cell index
// (`0..64`), a pass to `PASS_CODE` (`64`) — so an outcome's move list is a plain
// JSON number array (compact `?r=` shares; the TS side reads numbers, not tagged
// enum objects). native == wasm.
impl Serialize for Move {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let code = match self {
            Move::Place(idx) => *idx,
            Move::Pass => PASS_CODE,
        };
        s.serialize_u8(code)
    }
}

impl<'de> Deserialize<'de> for Move {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let code = u8::deserialize(d)?;
        match code {
            PASS_CODE => Ok(Move::Pass),
            idx if (idx as usize) < CELLS => Ok(Move::Place(idx)),
            other => Err(D::Error::custom(format!(
                "invalid Othello move code {other}"
            ))),
        }
    }
}

/// The Othello game marker (zero-sized) the trait impls hang off.
#[derive(Debug, Clone, Copy)]
pub struct Othello;

/// The eight ray directions `(drow, dcol)` a flip can run along.
const DIRS: [(isize, isize); 8] = [
    (-1, -1),
    (-1, 0),
    (-1, 1),
    (0, -1),
    (0, 1),
    (1, -1),
    (1, 0),
    (1, 1),
];

/// The discs a placement at `idx` would flip for the side to move — the union of
/// every direction in which the placement brackets a non-empty run of the
/// opponent's discs terminated by one of the mover's discs. Empty when the
/// placement is illegal (occupied cell, or brackets nothing).
#[must_use]
pub fn flips_for(board: &Board, idx: usize) -> Vec<usize> {
    if board.at(idx) != 0 {
        return Vec::new();
    }
    let me = cell_of(board.to_move);
    let opp = cell_of(board.to_move.other());
    let (r0, c0) = ((idx / SIZE) as isize, (idx % SIZE) as isize);
    let mut flips = Vec::new();
    for (dr, dc) in DIRS {
        let mut run = Vec::new();
        let (mut r, mut c) = (r0 + dr, c0 + dc);
        while (0..SIZE as isize).contains(&r) && (0..SIZE as isize).contains(&c) {
            let cell = board.cells[(r * SIZE as isize + c) as usize];
            if cell == opp {
                run.push((r * SIZE as isize + c) as usize);
            } else {
                // Terminate the ray: a `me` cell closes the bracket (flip the run);
                // an empty cell or the edge closes nothing.
                if cell == me && !run.is_empty() {
                    flips.extend(run);
                }
                break;
            }
            r += dr;
            c += dc;
        }
    }
    flips
}

/// The empty cells the side to move may legally place a disc into (each flips
/// at least one opponent disc). Empty when the side has no placement.
#[must_use]
pub fn legal_places(board: &Board) -> Vec<u8> {
    (0..CELLS)
        .filter(|&i| board.at(i) == 0 && !flips_for(board, i).is_empty())
        .map(|i| i as u8)
        .collect()
}

/// `Some(result)` when the position is terminal (neither side can place), else
/// `None`. Terminal result is decided by disc count.
#[must_use]
pub fn result(board: &Board) -> Option<MatchResult> {
    if !legal_places(board).is_empty() {
        return None;
    }
    // Current side is stuck; the game ends only if the opponent is stuck too.
    let mut opp = *board;
    opp.to_move = board.to_move.other();
    if !legal_places(&opp).is_empty() {
        return None; // the current side must pass, not end the game
    }
    let (a, b) = (board.count(Side::A), board.count(Side::B));
    Some(match a.cmp(&b) {
        std::cmp::Ordering::Greater => MatchResult::WinA,
        std::cmp::Ordering::Less => MatchResult::WinB,
        std::cmp::Ordering::Equal => MatchResult::Draw,
    })
}

/// The legal moves in `board`: one `Place` per legal cell, or a single `Pass`
/// when the side to move is stuck but the game is not over. Empty when terminal.
#[must_use]
pub fn legal_moves(board: &Board) -> Vec<Move> {
    if result(board).is_some() {
        return Vec::new();
    }
    let places = legal_places(board);
    if places.is_empty() {
        return vec![Move::Pass];
    }
    places.into_iter().map(Move::Place).collect()
}

/// The position after playing `mv` (assumes `mv` is legal): a `Place` sets the
/// disc, flips every bracketed run, and passes the turn; a `Pass` only passes
/// the turn.
#[must_use]
pub fn apply_move(board: &Board, mv: Move) -> Board {
    let mut next = *board;
    if let Move::Place(idx) = mv {
        let me = cell_of(board.to_move);
        let i = idx as usize;
        next.cells[i] = me;
        for f in flips_for(board, i) {
            next.cells[f] = me;
        }
    }
    next.to_move = board.to_move.other();
    next
}

impl Adversary for Othello {
    type Position = Board;
    type Move = Move;
    const KIND: &'static str = "othello";

    fn initial(_seed: u64) -> Board {
        // The standard opening. `seed` is reserved for future start variants;
        // today every seed opens from the canonical centre four.
        Board::start()
    }

    fn side_to_move(pos: &Board) -> Side {
        pos.to_move
    }

    fn legal_moves(pos: &Board) -> Vec<Move> {
        legal_moves(pos)
    }

    fn apply(pos: &Board, mv: Move) -> Board {
        apply_move(pos, mv)
    }

    fn result(pos: &Board) -> Option<MatchResult> {
        result(pos)
    }

    fn state_hash(pos: &Board) -> String {
        state_hash(pos)
    }

    fn render_text(pos: &Board) -> String {
        let mut s = String::from("  0 1 2 3 4 5 6 7\n");
        for row in 0..SIZE {
            s.push_str(&format!("{row} "));
            for col in 0..SIZE {
                let ch = match side_of_cell(pos.get(row, col)) {
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
        let mover = match pos.to_move {
            Side::A => "X",
            Side::B => "O",
        };
        if legal_places(pos).is_empty() {
            s.push_str(&format!("To move: {mover}. No legal move — you must pass."));
        } else {
            s.push_str(&format!(
                "To move: {mover}. Reply with one cell index (0-{}).",
                CELLS - 1
            ));
        }
        s
    }

    fn move_to_text(mv: Move) -> String {
        match mv {
            Move::Place(idx) => idx.to_string(),
            Move::Pass => "pass".to_string(),
        }
    }

    fn parse_move(pos: &Board, s: &str) -> Option<Move> {
        let legal = legal_moves(pos);
        if s.to_ascii_lowercase().contains("pass") {
            return legal.contains(&Move::Pass).then_some(Move::Pass);
        }
        let digits: String = s
            .chars()
            .skip_while(|c| !c.is_ascii_digit())
            .take_while(|c| c.is_ascii_digit())
            .collect();
        let idx: usize = digits.parse().ok()?;
        let mv = Move::Place(u8::try_from(idx).ok()?);
        legal.contains(&mv).then_some(mv)
    }
}

impl pond_outcome::Game for Othello {
    type Move = Move;
    const KIND: &'static str = "othello";
    const VERSION: u32 = 1;

    fn replay(seed: u64, moves: &[Move]) -> pond_outcome::Replayed {
        let mut pos = <Othello as Adversary>::initial(seed);
        for &mv in moves {
            // A tampered move (illegal, or a pass that wasn't forced) is not in
            // `legal_moves`, so it is a no-op and the hash diverges from the
            // honest match — verification then fails.
            if legal_moves(&pos).contains(&mv) {
                pos = apply_move(&pos, mv);
            }
        }
        // `won` = Side A (the opening player) won; the shelf game assigns the
        // human a side and interprets accordingly. The harness scores on
        // `result()` directly, not on `won`.
        let won = matches!(
            <Othello as Adversary>::result(&pos),
            Some(MatchResult::WinA)
        );
        pond_outcome::Replayed::new(state_hash(&pos), won)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Apply a sequence of Place indices from the start position.
    fn play(cells: &[u8]) -> Board {
        let mut pos = <Othello as Adversary>::initial(0);
        for &i in cells {
            pos = apply_move(&pos, Move::Place(i));
        }
        pos
    }

    #[test]
    fn start_has_exactly_the_four_textbook_opening_moves_for_a() {
        let pos = <Othello as Adversary>::initial(0);
        assert_eq!(<Othello as Adversary>::side_to_move(&pos), Side::A);
        let mut places = legal_places(&pos);
        places.sort_unstable();
        assert_eq!(places, vec![19, 26, 37, 44], "the standard 4 opening moves");
    }

    #[test]
    fn playing_d3_flips_the_bracketed_white_disc() {
        let pos = play(&[19]); // A plays d3 = (2,3)
        assert_eq!(side_of_cell(pos.at(19)), Some(Side::A), "the placed disc");
        assert_eq!(
            side_of_cell(pos.at(27)),
            Some(Side::A),
            "(3,3) flipped to A"
        );
        assert_eq!(side_of_cell(pos.at(36)), Some(Side::B), "(4,4) still B");
        assert_eq!(pos.count(Side::A), 4);
        assert_eq!(pos.count(Side::B), 1);
        assert_eq!(pos.to_move, Side::B, "turn passes to B");
    }

    #[test]
    fn a_stuck_side_with_a_live_opponent_must_pass() {
        // (0,0)=A, (0,1)=B, rest empty, B to move. B can bracket nothing (its only
        // anchor is (0,1) and the lone A sits off its edge), but A can play (0,2)
        // to bracket (0,1). So B must PASS and the game is not over.
        let mut cells = [0u8; CELLS];
        cells[0] = cell_of(Side::A);
        cells[1] = cell_of(Side::B);
        let board = Board {
            cells,
            to_move: Side::B,
        };
        assert!(legal_places(&board).is_empty(), "B is stuck");
        assert_eq!(result(&board), None, "but the game is not over");
        assert_eq!(legal_moves(&board), vec![Move::Pass], "B must pass");
        let after = apply_move(&board, Move::Pass);
        assert_eq!(after.to_move, Side::A);
        assert!(
            !legal_places(&after).is_empty(),
            "A has a move after the pass"
        );
    }

    #[test]
    fn a_full_board_is_terminal_and_counts_discs() {
        // A concrete full board (reachability irrelevant to result()): 44 A, 20 B.
        let mut cells = [1u8; CELLS];
        for c in cells.iter_mut().take(20) {
            *c = 2;
        }
        let board = Board {
            cells,
            to_move: Side::A,
        };
        assert!(
            legal_places(&board).is_empty(),
            "a full board has no placements"
        );
        assert_eq!(
            result(&board),
            Some(MatchResult::WinA),
            "44 A vs 20 B -> A wins"
        );
        assert!(
            <Othello as Adversary>::legal_moves(&board).is_empty(),
            "terminal: no moves"
        );
    }

    #[test]
    fn an_even_full_board_is_a_draw() {
        let mut cells = [1u8; CELLS];
        for c in cells.iter_mut().take(32) {
            *c = 2;
        }
        let board = Board {
            cells,
            to_move: Side::A,
        };
        assert_eq!(result(&board), Some(MatchResult::Draw), "32-32 -> draw");
    }

    #[test]
    fn state_hash_is_stable_and_move_sensitive() {
        let a = <Othello as Adversary>::initial(0);
        let b = <Othello as Adversary>::initial(0);
        assert_eq!(state_hash(&a), state_hash(&b));
        let moved = apply_move(&a, Move::Place(19));
        assert_ne!(state_hash(&a), state_hash(&moved));
    }

    #[test]
    fn parse_move_accepts_a_legal_index_and_pass_only_when_legal() {
        let pos = <Othello as Adversary>::initial(0);
        assert_eq!(
            <Othello as Adversary>::parse_move(&pos, "I play 19"),
            Some(Move::Place(19))
        );
        assert_eq!(
            <Othello as Adversary>::parse_move(&pos, "27"),
            None,
            "27 is not legal at start"
        );
        assert_eq!(
            <Othello as Adversary>::parse_move(&pos, "pass"),
            None,
            "pass illegal when moves exist"
        );
    }

    #[test]
    fn move_serializes_to_a_compact_u8_code() {
        // The TS `?r=` share reads a plain number array: a placement is its cell
        // index, a pass is 64. Lock that wire contract.
        assert_eq!(serde_json::to_string(&Move::Place(19)).unwrap(), "19");
        assert_eq!(serde_json::to_string(&Move::Pass).unwrap(), "64");
        assert_eq!(serde_json::from_str::<Move>("19").unwrap(), Move::Place(19));
        assert_eq!(serde_json::from_str::<Move>("64").unwrap(), Move::Pass);
        assert!(
            serde_json::from_str::<Move>("65").is_err(),
            "out-of-range code rejected"
        );
    }

    /// Play to a terminal position by always taking the first legal move (a
    /// `Place` of the lowest index, or `Pass` when forced) — deterministic.
    fn deterministic_game(seed: u64) -> (Vec<Move>, Board) {
        let mut pos = <Othello as Adversary>::initial(seed);
        let mut moves = Vec::new();
        while result(&pos).is_none() {
            let mv = legal_moves(&pos)[0];
            moves.push(mv);
            pos = apply_move(&pos, mv);
            assert!(moves.len() <= 200, "a game must terminate");
        }
        (moves, pos)
    }

    #[test]
    fn a_full_game_including_a_forced_pass_replays_to_a_verifiable_hash() {
        use pond_outcome::{attest, verify, Outcome};
        let (moves, terminal) = deterministic_game(0);
        assert!(result(&terminal).is_some(), "the game reaches a terminal");
        // The deterministic first-legal game produces at least one forced pass —
        // so the replay path exercises a Pass in the move list, not just Places.
        assert!(
            moves.contains(&Move::Pass),
            "this line includes a forced pass ({} moves)",
            moves.len()
        );

        let rec = attest::<Othello>(0, moves.clone(), Outcome::Abandoned, None);
        assert!(
            verify::<Othello>(&rec).ok,
            "honest match (with a pass) replays"
        );

        // Tamper the first Place with an always-illegal opening cell (idx 0):
        // replay skips it, the line diverges, verification fails.
        let mut bad = rec.clone();
        let first_place = bad
            .moves
            .iter()
            .position(|m| matches!(m, Move::Place(_)))
            .expect("a game has placements");
        bad.moves[first_place] = Move::Place(0);
        assert!(
            !verify::<Othello>(&bad).ok,
            "a tampered move list fails verify"
        );
    }
}
