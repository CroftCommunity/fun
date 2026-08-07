//! Dots and Boxes rules: draw an edge, claim any box it closes, and **move
//! again if you closed one**.
//!
//! That last clause is the shape no other adversarial game on the shelf has:
//! `side_to_move` is not a function of move parity. The shared spine already
//! supports it — [`adversary_core::Adversary::side_to_move`] takes the position,
//! and the scoring rig re-reads whose turn it is from the live board every
//! iteration — so nothing shared needed changing to accommodate it.

use adversary_core::{Adversary, MatchResult, Side};
use serde::{Deserialize, Serialize};

use crate::board::{
    completed_boxes, h_edge, owner_of, side_of_owner, v_edge, Board, ALL_EDGES, BOXES, COLS, EDGES,
    ROWS,
};
use crate::hash::state_hash;

/// A move: draw edge `0..EDGES`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Edge(pub u8);

/// The Dots and Boxes game marker (zero-sized) the trait impls hang off.
#[derive(Debug, Clone, Copy)]
pub struct Dots;

/// The terminal result implied by a final box count.
///
/// A **free function** on purpose. At 9 boxes a tie is unreachable, so the
/// `Draw` arm cannot be exercised through any real game — and an unreachable
/// branch is one no test can verify in place. Lifting the policy out to where a
/// test can call it directly is the fix `CLAUDE.md`'s mutation-testing guidance
/// prescribes for exactly this case.
#[must_use]
pub fn result_of(boxes_a: u8, boxes_b: u8) -> MatchResult {
    match boxes_a.cmp(&boxes_b) {
        std::cmp::Ordering::Greater => MatchResult::WinA,
        std::cmp::Ordering::Less => MatchResult::WinB,
        std::cmp::Ordering::Equal => MatchResult::Draw,
    }
}

/// The edges that can still be drawn. Empty when every edge is drawn.
#[must_use]
pub fn legal_edges(pos: &Board) -> Vec<Edge> {
    let mut rest = !pos.edges & ALL_EDGES;
    let mut out = Vec::with_capacity(rest.count_ones() as usize);
    while rest != 0 {
        let e = rest.trailing_zeros();
        rest &= rest - 1;
        out.push(Edge(e as u8));
    }
    out
}

/// The position after drawing `mv` (assumes `mv` is legal).
///
/// Claims every box the edge closes for the mover, and passes the turn **only
/// if it closed none**.
#[must_use]
pub fn apply_move(pos: &Board, mv: Edge) -> Board {
    let mut next = *pos;
    let e = mv.0 as usize;
    let closed = completed_boxes(next.edges, e);
    if e < EDGES {
        next.edges |= 1u32 << e;
    }
    if closed == 0 {
        // No capture: the turn passes. This is the ONLY place the turn changes.
        next.to_move = next.to_move.other();
    } else {
        let owner = owner_of(next.to_move);
        for b in 0..BOXES {
            if closed & (1u16 << b) != 0 {
                next.owners[b] = owner;
            }
        }
    }
    next
}

impl Adversary for Dots {
    type Position = Board;
    type Move = Edge;
    const KIND: &'static str = "dots";

    fn initial(_seed: u64) -> Board {
        // The standard empty board. `seed` is reserved for future start variants
        // (a handicap opening, a larger board) without changing the record
        // format -- the same posture Drop 4 documents.
        Board::empty()
    }

    fn side_to_move(pos: &Board) -> Side {
        pos.to_move
    }

    fn legal_moves(pos: &Board) -> Vec<Edge> {
        legal_edges(pos)
    }

    fn apply(pos: &Board, mv: Edge) -> Board {
        apply_move(pos, mv)
    }

    fn result(pos: &Board) -> Option<MatchResult> {
        // The only terminal condition is a full lattice. A side can be
        // mathematically safe earlier (five of nine boxes), but standard play
        // draws every edge, and stopping early would truncate the record.
        if pos.is_complete() {
            let (a, b) = pos.box_counts();
            Some(result_of(a, b))
        } else {
            None
        }
    }

    fn state_hash(pos: &Board) -> String {
        state_hash(pos)
    }

