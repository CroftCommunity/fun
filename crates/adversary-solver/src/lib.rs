//! The class-preserving difficulty band, shared by every adversarial game on the
//! shelf.
//!
//! Both shipped engines grew the same ~30 lines independently: produce a value
//! per legal move, bucket those values into win/draw/loss **classes**, then pick
//! within a band. The band has two knobs, and they are the whole difficulty
//! model:
//!
//! - **`preserve_class`** — the *class floor*. Only moves in the best available
//!   class are eligible, so the pick can never drop from winning to drawing or
//!   from drawing to losing. This is what makes a hard opponent never throw the
//!   game, and it is the property the AI-scoring harness grades against.
//! - **`sloppiness_pct`** — within-class noise. With this probability a random
//!   *eligible* move is taken instead of the tightest one. Sloppiness never
//!   crosses the floor: an easy opponent is beatable because its floor is off,
//!   not because sloppiness overrides it.
//!
//! What is deliberately **not** here: `capped_class` and `live_band(level)`. Both
//! read as if they belonged next to the selector and neither does. `capped_class`
//! genuinely differs per game — Drop 4 classifies a horizon-visible win, Othello
//! returns a constant `0` because it is unsolved from the opening, so a positive
//! heuristic there is not a proven anything. `live_band` is per-game difficulty
//! tuning. Pulling either in would make this crate a place where a game's
//! judgement lives, which is exactly what it is for avoiding.

#![warn(missing_docs)]

use rand_chacha::rand_core::RngCore;

/// The difficulty knobs for one level: how deep to search, whether the class
/// floor is on, and how sloppy to be within the class.
///
/// `depth` is carried here because every consumer's level table sets it
/// alongside the other two; this crate never reads it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LiveBand {
    /// Bounded search depth for the value source.
    pub depth: u32,
    /// Keep only moves in the best available class (never throw the game).
    pub preserve_class: bool,
    /// Percent chance (0-100) of a random in-class move instead of the tightest.
    pub sloppiness_pct: u32,
}

/// Pick a move from a difficulty band over per-move `values`, using `class_of` to
/// bucket each value's win/draw/loss class.
///
/// With `preserve_class`, only moves in the best available class are eligible, so
/// the pick never drops the class. With probability `sloppiness_pct` a random
/// eligible move is chosen; otherwise the tightest (highest-value) eligible move.
/// Returns `None` only when `values` is empty.
///
/// Generic over the move type, which is the entire reason this crate exists: the
/// three shelf games' moves are a column, a cell index, and a packed
/// `(from, to, variant)` code, and none of that matters to the selection.
///
/// **The RNG is untouched when `sloppiness_pct == 0`.** That is a load-bearing
/// property, not an optimization: a deterministic level must produce the same
/// game from the same seed, and consuming a random number here would shift every
/// subsequent draw in the match.
pub fn select_in_band<M: Copy>(
    values: &[(M, i32)],
    class_of: impl Fn(i32) -> i32,
    preserve_class: bool,
    sloppiness_pct: u32,
    rng: &mut impl RngCore,
) -> Option<M> {
    let best = values.iter().map(|&(_, v)| v).max()?;
    let best_class = class_of(best);
    let eligible: Vec<(M, i32)> = values
        .iter()
        .copied()
        .filter(|&(_, v)| !preserve_class || class_of(v) == best_class)
        .collect();
    if eligible.is_empty() {
        return None; // unreachable: the best move is always eligible
    }
    if sloppiness_pct > 0 && rng.next_u32() % 100 < sloppiness_pct {
        return Some(eligible[(rng.next_u32() as usize) % eligible.len()].0);
    }
    eligible.iter().max_by_key(|&&(_, v)| v).map(|&(m, _)| m)
}

