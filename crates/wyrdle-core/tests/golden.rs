//! Golden vectors for the guess-pattern engine + the state hash (W1).
//!
//! The pattern expectations are derived by hand (see the comments) — the
//! canonical duplicate-letter cases are the classic Wordle scoring bug, so they
//! are pinned explicitly. The state-hash goldens are regression anchors: a change
//! that alters the canonical encoding flips them.

use wyrdle_core::pattern::Mark::{Absent, Correct, Present};
use wyrdle_core::{score, state_hash, Word};

fn w(s: &str) -> Word {
    Word::try_from(s).expect("valid 5-letter word")
}

#[test]
fn duplicate_letters_score_by_remaining_count() {
    // answer ALLOY, guess LOLLY:
    //   pos2 L==L correct; pos4 Y==Y correct.
    //   remaining answer letters {A, L, O}; guess non-greens L,O,L:
    //   L->present (consume), O->present (consume), L->absent (none left).
    assert_eq!(
        score(&w("alloy"), &w("lolly")),
        [Present, Present, Correct, Absent, Correct],
    );

    // answer ABBEY, guess KEBAB:
    //   pos2 B==B correct; remaining {A, B, E, Y}; guess non-greens K,E,A,B:
    //   K->absent, E->present, A->present, B->present.
    assert_eq!(
        score(&w("abbey"), &w("kebab")),
        [Absent, Present, Correct, Present, Present],
    );
}

#[test]
fn all_correct_and_all_absent() {
    assert_eq!(score(&w("there"), &w("there")), [Correct; 5]);
    // GHOST vs AMPLY share no letters.
    assert_eq!(score(&w("ghost"), &w("amply")), [Absent; 5]);
}

#[test]
fn present_only_when_letter_exists() {
    // answer CRANE, guess PLUMB: none of P,L,U,M,B is in CRANE.
    assert_eq!(score(&w("crane"), &w("plumb")), [Absent; 5]);
    // answer CRANE, guess NACRE: anagram-ish — N present, A present, C present,
    //   R present, E correct. (only E is in position.)
    //   C R A N E
    //   N A C R E
    //   pos4 E==E correct; remaining {C,R,A,N}; N->present,A->present,C->present,R->present
    assert_eq!(
        score(&w("crane"), &w("nacre")),
        [Present, Present, Present, Present, Correct],
    );
}

#[test]
fn state_hash_is_pinned_and_position_sensitive() {
    let answer = w("there");
    let guesses = [w("about"), w("think"), w("there")];
    let h = state_hash(&answer, &guesses);
    assert_eq!(h.len(), 64, "sha-256 lowercase hex");
    // Regression anchor (captured from the reference implementation):
    assert_eq!(
        h, "eda37ee58a83c11ac734b0dccc38b64e30274aeb04f5b9fbea0c3ec27558c14d",
        "canonical state-hash encoding is stable",
    );

    // A one-guess change flips the hash.
    let other = [w("about"), w("think"), w("their")];
    assert_ne!(
        state_hash(&answer, &other),
        h,
        "a different guess -> different hash"
    );
    // An empty game and a played game differ.
    assert_ne!(state_hash(&answer, &[]), h);
}
