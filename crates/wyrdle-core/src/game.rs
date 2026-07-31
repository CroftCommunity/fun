//! The `Game` play-loop and the verifiable-outcome binding.
//!
//! A `Game` holds the answer (derived from the seed) and the guesses played so
//! far. Because the answer is a pure function of the seed and a guess is a
//! [`Word`], a whole game replays exactly from `(seed, guesses)` — which is what
//! makes the outcome verifiable ([`Wyrdle`] implements [`pond_outcome::Game`]).
//! The answer is never exposed by this type before a win — the UI reads
//! per-guess patterns and the keyboard state, never the hidden word (spoiler
//! discipline).

use crate::hash::state_hash;
use crate::pattern::{score, Mark};
use crate::word::{Word, WORD_LEN};
use crate::words::{answer_for, is_allowed};
use crate::MAX_GUESSES;

/// Why a guess could not be played.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum GuessError {
    /// The guess is not in the allowed word list (the core decides legality).
    #[error("not a word in the allowed list")]
    NotAWord,
    /// The game is already won or lost — no further guesses are accepted.
    #[error("the game is already over")]
    GameOver,
}

/// A single daily word game: the hidden answer + the guesses played.
#[derive(Clone)]
pub struct Game {
    answer: Word,
    seed: u64,
    guesses: Vec<Word>,
}

impl Game {
    /// A game for `seed`. The answer is `answer_for(seed)` — no RNG.
    #[must_use]
    pub fn new(seed: u64) -> Self {
        Self {
            answer: answer_for(seed),
            seed,
            guesses: Vec::new(),
        }
    }

    /// The seed this game was dealt from (the outcome proof carries it).
    #[must_use]
    pub fn seed(&self) -> u64 {
        self.seed
    }

    /// The guesses played so far (the outcome proof passed to `attest`).
    #[must_use]
    pub fn guesses(&self) -> &[Word] {
        &self.guesses
    }

    /// Guesses remaining in the budget.
    #[must_use]
    pub fn guesses_left(&self) -> usize {
        MAX_GUESSES.saturating_sub(self.guesses.len())
    }

    /// The board is solved — the most recent guess is the answer.
    #[must_use]
    pub fn is_won(&self) -> bool {
        self.guesses.last().is_some_and(|g| *g == self.answer)
    }

    /// The budget is spent and the answer was not found.
    #[must_use]
    pub fn is_lost(&self) -> bool {
        self.guesses.len() >= MAX_GUESSES && !self.is_won()
    }

    /// The game has ended (won or lost).
    #[must_use]
    pub fn is_over(&self) -> bool {
        self.is_won() || self.is_lost()
    }

    /// The per-guess patterns, in play order (for rendering the grid).
    #[must_use]
    pub fn patterns(&self) -> Vec<[Mark; WORD_LEN]> {
        self.guesses
            .iter()
            .map(|g| score(&self.answer, g))
            .collect()
    }

    /// The best-known [`Mark`] for each letter `a..z` across all guesses
    /// (`Correct` > `Present` > `Absent` > unseen) — for colouring the keyboard.
    #[must_use]
    pub fn keyboard_state(&self) -> [Option<Mark>; 26] {
        fn rank(m: Mark) -> u8 {
            match m {
                Mark::Absent => 0,
                Mark::Present => 1,
                Mark::Correct => 2,
            }
        }
        let mut best: [Option<Mark>; 26] = [None; 26];
        for g in &self.guesses {
            let marks = score(&self.answer, g);
            for (m, &letter) in marks.iter().zip(g.0.iter()) {
                let slot = &mut best[letter as usize];
                if slot.is_none_or(|b| rank(*m) > rank(b)) {
                    *slot = Some(*m);
                }
            }
        }
        best
    }

    /// The canonical state hash — replay reproduces it exactly.
    #[must_use]
    pub fn current_hash(&self) -> String {
        state_hash(&self.answer, &self.guesses)
    }

    /// Play `guess`, returning its pattern.
    ///
    /// # Errors
    /// - `GameOver` if the game already ended (nothing changes).
    /// - `NotAWord` if `guess` is not in the allowed list (nothing changes) — so a
    ///   tampered non-word in a record is a no-op and diverges the state hash.
    pub fn play(&mut self, guess: Word) -> Result<[Mark; WORD_LEN], GuessError> {
        if self.is_over() {
            return Err(GuessError::GameOver);
        }
        if !is_allowed(&guess) {
            return Err(GuessError::NotAWord);
        }
        self.guesses.push(guess);
        Ok(score(&self.answer, &guess))
    }
}

/// The verifiable-outcome binding for the daily word game.
pub struct Wyrdle;

impl pond_outcome::Game for Wyrdle {
    type Move = Word;
    const KIND: &'static str = "wyrdle";
    const VERSION: u32 = 1;

