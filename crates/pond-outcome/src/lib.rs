//! P8 — the verifiable-outcome record (shared substrate).
//!
//! An outcome is `(kind, seed, move list)` replayed through the game core: the
//! record carries the resulting `state_hash`, so **anyone re-verifies it by
//! replaying** — [`verify`] re-runs the core and never trusts a stored field.
//!
//! Game-agnostic: a game implements [`Game`] (replay `(seed, moves)` → final
//! hash + won). `assistance` is a **self-declared** meta-fact (undo/hint use
//! cannot be derived from a winning move list, which is clean by construction),
//! so [`verify`] proves the *deal was cleared legitimately*, while `assistance`
//! and a non-`Won` `result` are declared metadata. Records serialize through
//! [`pond_docformat`]. Local only — the follow-chain leaderboard that reads
//! these is out of scope and gated.

use serde::{de::DeserializeOwned, Deserialize, Serialize};

/// A game whose outcomes can be attested and verified.
pub trait Game {
    /// The game's move type (serialized into the record).
    type Move: Serialize + DeserializeOwned + Clone;
    /// Document kind, e.g. `"solitaire"`.
    const KIND: &'static str;
    /// Record schema version (for `pond-docformat`).
    const VERSION: u32;
    /// Replay `(seed, moves)` and report the final state hash and whether won.
    fn replay(seed: u64, moves: &[Self::Move]) -> Replayed;
}

/// The result of replaying a game to its end state.
#[derive(Debug, Clone)]
pub struct Replayed {
    /// The canonical `state_hash` of the final state.
    pub final_hash: String,
    /// Whether the final state is a win.
    pub won: bool,
    /// A score-based game's final score (folded into the record for display /
    /// comparison; still re-derived by replay). `None` for win/lose games.
    pub score: Option<u64>,
    /// Stars earned (0–3), for graded score games. `None` when not graded.
    pub stars: Option<u8>,
}

impl Replayed {
    /// A win/lose replay result (no score).
    #[must_use]
    pub fn new(final_hash: String, won: bool) -> Self {
        Self {
            final_hash,
            won,
            score: None,
            stars: None,
        }
    }

    /// A score-graded replay result.
    #[must_use]
    pub fn scored(final_hash: String, won: bool, score: u64, stars: u8) -> Self {
        Self {
            final_hash,
            won,
            score: Some(score),
            stars: Some(stars),
        }
    }
}

/// How a game ended. `Won` is verifiable (replay + the game's win check);
/// `Stuck` / `Abandoned` are declared metadata; `Lost` is a completed run that
/// did not meet its goal (e.g. a Trio Tumble move budget spent under target — also
/// verifiable by replay).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Outcome {
    /// The game was won.
    Won,
    /// The player declared the deal stuck / unwinnable from here.
    Stuck,
    /// The game was left unfinished.
    Abandoned,
    /// The game ran to completion without meeting its goal.
    Lost,
}

/// A self-checking outcome record. `verify` re-derives `final_hash` by replay.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Record<M> {
    /// Game kind.
    pub kind: String,
    /// The seed the deal was dealt from.
    pub seed: u64,
    /// The full move list (the proof — replayed to re-derive the hash).
    pub moves: Vec<M>,
    /// `moves.len()` — the compare metric (fewer = better).
    pub move_count: usize,
    /// The canonical `state_hash` of the final state.
    pub final_hash: String,
    /// How the game ended.
    pub result: Outcome,
    /// Self-declared assistance (undo/hints): `Some(false)` = none declared,
    /// `Some(true)` = assistance declared, `None` = declaration opted out.
    pub assistance: Option<bool>,
    /// Final score for a score-based game (omitted for win/lose games).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub score: Option<u64>,
    /// Stars earned (0–3) for a graded game (omitted otherwise).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stars: Option<u8>,
}

/// The result of verifying a record: whether it holds, with the expected vs
/// actual hash for diagnosing a tamper/regression.
#[derive(Debug, Clone)]
pub struct Verification {
    /// Whether the record verified.
    pub ok: bool,
    /// The hash stored in the record.
    pub expected: String,
    /// The hash re-derived by replay.
    pub actual: String,
}

/// Attest an outcome: replay `(seed, moves)` and build the record. `result` is
/// `Won` if the replay is a win, else `if_unfinished` (`Stuck` or `Abandoned`).
#[must_use]
pub fn attest<G: Game>(
    seed: u64,
    moves: Vec<G::Move>,
    if_unfinished: Outcome,
    assistance: Option<bool>,
) -> Record<G::Move> {
    let replayed = G::replay(seed, &moves);
    let result = if replayed.won {
        Outcome::Won
    } else {
        if_unfinished
    };
    Record {
        kind: G::KIND.to_owned(),
        seed,
        move_count: moves.len(),
        moves,
        final_hash: replayed.final_hash,
        result,
        assistance,
        score: replayed.score,
        stars: replayed.stars,
    }
}

/// Re-verify a record by replaying it — **never** trusts the stored hash. For a
/// `Won` record, also asserts the replay is actually a win.
#[must_use]
pub fn verify<G: Game>(record: &Record<G::Move>) -> Verification {
    let replayed = G::replay(record.seed, &record.moves);
    let hash_ok = replayed.final_hash == record.final_hash;
    let result_ok = record.result != Outcome::Won || replayed.won;
    Verification {
        ok: hash_ok && result_ok,
        expected: record.final_hash.clone(),
        actual: replayed.final_hash,
    }
}

/// A clean clear: won without declared assistance (the count metric leads with
/// this). `None` (declaration opted out) is not a clean clear.
#[must_use]
pub fn clean_clear<M>(record: &Record<M>) -> bool {
    record.result == Outcome::Won && record.assistance == Some(false)
}

/// Serialize a record through the `pond-docformat` envelope.
///
/// # Errors
/// Propagates [`pond_docformat::DocError`] on a serialization failure.
pub fn to_doc<G: Game>(record: &Record<G::Move>) -> Result<Vec<u8>, pond_docformat::DocError> {
    pond_docformat::write(G::KIND, G::VERSION, record)
}

/// Read a record from a `pond-docformat` envelope (kind + version checked).
///
/// # Errors
/// Propagates [`pond_docformat::DocError`] on a malformed / wrong-kind /
/// unsupported-version document.
pub fn from_doc<G: Game>(bytes: &[u8]) -> Result<Record<G::Move>, pond_docformat::DocError> {
    pond_docformat::read_as::<Record<G::Move>>(bytes, G::KIND, G::VERSION)
}
