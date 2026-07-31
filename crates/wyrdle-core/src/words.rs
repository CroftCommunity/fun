//! The embedded, license-clean word lists + the seed->answer map.
//!
//! `allowed` is every legal 5-letter guess (sorted); `answers` is the curated
//! common answer pool (frequency-ordered). Both are committed under `data/` and
//! embedded at compile time (see `games/wyrdle/PROVENANCE.md` for sources and
//! licences). The answer for a seed is `answers[seed % answers.len()]` — a pure
//! integer map, no RNG, so replay is exact.

use std::sync::OnceLock;

use crate::word::Word;

static ALLOWED_RAW: &str = include_str!("../data/allowed.txt");
static ANSWERS_RAW: &str = include_str!("../data/answers.txt");

fn parse(raw: &str) -> Vec<Word> {
    raw.lines()
        .filter(|l| !l.is_empty())
        .map(|l| {
            // The data files are validated 5-letter a-z by tools/build-wordlists.mjs
            // and committed, so a malformed line is a build-data corruption, not a
            // runtime condition.
            Word::try_from(l).expect("embedded word data is validated 5-letter a-z")
        })
        .collect()
}

fn allowed() -> &'static [Word] {
    static CELL: OnceLock<Vec<Word>> = OnceLock::new();
    CELL.get_or_init(|| parse(ALLOWED_RAW))
}

fn answers() -> &'static [Word] {
    static CELL: OnceLock<Vec<Word>> = OnceLock::new();
    CELL.get_or_init(|| parse(ANSWERS_RAW))
}

/// Whether `word` is a legal guess (present in the allowed list). `allowed.txt`
/// is sorted lexicographically, which — because `a-z` maps order-preserving to
/// `0..26` — is the same order as the letter-index arrays, so a binary search is
/// correct.
#[must_use]
pub fn is_allowed(word: &Word) -> bool {
    allowed().binary_search_by(|w| w.0.cmp(&word.0)).is_ok()
}

/// The answer for `seed`: `answers[seed % answers.len()]`. Pure integer map.
#[must_use]
pub fn answer_for(seed: u64) -> Word {
    let a = answers();
    a[(seed % a.len() as u64) as usize]
}

/// The size of the answer pool (the seed->answer modulus).
#[must_use]
pub fn answers_len() -> usize {
    answers().len()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_embed_and_parse() {
        assert_eq!(allowed().len(), 15922, "allowed list embeds");
        assert_eq!(answers().len(), 1500, "answers list embeds");
    }

    #[test]
    fn allowed_is_sorted_for_binary_search() {
        let a = allowed();
        assert!(a.windows(2).all(|w| w[0].0 <= w[1].0), "allowed is sorted");
    }

    #[test]
    fn every_answer_is_allowed() {
        for w in answers() {
            assert!(is_allowed(w), "answer {w} must be a legal guess");
        }
    }

    #[test]
    fn is_allowed_accepts_real_words_rejects_nonwords() {
        assert!(is_allowed(&Word::try_from("crane").expect("valid")));
        assert!(!is_allowed(&Word::try_from("zzzzz").expect("valid")));
    }

    #[test]
    fn answer_for_wraps_at_pool_size() {
        let n = answers_len() as u64;
        assert_eq!(answer_for(0), answer_for(n), "seed wraps at the pool size");
        assert_eq!(answer_for(3), answer_for(n + 3));
    }
}
