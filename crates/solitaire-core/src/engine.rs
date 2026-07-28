//! The legal-move engine: `play_move` (T1–T5) + `legal_moves`, implementing
//! RULES.md → "Moves and the turn" verbatim.

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::board::{GameState, TableauCard};
use crate::card::Card;

/// A move. See RULES.md → "Legal-move predicates (the tie-break tables)".
///
/// `Draw` covers both drawing one stock card to the waste and, when the stock
/// is empty, recycling the waste back into the stock.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub enum Move {
    /// T1 — draw one stock card to the waste, or recycle the waste when the
    /// stock is empty.
    Draw,
    /// T2 — move the waste's top card to its suit foundation.
    WasteToFoundation,
    /// T3 — move the waste's top card onto a tableau pile.
    WasteToTableau {
        /// Destination tableau pile `0..7`.
        pile: usize,
    },
    /// T4 — move a tableau pile's top card to its suit foundation.
    TableauToFoundation {
        /// Source tableau pile `0..7`.
        pile: usize,
    },
    /// T5 — move the top `count` face-up cards of one tableau pile onto another.
    TableauToTableau {
        /// Source pile `0..7`.
        from: usize,
        /// Number of face-up cards moved (a valid descending, alternating run).
        count: usize,
        /// Destination pile `0..7`.
        to: usize,
    },
}

/// Why a move was rejected. Illegal moves leave the state unchanged.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum MoveError {
    /// The move's legality predicate did not hold in the current state.
    #[error("move is not legal in the current state")]
    Illegal,
    /// A pile index was out of range (`>= 7`).
    #[error("tableau pile index {0} out of range")]
    BadPile(usize),
}

/// Foundation-build rule (RULES.md): `c` may go to its suit foundation iff the
/// foundation is empty and `c` is an Ace, or `c` is one rank above the top.
fn foundation_accepts(foundations: &[u8; 4], c: Card) -> bool {
    let top = foundations[c.suit as usize];
    if top == 0 {
        c.rank == 1
    } else {
        c.rank == top + 1
    }
}

/// Tableau-build rule (RULES.md): onto an empty pile only a King; otherwise
/// onto a face-up top of the opposite colour and one rank higher.
fn tableau_accepts(pile: &[TableauCard], c: Card) -> bool {
    match pile.last() {
        None => c.rank == 13,
        Some(d) => d.face_up && d.card.color() != c.color() && c.rank + 1 == d.card.rank,
    }
}

/// Is `run` (bottom→top) a valid descending, alternating-colour, all-face-up run?
fn is_valid_run(run: &[TableauCard]) -> bool {
    if run.iter().any(|tc| !tc.face_up) {
        return false;
    }
    run.windows(2).all(|w| {
        let (deeper, shallower) = (&w[0], &w[1]);
        deeper.card.rank == shallower.card.rank + 1 && deeper.card.color() != shallower.card.color()
    })
}

/// Length of the maximal movable run (valid, face-up) at the top of `pile`.
fn top_run_len(pile: &[TableauCard]) -> usize {
    if pile.last().is_none_or(|t| !t.face_up) {
        return 0;
    }
    let mut len = 1;
    while len < pile.len() {
        let shallower = &pile[pile.len() - len];
        let deeper = &pile[pile.len() - len - 1];
        if deeper.face_up
            && deeper.card.rank == shallower.card.rank + 1
            && deeper.card.color() != shallower.card.color()
        {
            len += 1;
        } else {
            break;
        }
    }
    len
}

impl GameState {
    /// Apply `mv` if legal; otherwise return an error and leave the state
    /// unchanged. See RULES.md for each move's predicate.
    ///
    /// # Errors
    /// [`MoveError::BadPile`] for an out-of-range pile index; [`MoveError::Illegal`]
    /// if the move's legality predicate does not hold.
    pub fn play_move(&mut self, mv: Move) -> Result<(), MoveError> {
        match mv {
            Move::Draw => self.do_draw(),
            Move::WasteToFoundation => self.do_waste_to_foundation(),
            Move::WasteToTableau { pile } => self.do_waste_to_tableau(pile),
            Move::TableauToFoundation { pile } => self.do_tableau_to_foundation(pile),
            Move::TableauToTableau { from, count, to } => {
                self.do_tableau_to_tableau(from, count, to)
            }
        }
    }

