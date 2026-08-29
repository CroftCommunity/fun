//! The measurement rig (plan Phase 10): self-play over the real core with the
//! shipped solver, in the shelf's three non-vacuity assertions, plus the two
//! checks only a hidden-information game needs:
//!
//! - **The discard oracle.** Expert's throw must equal the exhaustive
//!   expectation's best on every deal — the one decision in cribbage with an
//!   exact answer, so regret there must be zero.
//! - **The peek check.** A test-only player given the FULL state must beat the
//!   honest Expert by a wide margin. If that margin ever collapses, the honest
//!   engine is reading something it should not (a leak makes the honest engine
//!   *stronger*, so "Expert got better" is the symptom to fear).
//!
//! This lives in Rust rather than behind a feature-flagged wasm export
//! (the plan's first shape) so the peeking code cannot exist in the shipped
//! module at all: a test cannot be compiled into a `cdylib`.

use cribbage_core::card::Card;
use cribbage_core::game::{apply, discard_pairs, legal_moves, GameState, Move, Phase, Seat};
use cribbage_core::score::{score_hand, score_peg};
use cribbage_core::View;
use cribbage_solver::{assess, live_move, CribTable, Level};
use rand::{RngCore, SeedableRng};
use rand_chacha::ChaCha20Rng;

enum Player {
    Level(Level),
    /// Uniformly random among the legal non-claim moves; claims exactly.
    Random,
    /// The cheat: reads the whole state.
    Peek,
}

fn exact_claim(state: &GameState, seat: Seat) -> Option<Move> {
    let Phase::Show(step) = state.phase() else {
        return None;
    };
    let view = View::for_seat(state, seat);
    let on_table = view.revealed.iter().find(|r| r.step == step)?;
    let cut = view.cut?;
    let c = &on_table.cards;
    let total = score_hand(
        &[c[0], c[1], c[2], c[3]],
        cut,
        step == cribbage_core::ShowStep::Crib,
    )
    .total();
    Some(Move::Claim(total))
}

/// The peeking player: the full state is in scope, and it uses it.
fn peek_move(state: &GameState, seat: Seat) -> Move {
    let legal = legal_moves(state);
    match state.phase() {
        Phase::Discard => {
            // Knows the cut. Knows the other seat's throw if it has already thrown.
            let cut = peek_cut(state);
            let six = View::for_seat(state, seat).hand.clone();
            let other_thrown = state.thrown_by(seat.other()).to_vec();
            let dealer = state.dealer() == seat;
            let mut best = (i32::MIN, Move::Discard(0));
            for (i, &(a, b)) in discard_pairs().iter().enumerate() {
                let keep: Vec<Card> = six
                    .iter()
                    .enumerate()
                    .filter(|(k, _)| *k != a && *k != b)
                    .map(|(_, c)| *c)
                    .collect();
                let mut v = i32::from(
                    score_hand(&[keep[0], keep[1], keep[2], keep[3]], cut, false).total(),
                );
                if other_thrown.len() == 2 {
                    let crib = [six[a], six[b], other_thrown[0], other_thrown[1]];
                    let c = i32::from(score_hand(&crib, cut, true).total());
                    v += if dealer { c } else { -c };
                }
                if v > best.0 {
                    best = (v, Move::Discard(i as u8));
                }
            }
            best.1
        }
        Phase::Peg => {
            if legal == [Move::Go] {
                return Move::Go;
            }
            // Immediate points minus the other seat's best immediate reply over
            // their ACTUAL hand.
            let view = View::for_seat(state, seat);
            let theirs = View::for_seat(state, seat.other()).hand;
            let mut best = (i32::MIN, legal[0]);
            for &mv in &legal {
                let Move::Play(i) = mv else { continue };
                let mut stack = view.stack.clone();
                stack.push(view.hand[usize::from(i)]);
                let mine = i32::from(score_peg(&stack).total());
                let count: u32 = stack.iter().map(|c| u32::from(c.value())).sum();
                let reply = theirs
                    .iter()
                    .filter(|c| count + u32::from(c.value()) <= 31)
                    .map(|c| {
                        let mut s = stack.clone();
                        s.push(*c);
                        i32::from(score_peg(&s).total())
                    })
                    .max()
                    .unwrap_or(-1);
                let v = mine - reply;
                if v > best.0 {
                    best = (v, mv);
                }
            }
            best.1
        }
        Phase::Show(_) => exact_claim(state, seat).unwrap_or(legal[0]),
        Phase::Over => legal[0],
    }
}