    fn render_text(pos: &Board) -> String {
        // A dot lattice where a free edge shows its own number and a drawn edge
        // shows a line, so a text player can read the board and the move
        // vocabulary off the same picture. Columns are fixed-width so the dots
        // line up: dot `c` sits at column `6c`.
        const W: usize = 6 * COLS + 2;
        let mut lines: Vec<String> = Vec::new();

        for r in 0..=ROWS {
            let mut row = vec![b' '; W];
            for c in 0..=COLS {
                row[6 * c] = b'*';
            }
            for c in 0..COLS {
                let e = h_edge(r, c);
                let at = 6 * c + 1;
                if pos.is_drawn(e) {
                    for k in 0..5 {
                        row[at + k] = b'-';
                    }
                } else {
                    for (k, byte) in format!("{e:>3}  ").bytes().enumerate() {
                        row[at + k] = byte;
                    }
                }
            }
            lines.push(String::from_utf8_lossy(&row).trim_end().to_string());

            if r < ROWS {
                let mut row = vec![b' '; W];
                for c in 0..=COLS {
                    let e = v_edge(r, c);
                    let at = 6 * c;
                    if pos.is_drawn(e) {
                        row[at] = b'|';
                    } else {
                        for (k, byte) in format!("{e:>2}").bytes().enumerate() {
                            row[at + k] = byte;
                        }
                    }
                }
                for c in 0..COLS {
                    row[6 * c + 3] = match side_of_owner(pos.owners[r * COLS + c]) {
                        Some(Side::A) => b'X',
                        Some(Side::B) => b'O',
                        None => b' ',
                    };
                }
                lines.push(String::from_utf8_lossy(&row).trim_end().to_string());
            }
        }

        let (a, b) = pos.box_counts();
        lines.push(format!("Boxes: X {a}, O {b}."));
        let mover = match pos.to_move {
            Side::A => "X",
            Side::B => "O",
        };
        lines.push(format!(
            "To move: {mover}. Reply with one edge number (0-{}).",
            EDGES - 1
        ));
        lines.join("\n")
    }

    fn move_to_text(mv: Edge) -> String {
        mv.0.to_string()
    }

    fn parse_move(pos: &Board, s: &str) -> Option<Edge> {
        let digits: String = s
            .chars()
            .skip_while(|c| !c.is_ascii_digit())
            .take_while(char::is_ascii_digit)
            .collect();
        let e: usize = digits.parse().ok()?;
        let mv = Edge(u8::try_from(e).ok()?);
        legal_edges(pos).contains(&mv).then_some(mv)
    }
}

impl pond_outcome::Game for Dots {
    type Move = Edge;
    const KIND: &'static str = "dots";
    const VERSION: u32 = 1;

