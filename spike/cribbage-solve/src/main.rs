//! Phase 0 discovery spike for `plans/2026-08-29-plan-cribbage-vs-engine.md`.
//!
//! Throwaway measurement code, written independently of the core it will
//! inform, so that when the shipped core agrees with it the agreement means
//! something (the dots / mancala spike posture).
//!
//! What is measured, in order:
//!   0. the scorer is VERIFIED before any number is trusted: the full
//!      enumeration of every (4-card hand, cut) — 12,994,800 of them — must
//!      reproduce the published score distribution (max 29 ×4, 28 ×76, and
//!      19/25/26/27 unreachable).
//!   1. scorer cost, ns per hand
//!   2. exhaustive-discard cost (15 keeps × 46 cuts), with and without a crib term
//!   3. crib-table sensitivity to the assumed opponent discard policy
//!   4. the pegging ladder: random / heuristic / expectimax-2 / expectimax-3,
//!      win rate AND points per deal, honest AND peeking
//!   5. the discard ladder, same shape
//!
//! Rules implemented: two-hand six-card cribbage to 121, his heels, his nobs,
//! pegging with go / last card / 31, show order non-dealer → dealer → crib with
//! the game ending the instant anyone reaches 121.

use rand::seq::SliceRandom;
use rand::{Rng, SeedableRng};
use rand_chacha::ChaCha20Rng;
use std::time::Instant;

// ---------------------------------------------------------------- cards

/// A card: rank 1..=13 (A..K), suit 0..=3.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
struct Card {
    rank: u8,
    suit: u8,
}

impl Card {
    fn value(self) -> u8 {
        self.rank.min(10)
    }
    fn idx(self) -> usize {
        (self.suit as usize) * 13 + (self.rank as usize - 1)
    }
    fn from_idx(i: usize) -> Card {
        Card { rank: (i % 13) as u8 + 1, suit: (i / 13) as u8 }
    }
}

fn full_deck() -> Vec<Card> {
    (0..52).map(Card::from_idx).collect()
}

// ---------------------------------------------------------------- scoring

/// Score a four-card hand (or crib) against the cut.
fn score_hand(hand: &[Card; 4], cut: Card, is_crib: bool) -> u32 {
    let five = [hand[0], hand[1], hand[2], hand[3], cut];
    let mut s = 0u32;

    // fifteens: every subset of the five cards
    for mask in 1u32..32 {
        let mut sum = 0u8;
        for (i, c) in five.iter().enumerate() {
            if mask & (1 << i) != 0 {
                sum += c.value();
            }
        }
        if sum == 15 {
            s += 2;
        }
    }

    // pairs + runs from rank counts
    let mut counts = [0u32; 14];
    for c in &five {
        counts[c.rank as usize] += 1;
    }
    for &n in &counts {
        s += n * n.saturating_sub(1); // 2→2, 3→6, 4→12
    }
    let mut r = 1usize;
    while r <= 13 {
        if counts[r] == 0 {
            r += 1;
            continue;
        }
        let start = r;
        let mut mult = 1u32;
        while r <= 13 && counts[r] > 0 {
            mult *= counts[r];
            r += 1;
        }
        let len = (r - start) as u32;
        if len >= 3 {
            s += len * mult;
        }
    }

    // flush: four in hand; five including cut. A crib needs all five.
    let suit = hand[0].suit;
    if hand.iter().all(|c| c.suit == suit) {
        if cut.suit == suit {
            s += 5;
        } else if !is_crib {
            s += 4;
        }
    }

    // his nobs
    if hand.iter().any(|c| c.rank == 11 && c.suit == cut.suit) {
        s += 1;
    }
    s
}

/// Points scored by the LAST card on the pegging stack (cards since the last
/// reset). 15 → 2, 31 → 2, pairs, runs. Go / last-card are scored by the loop.
fn score_peg(stack: &[Card]) -> u32 {
    let count: u32 = stack.iter().map(|c| c.value() as u32).sum();
    let mut s = 0;
    if count == 15 || count == 31 {
        s += 2;
    }
    let n = stack.len();
    let last = stack[n - 1].rank;
    let mut same = 1;
    for c in stack[..n - 1].iter().rev() {
        if c.rank == last {
            same += 1;
        } else {
            break;
        }
    }
    s += match same {
        2 => 2,
        3 => 6,
        4 => 12,
        _ => 0,
    };
    // runs: longest trailing window that is a permutation of consecutive ranks
    for len in (3..=n).rev() {
        let w = &stack[n - len..];
        let mut ranks: Vec<u8> = w.iter().map(|c| c.rank).collect();
        ranks.sort_unstable();
        if ranks.windows(2).all(|p| p[1] == p[0] + 1) {
            s += len as u32;
            break;
        }
    }
    s
}

