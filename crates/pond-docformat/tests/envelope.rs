//! The version-and-unknown-field policy, exercised through the public API and
//! against a committed fixture (the P10 compatibility-matrix seed).

use std::fs;
use std::path::PathBuf;

use pond_docformat::{read, read_as, write, DocError};
use serde::{Deserialize, Serialize};

#[derive(Debug, PartialEq, Serialize, Deserialize)]
struct Save {
    game: String,
    seed: u64,
}

fn fixture(name: &str) -> Vec<u8> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("fixtures")
        .join(name);
    fs::read(path).expect("fixture readable")
}

#[test]
fn write_then_read_as_round_trips() {
    let bytes = write(
        "save",
        1,
        &Save {
            game: "solitaire".into(),
            seed: 7,
        },
    )
    .unwrap();
    let got: Save = read_as(&bytes, "save", 1).unwrap();
    assert_eq!(
        got,
        Save {
            game: "solitaire".into(),
            seed: 7
        }
    );
}

#[test]
fn committed_v1_fixture_loads_under_current_code() {
    // Backward tolerance: an older on-disk version loads when the caller
    // supports up to a newer max.
    let got: Save = read_as(&fixture("save-v1.json"), "save", 2).unwrap();
    assert_eq!(got.game, "solitaire");
    assert_eq!(got.seed, 42);
}

#[test]
fn unknown_payload_fields_are_preserved_not_dropped() {
    // The fixture carries a `note` field that `Save` does not model. The
    // envelope preserves it verbatim (policy: never silently dropped).
    let doc = read(&fixture("save-v1.json")).unwrap();
    assert_eq!(
        doc.payload.get("note").and_then(|v| v.as_str()),
        Some("a committed v1 fixture — the P10 compatibility-matrix seed",)
    );
    // ...and typed extraction still works, ignoring the unmodeled field.
    let got: Save = read_as(&fixture("save-v1.json"), "save", 1).unwrap();
    assert_eq!(got.seed, 42);
}

#[test]
fn newer_version_than_supported_fails_loud() {
    let bytes = write(
        "save",
        3,
        &Save {
            game: "solitaire".into(),
            seed: 1,
        },
    )
    .unwrap();
    let err = read_as::<Save>(&bytes, "save", 2).unwrap_err();
    assert_eq!(
        err,
        DocError::UnsupportedVersion {
            kind: "save".into(),
            found: 3,
            max: 2
        }
    );
}

#[test]
fn wrong_kind_is_rejected() {
    let bytes = write(
        "outcome",
        1,
        &Save {
            game: "solitaire".into(),
            seed: 1,
        },
    )
    .unwrap();
    let err = read_as::<Save>(&bytes, "save", 1).unwrap_err();
    assert_eq!(
        err,
        DocError::WrongKind {
            expected: "save".into(),
            found: "outcome".into()
        }
    );
}

#[test]
fn malformed_bytes_error_cleanly() {
    assert!(matches!(read(b"not json"), Err(DocError::Malformed(_))));
}
