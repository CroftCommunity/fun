//! The rules: sow, capture, the extra turn, and the sweep.
//!
//! A move is one **pit**, given as an absolute cell index, and applying it is a
//! loop: every seed comes out of that pit and goes back one at a time around the
//! board, skipping the opponent's store. Three things can happen at the end of
//! that loop, and exactly one of them:
//!
//! 1. the last seed lands in the mover's **own store** — the mover moves again;
//! 2. the last seed lands in an **empty pit on the mover's own side** whose
//!    opposite pit is non-empty — the mover captures both piles;
//! 3. neither — the turn simply passes.
//!
//! Then, whichever happened, if **either** side now has no seeds the game is
//! over and the other side **sweeps** their remaining seeds into their store.
//! The sweep is applied here rather than left to the reader, so a terminal
//! position is always canonical: both sides empty, and the stores holding the
//! final score.

use adversary_core::{Adversary, MatchResult, Side};
use serde::{Deserialize, Serialize};

use crate::board::{is_pit_of, opposite_pit, store_of, Board, CELLS};
use crate::hash::state_hash;

/// A move: sow the seeds in cell `0..CELLS`. Stores are never legal.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Pit(pub u8);

/// The Furrow game marker (zero-sized) the trait impls hang off.
#[derive(Debug, Clone, Copy)]
pub struct Furrow;

/// The terminal result implied by the two final stores.
///
/// A **free function** for the same reason dots' is: the policy is about two
/// numbers, not about the board, and every arm — including the draw — should be
/// reachable by a test directly.
#[must_use]
pub fn result_of(store_a: u8, store_b: u8) -> MatchResult {
    match store_a.cmp(&store_b) {
        std::cmp::Ordering::Greater => MatchResult::WinA,
        std::cmp::Ordering::Less => MatchResult::WinB,
        std::cmp::Ordering::Equal => MatchResult::Draw,
    }
}

/// The pits the side to move may sow: their own, holding at least one seed.
#[must_use]
pub fn legal_pits(pos: &Board) -> Vec<Pit> {
    Board::pits_of(pos.to_move)
        .filter(|&p| pos.cells[p] > 0)
        .map(|p| Pit(p as u8))
        .collect()
}

/// Whether the game is over: one side has no seeds left to sow.
#[must_use]
pub fn is_over(pos: &Board) -> bool {
    pos.side_is_empty(Side::A) || pos.side_is_empty(Side::B)
}

/// Rake every seed still in a pit into that pit's owner's store.
///
/// The end-of-game transformation, and the reason the final score is not what
/// accumulated during play. Applied only at a terminal position, where exactly
/// one side has seeds — but written to be total, so it is a function a test can
/// call on any board and reason about.
#[must_use]
pub fn sweep(pos: &Board) -> Board {
    let mut next = *pos;
    for side in [Side::A, Side::B] {
        let store = store_of(side);
        for p in Board::pits_of(side) {
            next.cells[store] += next.cells[p];
            next.cells[p] = 0;
        }
    }
    next
}

/// The position after sowing `mv` (assumes `mv` is legal).
#[must_use]
pub fn apply_move(pos: &Board, mv: Pit) -> Board {
    let from = mv.0 as usize;
    let mover = pos.to_move;
    let mut next = *pos;

    // Lift the pit, then drop one seed per cell going up the numbering, wrapping
    // at the end and skipping the opponent's store.
    let mut hand = next.cells[from];
    next.cells[from] = 0;
    let theirs = store_of(mover.other());
    let mut at = from;
    while hand > 0 {
        at = (at + 1) % CELLS;
        if at == theirs {
            continue;
        }
        next.cells[at] += 1;
        hand -= 1;
    }

    if at == store_of(mover) {
        // The last seed landed in the mover's own store: another move, and no
        // capture is possible (a store is not a pit).
        return settle(&next);
    }

    // A capture needs the landing pit to be the mover's own and to have been
    // empty before the seed arrived -- which is exactly "it holds one now" --
    // and the facing pit to hold something worth taking.
    if is_pit_of(mover, at) && next.cells[at] == 1 {
        let facing = opposite_pit(at);
        if next.cells[facing] > 0 {
            next.cells[store_of(mover)] += next.cells[facing] + 1;
            next.cells[facing] = 0;
            next.cells[at] = 0;
        }
    }

    next.to_move = mover.other();
    settle(&next)
}

