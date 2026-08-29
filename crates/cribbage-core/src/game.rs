//! The game: deal, discard, cut, pegging, the show with claims, the next deal,
//! and the terminal with its value. Positions are values; `apply` returns a
//! new state and never mutates its input.

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::card::{full_deck, Card};
use crate::rng::DetRng;
use crate::score::{score_hand, score_peg, HandScore, PegScore};

/// Points to win.
pub const TARGET: u8 = 121;
/// A loser below this is skunked (game worth 2).
pub const SKUNK_LINE: u8 = 91;
/// A loser below this is double-skunked (game worth 3).
pub const DOUBLE_SKUNK_LINE: u8 = 61;

/// A seat. `A` and `B` are symmetric; the seed decides who deals first.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Seat {
    /// The first seat.
    A,
    /// The second seat.
    B,
}

impl Seat {
    /// The other seat.
    #[must_use]
    pub fn other(self) -> Seat {
        match self {
            Seat::A => Seat::B,
            Seat::B => Seat::A,
        }
    }
    /// `0` for A, `1` for B — the index into per-seat arrays.
    #[must_use]
    pub fn idx(self) -> usize {
        match self {
            Seat::A => 0,
            Seat::B => 1,
        }
    }
}

/// Which hand is being counted at the show, in the order the rules fix.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ShowStep {
    /// The non-dealer's hand counts first.
    NonDealer,
    /// Then the dealer's hand.
    Dealer,
    /// Then the crib (the dealer's).
    Crib,
}

/// The phase of a deal.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Phase {
    /// Both seats throw two cards to the crib, non-dealer first.
    Discard,
    /// Pegging to 31.
    Peg,
    /// The show: a claim per hand, in order.
    Show(ShowStep),
    /// The game is over.
    Over,
}

/// A move. Its wire code is what a record carries (`RULES.md` → "Move codes").
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(into = "u8", try_from = "u8")]
pub enum Move {
    /// Throw the pair at this index (0..15) of the six-card hand's pairs.
    Discard(u8),
    /// Play the card at this index (0..4) of the hand.
    Play(u8),
    /// Declare a go (only when no card plays and the other seat can play).
    Go,
    /// Claim this many points (0..=29) for the hand being counted.
    Claim(u8),
}

/// The pairs of a six-card hand, in the order `Move::Discard` indexes them.
#[must_use]
pub fn discard_pairs() -> [(usize, usize); 15] {
    let mut out = [(0, 0); 15];
    let mut k = 0;
    for a in 0..6 {
        for b in a + 1..6 {
            out[k] = (a, b);
            k += 1;
        }
    }
    out
}

impl Move {
    /// The wire code.
    #[must_use]
    pub fn code(self) -> u8 {
        match self {
            Move::Discard(i) => i,
            Move::Play(i) => 16 + i,
            Move::Go => 20,
            Move::Claim(n) => 32 + n,
        }
    }

    /// The move for a wire code, or `None` if the code names nothing.
    #[must_use]
    pub fn from_code(code: u8) -> Option<Move> {
        match code {
            0..=14 => Some(Move::Discard(code)),
            16..=19 => Some(Move::Play(code - 16)),
            20 => Some(Move::Go),
            32..=61 => Some(Move::Claim(code - 32)),
            _ => None,
        }
    }
}

impl From<Move> for u8 {
    fn from(m: Move) -> u8 {
        m.code()
    }
}

impl TryFrom<u8> for Move {
    type Error = RuleError;
    fn try_from(code: u8) -> Result<Move, RuleError> {
        Move::from_code(code).ok_or(RuleError::UnknownCode(code))
    }
}

/// Why a move was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum RuleError {
    /// The code names no move.
    #[error("no move has code {0}")]
    UnknownCode(u8),
    /// The move is not for this phase.
    #[error("that move is not for this phase")]
    WrongPhase,
    /// The index is outside the hand.
    #[error("no such card in hand")]
    NoSuchCard,
    /// The card would take the count past 31.
    #[error("that card would pass 31")]
    Past31,
    /// A go was declared with a playable card, or when the other seat cannot play.
    #[error("a go is not available here")]
    GoNotAvailable,
    /// A claim above the maximum possible hand.
    #[error("a hand scores at most 29")]
    ClaimTooLarge,
    /// The game is over.
    #[error("the game is over")]
    GameOver,
}