// ---------------------------------------------------------------- expectation

fn all_keeps() -> Vec<([usize; 4], [usize; 2])> {
    let mut v = Vec::new();
    for a in 0..6 {
        for b in a + 1..6 {
            let keep: Vec<usize> = (0..6).filter(|&i| i != a && i != b).collect();
            v.push(([keep[0], keep[1], keep[2], keep[3]], [a, b]));
        }
    }
    v
}

/// Expected own-hand score over the 46 unseen cuts, in hundredths.
fn hand_expectation(keep: &[Card; 4], seen: &[Card]) -> i64 {
    let mut total = 0i64;
    let mut n = 0i64;
    for c in full_deck() {
        if seen.contains(&c) {
            continue;
        }
        total += score_hand(keep, c, false) as i64;
        n += 1;
    }
    total * 100 / n
}

/// Crib table: expected crib score (hundredths) indexed by
/// (low rank, high rank, suited). Built by Monte Carlo under an opponent policy.
struct CribTable {
    t: Vec<i64>, // [r1][r2][suited]
}

impl CribTable {
    fn key(a: Card, b: Card) -> usize {
        let (lo, hi) = if a.rank <= b.rank { (a.rank, b.rank) } else { (b.rank, a.rank) };
        ((lo as usize) * 14 + hi as usize) * 2 + (a.suit == b.suit) as usize
    }
    fn get(&self, a: Card, b: Card) -> i64 {
        self.t[Self::key(a, b)]
    }

    fn build(opp: &dyn DiscardPolicy, samples: usize, seed: u64) -> CribTable {
        let mut rng = ChaCha20Rng::seed_from_u64(seed);
        let mut sum = vec![0i64; 14 * 14 * 2];
        let mut cnt = vec![0i64; 14 * 14 * 2];
        let mut deck = full_deck();
        for _ in 0..samples {
            deck.shuffle(&mut rng);
            // our six = deck[0..6], opponent six = deck[6..12], cut from the rest
            let ours: [Card; 6] = deck[0..6].try_into().unwrap();
            let theirs: [Card; 6] = deck[6..12].try_into().unwrap();
            // opponent is the non-dealer here (they are throwing into OUR crib)
            let (_, od) = opp.choose(&theirs, false, &mut rng, None);
            let cut = deck[12];
            for a in 0..6 {
                for b in a + 1..6 {
                    let crib = [ours[a], ours[b], theirs[od[0]], theirs[od[1]]];
                    let k = Self::key(ours[a], ours[b]);
                    sum[k] += score_hand(&crib, cut, true) as i64 * 100;
                    cnt[k] += 1;
                }
            }
        }
        let t = sum.iter().zip(&cnt).map(|(s, c)| if *c > 0 { s / c } else { 0 }).collect();
        CribTable { t }
    }

    fn max_abs_diff(&self, other: &CribTable) -> (i64, f64) {
        let mut mx = 0;
        let mut tot = 0i64;
        let mut n = 0;
        for (a, b) in self.t.iter().zip(&other.t) {
            if *a == 0 && *b == 0 {
                continue;
            }
            let d = (a - b).abs();
            mx = mx.max(d);
            tot += d;
            n += 1;
        }
        (mx, tot as f64 / n as f64)
    }
}

// ---------------------------------------------------------------- policies

/// What a discarding seat may know. `peek` is the full-state cheat: the cut and
/// the opponent's two discards.
struct Peek<'a> {
    cut: Card,
    opp_discards: [Card; 2],
    _p: std::marker::PhantomData<&'a ()>,
}

trait DiscardPolicy {
    fn name(&self) -> &'static str;
    /// Returns (keep indices, discard indices) into the six-card hand.
    fn choose(
        &self,
        six: &[Card; 6],
        is_dealer: bool,
        rng: &mut ChaCha20Rng,
        peek: Option<&Peek>,
    ) -> ([usize; 4], [usize; 2]);
}