/// Apply the sweep if the position has become terminal, else leave it alone.
fn settle(pos: &Board) -> Board {
    if is_over(pos) {
        sweep(pos)
    } else {
        *pos
    }
}

impl Adversary for Furrow {
    type Position = Board;
    type Move = Pit;
    const KIND: &'static str = "furrow";

    fn initial(_seed: u64) -> Board {
        // The standard opening. `seed` is reserved for future start variants
        // (a different seed count, a handicap) without changing the record
        // format -- the posture Drop 4 and dots both take.
        Board::opening()
    }

    fn side_to_move(pos: &Board) -> Side {
        pos.to_move
    }

    fn legal_moves(pos: &Board) -> Vec<Pit> {
        legal_pits(pos)
    }

    fn apply(pos: &Board, mv: Pit) -> Board {
        apply_move(pos, mv)
    }

    fn result(pos: &Board) -> Option<MatchResult> {
        is_over(pos).then(|| {
            let swept = sweep(pos);
            result_of(swept.store(Side::A), swept.store(Side::B))
        })
    }

    fn state_hash(pos: &Board) -> String {
        state_hash(pos)
    }

    fn render_text(pos: &Board) -> String {
        // Each pit is rendered as **`code=seeds`**, one token, and that is the
        // whole design of this picture.
        //
        // The first version laid the board out spatially — a row of pit labels
        // above the opponent's counts and below yours, with both stores sharing a
        // line with the opponent's counts. It looked like a mancala board and it
        // measured badly: the live trial put the model's unusable-reply rate at
        // **10.9%** against dots' 1.2% on the same model. Three reasons, and the
        // third is the one no other game on this shelf has:
        //
        // 1. Labels sat in a different row from the counts they named, ascending
        //    on one side and descending on the other, so reading a move meant
        //    zipping two rows together in two directions.
        // 2. The store line also carried the opponent's counts, so one line held
        //    eight numbers of two different kinds.
        // 3. **Seed counts reach 10-13 in this game**, so a `12` in a count row is
        //    indistinguishable from the pit *label* 12. Dots never had this
        //    problem because its board has no counts to confuse with its codes.
        //
        // Binding the code to its count removes all three: there is no zipping,
        // no mixed line, and a bare number can only be a count because every code
        // is followed by `=`.
        let cell = |i: usize| format!("{i:>2}={:<2}", pos.cells[i]);
        let row = |cells: &[usize]| {
            cells
                .iter()
                .map(|&i| cell(i))
                .collect::<Vec<_>>()
                .join("  ")
        };
        let theirs: Vec<usize> = Board::pits_of(Side::B).rev().collect();
        let mine: Vec<usize> = Board::pits_of(Side::A).collect();

        let mut lines = vec![
            format!("O pits: {}   O store: {}", row(&theirs), pos.store(Side::B)),
            format!("X pits: {}   X store: {}", row(&mine), pos.store(Side::A)),
        ];
        let mover = match pos.to_move {
            Side::A => "X",
            Side::B => "O",
        };
        let choices = legal_pits(pos)
            .iter()
            .map(|p| p.0.to_string())
            .collect::<Vec<_>>()
            .join(", ");
        lines.push(format!(
            "To move: {mover}. Reply with one pit number ({choices})."
        ));
        lines.join("\n")
    }

    fn move_to_text(mv: Pit) -> String {
        mv.0.to_string()
    }

    fn parse_move(pos: &Board, s: &str) -> Option<Pit> {
        let digits: String = s
            .chars()
            .skip_while(|c| !c.is_ascii_digit())
            .take_while(char::is_ascii_digit)
            .collect();
        let p: usize = digits.parse().ok()?;
        let mv = Pit(u8::try_from(p).ok()?);
        legal_pits(pos).contains(&mv).then_some(mv)
    }
}

impl pond_outcome::Game for Furrow {
    type Move = Pit;
    const KIND: &'static str = "furrow";
    const VERSION: u32 = 1;