/// What the last move scored, for the UI to narrate. Never on the hashed path.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Scored {
    /// His heels: a jack cut, two to the dealer.
    Heels,
    /// Pegging points for the card just played.
    Peg(PegScore),
    /// One for a go.
    Go,
    /// One for the last card.
    LastCard,
    /// A claim was graded: what was claimed, what the hand was worth, what the
    /// other seat took by muggins.
    Claim {
        /// The claim.
        claimed: u8,
        /// The hand's true score.
        actual: HandScore,
        /// Points the other seat took for the under-claim.
        muggins: u8,
    },
}

/// The whole position — both hands, the crib, the cut. A seat sees a `View`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GameState {
    pub(crate) seed: u64,
    pub(crate) deal_no: u32,
    pub(crate) dealer: Seat,
    pub(crate) to_move: Seat,
    pub(crate) phase: Phase,
    pub(crate) scores: [u8; 2],
    /// Cards still in hand (six at the discard, four to zero while pegging).
    pub(crate) hands: [Vec<Card>; 2],
    /// The four each seat kept, for the show.
    pub(crate) kept: [Vec<Card>; 2],
    /// The two each seat threw (the crib, attributed).
    pub(crate) thrown: [Vec<Card>; 2],
    pub(crate) crib: Vec<Card>,
    pub(crate) cut: Card,
    /// Cards since the count last reset, in play order.
    pub(crate) stack: Vec<Card>,
    /// Every card played this deal, in play order, with who played it.
    pub(crate) played: Vec<(Seat, Card)>,
    pub(crate) go: [bool; 2],
    pub(crate) last_player: Option<Seat>,
    /// The claims graded so far this deal, in show order.
    pub(crate) shown: Vec<Shown>,
    /// What the last move scored, and for whom.
    pub(crate) last: Option<(Seat, Scored)>,
}

/// A hand that has been counted at the show.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Shown {
    /// Which hand.
    pub step: ShowStep,
    /// What its owner claimed.
    pub claimed: u8,
    /// What it was worth.
    pub actual: HandScore,
    /// What the other seat took by muggins.
    pub muggins: u8,
}

/// The terminal outcome.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Outcome {
    /// Who reached 121.
    pub winner: Seat,
    /// 1, or 2 for a skunk, or 3 for a double skunk.
    pub value: u8,
}

/// The seed of deal `n` (1-based) of game `seed`.
fn deal_seed(seed: u64, deal_no: u32) -> u64 {
    seed ^ u64::from(deal_no).wrapping_mul(0x9E37_79B9_7F4A_7C15)
}

impl GameState {
    /// A new game: the seed picks the first dealer and every deal.
    #[must_use]
    pub fn new(seed: u64) -> GameState {
        // The cut for deal: its own draw, so the first dealer is not the deal's.
        let dealer = if DetRng::from_seed(seed).index(2) == 0 {
            Seat::A
        } else {
            Seat::B
        };
        let mut s = GameState {
            seed,
            deal_no: 0,
            dealer: dealer.other(), // `deal` swaps it back
            to_move: dealer,
            phase: Phase::Discard,
            scores: [0, 0],
            hands: [Vec::new(), Vec::new()],
            kept: [Vec::new(), Vec::new()],
            thrown: [Vec::new(), Vec::new()],
            crib: Vec::new(),
            cut: Card { rank: 1, suit: 0 },
            stack: Vec::new(),
            played: Vec::new(),
            go: [false, false],
            last_player: None,
            shown: Vec::new(),
            last: None,
        };
        s.deal();
        s
    }

    /// Start the next deal: the dealer swaps, the deck reshuffles from the seed
    /// and the deal number, the non-dealer is to discard.
    fn deal(&mut self) {
        self.deal_no += 1;
        self.dealer = self.dealer.other();
        let mut deck = full_deck();
        DetRng::from_seed(deal_seed(self.seed, self.deal_no)).shuffle(&mut deck);
        let nd = self.dealer.other();
        let mut hands = [Vec::new(), Vec::new()];
        hands[nd.idx()] = deck[0..6].to_vec();
        hands[self.dealer.idx()] = deck[6..12].to_vec();
        for h in &mut hands {
            h.sort_by_key(|c| c.code());
        }
        self.hands = hands;
        self.kept = [Vec::new(), Vec::new()];
        self.thrown = [Vec::new(), Vec::new()];
        self.crib = Vec::new();
        self.cut = deck[12];
        self.stack = Vec::new();
        self.played = Vec::new();
        self.go = [false, false];
        self.last_player = None;
        self.shown = Vec::new();
        self.phase = Phase::Discard;
        self.to_move = nd;
    }

    fn can_play(&self, seat: Seat) -> bool {
        let count = self.count();
        self.hands[seat.idx()]
            .iter()
            .any(|c| count + c.value() <= 31)
    }