    /// The legal moves in the current state, in the canonical order (RULES.md →
    /// "Move-ordering / determinism notes"). The UI highlights from this list.
    #[must_use]
    pub fn legal_moves(&self) -> Vec<Move> {
        let mut moves = Vec::new();
        // T1 Draw (draw or recycle).
        if !self.stock.is_empty() || !self.waste.is_empty() {
            moves.push(Move::Draw);
        }
        // T2 Waste -> Foundation.
        if let Some(&c) = self.waste.last() {
            if foundation_accepts(&self.foundations, c) {
                moves.push(Move::WasteToFoundation);
            }
        }
        // T4 Tableau -> Foundation, piles 0..7.
        for (pile, cards) in self.tableau.iter().enumerate() {
            if let Some(tc) = cards.last() {
                if tc.face_up && foundation_accepts(&self.foundations, tc.card) {
                    moves.push(Move::TableauToFoundation { pile });
                }
            }
        }
        // T3 Waste -> Tableau, piles 0..7.
        if let Some(&c) = self.waste.last() {
            for (pile, cards) in self.tableau.iter().enumerate() {
                if tableau_accepts(cards, c) {
                    moves.push(Move::WasteToTableau { pile });
                }
            }
        }
        // T5 Tableau -> Tableau, by from, then count ascending, then to.
        for from in 0..self.tableau.len() {
            let n = self.tableau[from].len();
            let maxrun = top_run_len(&self.tableau[from]);
            for count in 1..=maxrun {
                let bottom = self.tableau[from][n - count].card;
                for to in 0..self.tableau.len() {
                    if to != from && tableau_accepts(&self.tableau[to], bottom) {
                        moves.push(Move::TableauToTableau { from, count, to });
                    }
                }
            }
        }
        moves
    }

    fn do_draw(&mut self) -> Result<(), MoveError> {
        if let Some(c) = self.stock.pop() {
            self.waste.push(c);
            Ok(())
        } else if !self.waste.is_empty() {
            // Recycle: waste returns to stock reversed (next draw = old bottom).
            self.stock = self.waste.iter().rev().copied().collect();
            self.waste.clear();
            Ok(())
        } else {
            Err(MoveError::Illegal)
        }
    }

    fn do_waste_to_foundation(&mut self) -> Result<(), MoveError> {
        let &c = self.waste.last().ok_or(MoveError::Illegal)?;
        if !foundation_accepts(&self.foundations, c) {
            return Err(MoveError::Illegal);
        }
        self.waste.pop();
        self.foundations[c.suit as usize] = c.rank;
        Ok(())
    }

    fn do_waste_to_tableau(&mut self, pile: usize) -> Result<(), MoveError> {
        let dest = self.tableau.get(pile).ok_or(MoveError::BadPile(pile))?;
        let &c = self.waste.last().ok_or(MoveError::Illegal)?;
        if !tableau_accepts(dest, c) {
            return Err(MoveError::Illegal);
        }
        self.waste.pop();
        self.tableau[pile].push(TableauCard {
            card: c,
            face_up: true,
        });
        Ok(())
    }

    fn do_tableau_to_foundation(&mut self, pile: usize) -> Result<(), MoveError> {
        let src = self.tableau.get(pile).ok_or(MoveError::BadPile(pile))?;
        let tc = *src.last().ok_or(MoveError::Illegal)?;
        if !tc.face_up || !foundation_accepts(&self.foundations, tc.card) {
            return Err(MoveError::Illegal);
        }
        self.tableau[pile].pop();
        self.foundations[tc.card.suit as usize] = tc.card.rank;
        self.auto_flip(pile);
        Ok(())
    }

    fn do_tableau_to_tableau(
        &mut self,
        from: usize,
        count: usize,
        to: usize,
    ) -> Result<(), MoveError> {
        if from >= self.tableau.len() {
            return Err(MoveError::BadPile(from));
        }
        if to >= self.tableau.len() {
            return Err(MoveError::BadPile(to));
        }
        if from == to || count == 0 || count > self.tableau[from].len() {
            return Err(MoveError::Illegal);
        }
        let n = self.tableau[from].len();
        let run = &self.tableau[from][n - count..];
        if !is_valid_run(run) || !tableau_accepts(&self.tableau[to], run[0].card) {
            return Err(MoveError::Illegal);
        }
        let moved = self.tableau[from].split_off(n - count);
        self.tableau[to].extend(moved);
        self.auto_flip(from);
        Ok(())
    }

    /// After removing cards from a tableau pile, flip its new top face-up if it
    /// is face-down (RULES.md auto-flip; consumes no RNG).
    fn auto_flip(&mut self, pile: usize) {
        if let Some(top) = self.tableau[pile].last_mut() {
            top.face_up = true;
        }
    }
}
