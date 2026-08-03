//! Depth-limited heuristic search for **live play**.
//!
//! The exact solver ([`crate::Solver`]) is the oracle, but a full solve from the
//! opening is minutes — unusable for a responsive opponent. This module plays a
//! bounded-depth negamax with a positional heuristic at the horizon, so a move
//! comes back in well under a frame from any position. It is strong (sees
//! tactics several plies deep) without being exact; exactness stays the oracle's
//! job (scoring, tutoring, the difficulty band on tractable positions).

use drop4_core::{apply_move, cell_of, legal_cols, winner, Board, Col, HEIGHT, WIDTH};
use rand_chacha::rand_core::RngCore;

use crate::Level;

/// Centre-first column order — the strongest ordering heuristic for Drop 4.
const ORDER: [u8; 7] = [3, 2, 4, 1, 5, 0, 6];
/// Terminal-win magnitude; dwarfs any heuristic score.
const WIN: i32 = 1_000_000;
/// Window weights indexed by disc count (1, 2, 3); 4 is terminal, handled above.
const W: [i32; 4] = [0, 1, 10, 50];

fn window_score(board: &Board, coords: [(usize, usize); 4], me: u8, opp: u8) -> i32 {
    let (mut s, mut o) = (0usize, 0usize);
    for (c, r) in coords {
        let v = board.get(c, r);
        if v == me {
            s += 1;
        } else if v == opp {
            o += 1;
        }
    }
    if o == 0 && s > 0 {
        W[s]
    } else if s == 0 && o > 0 {
        -W[o]
    } else {
        0
    }
}

/// A positional score from the side-to-move's perspective: centre control plus
/// open 2-/3-in-a-line windows for us minus the opponent's.
#[must_use]
pub fn heuristic(board: &Board) -> i32 {
    let me = cell_of(board.to_move);
    let opp = cell_of(board.to_move.other());
    let mut score = 0i32;
    // Centre-column control.
    for r in 0..HEIGHT {
        let v = board.get(3, r);
        if v == me {
            score += 3;
        } else if v == opp {
            score -= 3;
        }
    }
    // Horizontal.
    for r in 0..HEIGHT {
        for c in 0..=WIDTH - 4 {
            score += window_score(board, [(c, r), (c + 1, r), (c + 2, r), (c + 3, r)], me, opp);
        }
    }
    // Vertical.
    for c in 0..WIDTH {
        for r in 0..=HEIGHT - 4 {
            score += window_score(board, [(c, r), (c, r + 1), (c, r + 2), (c, r + 3)], me, opp);
        }
    }
    // Diagonal ascending (↗).
    for c in 0..=WIDTH - 4 {
        for r in 0..=HEIGHT - 4 {
            score += window_score(
                board,
                [(c, r), (c + 1, r + 1), (c + 2, r + 2), (c + 3, r + 3)],
                me,
                opp,
            );
        }
    }
    // Diagonal descending (↘).
    for c in 0..=WIDTH - 4 {
        for r in 3..HEIGHT {
            score += window_score(
                board,
                [(c, r), (c + 1, r - 1), (c + 2, r - 2), (c + 3, r - 3)],
                me,
                opp,
            );
        }
    }
    score
}

fn negamax_capped(board: &Board, depth: u32, mut alpha: i32, beta: i32) -> i32 {
    if winner(board).is_some() {
        return -WIN; // the side to move is already lost (opponent has four)
    }
    let legal = legal_cols(board);
    if legal.is_empty() {
        return 0; // full board, no line => draw
    }
    for &c in &legal {
        if winner(&apply_move(board, c)) == Some(board.to_move) {
            return WIN; // win now
        }
    }
    if depth == 0 {
        return heuristic(board);
    }
    let mut best = i32::MIN + 1;
    for oc in ORDER {
        let c = Col(oc);
        if legal.contains(&c) {
            let score = -negamax_capped(&apply_move(board, c), depth - 1, -beta, -alpha);
            if score > best {
                best = score;
            }
            if best > alpha {
                alpha = best;
            }
            if alpha >= beta {
                break;
            }
        }
    }
    best
}