    /// Award points and end the game if that reached the target. Returns
    /// whether the game is now over.
    fn award(&mut self, seat: Seat, points: u8, what: Scored) -> bool {
        self.scores[seat.idx()] += points;
        self.last = Some((seat, what));
        if self.scores[seat.idx()] >= TARGET {
            self.phase = Phase::Over;
            self.hands = [Vec::new(), Vec::new()];
            true
        } else {
            false
        }
    }

    fn reset_count(&mut self) {
        self.stack.clear();
        self.go = [false, false];
    }

    /// After any pegging transition: hand the turn to a seat that can act, or
    /// resolve a go point when nobody can, or move to the show when the cards
    /// are gone. Leaves `to_move` on a seat with a legal move.
    fn settle(&mut self) {
        loop {
            if self.phase != Phase::Peg {
                return;
            }
            if self.hands[0].is_empty() && self.hands[1].is_empty() {
                self.reset_count();
                self.phase = Phase::Show(ShowStep::NonDealer);
                self.to_move = self.dealer.other();
                return;
            }
            if self.hands[self.to_move.idx()].is_empty() {
                self.to_move = self.to_move.other();
            }
            if self.can_play(self.to_move) {
                return;
            }
            let other = self.to_move.other();
            if !self.hands[other.idx()].is_empty() && !self.go[other.idx()] && self.can_play(other)
            {
                return; // `to_move` must declare a go
            }
            // Nobody can play: the last to play pegs one and the other seat leads.
            let last = self.last_player.unwrap_or(self.to_move);
            if self.award(last, 1, Scored::Go) {
                return;
            }
            self.reset_count();
            self.to_move = last.other();
        }
    }

    fn play_card(&mut self, seat: Seat, i: usize) -> Result<(), RuleError> {
        let card = *self.hands[seat.idx()].get(i).ok_or(RuleError::NoSuchCard)?;
        if self.count() + card.value() > 31 {
            return Err(RuleError::Past31);
        }
        self.hands[seat.idx()].remove(i);
        self.stack.push(card);
        self.played.push((seat, card));
        self.last_player = Some(seat);
        let peg = score_peg(&self.stack);
        if self.award(seat, peg.total(), Scored::Peg(peg)) {
            return Ok(());
        }
        let both_empty = self.hands[0].is_empty() && self.hands[1].is_empty();
        if self.count() == 31 {
            self.reset_count();
            self.to_move = seat.other();
        } else if both_empty {
            if self.award(seat, 1, Scored::LastCard) {
                return Ok(());
            }
        } else if self.go[seat.other().idx()] {
            self.to_move = seat; // the other has gone; keep playing
        } else {
            self.to_move = seat.other();
        }
        self.settle();
        Ok(())
    }

    fn declare_go(&mut self, seat: Seat) -> Result<(), RuleError> {
        let other = seat.other();
        let available = !self.hands[seat.idx()].is_empty()
            && !self.can_play(seat)
            && !self.go[other.idx()]
            && self.can_play(other);
        if !available {
            return Err(RuleError::GoNotAvailable);
        }
        self.go[seat.idx()] = true;
        self.to_move = other;
        self.settle();
        Ok(())
    }

    fn discard(&mut self, seat: Seat, pair: u8) -> Result<(), RuleError> {
        let (a, b) = *discard_pairs()
            .get(usize::from(pair))
            .ok_or(RuleError::NoSuchCard)?;
        let hand = &mut self.hands[seat.idx()];
        // b > a, so removing b first keeps a's index valid
        let cb = hand.remove(b);
        let ca = hand.remove(a);
        self.crib.push(ca);
        self.crib.push(cb);
        self.thrown[seat.idx()] = vec![ca, cb];
        self.kept[seat.idx()].clone_from(hand);
        if seat == self.dealer.other() {
            self.to_move = self.dealer;
            return Ok(());
        }
        // Both have thrown: the cut turns, and pegging starts with the non-dealer.
        self.crib.sort_by_key(|c| c.code());
        self.phase = Phase::Peg;
        self.to_move = self.dealer.other();
        if self.cut.is_jack() && self.award(self.dealer, 2, Scored::Heels) {
            return Ok(());
        }
        self.settle();
        Ok(())
    }