/// A deterministic work allowance for one top-level search.
///
/// **Nodes, not milliseconds, and that is the whole design.** A wall-clock bound
/// would make the move a search returns a function of how fast the machine is,
/// and three things here are built on that not being true: `tests/baselines.test.ts`
/// re-runs the engines and asserts exact Reports; a level with no sloppiness must
/// play the same game from the same seed (see
/// `zero_sloppiness_does_not_consume_the_rng`); and the wasm modules are
/// freestanding, with no host import to ask for the time. A node count is the
/// same number on a laptop, on a phone, in CI and in wasm.
///
/// The honest cost: this bounds *work*, not *latency*. Slow hardware at a fixed
/// budget is still slow — it is predictably slow rather than pathologically slow.
/// Nodes are a proxy for time and the proxy needs calibrating per game by
/// measurement, which is why each consumer records its budget's measurements
/// beside the constant.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NodeBudget {
    remaining: u64,
    unlimited: bool,
    exhausted: bool,
}

impl NodeBudget {
    /// A budget of `nodes` search nodes.
    #[must_use]
    pub fn of(nodes: u64) -> Self {
        NodeBudget {
            remaining: nodes,
            unlimited: false,
            exhausted: false,
        }
    }

    /// No limit — spelled out rather than written as `of(u64::MAX)` at every call
    /// site, because "this path is deliberately unbounded" is a decision a reader
    /// should see stated. The analysis oracle and the tutor are the intended
    /// users: a panel opening can afford what a tap cannot.
    #[must_use]
    pub fn unlimited() -> Self {
        NodeBudget {
            remaining: 0,
            unlimited: true,
            exhausted: false,
        }
    }

    /// Charge one node. Returns `false` once the allowance is gone, and keeps
    /// returning `false` — a search that overran does not get to continue because
    /// its next node happened to be cheap.
    pub fn charge(&mut self) -> bool {
        if self.unlimited {
            return true;
        }
        if self.remaining == 0 {
            self.exhausted = true;
            return false;
        }
        self.remaining -= 1;
        true
    }

    /// Whether this budget ever ran out. **Latching**: the caller reads it after
    /// a search to decide whether the result may be used at all, so it must
    /// report "this search overran" and not "the last charge happened to fail".
    #[must_use]
    pub fn is_exhausted(&self) -> bool {
        self.exhausted
    }
}

/// The result of a deepening search: what the last **complete** iteration
/// returned, and how deep that iteration was.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Deepened<T> {
    /// The last complete iteration's result.
    pub result: T,
    /// The depth that iteration searched to. Reported because it is the honest
    /// answer to "how strong was this move?" — a caller that promised depth 8 and
    /// got depth 5 should be able to tell.
    pub depth: u32,
}