/// The cut card is what the deck put at index 12 — reconstructed the way the
/// core deals, which is exactly what a peeker would do.
fn peek_cut(state: &GameState) -> Card {
    // Everything not in either hand, not thrown: 52 - 12 = 40 candidates; the
    // core keeps the cut in the state, and the view reveals it after the
    // discards. A peeker can simply apply two throws on a clone and read it.
    let mut s = state.clone();
    while s.phase() == Phase::Discard {
        s = apply(&s, Move::Discard(0)).expect("a discard is always legal here");
    }
    View::for_seat(&s, Seat::A)
        .cut
        .expect("cut is showing after the discards")
}

struct Outcome {
    winner: Seat,
    deals: u32,
    points: [u32; 2],
    /// How many of seat A's discards matched the exhaustive best.
    a_discards_optimal: (u32, u32),
}

fn play(players: [&Player; 2], seed: u64, table: &CribTable) -> Outcome {
    let mut s = GameState::new(seed);
    let mut rngs = [
        ChaCha20Rng::seed_from_u64(seed ^ 1),
        ChaCha20Rng::seed_from_u64(seed ^ 2),
    ];
    let mut a_opt = (0, 0);
    let mut n = 0;
    while s.outcome().is_none() {
        let seat = s.to_move();
        let view = View::for_seat(&s, seat);
        let mv = match players[seat.idx()] {
            Player::Level(l) => {
                let m = live_move(&view, table, *l, &mut rngs[seat.idx()]).expect("a move on turn");
                if seat == Seat::A && s.phase() == Phase::Discard && *l == Level::Expert {
                    let report = assess(&view, table);
                    a_opt.1 += 1;
                    if report.moves[0].mv == m {
                        a_opt.0 += 1;
                    }
                }
                m
            }
            Player::Random => {
                if let Some(c) = exact_claim(&s, seat) {
                    c
                } else {
                    let legal = legal_moves(&s);
                    legal[(rngs[seat.idx()].next_u32() as usize) % legal.len()]
                }
            }
            Player::Peek => peek_move(&s, seat),
        };
        s = apply(&s, mv).expect("every chosen move is legal");
        n += 1;
        assert!(n < 5000, "a game must end");
    }
    let o = s.outcome().expect("over");
    Outcome {
        winner: o.winner,
        deals: s.deal_no(),
        points: [u32::from(s.scores()[0]), u32::from(s.scores()[1])],
        a_discards_optimal: a_opt,
    }
}

struct Ladder {
    a_wins: u32,
    games: u32,
    ppd: [f64; 2],
    a_discards_optimal: (u32, u32),
}

/// Seat A = the candidate, seat B = the reference; the first dealer follows the seed.
fn ladder(a: &Player, b: &Player, games: u32, seed_base: u64, table: &CribTable) -> Ladder {
    let mut a_wins = 0;
    let mut pts = [0u64; 2];
    let mut deals = 0u64;
    let mut opt = (0, 0);
    for g in 0..games {
        let o = play([a, b], seed_base + u64::from(g), table);
        if o.winner == Seat::A {
            a_wins += 1;
        }
        pts[0] += u64::from(o.points[0]);
        pts[1] += u64::from(o.points[1]);
        deals += u64::from(o.deals);
        opt.0 += o.a_discards_optimal.0;
        opt.1 += o.a_discards_optimal.1;
    }
    Ladder {
        a_wins,
        games,
        ppd: [pts[0] as f64 / deals as f64, pts[1] as f64 / deals as f64],
        a_discards_optimal: opt,
    }
}