struct RandomDiscard;
impl DiscardPolicy for RandomDiscard {
    fn name(&self) -> &'static str {
        "random"
    }
    fn choose(&self, _: &[Card; 6], _: bool, rng: &mut ChaCha20Rng, _: Option<&Peek>) -> ([usize; 4], [usize; 2]) {
        let k = all_keeps();
        k[rng.gen_range(0..k.len())]
    }
}

/// Maximize own expected hand over the 46 cuts; ignore the crib.
struct HandOnly;
impl DiscardPolicy for HandOnly {
    fn name(&self) -> &'static str {
        "hand-only"
    }
    fn choose(&self, six: &[Card; 6], _: bool, _: &mut ChaCha20Rng, _: Option<&Peek>) -> ([usize; 4], [usize; 2]) {
        let mut best = None;
        for (keep, disc) in all_keeps() {
            let k = [six[keep[0]], six[keep[1]], six[keep[2]], six[keep[3]]];
            let v = hand_expectation(&k, six);
            if best.map_or(true, |(bv, _, _)| v > bv) {
                best = Some((v, keep, disc));
            }
        }
        let (_, k, d) = best.unwrap();
        (k, d)
    }
}

/// Hand expectation ± crib-table expectation (dealer adds, non-dealer subtracts).
struct FullExpect<'t> {
    table: &'t CribTable,
}
impl DiscardPolicy for FullExpect<'_> {
    fn name(&self) -> &'static str {
        "full-expect"
    }
    fn choose(&self, six: &[Card; 6], is_dealer: bool, _: &mut ChaCha20Rng, _: Option<&Peek>) -> ([usize; 4], [usize; 2]) {
        let mut best = None;
        for (keep, disc) in all_keeps() {
            let k = [six[keep[0]], six[keep[1]], six[keep[2]], six[keep[3]]];
            let crib = self.table.get(six[disc[0]], six[disc[1]]);
            let v = hand_expectation(&k, six) + if is_dealer { crib } else { -crib };
            if best.map_or(true, |(bv, _, _)| v > bv) {
                best = Some((v, keep, disc));
            }
        }
        let (_, k, d) = best.unwrap();
        (k, d)
    }
}

/// The cheat: knows the cut and the opponent's discards, maximizes ACTUAL points.
struct PeekDiscard;
impl DiscardPolicy for PeekDiscard {
    fn name(&self) -> &'static str {
        "PEEK"
    }
    fn choose(&self, six: &[Card; 6], is_dealer: bool, _: &mut ChaCha20Rng, peek: Option<&Peek>) -> ([usize; 4], [usize; 2]) {
        let p = peek.expect("peek policy needs the full state");
        let mut best = None;
        for (keep, disc) in all_keeps() {
            let k = [six[keep[0]], six[keep[1]], six[keep[2]], six[keep[3]]];
            let crib = [six[disc[0]], six[disc[1]], p.opp_discards[0], p.opp_discards[1]];
            let c = score_hand(&crib, p.cut, true) as i64;
            let v = score_hand(&k, p.cut, false) as i64 + if is_dealer { c } else { -c };
            if best.map_or(true, |(bv, _, _)| v > bv) {
                best = Some((v, keep, disc));
            }
        }
        let (_, k, d) = best.unwrap();
        (k, d)
    }
}

/// The pegging observation: own remaining cards, the live stack, every card
/// this seat has seen (its own six, the cut, the opponent's plays), and how
/// many cards the opponent still holds.
struct PegView<'a> {
    hand: &'a [Card],
    stack: &'a [Card],
    seen: &'a [Card],
    opp_left: usize,
}

trait PegPolicy {
    fn name(&self) -> &'static str;
    /// Index into `view.hand` of the card to play. Only called when a legal play exists.
    fn choose(&self, view: &PegView, rng: &mut ChaCha20Rng, opp_hand: Option<&[Card]>) -> usize;
}

fn count_of(stack: &[Card]) -> u32 {
    stack.iter().map(|c| c.value() as u32).sum()
}

fn playable(hand: &[Card], stack: &[Card]) -> Vec<usize> {
    let c = count_of(stack);
    (0..hand.len()).filter(|&i| c + hand[i].value() as u32 <= 31).collect()
}

struct RandomPeg;
impl PegPolicy for RandomPeg {
    fn name(&self) -> &'static str {
        "random"
    }
    fn choose(&self, v: &PegView, rng: &mut ChaCha20Rng, _: Option<&[Card]>) -> usize {
        let p = playable(v.hand, v.stack);
        p[rng.gen_range(0..p.len())]
    }
}