    fn claim(&mut self, seat: Seat, step: ShowStep, claimed: u8) -> Result<(), RuleError> {
        if claimed > 29 {
            return Err(RuleError::ClaimTooLarge);
        }
        let (cards, is_crib) = match step {
            ShowStep::Crib => (&self.crib, true),
            _ => (&self.kept[seat.idx()], false),
        };
        let four: [Card; 4] = [cards[0], cards[1], cards[2], cards[3]];
        let actual = score_hand(&four, self.cut, is_crib);
        let total = actual.total();
        let (scored, muggins) = if claimed <= total {
            (claimed, total - claimed)
        } else {
            (total, 0)
        };
        let what = Scored::Claim {
            claimed,
            actual,
            muggins,
        };
        self.shown.push(Shown {
            step,
            claimed,
            actual,
            muggins,
        });
        if self.award(seat, scored, what) {
            return Ok(());
        }
        if muggins > 0 {
            let over = self.award(seat.other(), muggins, what);
            self.last = Some((seat, what)); // the claim is the claimant's event
            if over {
                return Ok(());
            }
        }
        match step {
            ShowStep::NonDealer => {
                self.phase = Phase::Show(ShowStep::Dealer);
                self.to_move = self.dealer;
            }
            ShowStep::Dealer => {
                self.phase = Phase::Show(ShowStep::Crib);
                self.to_move = self.dealer;
            }
            ShowStep::Crib => self.deal(),
        }
        Ok(())
    }

    /// The seed.
    #[must_use]
    pub fn seed(&self) -> u64 {
        self.seed
    }
    /// 1-based deal number.
    #[must_use]
    pub fn deal_no(&self) -> u32 {
        self.deal_no
    }
    /// The dealer this deal.
    #[must_use]
    pub fn dealer(&self) -> Seat {
        self.dealer
    }
    /// Whose move it is.
    #[must_use]
    pub fn to_move(&self) -> Seat {
        self.to_move
    }
    /// The phase.
    #[must_use]
    pub fn phase(&self) -> Phase {
        self.phase
    }
    /// The scores, `[A, B]`.
    #[must_use]
    pub fn scores(&self) -> [u8; 2] {
        self.scores
    }
    /// The current count.
    #[must_use]
    pub fn count(&self) -> u8 {
        self.stack.iter().map(|c| c.value()).sum()
    }
    /// What the last move scored.
    #[must_use]
    pub fn last_scored(&self) -> Option<(Seat, Scored)> {
        self.last
    }
    /// The two cards `seat` threw to the crib this deal (empty before it discards).
    #[must_use]
    pub fn thrown_by(&self, seat: Seat) -> &[Card] {
        &self.thrown[seat.idx()]
    }

    /// The terminal outcome, if the game is over.
    #[must_use]
    pub fn outcome(&self) -> Option<Outcome> {
        if self.phase != Phase::Over {
            return None;
        }
        let winner = if self.scores[0] >= TARGET {
            Seat::A
        } else {
            Seat::B
        };
        let loser = self.scores[winner.other().idx()];
        let value = if loser < DOUBLE_SKUNK_LINE {
            3
        } else if loser < SKUNK_LINE {
            2
        } else {
            1
        };
        Some(Outcome { winner, value })
    }
}

/// The legal moves for the seat to move. Empty when the game is over.
#[must_use]
pub fn legal_moves(s: &GameState) -> Vec<Move> {
    match s.phase {
        Phase::Discard => (0..15).map(Move::Discard).collect(),
        Phase::Peg => {
            let seat = s.to_move;
            let count = s.count();
            let plays: Vec<Move> = s.hands[seat.idx()]
                .iter()
                .enumerate()
                .filter(|(_, c)| count + c.value() <= 31)
                .map(|(i, _)| Move::Play(i as u8))
                .collect();
            if plays.is_empty() {
                vec![Move::Go]
            } else {
                plays
            }
        }
        Phase::Show(_) => (0..=29).map(Move::Claim).collect(),
        Phase::Over => Vec::new(),
    }
}

