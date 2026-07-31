//! Guess scoring — the per-letter correct / present / absent pattern.
//!
//! [`score`] implements the standard Wordle-family two-pass algorithm so
//! repeated letters are handled correctly: pass 1 marks exact-position matches
//! `Correct` and tallies the answer's remaining (non-green) letters; pass 2 marks
//! a non-green guess letter `Present` iff that letter still has a remaining tally
//! (decrementing it), else `Absent`. This is what makes `LOLLY` against `ALLOY`
//! score only as many `L`s as the answer actually has left.

use crate::word::{Word, WORD_LEN};

/// A single letter's result in a scored guess.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Mark {
    /// The letter is not in the answer (given letters already accounted for).
    Absent,
    /// The letter is in the answer, but not at this position.
    Present,
    /// The letter is at this exact position.
    Correct,
}

impl Mark {
    /// The classic emoji square for a share grid.
    #[must_use]
    pub fn emoji(self) -> char {
        match self {
            Mark::Correct => '🟩',
            Mark::Present => '🟨',
            Mark::Absent => '⬛',
        }
    }

    /// A colour-blind-safe text label (never rely on colour alone).
    #[must_use]
    pub fn label(self) -> &'static str {
        match self {
            Mark::Correct => "correct",
            Mark::Present => "present",
            Mark::Absent => "absent",
        }
    }
}

/// Score `guess` against `answer` into a per-position [`Mark`] array.
#[must_use]
pub fn score(answer: &Word, guess: &Word) -> [Mark; WORD_LEN] {
    let mut marks = [Mark::Absent; WORD_LEN];
    let mut remaining = [0u8; 26];

    // Pass 1: exact-position matches are Correct; tally the answer's other letters.
    for i in 0..WORD_LEN {
        if guess.0[i] == answer.0[i] {
            marks[i] = Mark::Correct;
        } else {
            remaining[answer.0[i] as usize] += 1;
        }
    }

    // Pass 2: a non-green guess letter is Present iff the answer still has one
    // left to account for (consume it), else Absent.
    for (mark, &g) in marks.iter_mut().zip(guess.0.iter()) {
        if *mark == Mark::Correct {
            continue;
        }
        let letter = g as usize;
        if remaining[letter] > 0 {
            *mark = Mark::Present;
            remaining[letter] -= 1;
        }
    }

    marks
}