/// Immediate points, then the folk rules: don't leave 5 or 21, lead under 5.
struct HeuristicPeg;
impl PegPolicy for HeuristicPeg {
    fn name(&self) -> &'static str {
        "heuristic"
    }
    fn choose(&self, v: &PegView, _: &mut ChaCha20Rng, _: Option<&[Card]>) -> usize {
        let mut best = (i64::MIN, 0);
        for i in playable(v.hand, v.stack) {
            let mut st = v.stack.to_vec();
            st.push(v.hand[i]);
            let pts = score_peg(&st) as i64;
            let after = count_of(&st);
            let mut score = pts * 10;
            if after == 5 || after == 21 {
                score -= 3;
            }
            if v.stack.is_empty() && v.hand[i].value() < 5 {
                score += 1;
            }
            if score > best.0 {
                best = (score, i);
            }
        }
        best.1
    }
}

/// Unseen-rank distribution for the opponent's holding.
fn unseen_counts(seen: &[Card]) -> [u32; 14] {
    let mut c = [4u32; 14];
    c[0] = 0;
    for s in seen {
        c[s.rank as usize] -= 1;
    }
    c
}

/// Expectimax over the opponent's unknown cards, `depth` plies deep. Returns the
/// value in hundredths of a point from the mover's perspective. `opp` is either a
/// rank distribution (honest) or the opponent's exact hand (peeking).
fn peg_value(hand: &[Card], stack: &[Card], opp: &OppModel, opp_left: usize, depth: u32) -> i64 {
    let plays = playable(hand, stack);
    if plays.is_empty() {
        // we say go; simplified: opponent gets 1 if they can still play, else reset
        return -100;
    }
    let mut best = i64::MIN;
    for i in plays {
        let mut st = stack.to_vec();
        st.push(hand[i]);
        let mut v = score_peg(&st) as i64 * 100;
        if depth > 1 && opp_left > 0 && count_of(&st) < 31 {
            let mut rest: Vec<Card> = hand.to_vec();
            rest.remove(i);
            v -= opp.reply_value(&st, &rest, opp_left, depth - 1);
        }
        best = best.max(v);
    }
    best
}

enum OppModel<'a> {
    Dist([u32; 14]),
    Exact(&'a [Card]),
}

impl OppModel<'_> {
    /// Expected value of the opponent's best reply, from the opponent's view.
    fn reply_value(&self, stack: &[Card], my_rest: &[Card], opp_left: usize, depth: u32) -> i64 {
        match self {
            OppModel::Exact(h) => {
                // opponent plays their best card against my known rest
                let me = OppModel::Exact(my_rest);
                let plays = playable(h, stack);
                if plays.is_empty() {
                    return -100; // they go; I get a point (approx)
                }
                let mut best = i64::MIN;
                for i in plays {
                    let mut st = stack.to_vec();
                    st.push(h[i]);
                    let mut v = score_peg(&st) as i64 * 100;
                    if depth > 1 && !my_rest.is_empty() && count_of(&st) < 31 {
                        let mut rest = h.to_vec();
                        rest.remove(i);
                        v -= me_reply(&st, my_rest, &rest, depth - 1);
                    }
                    best = best.max(v);
                }
                let _ = me;
                best
            }
            OppModel::Dist(counts) => {
                let c = count_of(stack);
                let total: u32 = counts.iter().sum();
                if total == 0 {
                    return 0;
                }
                let mut acc = 0i64;
                let mut can_play = 0u32;
                for r in 1..=13u8 {
                    let n = counts[r as usize];
                    if n == 0 {
                        continue;
                    }
                    let card = Card { rank: r, suit: 0 };
                    if c + card.value() as u32 > 31 {
                        continue;
                    }
                    can_play += n;
                    let mut st = stack.to_vec();
                    st.push(card);
                    let mut v = score_peg(&st) as i64 * 100;
                    if depth > 1 && !my_rest.is_empty() && count_of(&st) < 31 {
                        let mut counts2 = *counts;
                        counts2[r as usize] -= 1;
                        v -= peg_value(my_rest, &st, &OppModel::Dist(counts2), opp_left - 1, depth - 1);
                    }
                    acc += v * n as i64;
                }
                // a card they cannot play is a "go" for them: I gain ~1
                let cannot = total - can_play;
                (acc - 100 * cannot as i64) / total as i64
            }
        }
    }
}

