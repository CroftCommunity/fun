//! The `Word` newtype — a fixed-length lowercase word as letter indices.
//!
//! A [`Word`] is `WORD_LEN` letters, each stored as a `0..26` index (`a`=0). It
//! is the game's move type (a guess) and the answer type, and it serializes
//! to/from a lowercase `a-z` string so an outcome record's `?r=` share stays
//! compact and human-readable.

use std::fmt;

use serde::{de, Deserialize, Deserializer, Serialize, Serializer};

/// The word length for the default mode (5-letter words).
pub const WORD_LEN: usize = 5;

/// A `WORD_LEN`-letter word as `0..26` letter indices (`a`=0 … `z`=25).
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub struct Word(pub [u8; WORD_LEN]);

/// Why a string could not be parsed into a [`Word`].
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum WordError {
    /// The string was not exactly `WORD_LEN` bytes.
    #[error("word must be exactly {WORD_LEN} letters")]
    WrongLength,
    /// The string contained a byte outside ASCII lowercase `a-z`.
    #[error("word must be ascii lowercase a-z")]
    NotAlpha,
}

impl Word {
    /// The letter indices (`0..26`).
    #[must_use]
    pub fn letters(&self) -> &[u8; WORD_LEN] {
        &self.0
    }

    /// The word as a lowercase `a-z` string.
    #[must_use]
    pub fn as_string(&self) -> String {
        self.0.iter().map(|&b| char::from(b'a' + b)).collect()
    }
}

impl TryFrom<&str> for Word {
    type Error = WordError;

    fn try_from(s: &str) -> Result<Self, WordError> {
        let bytes = s.as_bytes();
        if bytes.len() != WORD_LEN {
            return Err(WordError::WrongLength);
        }
        let mut out = [0u8; WORD_LEN];
        for (slot, &b) in out.iter_mut().zip(bytes.iter()) {
            if !b.is_ascii_lowercase() {
                return Err(WordError::NotAlpha);
            }
            *slot = b - b'a';
        }
        Ok(Word(out))
    }
}

impl fmt::Display for Word {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.as_string())
    }
}

impl Serialize for Word {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.as_string())
    }
}

impl<'de> Deserialize<'de> for Word {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let s = String::deserialize(d)?;
        Word::try_from(s.as_str()).map_err(de::Error::custom)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_lowercase() {
        let w = Word::try_from("there").expect("valid");
        assert_eq!(w.0, [19, 7, 4, 17, 4]);
        assert_eq!(w.as_string(), "there");
    }

    #[test]
    fn rejects_wrong_length_and_non_alpha() {
        assert_eq!(Word::try_from("cat"), Err(WordError::WrongLength));
        assert_eq!(Word::try_from("theree"), Err(WordError::WrongLength));
        assert_eq!(Word::try_from("THERE"), Err(WordError::NotAlpha));
        assert_eq!(Word::try_from("the1e"), Err(WordError::NotAlpha));
    }

    #[test]
    fn serde_is_a_bare_string() {
        let w = Word::try_from("crane").expect("valid");
        let json = serde_json::to_string(&w).expect("ser");
        assert_eq!(json, "\"crane\"");
        let back: Word = serde_json::from_str(&json).expect("de");
        assert_eq!(back, w);
    }
}