    fn replay(seed: u64, moves: &[Edge]) -> pond_outcome::Replayed {
        let mut pos = <Dots as Adversary>::initial(seed);
        for &mv in moves {
            // A tampered move (illegal, or after the match ended) is a no-op, so
            // the hash diverges from the honest match and verification fails.
            if legal_edges(&pos).contains(&mv) {
                pos = apply_move(&pos, mv);
            }
        }
        // `won` means "Side A (the opening player) won". The shelf game assigns
        // the human to a side and interprets accordingly -- and for this game
        // that assignment matters, because 3x3 is a second-player win.
        let won = matches!(<Dots as Adversary>::result(&pos), Some(MatchResult::WinA));
        pond_outcome::Replayed::new(state_hash(&pos), won)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::board::box_mask;
    use pond_outcome::{attest, verify, Outcome};

    fn play(edges: &[u8]) -> Board {
        let mut pos = <Dots as Adversary>::initial(0);
        for &e in edges {
            pos = <Dots as Adversary>::apply(&pos, Edge(e));
        }
        pos
    }

    /// Draw every edge of `board` except those in `keep_open`, giving each
    /// completed box to nobody (a constructed position, not a played one).
    fn position_missing(keep_open: &[usize]) -> Board {
        let mut edges = ALL_EDGES;
        for &e in keep_open {
            edges &= !(1u32 << e);
        }
        Board {
            edges,
            owners: [0; BOXES],
            to_move: Side::A,
        }
    }

    // --- the extra-turn rule, which is the whole point of this game ---

    #[test]
    fn a_move_that_closes_no_box_passes_the_turn() {
        let pos = play(&[0]);
        assert_eq!(<Dots as Adversary>::side_to_move(&pos), Side::B);
        assert!(pos.is_drawn(0));
        assert_eq!(pos.box_counts(), (0, 0));
    }

    #[test]
    fn closing_a_box_claims_it_and_keeps_the_turn() {
        // Box 0 closes on H(0,0)=0, H(1,0)=3, V(0,0)=12, V(0,1)=13.
        // A draws 0, B draws 3, A draws 12, B draws 13 -> B closes box 0.
        let pos = play(&[0, 3, 12, 13]);
        assert_eq!(pos.box_counts(), (0, 1), "B claimed the box");
        assert_eq!(
            <Dots as Adversary>::side_to_move(&pos),
            Side::B,
            "closing a box grants another move"
        );
    }

    #[test]
    fn closing_two_boxes_with_one_edge_claims_both_and_keeps_the_turn() {
        // Everything for boxes 0 and 1 except their shared edge V(0,1)=13.
        let shared = v_edge(0, 1);
        let mut pos = position_missing(&[shared]);
        pos.to_move = Side::B;
        let after = apply_move(&pos, Edge(shared as u8));
        assert_eq!(
            after.box_counts(),
            (0, 2),
            "one edge can close two boxes, and both go to the mover"
        );
        assert_eq!(
            <Dots as Adversary>::side_to_move(&after),
            Side::B,
            "a double capture still grants another move"
        );
    }

    #[test]
    fn the_turn_can_stay_with_one_side_for_several_moves() {
        // A chain: give A a position where three separate boxes are one edge
        // from closing, and confirm A takes all three consecutively.
        let opens = [v_edge(0, 1), v_edge(1, 1), v_edge(2, 1)];
        let mut pos = position_missing(&opens);
        pos.to_move = Side::A;
        for &e in &opens {
            let before = <Dots as Adversary>::side_to_move(&pos);
            pos = apply_move(&pos, Edge(e as u8));
            assert_eq!(
                <Dots as Adversary>::side_to_move(&pos),
                before,
                "each capture keeps the turn"
            );
        }
        assert_eq!(
            pos.box_counts().0,
            6,
            "A closed both boxes beside each edge"
        );
    }

    // --- legality ---

    #[test]
    fn new_game_has_every_edge_legal_and_side_a_to_move() {
        let pos = <Dots as Adversary>::initial(0);
        assert_eq!(<Dots as Adversary>::side_to_move(&pos), Side::A);
        assert_eq!(<Dots as Adversary>::legal_moves(&pos).len(), EDGES);
    }

    #[test]
    fn a_drawn_edge_is_not_legal_again() {
        let pos = play(&[7]);
        let legal = <Dots as Adversary>::legal_moves(&pos);
        assert_eq!(legal.len(), EDGES - 1);
        assert!(!legal.contains(&Edge(7)));
    }

    #[test]
    fn a_complete_board_is_terminal_with_no_legal_moves() {
        let pos = position_missing(&[]);
        assert!(pos.is_complete());
        assert!(
            <Dots as Adversary>::legal_moves(&pos).is_empty(),
            "a terminal position has no legal moves"
        );
        assert!(<Dots as Adversary>::result(&pos).is_some());
    }

    #[test]
    fn a_position_with_edges_left_is_not_terminal() {
        let pos = position_missing(&[0]);
        assert_eq!(<Dots as Adversary>::result(&pos), None);
        assert_eq!(<Dots as Adversary>::legal_moves(&pos).len(), 1);
    }

    // --- results ---

    #[test]
    fn result_of_covers_all_three_outcomes_including_the_unreachable_tie() {
        assert_eq!(result_of(5, 4), MatchResult::WinA);
        assert_eq!(result_of(4, 5), MatchResult::WinB);
        // Unreachable at 9 boxes, which is exactly why it is tested here
        // directly rather than through a played game.
        assert_eq!(result_of(4, 4), MatchResult::Draw);
        assert_eq!(result_of(0, 0), MatchResult::Draw);
    }

    #[test]
    fn nine_boxes_cannot_tie_so_a_finished_game_always_has_a_winner() {
        // Every split of 9 boxes is decisive. This is the property that makes
        // the Draw arm unreachable in play.
        for a in 0u8..=9 {
            let b = 9 - a;
            assert_ne!(
                result_of(a, b),
                MatchResult::Draw,
                "{a}:{b} must be decisive"
            );
        }
    }

    #[test]
    fn a_played_out_game_awards_all_nine_boxes() {
        // Play every edge in index order; whoever closes a box keeps the turn.
        let all: Vec<u8> = (0..EDGES as u8).collect();
        let mut pos = <Dots as Adversary>::initial(0);
        for e in all {
            if pos.is_drawn(e as usize) {
                continue;
            }
            pos = apply_move(&pos, Edge(e));
        }
        assert!(pos.is_complete());
        let (a, b) = pos.box_counts();
        assert_eq!(a + b, BOXES as u8, "every box is claimed by someone");
        assert_eq!(<Dots as Adversary>::result(&pos), Some(result_of(a, b)));
    }

    // --- text bridge ---

    #[test]
    fn render_text_draws_the_empty_lattice_exactly() {
        // Asserted in full rather than by `contains`, because a `contains` check
        // passes even when every other glyph is wrong -- a real gap that
        // mutation testing found in `render_text` on an earlier game.
        let pos = <Dots as Adversary>::initial(0);
        let t = <Dots as Adversary>::render_text(&pos);
        let expected = "\
*  0  *  1  *  2  *
12    13    14    15
*  3  *  4  *  5  *
16    17    18    19
*  6  *  7  *  8  *
20    21    22    23
*  9  * 10  * 11  *
Boxes: X 0, O 0.
To move: X. Reply with one edge number (0-23).";
        assert_eq!(t, expected);
    }

    #[test]
    fn render_text_shows_drawn_edges_and_box_owners() {
        let pos = play(&[0, 3, 12, 13]); // B closes box 0
        let t = <Dots as Adversary>::render_text(&pos);
        assert!(!t.contains(" 0 "), "edge 0 is drawn, so its number is gone");
        assert!(t.contains('O'), "B's box renders as O");
        assert!(t.contains("Boxes: X 0, O 1"), "the score is shown");
    }

    #[test]
    fn move_to_text_is_the_bare_edge_number() {
        assert_eq!(<Dots as Adversary>::move_to_text(Edge(0)), "0");
        assert_eq!(<Dots as Adversary>::move_to_text(Edge(23)), "23");
    }

    #[test]
    fn parse_move_takes_a_legal_edge_and_rejects_everything_else() {
        let pos = <Dots as Adversary>::initial(0);
        assert_eq!(<Dots as Adversary>::parse_move(&pos, "13"), Some(Edge(13)));
        assert_eq!(
            <Dots as Adversary>::parse_move(&pos, "I'll draw 13 next"),
            Some(Edge(13))
        );
        assert_eq!(
            <Dots as Adversary>::parse_move(&pos, "24"),
            None,
            "off board"
        );
        assert_eq!(<Dots as Adversary>::parse_move(&pos, "999"), None);
        assert_eq!(<Dots as Adversary>::parse_move(&pos, "nope"), None);
        let drawn = play(&[13]);
        assert_eq!(
            <Dots as Adversary>::parse_move(&drawn, "13"),
            None,
            "an already-drawn edge is not a legal parse target"
        );
    }

    // --- verifiable outcome (the wiring test) ---

    #[test]
    fn match_record_verifies_and_tamper_is_detected() {
        // Play a real game to completion, then round-trip it through the
        // pond_outcome entry point -- the path a `?r=` share actually takes.
        let mut pos = <Dots as Adversary>::initial(0);
        let mut moves: Vec<Edge> = Vec::new();
        // A deterministic full game: always take the lowest-numbered legal edge.
        while let Some(&mv) = legal_edges(&pos).first() {
            moves.push(mv);
            pos = apply_move(&pos, mv);
        }
        assert_eq!(moves.len(), EDGES, "a full game draws every edge once");

        let record = attest::<Dots>(0, moves.clone(), Outcome::Abandoned, Some(false));
        let checked = verify::<Dots>(&record);
        assert!(checked.ok, "an honest match record verifies");
        assert_eq!(
            checked.actual,
            <Dots as Adversary>::state_hash(&pos),
            "replay reproduces the played position exactly"
        );

        // Tamper: repeat an edge already drawn. Replay treats it as a no-op, so
        // one edge is left undrawn and the hash diverges.
        let mut bad = record.clone();
        bad.moves[10] = bad.moves[0];
        let broken = verify::<Dots>(&bad);
        assert!(!broken.ok, "a tampered move list fails verify");
    }

    #[test]
    fn reordering_two_quiet_opening_moves_is_not_tampering() {
        // Worth pinning, because it looks like a hole and is not one. Swapping
        // two non-capturing moves that close nothing leaves the same edge set,
        // the same turn parity, and therefore the same final position -- it is a
        // different route to an identical state, not a forged result. The hash
        // is right to be blind to it; what it must catch is a move that did not
        // legally happen (above).
        let mut a = <Dots as Adversary>::initial(0);
        let mut b = <Dots as Adversary>::initial(0);
        for e in [0u8, 1] {
            a = apply_move(&a, Edge(e));
        }
        for e in [1u8, 0] {
            b = apply_move(&b, Edge(e));
        }
        assert_eq!(a, b, "the two orders reach the identical position");
        assert_eq!(
            <Dots as Adversary>::state_hash(&a),
            <Dots as Adversary>::state_hash(&b)
        );
    }

    #[test]
    fn replay_ignores_an_illegal_move_so_the_hash_diverges() {
        let honest = vec![Edge(0), Edge(1)];
        let tampered = vec![Edge(0), Edge(0)]; // edge 0 twice: the second is a no-op
        let a = <Dots as pond_outcome::Game>::replay(0, &honest);
        let b = <Dots as pond_outcome::Game>::replay(0, &tampered);
        assert_ne!(a.final_hash, b.final_hash);
    }

    #[test]
    fn state_hash_is_move_sensitive() {
        let a = <Dots as Adversary>::initial(0);
        let moved = <Dots as Adversary>::apply(&a, Edge(5));
        assert_ne!(
            <Dots as Adversary>::state_hash(&a),
            <Dots as Adversary>::state_hash(&moved)
        );
    }

    // --- the trait impl itself, not just the free functions ---
    //
    // Mutation testing on checkers found that a trait impl which only delegates
    // is invisible to a suite that always calls the free function. These call
    // through the trait deliberately.

    #[test]
    fn trait_delegates_to_the_real_rules() {
        let pos = <Dots as Adversary>::initial(0);
        assert_eq!(
            <Dots as Adversary>::legal_moves(&pos).len(),
            legal_edges(&pos).len()
        );
        assert_eq!(
            <Dots as Adversary>::apply(&pos, Edge(2)),
            apply_move(&pos, Edge(2))
        );
        assert_eq!(<Dots as Adversary>::KIND, "dots");
    }

    #[test]
    fn box_mask_and_the_rules_agree_on_what_closes_a_box() {
        // Cross-check: drawing all four edges of box b, in order, must claim it.
        for b in 0..BOXES {
            let mask = box_mask(b);
            let edges: Vec<u8> = (0..EDGES as u8)
                .filter(|&e| mask & (1u32 << e) != 0)
                .collect();
            let mut pos = Board {
                edges: 0,
                owners: [0; BOXES],
                to_move: Side::A,
            };
            for (i, &e) in edges.iter().enumerate() {
                pos = apply_move(&pos, Edge(e));
                let claimed = pos.owners[b] != 0;
                assert_eq!(
                    claimed,
                    i == 3,
                    "box {b} is claimed on its fourth edge, not its {}th",
                    i + 1
                );
            }
        }
    }

    #[test]
    fn dimension_constants_reach_the_module() {
        assert_eq!((ROWS, COLS), (3, 3));
        assert!(side_of_owner(owner_of(Side::A)).is_some());
        assert_eq!(h_edge(0, 0), 0);
    }
}