fn me_reply(stack: &[Card], my_rest: &[Card], opp_rest: &[Card], depth: u32) -> i64 {
    peg_value(my_rest, stack, &OppModel::Exact(opp_rest), opp_rest.len(), depth)
}

struct ExpectimaxPeg {
    depth: u32,
    name: &'static str,
}
impl PegPolicy for ExpectimaxPeg {
    fn name(&self) -> &'static str {
        self.name
    }
    fn choose(&self, v: &PegView, _: &mut ChaCha20Rng, _: Option<&[Card]>) -> usize {
        let dist = OppModel::Dist(unseen_counts(v.seen));
        let mut best = (i64::MIN, 0);
        for i in playable(v.hand, v.stack) {
            let mut st = v.stack.to_vec();
            st.push(v.hand[i]);
            let mut val = score_peg(&st) as i64 * 100;
            if self.depth > 1 && v.opp_left > 0 && count_of(&st) < 31 {
                let mut rest = v.hand.to_vec();
                rest.remove(i);
                val -= dist.reply_value(&st, &rest, v.opp_left, self.depth - 1);
            }
            if val > best.0 {
                best = (val, i);
            }
        }
        best.1
    }
}

/// The cheat: minimax against the opponent's actual cards.
struct PeekPeg;
impl PegPolicy for PeekPeg {
    fn name(&self) -> &'static str {
        "PEEK"
    }
    fn choose(&self, v: &PegView, _: &mut ChaCha20Rng, opp_hand: Option<&[Card]>) -> usize {
        let oh = opp_hand.expect("peek policy needs the opponent's hand");
        let model = OppModel::Exact(oh);
        let mut best = (i64::MIN, 0);
        for i in playable(v.hand, v.stack) {
            let mut st = v.stack.to_vec();
            st.push(v.hand[i]);
            let mut val = score_peg(&st) as i64 * 100;
            if !oh.is_empty() && count_of(&st) < 31 {
                let mut rest = v.hand.to_vec();
                rest.remove(i);
                val -= model.reply_value(&st, &rest, oh.len(), 6);
            }
            if val > best.0 {
                best = (val, i);
            }
        }
        best.1
    }
}

// ---------------------------------------------------------------- the game

struct Seat<'a> {
    discard: &'a dyn DiscardPolicy,
    peg: &'a dyn PegPolicy,
    peeks: bool,
}

struct GameStats {
    winner: usize,
    deals: u32,
    points: [u32; 2],
}

const TARGET: u32 = 121;

