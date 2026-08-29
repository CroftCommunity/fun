//! The observation: what one seat can see. This is the type the solver takes
//! and the type the wasm binding hands to the UI — never [`GameState`].

use serde::{Deserialize, Serialize};

use crate::card::Card;
use crate::game::{GameState, Outcome, Phase, Scored, Seat, ShowStep, Shown};

/// A hand on the table at the show: its cards, and its grading once claimed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Revealed {
    /// Which hand.
    pub step: ShowStep,
    /// Who it belongs to (the crib is the dealer's).
    pub owner: Seat,
    /// The four cards.
    pub cards: Vec<Card>,
    /// `Some` once its owner has claimed.
    pub graded: Option<Shown>,
}

/// One seat's view of the game.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct View {
    /// Whose view this is.
    pub seat: Seat,
    /// The dealer this deal.
    pub dealer: Seat,
    /// Whose move it is.
    pub to_move: Seat,
    /// The phase.
    pub phase: Phase,
    /// 1-based deal number.
    pub deal_no: u32,
    /// `[A, B]`.
    pub scores: [u8; 2],
    /// Cards still in this seat's hand.
    pub hand: Vec<Card>,
    /// The four this seat kept (empty until it has discarded).
    pub kept: Vec<Card>,
    /// The cut, once both seats have discarded.
    pub cut: Option<Card>,
    /// Cards since the count last reset, in play order.
    pub stack: Vec<Card>,
    /// The count.
    pub count: u8,
    /// Every card played this deal, in play order.
    pub played: Vec<(Seat, Card)>,
    /// How many cards the other seat still holds.
    pub opponent_cards: u8,
    /// Every card this seat has seen this deal: its own six, the cut, and the
    /// other seat's plays — the complement is the unseen set an engine reasons over.
    pub seen: Vec<Card>,
    /// Hands on the table at the show, in show order.
    pub revealed: Vec<Revealed>,
    /// What the last move scored, and for whom.
    pub last: Option<(Seat, Scored)>,
    /// The terminal outcome, if over.
    pub outcome: Option<Outcome>,
}