/// The position after `mv`, or why it is refused.
///
/// # Errors
/// A [`RuleError`] naming the rule the move broke.
pub fn apply(s: &GameState, mv: Move) -> Result<GameState, RuleError> {
    let mut next = s.clone();
    next.last = None;
    let seat = s.to_move;
    match (s.phase, mv) {
        (Phase::Over, _) => return Err(RuleError::GameOver),
        (Phase::Discard, Move::Discard(pair)) => next.discard(seat, pair)?,
        (Phase::Peg, Move::Play(i)) => next.play_card(seat, usize::from(i))?,
        (Phase::Peg, Move::Go) => next.declare_go(seat)?,
        (Phase::Show(step), Move::Claim(n)) => next.claim(seat, step, n)?,
        _ => return Err(RuleError::WrongPhase),
    }
    Ok(next)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn c(rank: u8, suit: u8) -> Card {
        Card { rank, suit }
    }

    /// A pegging position built by hand: A is the dealer, B leads.
    fn pegging(a: &[Card], b: &[Card], cut: Card, scores: [u8; 2]) -> GameState {
        let mut s = GameState::new(1);
        s.dealer = Seat::A;
        s.to_move = Seat::B;
        s.phase = Phase::Peg;
        s.scores = scores;
        s.hands = [a.to_vec(), b.to_vec()];
        s.kept = [a.to_vec(), b.to_vec()];
        s.crib = vec![c(2, 0), c(3, 0), c(8, 1), c(9, 1)];
        s.thrown = [vec![c(2, 0), c(3, 0)], vec![c(8, 1), c(9, 1)]];
        s.cut = cut;
        s.stack.clear();
        s.played.clear();
        s.go = [false, false];
        s.last_player = None;
        s.shown.clear();
        s
    }

    fn play_all(s: GameState, moves: &[Move]) -> GameState {
        moves.iter().fold(s, |s, &m| apply(&s, m).expect("legal"))
    }

    #[test]
    fn move_codes_round_trip_and_reject_gaps() {
        for code in 0..=70u8 {
            match Move::from_code(code) {
                Some(m) => assert_eq!(m.code(), code),
                None => assert!(matches!(code, 15 | 21..=31 | 62..=70), "{code}"),
            }
        }
        assert_eq!(Move::Go.code(), 20);
        assert_eq!(Move::Claim(29).code(), 61);
    }

    #[test]
    fn a_new_game_deals_six_sorted_cards_each_and_the_non_dealer_discards_first() {
        let s = GameState::new(42);
        assert_eq!(s.deal_no(), 1);
        assert_eq!(s.phase(), Phase::Discard);
        assert_eq!(s.scores(), [0, 0]);
        assert_eq!(s.to_move(), s.dealer().other());
        for h in &s.hands {
            assert_eq!(h.len(), 6);
            assert!(h.windows(2).all(|w| w[0].code() < w[1].code()));
        }
        let all: Vec<Card> = s.hands.iter().flatten().copied().chain([s.cut]).collect();
        let mut codes: Vec<u8> = all.iter().map(|c| c.code()).collect();
        codes.dedup();
        assert_eq!(codes.len(), 13, "thirteen distinct cards");
        assert_eq!(legal_moves(&s).len(), 15);
    }

    #[test]
    fn different_seeds_deal_differently_and_the_first_dealer_varies() {
        let a = GameState::new(1);
        let b = GameState::new(2);
        assert_ne!(a.hands, b.hands);
        let dealers: Vec<Seat> = (0..40).map(|s| GameState::new(s).dealer()).collect();
        assert!(dealers.contains(&Seat::A) && dealers.contains(&Seat::B));
    }

    #[test]
    fn both_discards_fill_the_crib_reveal_the_cut_and_start_pegging_with_the_non_dealer() {
        let s = GameState::new(42);
        let nd = s.dealer().other();
        let after = play_all(s.clone(), &[Move::Discard(0), Move::Discard(14)]);
        assert_eq!(after.crib.len(), 4);
        assert_eq!(after.hands[0].len(), 4);
        assert_eq!(after.hands[1].len(), 4);
        assert_eq!(after.kept, after.hands);
        assert_eq!(after.phase(), Phase::Peg);
        assert_eq!(after.to_move(), nd);
        // pair 0 = the first two cards of the non-dealer's hand went to the crib
        assert!(after.crib.contains(&s.hands[nd.idx()][0]));
        assert!(after.crib.contains(&s.hands[nd.idx()][1]));
        assert!(apply(&s, Move::Play(0)).is_err());
        assert!(apply(&s, Move::Discard(15)).is_err());
    }

    #[test]
    fn a_jack_cut_is_two_for_the_dealer_and_nothing_otherwise() {
        let jack_seed = (0..2000u64)
            .find(|&seed| GameState::new(seed).cut.is_jack())
            .expect("some seed cuts a jack");
        let s = GameState::new(jack_seed);
        let after = play_all(s.clone(), &[Move::Discard(0), Move::Discard(0)]);
        assert_eq!(after.scores()[s.dealer().idx()], 2);
        assert_eq!(after.scores()[s.dealer().other().idx()], 0);
        assert_eq!(after.last_scored(), Some((s.dealer(), Scored::Heels)));

        let plain_seed = (0..2000u64)
            .find(|&seed| !GameState::new(seed).cut.is_jack())
            .expect("some seed does not");
        let after = play_all(
            GameState::new(plain_seed),
            &[Move::Discard(0), Move::Discard(0)],
        );
        assert_eq!(after.scores(), [0, 0]);
    }

    #[test]
    fn pegging_scores_fifteen_and_the_count_accumulates() {
        let s = pegging(
            &[c(5, 0), c(9, 0), c(9, 1), c(13, 0)],
            &[c(10, 0), c(4, 0), c(6, 0), c(7, 0)],
            c(2, 3),
            [0, 0],
        );
        let s = apply(&s, Move::Play(0)).unwrap(); // B: 10
        assert_eq!(s.count(), 10);
        assert_eq!(s.to_move(), Seat::A);
        let s = apply(&s, Move::Play(0)).unwrap(); // A: 5 → 15
        assert_eq!(s.scores(), [2, 0]);
        assert_eq!(s.count(), 15);
        assert!(matches!(s.last_scored(), Some((Seat::A, Scored::Peg(p))) if p.fifteen == 2));
    }

    #[test]
    fn a_card_past_thirty_one_is_refused() {
        // B 10, A 5 (15, +2 A), B K (25), A 1 (26); B's Q would make 36.
        let s = pegging(
            &[c(5, 0), c(1, 0), c(9, 0), c(9, 1)],
            &[c(10, 0), c(13, 1), c(12, 2), c(4, 0)],
            c(2, 3),
            [0, 0],
        );
        let s = play_all(
            s,
            &[Move::Play(0), Move::Play(0), Move::Play(0), Move::Play(0)],
        );
        assert_eq!(s.count(), 26);
        assert_eq!(s.scores(), [2, 0]);
        assert_eq!(apply(&s, Move::Play(0)), Err(RuleError::Past31));
        assert_eq!(legal_moves(&s), vec![Move::Play(1)], "only the 4 plays");
    }

    #[test]
    fn go_is_the_only_move_when_nothing_plays_but_the_other_seat_can() {
        // B 10, A K, B Q → 30 (no pair, no run). A holds 9 9 8; B holds an ace.
        let s = pegging(
            &[c(13, 0), c(9, 0), c(9, 1), c(8, 0)],
            &[c(10, 1), c(12, 2), c(1, 0), c(6, 0)],
            c(2, 3),
            [0, 0],
        );
        let s = play_all(s, &[Move::Play(0), Move::Play(0), Move::Play(0)]);
        assert_eq!(s.count(), 30);
        assert_eq!(s.scores(), [0, 0]);
        assert_eq!(s.to_move(), Seat::A);
        assert_eq!(apply(&s, Move::Play(0)), Err(RuleError::Past31));
        assert_eq!(legal_moves(&s), vec![Move::Go]);
        // and a go is refused while a card still plays
        let fresh = pegging(&[c(5, 0)], &[c(5, 1)], c(2, 3), [0, 0]);
        assert_eq!(apply(&fresh, Move::Go), Err(RuleError::GoNotAvailable));
    }

    #[test]
    fn when_neither_can_play_the_go_point_resolves_without_a_move() {
        // B 10, A 10, B 10 → 30; A holds 9 9 8 (none plays), B holds 7 6 (none plays):
        // nobody can play → B (last to play) pegs 1 automatically, A leads the reset.
        let s = pegging(
            &[c(13, 0), c(9, 0), c(9, 1), c(8, 0)],
            &[c(10, 1), c(12, 2), c(7, 0), c(6, 0)],
            c(2, 3),
            [0, 0],
        );
        let s = play_all(s, &[Move::Play(0), Move::Play(0), Move::Play(0)]);
        assert_eq!(s.scores(), [0, 1]);
        assert_eq!(s.count(), 0);
        assert_eq!(s.to_move(), Seat::A);
        assert_eq!(s.last_scored(), Some((Seat::B, Scored::Go)));
    }

    #[test]
    fn a_go_lets_the_other_seat_keep_playing_then_peg_the_go() {
        // B 10, A K, B Q → 30. A holds 9 9 8 → must Go. B holds an ace → plays to 31 for 2.
        let s = pegging(
            &[c(13, 0), c(9, 0), c(9, 1), c(8, 0)],
            &[c(10, 1), c(12, 2), c(1, 0), c(6, 0)],
            c(2, 3),
            [0, 0],
        );
        let s = play_all(s, &[Move::Play(0), Move::Play(0), Move::Play(0)]);
        assert_eq!(legal_moves(&s), vec![Move::Go]);
        let s = apply(&s, Move::Go).unwrap();
        assert_eq!(s.to_move(), Seat::B);
        let s = apply(&s, Move::Play(0)).unwrap(); // B: ace → 31
        assert_eq!(s.scores(), [0, 2]);
        assert_eq!(s.count(), 0, "31 resets the count");
        // after 31 the other seat leads; A has cards
        assert_eq!(s.to_move(), Seat::A);
    }

    #[test]
    fn after_a_go_the_player_who_keeps_playing_pegs_one_when_they_run_out_of_plays() {
        // B 10, A K, B 8 → 28. A holds 9 9 9 (no play) → Go. B plays 2 → 30, cannot
        // play the 6, A has gone → B pegs 1 for the go.
        let s = pegging(
            &[c(13, 0), c(9, 0), c(9, 1), c(9, 2)],
            &[c(10, 1), c(8, 0), c(2, 0), c(6, 0)],
            c(3, 3),
            [0, 0],
        );
        let s = play_all(s, &[Move::Play(0), Move::Play(0), Move::Play(0)]); // 10, K, 8 → 28
        let s = apply(&s, Move::Go).unwrap();
        let s = apply(&s, Move::Play(0)).unwrap(); // B: 2 → 30; B cannot play 6; A has gone → B pegs 1
        assert_eq!(s.scores(), [0, 1]);
        assert_eq!(s.count(), 0);
        assert_eq!(
            s.to_move(),
            Seat::A,
            "the seat that did not score the go leads"
        );
    }

    #[test]
    fn the_last_card_pegs_one_and_the_show_starts_with_the_non_dealer() {
        let s = pegging(
            &[c(2, 0), c(3, 0), c(4, 0), c(9, 0)],
            &[c(2, 1), c(3, 1), c(4, 1), c(9, 1)],
            c(13, 3),
            [0, 0],
        );
        // alternate cheaply: B 9, A 9 (18, pair 2), B 4 (22), A 4 (26, pair 2), B 3 (29), A 2 (31 → 2), B 3? count reset: B 3, A 2? A has 3 left...
        let s = play_all(s, &[Move::Play(3), Move::Play(3)]); // B 9, A 9 → pair
        assert_eq!(s.scores(), [2, 0]);
        let s = play_all(s, &[Move::Play(2), Move::Play(2)]); // B 4, A 4 → pair (26)
        assert_eq!(s.scores(), [4, 0]);
        let s = play_all(s, &[Move::Play(1), Move::Play(0)]); // B 3 (29), A 2 (31 → +2, and 4-3-2 is a run → +3)
        assert_eq!(s.scores(), [9, 0]);
        assert_eq!(s.to_move(), Seat::B);
        let s = play_all(s, &[Move::Play(0), Move::Play(0)]); // B 2, A 3 → 5, nothing; last card A +1
        assert_eq!(s.scores(), [10, 0]);
        assert_eq!(s.last_scored(), Some((Seat::A, Scored::LastCard)));
        assert_eq!(s.phase(), Phase::Show(ShowStep::NonDealer));
        assert_eq!(s.to_move(), Seat::B);
        assert!(legal_moves(&s).iter().all(|m| matches!(m, Move::Claim(_))));
        assert_eq!(legal_moves(&s).len(), 30);
    }

    fn at_show(scores: [u8; 2]) -> GameState {
        // A deals; B's hand 5 5 5 J with a 5 cut is 28 + nobs? J♠ 5 5 5 + 5♠: 29 if J matches cut suit.
        let mut s = pegging(
            &[c(2, 0), c(4, 1), c(6, 2), c(8, 3)],
            &[c(11, 3), c(5, 0), c(5, 1), c(5, 2)],
            c(5, 3),
            scores,
        );
        s.hands = [vec![], vec![]];
        s.phase = Phase::Show(ShowStep::NonDealer);
        s.to_move = Seat::B;
        s
    }

    #[test]
    fn claims_are_graded_exact_under_with_muggins_and_over_corrected() {
        let s = at_show([0, 0]);
        let exact = apply(&s, Move::Claim(29)).unwrap();
        assert_eq!(exact.scores(), [0, 29]);
        assert_eq!(exact.phase(), Phase::Show(ShowStep::Dealer));
        assert_eq!(exact.to_move(), Seat::A);

        let under = apply(&s, Move::Claim(20)).unwrap();
        assert_eq!(
            under.scores(),
            [9, 20],
            "the dealer takes the nine by muggins"
        );
        assert!(matches!(
            under.last_scored(),
            Some((
                Seat::B,
                Scored::Claim {
                    claimed: 20,
                    muggins: 9,
                    ..
                }
            ))
        ));

        let over = apply(&s, Move::Claim(29)).unwrap();
        let s2 = at_show([0, 0]);
        let over2 = apply(&s2, Move::Claim(29)).unwrap();
        assert_eq!(over.scores(), over2.scores());
        assert!(apply(&s, Move::Claim(30)).is_err());
    }

    #[test]
    fn over_claiming_scores_the_true_total() {
        let mut s = at_show([0, 0]);
        s.kept[1] = vec![c(2, 0), c(4, 1), c(6, 2), c(8, 3)]; // a zero hand for B against a 5 cut? 2+4+... 2+5+8 = 15: 2 points
        let over = apply(&s, Move::Claim(12)).unwrap();
        let actual = score_hand(&[c(2, 0), c(4, 1), c(6, 2), c(8, 3)], c(5, 3), false).total();
        assert_eq!(over.scores()[1], actual);
        assert_eq!(over.scores()[0], 0);
    }

    #[test]
    fn the_show_runs_non_dealer_dealer_crib_then_the_next_deal_swaps_the_dealer() {
        let s = at_show([0, 0]);
        let s = play_all(s, &[Move::Claim(29)]);
        let dealer_hand = score_hand(&[c(2, 0), c(4, 1), c(6, 2), c(8, 3)], c(5, 3), false).total();
        let s = play_all(s, &[Move::Claim(dealer_hand)]);
        assert_eq!(s.phase(), Phase::Show(ShowStep::Crib));
        assert_eq!(s.to_move(), Seat::A);
        let crib = score_hand(&[c(2, 0), c(3, 0), c(8, 1), c(9, 1)], c(5, 3), true).total();
        let s = play_all(s, &[Move::Claim(crib)]);
        assert_eq!(s.scores(), [dealer_hand + crib, 29]);
        assert_eq!(s.deal_no(), 2);
        assert_eq!(s.dealer(), Seat::B);
        assert_eq!(s.phase(), Phase::Discard);
        assert_eq!(s.to_move(), Seat::A);
        assert_eq!(s.hands[0].len(), 6);
        assert!(s.crib.is_empty());
    }

    #[test]
    fn the_game_ends_the_instant_a_seat_reaches_121_even_mid_pegging() {
        let s = pegging(
            &[c(5, 0), c(9, 0), c(9, 1), c(13, 0)],
            &[c(10, 0), c(4, 0), c(6, 0), c(7, 0)],
            c(2, 3),
            [119, 100],
        );
        let s = play_all(s, &[Move::Play(0), Move::Play(0)]); // B 10, A 5 → 15: A to 121
        assert_eq!(s.phase(), Phase::Over);
        assert_eq!(
            s.outcome(),
            Some(Outcome {
                winner: Seat::A,
                value: 1
            })
        );
        assert!(legal_moves(&s).is_empty());
        assert_eq!(apply(&s, Move::Play(0)), Err(RuleError::GameOver));
    }

    #[test]
    fn the_non_dealer_counting_out_first_wins_before_the_dealer_counts() {
        // B (non-dealer) on 100 with a 29 hand; A (dealer) on 120 with points in hand.
        let s = at_show([120, 100]);
        let s = apply(&s, Move::Claim(29)).unwrap();
        assert_eq!(
            s.outcome(),
            Some(Outcome {
                winner: Seat::B,
                value: 1
            })
        );
        assert_eq!(s.scores(), [120, 129]);
    }

    #[test]
    fn muggins_can_win_the_game_for_the_other_seat() {
        let s = at_show([115, 100]);
        let s = apply(&s, Move::Claim(20)).unwrap(); // dealer takes 9 → 124
        assert_eq!(
            s.outcome(),
            Some(Outcome {
                winner: Seat::A,
                value: 1
            })
        );
    }

    #[test]
    fn game_value_is_one_two_below_91_and_three_below_61() {
        for (loser, value) in [(91, 1), (90, 2), (61, 2), (60, 3), (0, 3)] {
            let s = at_show([loser, 100]);
            let s = apply(&s, Move::Claim(29)).unwrap();
            assert_eq!(
                s.outcome().map(|o| o.value),
                Some(value),
                "loser on {loser}"
            );
        }
    }

    #[test]
    fn a_whole_game_of_legal_moves_terminates_and_is_a_pure_function_of_its_moves() {
        let mut s = GameState::new(7);
        let mut moves = Vec::new();
        let mut n = 0u64;
        while s.outcome().is_none() {
            let legal = legal_moves(&s);
            // a cheap deterministic chooser: cycle through the legal list
            let m = legal[(n as usize * 7) % legal.len()];
            moves.push(m);
            s = apply(&s, m).unwrap();
            n += 1;
            assert!(n < 5000, "a game must end");
        }
        let replayed = play_all(GameState::new(7), &moves);
        assert_eq!(replayed, s);
        assert!(s.scores().iter().any(|&x| x >= TARGET));
    }
}