/// The best move by bounded-depth heuristic search, or `None` if terminal.
/// Takes an immediate win; otherwise picks the centre-ordered move with the
/// highest negamax score to `max_depth`.
#[must_use]
pub fn best_move_capped(board: &Board, max_depth: u32) -> Option<Col> {
    let legal = legal_cols(board);
    if legal.is_empty() {
        return None;
    }
    for &c in &legal {
        if winner(&apply_move(board, c)) == Some(board.to_move) {
            return Some(c);
        }
    }
    let mut best = i32::MIN + 1;
    let mut best_col = None;
    for oc in ORDER {
        let c = Col(oc);
        if legal.contains(&c) {
            let score = -negamax_capped(
                &apply_move(board, c),
                max_depth.saturating_sub(1),
                i32::MIN + 1,
                i32::MAX - 1,
            );
            if score > best {
                best = score;
                best_col = Some(c);
            }
        }
    }
    best_col
}

fn live_params(level: Level) -> (u32, u32) {
    // (search depth, percent chance of a random move) — weaker levels are
    // shallower and blunder more, all still instant.
    match level {
        Level::Easy => (2, 50),
        Level::Medium => (5, 20),
        Level::Hard => (8, 5),
        Level::Perfect => (10, 0),
    }
}

/// A live opponent move at `level` (depth + blunder chance), or `None` if
/// terminal. Fast from any position (this is the shipped opponent; the exact
/// solver is the oracle).
#[must_use]
pub fn choose_capped(board: &Board, level: Level, rng: &mut impl RngCore) -> Option<Col> {
    let legal = legal_cols(board);
    if legal.is_empty() {
        return None;
    }
    let (depth, pct) = live_params(level);
    if pct > 0 && rng.next_u32() % 100 < pct {
        return Some(legal[(rng.next_u32() as usize) % legal.len()]);
    }
    best_move_capped(board, depth)
}

#[cfg(test)]
mod tests {
    use super::*;
    use adversary_core::{Adversary, MatchResult, Side};
    use drop4_core::Drop4;
    use rand_chacha::rand_core::SeedableRng;
    use rand_chacha::ChaCha20Rng;

    fn play(cols: &[u8]) -> Board {
        let mut pos = <Drop4 as Adversary>::initial(0);
        for &c in cols {
            pos = <Drop4 as Adversary>::apply(&pos, Col(c));
        }
        pos
    }

    #[test]
    fn capped_takes_the_immediate_win() {
        let pos = play(&[0, 1, 0, 1, 0, 1]); // A has three in col 0, to move
        assert_eq!(best_move_capped(&pos, 6), Some(Col(0)));
    }

    #[test]
    fn capped_blocks_the_immediate_threat() {
        let pos = play(&[0, 3, 1, 3, 2, 3]); // B threatens col 3, A to move
        assert_eq!(best_move_capped(&pos, 6), Some(Col(3)), "must block col 3");
    }

    #[test]
    fn capped_never_loses_to_random_as_first_player() {
        // Deterministic (seeded random opponent); depth-6 heuristic never loses.
        let mut rng = ChaCha20Rng::seed_from_u64(11);
        for _ in 0..8 {
            let mut pos = <Drop4 as Adversary>::initial(0);
            let mut a = true;
            while <Drop4 as Adversary>::result(&pos).is_none() {
                let mv = if a {
                    best_move_capped(&pos, 6).unwrap()
                } else {
                    let l = legal_cols(&pos);
                    l[(rng.next_u32() as usize) % l.len()]
                };
                pos = <Drop4 as Adversary>::apply(&pos, mv);
                a = !a;
            }
            assert_ne!(
                <Drop4 as Adversary>::result(&pos),
                Some(MatchResult::WinB),
                "depth-6 capped first player must not lose to random"
            );
        }
    }

    #[test]
    fn capped_is_responsive_from_the_opening() {
        // The whole point of the capped engine: a move from the empty board in
        // well under a frame. Bound is generous (debug; release is ~50 ms) so it
        // catches a pathological blowup without flaking.
        let pos = <Drop4 as Adversary>::initial(0);
        let t = std::time::Instant::now();
        let mv = best_move_capped(&pos, 8);
        let ms = t.elapsed().as_millis();
        assert!(mv.is_some(), "returns a move from the opening");
        assert!(ms < 5000, "depth-8 opening move took {ms}ms (debug)");
    }

    #[test]
    fn choose_capped_perfect_takes_the_win() {
        let pos = play(&[0, 1, 0, 1, 0, 1]);
        let mut rng = ChaCha20Rng::seed_from_u64(1);
        assert_eq!(choose_capped(&pos, Level::Perfect, &mut rng), Some(Col(0)));
        let _ = Side::A;
    }
}