fn play_game(seats: &[Seat; 2], seed: u64, first_dealer: usize) -> GameStats {
    let mut rng = ChaCha20Rng::seed_from_u64(seed);
    let mut scores = [0u32; 2];
    let mut dealer = first_dealer;
    let mut deals = 0;
    let mut deck = full_deck();

    let win = |scores: &[u32; 2]| -> Option<usize> {
        if scores[0] >= TARGET {
            Some(0)
        } else if scores[1] >= TARGET {
            Some(1)
        } else {
            None
        }
    };

    loop {
        deals += 1;
        deck.shuffle(&mut rng);
        let six: [[Card; 6]; 2] = [deck[0..6].try_into().unwrap(), deck[6..12].try_into().unwrap()];
        let cut = deck[12];
        let nd = 1 - dealer;

        // discards: the honest seats choose without the peek; a peeking seat is
        // given the other seat's (already-decided) discards and the cut.
        let mut keeps = [[Card { rank: 0, suit: 0 }; 4]; 2];
        let mut discs = [[Card { rank: 0, suit: 0 }; 2]; 2];
        let order = if seats[nd].peeks { [dealer, nd] } else { [nd, dealer] };
        for &s in &order {
            let other = 1 - s;
            let peek = if seats[s].peeks {
                Some(Peek { cut, opp_discards: discs[other], _p: std::marker::PhantomData })
            } else {
                None
            };
            let (k, d) = seats[s].discard.choose(&six[s], s == dealer, &mut rng, peek.as_ref());
            keeps[s] = [six[s][k[0]], six[s][k[1]], six[s][k[2]], six[s][k[3]]];
            discs[s] = [six[s][d[0]], six[s][d[1]]];
        }
        let crib = [discs[0][0], discs[0][1], discs[1][0], discs[1][1]];

        // his heels
        if cut.rank == 11 {
            scores[dealer] += 2;
            if let Some(w) = win(&scores) {
                return GameStats { winner: w, deals, points: scores };
            }
        }

        // pegging
        let mut hands: [Vec<Card>; 2] = [keeps[0].to_vec(), keeps[1].to_vec()];
        let mut seen: [Vec<Card>; 2] = [six[0].to_vec(), six[1].to_vec()];
        seen[0].push(cut);
        seen[1].push(cut);
        let mut stack: Vec<Card> = Vec::new();
        let mut turn = nd;
        let mut last_player = nd;
        let mut just_reset = true;
        loop {
            if hands[0].is_empty() && hands[1].is_empty() {
                if !just_reset {
                    scores[last_player] += 1; // last card
                }
                break;
            }
            let can = |s: usize, st: &[Card], h: &[Vec<Card>]| !playable(&h[s], st).is_empty();
            if can(turn, &stack, &hands) {
                let opp_hand = hands[1 - turn].clone();
                let view = PegView { hand: &hands[turn], stack: &stack, seen: &seen[turn], opp_left: hands[1 - turn].len() };
                let i = seats[turn].peg.choose(&view, &mut rng, if seats[turn].peeks { Some(&opp_hand) } else { None });
                let card = hands[turn].remove(i);
                stack.push(card);
                seen[1 - turn].push(card);
                scores[turn] += score_peg(&stack);
                last_player = turn;
                just_reset = false;
                if count_of(&stack) == 31 {
                    stack.clear();
                    just_reset = true;
                }
                turn = 1 - turn;
            } else if can(1 - turn, &stack, &hands) {
                turn = 1 - turn;
            } else {
                scores[last_player] += 1; // go
                stack.clear();
                just_reset = true;
                turn = 1 - last_player;
            }
            if let Some(w) = win(&scores) {
                return GameStats { winner: w, deals, points: scores };
            }
        }

        // the show: non-dealer, dealer, crib — each a separate win check
        scores[nd] += score_hand(&keeps[nd], cut, false);
        if let Some(w) = win(&scores) {
            return GameStats { winner: w, deals, points: scores };
        }
        scores[dealer] += score_hand(&keeps[dealer], cut, false);
        if let Some(w) = win(&scores) {
            return GameStats { winner: w, deals, points: scores };
        }
        scores[dealer] += score_hand(&crib, cut, true);
        if let Some(w) = win(&scores) {
            return GameStats { winner: w, deals, points: scores };
        }
        dealer = nd;
    }
}

struct Ladder {
    wins: u32,
    games: u32,
    ppd: [f64; 2],
    secs: f64,
}

/// Seat 0 = the candidate, seat 1 = the reference. First dealer alternates.
fn run_pair(a: &Seat, b: &Seat, games: u32, seed_base: u64) -> Ladder {
    let t = Instant::now();
    let mut wins = 0;
    let mut pts = [0u64; 2];
    let mut deals = 0u64;
    for g in 0..games {
        let seats = [Seat { discard: a.discard, peg: a.peg, peeks: a.peeks }, Seat { discard: b.discard, peg: b.peg, peeks: b.peeks }];
        let s = play_game(&seats, seed_base + g as u64, (g % 2) as usize);
        if s.winner == 0 {
            wins += 1;
        }
        pts[0] += s.points[0] as u64;
        pts[1] += s.points[1] as u64;
        deals += s.deals as u64;
    }
    Ladder { wins, games, ppd: [pts[0] as f64 / deals as f64, pts[1] as f64 / deals as f64], secs: t.elapsed().as_secs_f64() }
}

fn report(label: &str, l: &Ladder) {
    println!(
        "  {:<42} win {:5.1}%   pts/deal {:5.2} vs {:5.2}   ({:.1}s)",
        label,
        100.0 * l.wins as f64 / l.games as f64,
        l.ppd[0],
        l.ppd[1],
        l.secs
    );
}

// ---------------------------------------------------------------- main