fn pct(l: &Ladder) -> f64 {
    100.0 * f64::from(l.a_wins) / f64::from(l.games)
}

#[test]
fn every_game_finishes_and_expert_beats_random_and_easy() {
    let table = CribTable::shipped();
    let games = 300;
    let vs_random = ladder(
        &Player::Level(Level::Expert),
        &Player::Random,
        games,
        100,
        &table,
    );
    let vs_easy = ladder(
        &Player::Level(Level::Expert),
        &Player::Level(Level::Easy),
        games,
        200,
        &table,
    );
    let easy_vs_random = ladder(
        &Player::Level(Level::Easy),
        &Player::Random,
        games,
        300,
        &table,
    );
    println!(
        "Expert vs random {:.1}% ({:.2} vs {:.2} pts/deal); Expert vs Easy {:.1}%; Easy vs random {:.1}%",
        pct(&vs_random), vs_random.ppd[0], vs_random.ppd[1], pct(&vs_easy), pct(&easy_vs_random)
    );
    // Non-vacuity: games were played and finished (play() asserts termination).
    assert_eq!(vs_random.games, games);
    assert!(
        pct(&vs_random) >= 90.0,
        "Expert vs random: {:.1}%",
        pct(&vs_random)
    );
    assert!(
        pct(&vs_easy) >= 65.0,
        "Expert vs Easy: {:.1}%",
        pct(&vs_easy)
    );
    assert!(
        pct(&easy_vs_random) >= 55.0,
        "Easy vs random: {:.1}%",
        pct(&easy_vs_random)
    );
}

#[test]
fn the_levels_are_ordered() {
    let table = CribTable::shipped();
    let games = 300;
    let hard_med = ladder(
        &Player::Level(Level::Hard),
        &Player::Level(Level::Medium),
        games,
        400,
        &table,
    );
    let med_easy = ladder(
        &Player::Level(Level::Medium),
        &Player::Level(Level::Easy),
        games,
        500,
        &table,
    );
    let exp_hard = ladder(
        &Player::Level(Level::Expert),
        &Player::Level(Level::Hard),
        games,
        600,
        &table,
    );
    println!(
        "Hard vs Medium {:.1}%; Medium vs Easy {:.1}%; Expert vs Hard {:.1}%",
        pct(&hard_med),
        pct(&med_easy),
        pct(&exp_hard)
    );
    assert!(pct(&hard_med) > 50.0);
    assert!(pct(&med_easy) > 50.0);
    assert!(pct(&exp_hard) > 50.0);
}

#[test]
fn expert_discards_are_the_exhaustive_optimum_every_time() {
    let table = CribTable::shipped();
    let l = ladder(
        &Player::Level(Level::Expert),
        &Player::Level(Level::Medium),
        100,
        700,
        &table,
    );
    let (hit, all) = l.a_discards_optimal;
    assert!(all > 0, "the check graded nothing");
    assert_eq!(
        hit,
        all,
        "Expert's discard had regret on {} of {} deals",
        all - hit,
        all
    );
}

#[test]
fn a_peeking_player_beats_the_honest_expert_by_a_wide_margin() {
    // Phase 0 measured a full peeker at 92.8%. This peeker is simpler (a one-ply
    // pegging minimax) and must still clear 60%: the honest engine has no path
    // to the cut or the other hand, and that margin is the proof.
    let table = CribTable::shipped();
    let l = ladder(
        &Player::Peek,
        &Player::Level(Level::Expert),
        400,
        800,
        &table,
    );
    println!(
        "Peek vs Expert {:.1}% ({:.2} vs {:.2} pts/deal)",
        pct(&l),
        l.ppd[0],
        l.ppd[1]
    );
    assert!(
        pct(&l) >= 60.0,
        "peek margin collapsed to {:.1}% — is the honest engine reading the state?",
        pct(&l)
    );
}