    fn replay(seed: u64, moves: &[Pit]) -> pond_outcome::Replayed {
        let mut pos = <Furrow as Adversary>::initial(seed);
        for &mv in moves {
            // A tampered move (illegal, the wrong side's pit, an empty pit, or
            // one played after the match ended) is a no-op, so the hash diverges
            // from the honest match and verification fails.
            if legal_pits(&pos).contains(&mv) {
                pos = apply_move(&pos, mv);
            }
        }
        // `won` means "Side A (the opening player) won".
        let won = matches!(<Furrow as Adversary>::result(&pos), Some(MatchResult::WinA));
        pond_outcome::Replayed::new(state_hash(&pos), won)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::board::{A_STORE, B_STORE, PITS, TOTAL_SEEDS};
    use pond_outcome::{attest, verify, Outcome};

    /// A board from twelve pit counts (A's six then B's six) plus both stores.
    fn board(a: [u8; PITS], b: [u8; PITS], stores: (u8, u8), to_move: Side) -> Board {
        let mut cells = [0u8; CELLS];
        cells[..PITS].copy_from_slice(&a);
        cells[A_STORE] = stores.0;
        cells[PITS + 1..PITS + 1 + PITS].copy_from_slice(&b);
        cells[B_STORE] = stores.1;
        Board { cells, to_move }
    }

    #[test]
    fn a_sow_writes_to_every_pit_it_passes_and_empties_the_one_it_lifted() {
        // The property this game brings: one move, many writes.
        let pos = Board::opening();
        let next = apply_move(&pos, Pit(0));
        assert_eq!(next.cells[0], 0, "the sown pit is emptied");
        assert_eq!(&next.cells[1..5], &[5, 5, 5, 5], "four seeds, four pits");
        assert_eq!(next.cells[5], 4, "and no further");
        assert_eq!(next.store(Side::A), 0, "four seeds do not reach the store");
    }

    #[test]
    fn the_classic_opening_from_pit_two_lands_in_the_store_and_keeps_the_turn() {
        // Pit 2 holds four seeds and sits four cells from A's store, so this is
        // the opening every mancala player knows: it banks a seed and moves
        // again. If the sow is off by one, this test says so first.
        let next = apply_move(&Board::opening(), Pit(2));
        assert_eq!(next.store(Side::A), 1);
        assert_eq!(
            next.to_move,
            Side::A,
            "landing in your own store is another move"
        );
        assert_eq!(&next.cells[3..6], &[5, 5, 5]);
    }

    #[test]
    fn a_lap_skips_the_opponents_store_and_never_the_movers_own() {
        // Nine seeds from pit 5: 6(store) 7 8 9 10 11 12 0 1 -- B's store at 13
        // is stepped over. Getting this backwards produces a plausible game that
        // is simply not mancala, so it is pinned by hand, not by round-trip.
        //
        // Pits 0 and 1 start occupied on purpose: an empty landing pit would
        // fire the capture rule and this test would then be measuring two rules
        // at once.
        let pos = board([1, 1, 0, 0, 0, 9], [0; PITS], (0, 0), Side::A);
        let next = apply_move(&pos, Pit(5));
        assert_eq!(next.store(Side::A), 1, "the mover's own store is sown");
        assert_eq!(next.store(Side::B), 0, "the opponent's store is skipped");
        assert_eq!(
            &next.cells[7..13],
            &[1, 1, 1, 1, 1, 1],
            "all six of B's pits"
        );
        assert_eq!(
            &next.cells[0..2],
            &[2, 2],
            "and back around to A's first two"
        );
    }

    #[test]
    fn a_thirteen_seed_lap_returns_to_the_pit_it_left_and_captures_there() {
        // The case a re-implementation gets wrong quietly: the lift emptied pit
        // 5, so a full lap lands the last seed in an empty own pit, and Kalah has
        // no self-capture exception. Measured in the Phase 0 spike, where the
        // expectation was wrong and the code was right.
        // Pit 7 (b[0]) faces pit 5, and holds three before the lap adds a fourth.
        let pos = board([0, 0, 0, 0, 0, 13], [3, 0, 0, 0, 0, 0], (0, 0), Side::A);
        let next = apply_move(&pos, Pit(5));
        // 13 seeds: 6,7..12,0..5 -- the last lands back in pit 5, alone.
        assert_eq!(
            next.cells[5], 0,
            "the landing pit is taken, not left holding one"
        );
        assert_eq!(next.cells[7], 0, "and so is the pit facing it");
        assert_eq!(
            next.store(Side::A),
            1 + 1 + 4,
            "one banked on the way past, plus the landing seed and the four facing it"
        );
    }

    #[test]
    fn a_capture_takes_the_landing_seed_and_the_whole_facing_pit() {
        let pos = board([1, 0, 0, 0, 0, 0], [0, 0, 0, 0, 5, 0], (0, 0), Side::A);
        let next = apply_move(&pos, Pit(0));
        assert_eq!(
            next.cells[1], 0,
            "the landing pit is emptied into the store"
        );
        assert_eq!(next.cells[11], 0, "so is the facing pit");
        assert_eq!(next.store(Side::A), 6, "one seed plus the five it faced");
        assert_eq!(
            next.to_move,
            Side::B,
            "a capture does not grant another move"
        );
    }

    #[test]
    fn no_capture_when_the_facing_pit_is_empty() {
        // The rule whose absence silently changes the game's balance. B keeps a
        // seed of its own so the move does not also end the game -- the sweep
        // would then bank the landing seed and hide what this test measures.
        let pos = board([1, 0, 0, 0, 0, 0], [1, 0, 0, 0, 0, 0], (0, 4), Side::A);
        let next = apply_move(&pos, Pit(0));
        assert_eq!(next.cells[1], 1, "the seed stays where it landed");
        assert_eq!(next.store(Side::A), 0);
    }

    #[test]
    fn no_capture_when_the_landing_pit_already_held_seeds() {
        let pos = board([1, 3, 0, 0, 0, 0], [0, 0, 0, 0, 5, 0], (0, 0), Side::A);
        let next = apply_move(&pos, Pit(0));
        assert_eq!(next.cells[1], 4, "landing on a pile is not a capture");
        assert_eq!(next.cells[11], 5, "the facing pit is untouched");
        assert_eq!(next.store(Side::A), 0);
    }

    #[test]
    fn no_capture_on_the_opponents_side() {
        // Landing in an empty pit is only a capture on your own side.
        let pos = board([0, 0, 0, 0, 0, 0], [0; PITS], (0, 0), Side::B);
        let pos = Board {
            cells: {
                let mut c = pos.cells;
                c[12] = 2; // B sows 12 -> 13 (own store) then 0 (A's pit)
                c[0] = 0;
                c[7] = 5;
                c
            },
            ..pos
        };
        let next = apply_move(&pos, Pit(12));
        assert_eq!(next.cells[0], 1, "the seed sits in A's pit");
        assert_eq!(next.cells[7], 5, "B's own pit facing it is not taken");
        assert_eq!(next.store(Side::B), 1, "only the seed sown into the store");
    }

    #[test]
    fn emptying_your_own_side_ends_the_game_and_the_opponent_sweeps() {
        // A's last seed goes into A's store, which empties A's side. The game is
        // over and every seed left on B's side becomes B's -- so the final score
        // is not what accumulated during play.
        let pos = board([0, 0, 0, 0, 0, 1], [2, 3, 0, 0, 0, 0], (10, 10), Side::A);
        let next = apply_move(&pos, Pit(5));
        assert!(is_over(&next));
        assert_eq!(next.store(Side::A), 11, "the seed it banked");
        assert_eq!(next.store(Side::B), 15, "ten banked plus the five swept");
        assert_eq!(
            next.in_play(),
            0,
            "a terminal position holds nothing in a pit"
        );
        assert!(legal_pits(&next).is_empty(), "and nobody can move");
    }

    #[test]
    fn a_capture_that_empties_the_opponent_stands_and_the_sweep_resolves_it() {
        // The "grand slam" decision, recorded in RULES.md: the capture is legal,
        // and the seeds the mover leaves behind are then swept to the mover.
        let pos = board([1, 0, 0, 0, 0, 0], [0, 0, 0, 0, 3, 0], (0, 0), Side::A);
        let next = apply_move(&pos, Pit(0));
        assert!(is_over(&next), "B has no seeds, so the game ends");
        assert_eq!(
            next.store(Side::A),
            4,
            "the capture, then nothing left to sweep"
        );
        assert_eq!(next.store(Side::B), 0);
    }

    #[test]
    fn seeds_are_conserved_through_every_move_of_a_played_game() {
        // The invariant a sow loop breaks first, and the cheapest one to check.
        let mut pos = Board::opening();
        let mut guard = 0;
        while !is_over(&pos) && guard < 300 {
            let mv = legal_pits(&pos)[guard % legal_pits(&pos).len()];
            pos = apply_move(&pos, mv);
            let total: u32 = pos.cells.iter().map(|&c| u32::from(c)).sum();
            assert_eq!(
                total,
                u32::from(TOTAL_SEEDS),
                "seeds are never created or lost"
            );
            guard += 1;
        }
        assert!(is_over(&pos), "a random-legal game terminates");
    }

    #[test]
    fn the_trait_impl_really_delegates_rather_than_answering_for_itself() {
        // Phase 4's one core survivor: `<Furrow as Adversary>::legal_moves` could
        // return `vec![]` with every test green, because every test called the
        // free function `legal_pits` directly. This is the shelf's recurring
        // mutation gap (a trait impl that only delegates), and it is the one that
        // matters most here -- the harness, the solver and the match runner all
        // reach this game *through the trait* and never through the free
        // function.
        let pos = Board::opening();
        assert_eq!(<Furrow as Adversary>::legal_moves(&pos), legal_pits(&pos));
        assert_eq!(<Furrow as Adversary>::legal_moves(&pos).len(), PITS);
        assert_eq!(<Furrow as Adversary>::side_to_move(&pos), Side::A);
        assert_eq!(
            <Furrow as Adversary>::apply(&pos, Pit(2)),
            apply_move(&pos, Pit(2))
        );
        assert_eq!(
            <Furrow as Adversary>::state_hash(&pos),
            crate::hash::state_hash(&pos)
        );
        assert_eq!(<Furrow as Adversary>::initial(0), Board::opening());
        // And at a terminal it must be empty for a real reason, not by accident.
        let over = board([0; PITS], [0; PITS], (24, 24), Side::A);
        assert!(<Furrow as Adversary>::legal_moves(&over).is_empty());
    }

    #[test]
    fn legal_pits_are_the_movers_own_non_empty_pits_only() {
        let pos = board([0, 2, 0, 0, 0, 1], [4, 4, 4, 4, 4, 4], (0, 0), Side::A);
        assert_eq!(legal_pits(&pos), vec![Pit(1), Pit(5)]);
        let flipped = Board {
            to_move: Side::B,
            ..pos
        };
        assert_eq!(
            legal_pits(&flipped),
            vec![Pit(7), Pit(8), Pit(9), Pit(10), Pit(11), Pit(12)]
        );
    }

    #[test]
    fn the_result_is_the_swept_score_and_every_class_is_reachable() {
        assert_eq!(result_of(25, 23), MatchResult::WinA);
        assert_eq!(result_of(23, 25), MatchResult::WinB);
        assert_eq!(result_of(24, 24), MatchResult::Draw);
        // Forty-eight seeds can split, so the draw arm is live in real play --
        // unlike dots, where nine boxes could not.
        let drawn = board([0; PITS], [0; PITS], (24, 24), Side::A);
        assert_eq!(
            <Furrow as Adversary>::result(&drawn),
            Some(MatchResult::Draw)
        );
    }

    #[test]
    fn result_is_none_while_both_sides_still_have_seeds() {
        assert_eq!(<Furrow as Adversary>::result(&Board::opening()), None);
    }

    #[test]
    fn result_sweeps_before_scoring_a_position_it_is_handed() {
        // A hand-built terminal that has not been swept: the result must still
        // count the seeds stranded on the board, or a caller that never routed
        // through `apply_move` would read the wrong winner.
        let stranded = board([0; PITS], [0, 0, 0, 0, 0, 6], (20, 18), Side::A);
        assert_eq!(
            <Furrow as Adversary>::result(&stranded),
            Some(MatchResult::WinB),
            "18 + 6 swept beats 20"
        );
    }

    #[test]
    fn every_pit_carries_its_own_code_so_a_count_cannot_be_read_as_one() {
        let text = <Furrow as Adversary>::render_text(&Board::opening());
        assert!(
            text.contains("To move: X. Reply with one pit number (0, 1, 2, 3, 4, 5)."),
            "got:\n{text}"
        );
        assert!(
            text.contains("X store: 0") && text.contains("O store: 0"),
            "got:\n{text}"
        );
        // B's pits read right-to-left in the picture, the way the board faces,
        // and each carries its own count.
        assert!(
            text.contains("12=4") && text.contains(" 7=4"),
            "got:\n{text}"
        );
        assert!(
            text.contains(" 0=4") && text.contains(" 5=4"),
            "got:\n{text}"
        );

        // The property the whole layout exists for: a pit holding twelve seeds
        // must not be readable as the pit *numbered* twelve. Every code is
        // followed by `=`, so a bare number can only ever be a count.
        let mut heavy = Board::opening();
        heavy.cells[1] = 12;
        let text = <Furrow as Adversary>::render_text(&heavy);
        assert!(text.contains(" 1=12"), "got:\n{text}");
        assert_eq!(
            text.matches("12=").count(),
            1,
            "only pit 12 may present itself as a code, not a count of twelve:\n{text}"
        );
    }

    #[test]
    fn parse_move_takes_a_legal_pit_and_refuses_everything_else() {
        let pos = Board::opening();
        assert_eq!(
            <Furrow as Adversary>::parse_move(&pos, "pit 3"),
            Some(Pit(3))
        );
        assert_eq!(
            <Furrow as Adversary>::parse_move(&pos, "  5  "),
            Some(Pit(5))
        );
        assert_eq!(
            <Furrow as Adversary>::parse_move(&pos, "6"),
            None,
            "a store is not a pit"
        );
        assert_eq!(
            <Furrow as Adversary>::parse_move(&pos, "9"),
            None,
            "the opponent's pit is not A's to sow"
        );
        assert_eq!(<Furrow as Adversary>::parse_move(&pos, "nope"), None);
    }

    /// A deterministic full game: always sow the lowest-numbered legal pit.
    fn lowest_legal_game() -> (Vec<Pit>, Board) {
        let mut pos = <Furrow as Adversary>::initial(0);
        let mut moves = Vec::new();
        while let Some(&mv) = legal_pits(&pos).first() {
            moves.push(mv);
            pos = apply_move(&pos, mv);
        }
        (moves, pos)
    }

    #[test]
    fn one_move_writes_to_many_pits_and_replay_reproduces_every_count() {
        // The shape this game brings to the shelf. Replaying a sow is a loop, so
        // "the hash matched" has to mean every one of fourteen counts matched,
        // not that a summary agreed.
        let mut direct = <Furrow as Adversary>::initial(0);
        let wide = Pit(5); // four seeds: store, then three of B's pits
        direct = apply_move(&direct, wide);
        let opening = <Furrow as Adversary>::initial(0);
        let changed = (0..CELLS)
            .filter(|&i| direct.cells[i] != opening.cells[i])
            .count();
        assert_eq!(
            changed, 5,
            "one move changed five cells: the pit it emptied, the store, and three of B's"
        );

        let (moves, played) = lowest_legal_game();
        let mut replayed = <Furrow as Adversary>::initial(0);
        for &mv in &moves {
            replayed = apply_move(&replayed, mv);
        }
        assert_eq!(
            replayed.cells, played.cells,
            "every count, not just the total"
        );
        assert_eq!(state_hash(&replayed), state_hash(&played));
    }

    #[test]
    fn match_record_verifies_and_tamper_is_detected() {
        // Round-trip a real game through the pond_outcome entry point -- the
        // path a `?r=` share actually takes.
        let (moves, pos) = lowest_legal_game();
        assert!(is_over(&pos), "the deterministic game reaches a terminal");

        let record = attest::<Furrow>(0, moves.clone(), Outcome::Abandoned, Some(false));
        let checked = verify::<Furrow>(&record);
        assert!(checked.ok, "an honest match record verifies");
        assert_eq!(
            checked.actual,
            <Furrow as Adversary>::state_hash(&pos),
            "replay reproduces the played position exactly"
        );

        // Tamper: claim a move from the store, which is never a legal pit for
        // anyone. Replay treats it as a no-op, so the sow never happened and
        // every count downstream of it shifts.
        let mut bad = record.clone();
        bad.moves[3] = Pit(A_STORE as u8);
        assert!(
            !verify::<Furrow>(&bad).ok,
            "a tampered move list fails verify"
        );

        // And the subtler tamper: a real pit, but the opponent's.
        let mut wrong_side = record.clone();
        wrong_side.moves[3] = Pit(9);
        assert!(
            !verify::<Furrow>(&wrong_side).ok,
            "sowing the opponent's pit is not a move this record could contain"
        );
    }

    #[test]
    fn move_text_round_trips_through_parse() {
        let pos = Board::opening();
        for mv in legal_pits(&pos) {
            let text = <Furrow as Adversary>::move_to_text(mv);
            assert_eq!(<Furrow as Adversary>::parse_move(&pos, &text), Some(mv));
        }
    }
}