impl View {
    /// The view from `seat`.
    #[must_use]
    pub fn for_seat(s: &GameState, seat: Seat) -> View {
        let other = seat.other();
        let both_discarded = !matches!(s.phase, Phase::Discard);
        let cut = both_discarded.then_some(s.cut);

        // Own six: what is still held plus what was thrown, before the show.
        let mut seen: Vec<Card> = s.hands[seat.idx()].clone();
        for c in &s.kept[seat.idx()] {
            if !seen.contains(c) {
                seen.push(*c);
            }
        }
        for c in &s.crib {
            // Only this seat's own throws are its knowledge; the crib is sorted,
            // so recover them as "crib cards that came from my six" — which the
            // core knows because everything not kept by me and not the other
            // seat's is mine. The other seat's throws are exactly what must stay
            // hidden, so filter by ownership, not by position.
            if s.thrown_by(seat).contains(c) && !seen.contains(c) {
                seen.push(*c);
            }
        }
        if let Some(c) = cut {
            seen.push(c);
        }
        for (who, c) in &s.played {
            if *who == other {
                seen.push(*c);
            }
        }

        // The show: hands face up in order, up to the step in progress.
        let mut revealed = Vec::new();
        let steps_on_table = match s.phase {
            Phase::Show(ShowStep::NonDealer) => 1,
            Phase::Show(ShowStep::Dealer) => 2,
            Phase::Show(ShowStep::Crib) => 3,
            // Game over: exactly the hands that were counted, none that was not.
            Phase::Over => s.shown.len(),
            _ => 0,
        };
        let nd = s.dealer.other();
        let table = [
            (ShowStep::NonDealer, nd, &s.kept[nd.idx()]),
            (ShowStep::Dealer, s.dealer, &s.kept[s.dealer.idx()]),
            (ShowStep::Crib, s.dealer, &s.crib),
        ];
        for (i, (step, owner, cards)) in table.iter().enumerate().take(steps_on_table.min(3)) {
            revealed.push(Revealed {
                step: *step,
                owner: *owner,
                cards: (*cards).clone(),
                graded: s.shown.get(i).copied(),
            });
        }

        View {
            seat,
            dealer: s.dealer,
            to_move: s.to_move,
            phase: s.phase,
            deal_no: s.deal_no,
            scores: s.scores,
            hand: s.hands[seat.idx()].clone(),
            kept: s.kept[seat.idx()].clone(),
            cut,
            stack: s.stack.clone(),
            count: s.count(),
            played: s.played.clone(),
            opponent_cards: s.hands[other.idx()].len() as u8,
            seen,
            revealed,
            last: s.last,
            outcome: s.outcome(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::{apply, legal_moves, Move};

    fn play(s: &GameState, moves: &[Move]) -> GameState {
        moves
            .iter()
            .fold(s.clone(), |s, &m| apply(&s, m).expect("legal"))
    }

    /// Every card that appears anywhere in the view's JSON.
    fn cards_in_json(v: &View) -> Vec<Card> {
        let json = serde_json::to_string(v).expect("serializes");
        let mut out = Vec::new();
        let mut rest = json.as_str();
        while let Some(at) = rest.find("{\"rank\":") {
            let seg = &rest[at..];
            let end = seg.find('}').expect("closes");
            let obj: Card = serde_json::from_str(&seg[..=end]).expect("a card");
            out.push(obj);
            rest = &seg[end..];
        }
        out
    }

    #[test]
    fn at_the_discard_a_seat_sees_its_six_and_nothing_of_the_other_hand_or_the_cut() {
        let s = GameState::new(11);
        for seat in [Seat::A, Seat::B] {
            let v = View::for_seat(&s, seat);
            assert_eq!(v.seat, seat);
            assert_eq!(v.hand, s.hands[seat.idx()]);
            assert_eq!(v.kept, Vec::<Card>::new());
            assert_eq!(v.cut, None);
            assert_eq!(v.opponent_cards, 6);
            assert_eq!(v.seen, s.hands[seat.idx()]);
            assert!(v.revealed.is_empty());
            let leaked: Vec<Card> = cards_in_json(&v)
                .into_iter()
                .filter(|c| s.hands[seat.other().idx()].contains(c) || *c == s.cut)
                .collect();
            assert!(leaked.is_empty(), "{seat:?} sees {leaked:?}");
        }
    }

    #[test]
    fn after_the_discards_the_cut_is_seen_but_not_the_crib_or_the_other_hand() {
        let s = GameState::new(11);
        let p = play(&s, &[Move::Discard(3), Move::Discard(9)]);
        for seat in [Seat::A, Seat::B] {
            let v = View::for_seat(&p, seat);
            assert_eq!(v.cut, Some(p.cut));
            assert_eq!(v.kept, p.kept[seat.idx()]);
            assert_eq!(v.hand, p.hands[seat.idx()]);
            assert_eq!(v.opponent_cards, 4);
            assert!(v.seen.contains(&p.cut));
            assert_eq!(v.seen.len(), 7, "own six plus the cut");
            let hidden: Vec<Card> = p.hands[seat.other().idx()]
                .iter()
                .chain(p.crib.iter().filter(|c| !s.hands[seat.idx()].contains(c)))
                .copied()
                .collect();
            let leaked: Vec<Card> = cards_in_json(&v)
                .into_iter()
                .filter(|c| hidden.contains(c))
                .collect();
            assert!(leaked.is_empty(), "{seat:?} sees {leaked:?}");
        }
    }

    #[test]
    fn during_pegging_the_other_seats_plays_join_seen_and_the_count_is_on_the_view() {
        let s = play(&GameState::new(11), &[Move::Discard(3), Move::Discard(9)]);
        let lead = s.to_move();
        let first = legal_moves(&s)[0];
        let p = apply(&s, first).unwrap();
        let card = p.played[0].1;
        let v = View::for_seat(&p, lead.other());
        assert!(v.seen.contains(&card));
        assert_eq!(v.seen.len(), 8);
        assert_eq!(v.played, vec![(lead, card)]);
        assert_eq!(v.stack, vec![card]);
        assert_eq!(v.count, card.value());
        assert_eq!(v.opponent_cards, 3);
        let own = View::for_seat(&p, lead);
        assert_eq!(own.seen.len(), 7, "your own play is not news");
        assert_eq!(own.hand.len(), 3);
    }

    #[test]
    fn when_the_game_ends_the_view_keeps_exactly_the_hands_that_were_counted() {
        // Mutation audit 2026-08-29: the `Phase::Over` arm had no test, and its
        // `shown.len() + 1` revealed a hand nobody counted. Over shows what was
        // counted — no more — and a game won while pegging shows nothing.
        let mut s = play(&GameState::new(11), &[Move::Discard(3), Move::Discard(9)]);
        while s.phase() == Phase::Peg {
            let m = legal_moves(&s)[0];
            s = apply(&s, m).unwrap();
        }
        let nd = s.dealer().other();
        s.scores = [100, 100];
        s.scores[nd.idx()] = 120;
        let over = apply(&s, Move::Claim(1)).unwrap();
        assert_eq!(over.phase(), Phase::Over);
        for seat in [Seat::A, Seat::B] {
            let v = View::for_seat(&over, seat);
            assert_eq!(
                v.revealed.len(),
                1,
                "only the non-dealer's hand was counted"
            );
            assert!(v.revealed[0].graded.is_some());
            assert_eq!(v.revealed[0].owner, nd);
            assert!(v.outcome.is_some());
        }
        // won while pegging: no hand reached the table
        let mut pegging = play(&GameState::new(11), &[Move::Discard(3), Move::Discard(9)]);
        pegging.scores = [120, 120];
        let mut won = pegging.clone();
        while won.phase() == Phase::Peg {
            let m = legal_moves(&won)[0];
            won = apply(&won, m).unwrap();
        }
        assert_eq!(won.phase(), Phase::Over);
        assert!(View::for_seat(&won, Seat::A).revealed.is_empty());
    }

    #[test]
    fn at_the_show_hands_appear_in_order_and_the_crib_only_at_the_end() {
        let mut s = play(&GameState::new(11), &[Move::Discard(3), Move::Discard(9)]);
        while s.phase() == Phase::Peg {
            let m = legal_moves(&s)[0];
            s = apply(&s, m).unwrap();
        }
        assert_eq!(s.phase(), Phase::Show(ShowStep::NonDealer));
        let nd = s.dealer().other();
        let d = s.dealer();
        let v = View::for_seat(&s, d);
        assert_eq!(v.revealed.len(), 1);
        assert_eq!(v.revealed[0].owner, nd);
        assert_eq!(v.revealed[0].cards, s.kept[nd.idx()]);
        assert_eq!(v.revealed[0].graded, None);
        let crib_leak = cards_in_json(&v)
            .iter()
            .any(|c| s.crib.contains(c) && !s.thrown_by(d).contains(c));
        assert!(!crib_leak, "the crib is face down until its turn");

        let s2 = apply(&s, Move::Claim(0)).unwrap();
        let v = View::for_seat(&s2, nd);
        assert_eq!(v.revealed.len(), 2);
        assert!(v.revealed[0].graded.is_some());
        assert_eq!(v.revealed[1].owner, d);
        assert_eq!(v.revealed[1].cards, s2.kept[d.idx()]);

        let s3 = apply(&s2, Move::Claim(0)).unwrap();
        let v = View::for_seat(&s3, nd);
        assert_eq!(v.revealed.len(), 3);
        assert_eq!(v.revealed[2].step, ShowStep::Crib);
        assert_eq!(v.revealed[2].cards, s3.crib);

        // the next deal starts clean
        let s4 = apply(&s3, Move::Claim(0)).unwrap();
        assert_eq!(s4.deal_no(), 2);
        let v = View::for_seat(&s4, nd);
        assert!(v.revealed.is_empty());
        assert_eq!(v.cut, None);
        assert_eq!(v.played, vec![]);
    }
}