    fn replay(seed: u64, moves: &[Word]) -> pond_outcome::Replayed {
        let mut game = Game::new(seed);
        for &guess in moves {
            // A tampered guess (a non-word, or one played after the game ended)
            // is a no-op, so the hash diverges from the honest game and
            // verification fails.
            let _ = game.play(guess);
        }
        pond_outcome::Replayed::new(game.current_hash(), game.is_won())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::words::answer_for;
    use pond_outcome::{attest, verify, Game as _, Outcome};

    fn w(s: &str) -> Word {
        Word::try_from(s).expect("valid 5-letter word")
    }

    /// Five allowed words that are not `answer` (drawn from other seeds' answers,
    /// which are all legal guesses), for building deterministic wrong-guess lines.
    fn wrong_guesses(answer: Word, seed: u64) -> Vec<Word> {
        let mut out = Vec::new();
        let mut i = 1u64;
        while out.len() < 5 {
            let g = answer_for(seed.wrapping_add(i).wrapping_mul(7919));
            if g != answer && !out.contains(&g) {
                out.push(g);
            }
            i += 1;
        }
        out
    }

    #[test]
    fn verify_roundtrip_holds_and_detects_tamper() {
        let seed = 7;
        let answer = answer_for(seed);
        let wrong = wrong_guesses(answer, seed);

        let mut g = Game::new(seed);
        g.play(wrong[0]).expect("allowed");
        g.play(wrong[1]).expect("allowed");
        g.play(answer).expect("the answer is allowed");
        assert!(g.is_won());

        let record = attest::<Wyrdle>(seed, g.guesses().to_vec(), Outcome::Abandoned, Some(false));
        assert_eq!(record.result, Outcome::Won, "a winning line attests as Won");
        assert!(verify::<Wyrdle>(&record).ok, "an honest record verifies");
        assert_eq!(record.score, None, "word game is win/lose, not scored");

        // Tampered final hash fails.
        let mut bad_hash = record.clone();
        bad_hash.final_hash = "0".repeat(64);
        assert!(!verify::<Wyrdle>(&bad_hash).ok, "a tampered hash fails");

        // Tampered move (swap the winning guess for a different word) fails.
        let mut bad_move = record.clone();
        bad_move.moves[2] = wrong[2];
        assert!(!verify::<Wyrdle>(&bad_move).ok, "a tampered move fails");
    }

    #[test]
    fn win_on_the_last_guess() {
        let seed = 42;
        let answer = answer_for(seed);
        let wrong = wrong_guesses(answer, seed);
        let mut g = Game::new(seed);
        for &word in &wrong {
            g.play(word).expect("allowed");
        }
        assert_eq!(g.guesses_left(), 1);
        assert!(!g.is_over());
        g.play(answer).expect("allowed");
        assert!(g.is_won(), "the sixth guess wins");
        assert!(!g.is_lost());
    }

    #[test]
    fn six_wrong_guesses_is_a_loss() {
        let seed = 100;
        let answer = answer_for(seed);
        let wrong = wrong_guesses(answer, seed);
        let mut g = Game::new(seed);
        for &word in &wrong {
            g.play(word).expect("allowed");
        }
        // A sixth wrong, allowed word.
        let sixth = answer_for(seed.wrapping_add(999).wrapping_mul(104_729));
        let sixth = if sixth == answer || wrong.contains(&sixth) {
            answer_for(seed.wrapping_add(1234).wrapping_mul(15_485_863))
        } else {
            sixth
        };
        g.play(sixth).expect("allowed");
        assert!(g.is_lost(), "six wrong guesses lose");
        assert!(!g.is_won());
    }

    #[test]
    fn play_after_game_over_is_rejected() {
        let seed = 3;
        let answer = answer_for(seed);
        let mut g = Game::new(seed);
        g.play(answer).expect("won in one");
        let before = g.current_hash();
        assert_eq!(g.play(answer), Err(GuessError::GameOver));
        assert_eq!(g.current_hash(), before, "a rejected guess changes nothing");
    }

    #[test]
    fn a_non_word_is_rejected_and_changes_nothing() {
        let mut g = Game::new(0);
        let before = g.current_hash();
        assert_eq!(g.play(w("zzzzz")), Err(GuessError::NotAWord));
        assert_eq!(g.current_hash(), before, "an illegal guess is a no-op");
    }

    #[test]
    fn replay_is_deterministic() {
        let seed = 55;
        let answer = answer_for(seed);
        let moves = vec![answer];
        let a = Wyrdle::replay(seed, &moves);
        let b = Wyrdle::replay(seed, &moves);
        assert_eq!(a.final_hash, b.final_hash);
        assert!(a.won);
        assert_eq!(a.score, None);
    }
}