fn main() {
    println!("== 0. scorer verification: every (hand, cut) ==");
    let t = Instant::now();
    let deck = full_deck();
    let mut dist = [0u64; 30];
    let mut n = 0u64;
    for a in 0..52 {
        for b in a + 1..52 {
            for c in b + 1..52 {
                for d in c + 1..52 {
                    let hand = [deck[a], deck[b], deck[c], deck[d]];
                    for e in 0..52 {
                        if e == a || e == b || e == c || e == d {
                            continue;
                        }
                        dist[score_hand(&hand, deck[e], false) as usize] += 1;
                        n += 1;
                    }
                }
            }
        }
    }
    let secs = t.elapsed().as_secs_f64();
    println!("  {} (hand, cut) pairs in {:.1}s = {:.0} ns/hand", n, secs, secs * 1e9 / n as f64);
    for (s, c) in dist.iter().enumerate() {
        if *c > 0 || (19..=29).contains(&s) {
            println!("  score {:>2}: {:>9}", s, c);
        }
    }
    let ok = n == 12_994_800 && dist[29] == 4 && dist[28] == 76 && dist[19] == 0 && dist[25] == 0 && dist[26] == 0 && dist[27] == 0;
    println!("  published distribution reproduced: {}", if ok { "YES" } else { "NO — STOP" });
    if !ok {
        std::process::exit(1);
    }

    println!("\n== 1/2. discard cost ==");
    let mut rng = ChaCha20Rng::seed_from_u64(7);
    let mut d = full_deck();
    let t = Instant::now();
    let reps = 2000;
    for _ in 0..reps {
        d.shuffle(&mut rng);
        let six: [Card; 6] = d[0..6].try_into().unwrap();
        let _ = HandOnly.choose(&six, true, &mut rng, None);
    }
    println!("  hand-only (15 keeps x 46 cuts): {:.1} us per decision", t.elapsed().as_secs_f64() * 1e6 / reps as f64);

    println!("\n== 3. crib table: sensitivity to the opponent policy ==");
    let t = Instant::now();
    let tab_random = CribTable::build(&RandomDiscard, 20_000, 1);
    let s1 = t.elapsed().as_secs_f64();
    let t = Instant::now();
    let tab_handonly = CribTable::build(&HandOnly, 20_000, 1);
    let s2 = t.elapsed().as_secs_f64();
    let tab_handonly_b = CribTable::build(&HandOnly, 20_000, 2);
    let (mx, mean) = tab_random.max_abs_diff(&tab_handonly);
    let (mx_n, mean_n) = tab_handonly.max_abs_diff(&tab_handonly_b);
    println!("  build: {:.1}s (random opp), {:.1}s (hand-only opp), 20k samples each", s1, s2);
    println!("  random-opp vs hand-only-opp: max |diff| {:.2} pts, mean {:.2} pts", mx as f64 / 100.0, mean / 100.0);
    println!("  same policy, two seeds (noise floor): max {:.2}, mean {:.2}", mx_n as f64 / 100.0, mean_n / 100.0);
    let five = Card { rank: 5, suit: 0 };
    let five2 = Card { rank: 5, suit: 1 };
    let k = Card { rank: 13, suit: 0 };
    let ten = Card { rank: 10, suit: 1 };
    println!(
        "  e.g. throw 5-5: {:.2}   K-10: {:.2}   (hand-only opp)",
        tab_handonly.get(five, five2) as f64 / 100.0,
        tab_handonly.get(k, ten) as f64 / 100.0
    );
    let t = Instant::now();
    for _ in 0..reps {
        d.shuffle(&mut rng);
        let six: [Card; 6] = d[0..6].try_into().unwrap();
        let _ = FullExpect { table: &tab_handonly }.choose(&six, true, &mut rng, None);
    }
    println!("  full-expect (with table lookup): {:.1} us per decision", t.elapsed().as_secs_f64() * 1e6 / reps as f64);

    let table = &tab_handonly;
    let full = FullExpect { table };
    let em2 = ExpectimaxPeg { depth: 2, name: "expectimax-2" };
    let em3 = ExpectimaxPeg { depth: 3, name: "expectimax-3" };
    let games = 1000;

    println!("\n== 4. pegging ladder (discard fixed = full-expect; reference = heuristic) — {} games each ==", games);
    let reference = Seat { discard: &full, peg: &HeuristicPeg, peeks: false };
    for peg in [&RandomPeg as &dyn PegPolicy, &HeuristicPeg, &em2, &em3] {
        let cand = Seat { discard: &full, peg, peeks: false };
        report(&format!("peg {} vs heuristic", peg.name()), &run_pair(&cand, &reference, games, 1000));
    }
    let cand = Seat { discard: &full, peg: &PeekPeg, peeks: true };
    report("peg PEEK vs heuristic", &run_pair(&cand, &reference, games, 1000));

    println!("\n== 5. discard ladder (peg fixed = heuristic; reference = full-expect) — {} games each ==", games);
    for disc in [&RandomDiscard as &dyn DiscardPolicy, &HandOnly, &full] {
        let cand = Seat { discard: disc, peg: &HeuristicPeg, peeks: false };
        report(&format!("discard {} vs full-expect", disc.name()), &run_pair(&cand, &reference, games, 2000));
    }
    let cand = Seat { discard: &PeekDiscard, peg: &HeuristicPeg, peeks: true };
    report("discard PEEK vs full-expect", &run_pair(&cand, &reference, games, 2000));

    println!("\n== 6. sanity + the ends of the ladder — {} games each ==", games);
    let rr = Seat { discard: &RandomDiscard, peg: &RandomPeg, peeks: false };
    report("random/random vs random/random", &run_pair(&rr, &rr, games, 3000));
    let best_honest = Seat { discard: &full, peg: &em2, peeks: false };
    report("full-expect/em2 vs random/random", &run_pair(&best_honest, &rr, games, 3000));
    let cheat = Seat { discard: &PeekDiscard, peg: &PeekPeg, peeks: true };
    report("PEEK/PEEK vs full-expect/em2", &run_pair(&cheat, &best_honest, games, 3000));

    let big = 10_000;
    println!("\n== 7. the pairs that were inside the noise at {} games, at {} (95% CI ±1%) ==", games, big);
    let same = Seat { discard: &full, peg: &HeuristicPeg, peeks: false };
    report("full-expect/heur vs SAME (seat bias)", &run_pair(&same, &reference, big, 5000));
    let ho = Seat { discard: &HandOnly, peg: &HeuristicPeg, peeks: false };
    report("discard hand-only vs full-expect", &run_pair(&ho, &reference, big, 5000));
    let c2 = Seat { discard: &full, peg: &em2, peeks: false };
    report("peg expectimax-2 vs heuristic", &run_pair(&c2, &reference, big, 5000));
    let c3 = Seat { discard: &full, peg: &em3, peeks: false };
    report("peg expectimax-3 vs heuristic", &run_pair(&c3, &reference, big, 5000));
    let r2 = Seat { discard: &full, peg: &em2, peeks: false };
    report("peg expectimax-3 vs expectimax-2", &run_pair(&c3, &r2, big, 5000));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn c(rank: u8, suit: u8) -> Card {
        Card { rank, suit }
    }

    #[test]
    fn twenty_nine() {
        // J♠ 5♥ 5♦ 5♣ with 5♠ cut
        assert_eq!(score_hand(&[c(11, 0), c(5, 1), c(5, 2), c(5, 3)], c(5, 0), false), 29);
    }

    #[test]
    fn flush_needs_five_in_crib() {
        let h = [c(2, 0), c(4, 0), c(6, 0), c(8, 0)];
        assert_eq!(score_hand(&h, c(9, 1), false), 4 + 4); // flush 4 + fifteens {6,9} {2,4,9}
        assert_eq!(score_hand(&h, c(9, 1), true), 4); // crib: no 4-flush
    }

    #[test]
    fn double_run() {
        // 4 4 5 6 + K: two runs of three (6) + pair (2) + fifteens: 4+5+6=15 x2 = 4 → 12
        assert_eq!(score_hand(&[c(4, 0), c(4, 1), c(5, 0), c(6, 0)], c(13, 3), false), 14); // + 5+K fifteen
    }

    #[test]
    fn nobs() {
        assert_eq!(score_hand(&[c(11, 2), c(2, 0), c(4, 1), c(9, 3)], c(7, 2), false), 3); // nobs + 2+4+9
    }

    #[test]
    fn peg_run_out_of_order() {
        assert_eq!(score_peg(&[c(4, 0), c(6, 1), c(5, 2)]), 5); // run of 3 + fifteen
    }

    #[test]
    fn peg_pair_royal() {
        assert_eq!(score_peg(&[c(7, 0), c(7, 1), c(7, 2)]), 6);
    }

    #[test]
    fn peg_thirty_one() {
        assert_eq!(score_peg(&[c(10, 0), c(10, 1), c(10, 2), c(1, 0)]), 2);
    }
}
