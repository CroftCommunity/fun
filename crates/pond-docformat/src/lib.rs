//! P2 — the version-and-unknown-field document policy (shared substrate).
//!
//! One versioned, forward-tolerant serialization envelope for every durable
//! pond document (saves, deal/level codes, outcome records):
//!
//! ```json
//! { "kind": "save", "version": 1, "payload": { ... } }
//! ```
//!
//! **Policy (the actual deliverable):**
//! - Each document is tagged with `kind` + `version`.
//! - The envelope preserves the payload verbatim as a [`serde_json::Value`], so
//!   **unknown fields are never silently dropped** at the envelope layer — a
//!   raw [`read`] round-trips them. Typed extraction ([`read_as`]) is a separate,
//!   caller-driven step.
//! - Reading a document whose `version` exceeds the caller's `max_version` is a
//!   **loud, typed error** ([`DocError::UnsupportedVersion`]) — never a silent
//!   fallback. Older versions within range load (forward/backward tolerance is
//!   the caller's migration concern on the typed payload).
//!
//! A per-`(kind, version)` fixture is committed under `fixtures/` — the seed of
//! the P10 compatibility matrix.

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

/// A versioned pond document. `payload` is preserved verbatim (nothing dropped).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Doc {
    /// Document kind, e.g. `"save"`, `"outcome"`, `"deal-pack"`.
    pub kind: String,
    /// Schema version for `kind`.
    pub version: u32,
    /// The document body, preserved as raw JSON until typed extraction.
    pub payload: serde_json::Value,
}

/// Why a document could not be read.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum DocError {
    /// The bytes were not a well-formed envelope / payload.
    #[error("malformed document: {0}")]
    Malformed(String),
    /// The document's `kind` was not the one the caller expected.
    #[error("wrong kind: expected `{expected}`, found `{found}`")]
    WrongKind {
        /// The kind the caller asked for.
        expected: String,
        /// The kind actually found in the document.
        found: String,
    },
    /// The document's `version` exceeds what the caller supports (fail-loud).
    #[error("unsupported version {found} for kind `{kind}` (max supported {max})")]
    UnsupportedVersion {
        /// The document kind.
        kind: String,
        /// The version found in the document.
        found: u32,
        /// The highest version the caller supports.
        max: u32,
    },
}

/// Serialize `payload` into a tagged envelope. `version` is the schema version
/// the caller is writing.
///
/// # Errors
/// [`DocError::Malformed`] if `payload` cannot be serialized to JSON.
pub fn write<T: Serialize>(kind: &str, version: u32, payload: &T) -> Result<Vec<u8>, DocError> {
    let doc = Doc {
        kind: kind.to_owned(),
        version,
        payload: serde_json::to_value(payload).map_err(|e| DocError::Malformed(e.to_string()))?,
    };
    serde_json::to_vec(&doc).map_err(|e| DocError::Malformed(e.to_string()))
}

/// Parse the envelope, preserving the payload verbatim. Performs no version or
/// kind checks — use [`read_as`] for typed, policy-checked extraction.
///
/// # Errors
/// [`DocError::Malformed`] if `bytes` is not a well-formed envelope.
pub fn read(bytes: &[u8]) -> Result<Doc, DocError> {
    serde_json::from_slice(bytes).map_err(|e| DocError::Malformed(e.to_string()))
}

/// Read a document, enforcing the policy: the `kind` must match, and the
/// `version` must be `<= max_version` (else a loud [`DocError::UnsupportedVersion`]).
/// On success, the payload is deserialized into `T`.
///
/// # Errors
/// [`DocError::Malformed`], [`DocError::WrongKind`], or
/// [`DocError::UnsupportedVersion`] per the policy above.
pub fn read_as<T: DeserializeOwned>(
    bytes: &[u8],
    kind: &str,
    max_version: u32,
) -> Result<T, DocError> {
    let doc = read(bytes)?;
    if doc.kind != kind {
        return Err(DocError::WrongKind {
            expected: kind.to_owned(),
            found: doc.kind,
        });
    }
    if doc.version > max_version {
        return Err(DocError::UnsupportedVersion {
            kind: doc.kind,
            found: doc.version,
            max: max_version,
        });
    }
    serde_json::from_value(doc.payload).map_err(|e| DocError::Malformed(e.to_string()))
}