/// Search `1..=max_depth`, keeping the last iteration that **finished**.
///
/// `search(d)` returns `None` when it ran out of budget partway. That result is
/// discarded entirely and the previous depth's stands.
///
/// **Why discarding is the whole point.** A budget that simply stopped a
/// fixed-depth search would leave some moves valued at the full depth and the
/// rest not valued at all, and the difficulty band compares values *across*
/// moves — it would then be choosing by which move the search happened to reach,
/// which is to say at random. Iterative deepening is what gives the budget
/// something safe to do when it bites: every value in the returned set comes from
/// one depth.
///
/// Returns `None` only when even depth 1 could not finish. A caller must size its
/// budget so that cannot happen in practice; the games do, by construction.
///
/// Takes no RNG and consumes none — the difficulty band draws *after* the values
/// exist, and a deepening search that moved the stream would change every
/// subsequent draw in the match.
pub fn deepen<T>(max_depth: u32, mut search: impl FnMut(u32) -> Option<T>) -> Option<Deepened<T>> {
    let mut best = None;
    for depth in 1..=max_depth {
        match search(depth) {
            Some(result) => best = Some(Deepened { result, depth }),
            None => break,
        }
    }
    best
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand_chacha::rand_core::SeedableRng;
    use rand_chacha::ChaCha20Rng;

    /// A search that finishes every depth up to `fails_at` and aborts there,
    /// tagging each value with the depth that produced it.
    fn staged(fails_at: u32) -> impl FnMut(u32) -> Option<Vec<(u32, u32)>> {
        move |d: u32| {
            if d >= fails_at {
                None
            } else {
                Some(vec![(1, d), (2, d), (3, d)])
            }
        }
    }

    #[test]
    fn deepening_reaches_max_depth_when_the_budget_holds() {
        let got = deepen(6, staged(u32::MAX)).expect("a search that never aborts returns a result");
        assert_eq!(got.depth, 6, "it must not stop early");
        assert!(
            got.result.iter().all(|&(_, d)| d == 6),
            "every value must come from the deepest completed iteration"
        );
    }

    #[test]
    fn an_abort_returns_the_previous_depth_untouched() {
        // Aborts at 4, so depth 3 is the last complete iteration.
        let got = deepen(9, staged(4)).expect("depths 1-3 completed");
        assert_eq!(got.depth, 3);
        assert!(
            got.result.iter().all(|&(_, d)| d == 3),
            "the aborted iteration's values must not leak in"
        );
    }

    /// The property the driver exists for: one returned set, one depth. A search
    /// that merged a partial deep iteration into a complete shallow one would
    /// hand the difficulty band values it cannot compare.
    #[test]
    fn a_returned_set_never_mixes_depths() {
        for fails_at in 2..8 {
            let got = deepen(7, staged(fails_at)).expect("depth 1 always completes here");
            let depths: Vec<u32> = got.result.iter().map(|&(_, d)| d).collect();
            assert!(
                depths.iter().all(|&d| d == depths[0]),
                "mixed depths {depths:?} at fails_at={fails_at}"
            );
            assert_eq!(
                depths[0], got.depth,
                "and the reported depth must be theirs"
            );
        }
    }

    #[test]
    fn a_budget_too_small_for_depth_one_returns_nothing() {
        // No safe answer exists, and inventing one is worse than saying so. The
        // caller decides; this crate does not guess.
        assert_eq!(deepen(5, staged(1)), None);
    }

    #[test]
    fn a_zero_max_depth_searches_nothing() {
        assert_eq!(deepen(0, staged(u32::MAX)), None);
    }

    /// Each depth is searched once, in increasing order, and nothing runs after
    /// an abort. Without this, a driver that re-ran depths or kept going past a
    /// failure would still satisfy every assertion above.
    #[test]
    fn depths_run_once_each_in_order_and_stop_at_the_abort() {
        let mut seen = Vec::new();
        let got = deepen(9, |d| {
            seen.push(d);
            if d >= 5 {
                None
            } else {
                Some(d)
            }
        });
        assert_eq!(
            got,
            Some(Deepened {
                result: 4,
                depth: 4
            })
        );
        assert_eq!(
            seen,
            vec![1, 2, 3, 4, 5],
            "1..=4 completed, 5 aborted, and nothing was tried after it"
        );
    }

    #[test]
    fn a_budget_allows_exactly_what_it_was_given() {
        let mut b = NodeBudget::of(3);
        assert!(b.charge(), "1 of 3");
        assert!(b.charge(), "2 of 3");
        assert!(b.charge(), "3 of 3");
        assert!(!b.charge(), "the fourth node is over the allowance");
    }

    #[test]
    fn exhaustion_latches_and_is_not_merely_the_last_answer() {
        // Load-bearing: the caller reads `is_exhausted` *after* the search to
        // decide whether the whole result is usable. A flag that reported only
        // the most recent charge would let an overrun be forgotten, and a
        // partially-searched move list would be handed to the difficulty band as
        // if it were complete.
        let mut b = NodeBudget::of(1);
        assert!(!b.is_exhausted(), "nothing has overrun yet");
        assert!(b.charge());
        assert!(
            !b.is_exhausted(),
            "spending the last node is not overrunning"
        );
        assert!(!b.charge());
        assert!(b.is_exhausted());
        assert!(!b.charge(), "and it stays refused");
        assert!(b.is_exhausted(), "and it stays reported");
    }

    #[test]
    fn a_zero_budget_refuses_immediately() {
        let mut b = NodeBudget::of(0);
        assert!(!b.charge());
        assert!(b.is_exhausted());
    }

    #[test]
    fn an_unlimited_budget_never_refuses_and_never_reports_exhaustion() {
        let mut b = NodeBudget::unlimited();
        for _ in 0..10_000 {
            assert!(b.charge());
        }
        assert!(!b.is_exhausted());
    }

    #[test]
    fn budgets_are_independent() {
        // One per top-level call. If two searches could share a counter, one
        // move's cost would depend on which searches ran before it — the same
        // nondeterminism this crate refuses everywhere else.
        let mut a = NodeBudget::of(1);
        let mut b = NodeBudget::of(1);
        assert!(a.charge());
        assert!(!a.charge());
        assert!(b.charge(), "b has its own allowance");
        assert!(!b.is_exhausted() || a.is_exhausted());
    }

    /// A stand-in move type. Deliberately **not** any game's move: this crate's
    /// whole claim is that selection does not care, and testing it against a real
    /// `Col` or `Move` would quietly re-couple it to that game.
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    struct Pick(u8);

    /// Both shipped games' band tests use one winning move, two neutral, one
    /// losing. **Two** winners here instead of one, deliberately: with a single
    /// winner the floor leaves a singleton and the sloppiness path has nothing to
    /// choose between, so a selector that ignored sloppiness entirely would pass.
    /// `Pick(2)` is the tightest.
    fn spread() -> [(Pick, i32); 5] {
        [
            (Pick(0), 0),
            (Pick(1), 0),
            (Pick(2), 500),
            (Pick(3), -500),
            (Pick(4), 300),
        ]
    }

    fn signum(v: i32) -> i32 {
        v.signum()
    }

    #[test]
    fn the_class_floor_never_admits_a_class_dropping_move() {
        // At sloppiness 100 *every* pick is random, so this is the edge where a
        // floor that did not hold would show it. 200 draws is enough that a
        // one-in-four leak is not plausibly missed.
        let values = spread();
        let mut rng = ChaCha20Rng::seed_from_u64(3);
        let mut seen = Vec::new();
        for _ in 0..200 {
            let picked = select_in_band(&values, signum, true, 100, &mut rng)
                .expect("a non-empty value list always yields a move");
            assert!(
                picked == Pick(2) || picked == Pick(4),
                "only the winning class is eligible, got {picked:?}"
            );
            if !seen.contains(&picked) {
                seen.push(picked);
            }
        }
        // ...and sloppiness really is ranging over the eligible set. Without this
        // the assertion above also passes for a selector that ignores sloppiness
        // and always returns the best move.
        assert_eq!(
            seen.len(),
            2,
            "full sloppiness must reach both winning moves"
        );
    }

    #[test]
    fn without_the_floor_full_sloppiness_does_admit_the_class_drop() {
        // The other side of the branch, and the one that stops the test above
        // being vacuous: without it, "the floor works" is indistinguishable from
        // "the selector only ever returns the best move".
        let values = spread();
        let mut rng = ChaCha20Rng::seed_from_u64(5);
        let dropped = (0..200)
            .any(|_| select_in_band(&values, signum, false, 100, &mut rng) == Some(Pick(3)));
        assert!(dropped, "no floor may admit a class-dropping move");
    }

    #[test]
    fn zero_sloppiness_is_deterministic_and_takes_the_tightest_move() {
        // Repeated calls, not one call: a level with no sloppiness must play the
        // same game from the same seed every time.
        let values = spread();
        let mut rng = ChaCha20Rng::seed_from_u64(4);
        for _ in 0..50 {
            assert_eq!(
                select_in_band(&values, signum, true, 0, &mut rng),
                Some(Pick(2))
            );
        }
    }

    #[test]
    fn zero_sloppiness_does_not_consume_the_rng() {
        // Load-bearing, and invisible to every assertion above. The selector
        // short-circuits before touching the RNG at sloppiness 0; if it drew a
        // number and discarded it, every subsequent draw in the match would shift
        // and a recorded game would stop reproducing. That is exactly the
        // regression the harness baselines would report as "the engine changed".
        let values = spread();
        let mut used = ChaCha20Rng::seed_from_u64(9);
        for _ in 0..10 {
            assert_eq!(
                select_in_band(&values, signum, true, 0, &mut used),
                Some(Pick(2)),
                "the call has to actually do its job, or this proves nothing"
            );
        }
        let mut untouched = ChaCha20Rng::seed_from_u64(9);
        assert_eq!(
            used.next_u32(),
            untouched.next_u32(),
            "a deterministic level must leave the stream where it found it"
        );
    }

    #[test]
    fn the_floor_tracks_the_best_available_class_not_a_fixed_one() {
        // When nothing wins, the floor holds the line at the *drawn* class rather
        // than admitting the loss — the case a `class == 1` shortcut would break.
        let values = [(Pick(0), 0), (Pick(1), -500), (Pick(2), -900)];
        let mut rng = ChaCha20Rng::seed_from_u64(11);
        for _ in 0..200 {
            assert_eq!(
                select_in_band(&values, signum, true, 100, &mut rng),
                Some(Pick(0))
            );
        }

        // And when everything loses, the floor cannot save the game, so it picks
        // the tightest loss rather than returning nothing.
        let doomed = [(Pick(0), -900), (Pick(1), -500)];
        let mut rng = ChaCha20Rng::seed_from_u64(12);
        assert_eq!(
            select_in_band(&doomed, signum, true, 0, &mut rng),
            Some(Pick(1))
        );
    }

    #[test]
    fn an_empty_value_list_selects_nothing() {
        // The only `None` the caller can actually observe: a terminal position.
        let mut rng = ChaCha20Rng::seed_from_u64(1);
        let empty: [(Pick, i32); 0] = [];
        assert_eq!(select_in_band(&empty, signum, true, 0, &mut rng), None);
        assert_eq!(select_in_band(&empty, signum, false, 100, &mut rng), None);
    }

    #[test]
    fn a_constant_class_function_makes_the_floor_a_no_op() {
        // Othello's `capped_class` returns 0 for everything, because the game is
        // unsolved from the opening and a positive heuristic proves nothing. Under
        // that classifier every move shares a class, so the floor eliminates
        // nobody and sloppiness ranges over the whole move list — including the
        // move that a signum classifier would have called a loss. Both shipped
        // games' semantics have to fit through this one function; this is the half
        // that is easy to break by "improving" the floor.
        let values = spread();
        let mut rng = ChaCha20Rng::seed_from_u64(7);
        let reached_all =
            (0..400).any(|_| select_in_band(&values, |_| 0, true, 100, &mut rng) == Some(Pick(3)));
        assert!(reached_all, "a constant class must not act as a floor");

        // ...and with no sloppiness it still plays the highest value.
        let mut rng = ChaCha20Rng::seed_from_u64(8);
        assert_eq!(
            select_in_band(&values, |_| 0, true, 0, &mut rng),
            Some(Pick(2))
        );
    }

    #[test]
    fn selection_is_generic_over_the_move_type() {
        // The rule-of-three point, asserted rather than assumed: the three shelf
        // games' moves are a column, a cell index and a packed (from, to, variant)
        // code. Nothing here may depend on which.
        #[derive(Debug, Clone, Copy, PartialEq, Eq)]
        struct Packed(u16);

        let values = [(Packed(16_383), 7), (Packed(0), -1)];
        let mut rng = ChaCha20Rng::seed_from_u64(2);
        assert_eq!(
            select_in_band(&values, signum, true, 0, &mut rng),
            Some(Packed(16_383))
        );
    }

    #[test]
    fn live_band_carries_the_three_knobs() {
        let band = LiveBand {
            depth: 8,
            preserve_class: true,
            sloppiness_pct: 45,
        };
        assert_eq!(band, band);
        assert_ne!(
            band,
            LiveBand {
                sloppiness_pct: 0,
                ..band
            }
        );
    }
}
