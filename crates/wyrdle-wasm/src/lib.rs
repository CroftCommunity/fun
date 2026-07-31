//! Browser binding over [`wyrdle_core`] for the games shelf — raw C-ABI +
//! serde-JSON, no `wasm-bindgen` (the same pattern as `bubble-wasm`).
//!
//! The module holds **one game** (one puzzle per tab): guess a hidden 5-letter
//! word within the budget. Input is tap-or-type — the host reads
//! [`is_allowed`] to reject non-words (the core decides legality), then calls
//! [`guess`] with the five letter indices. Reads (board / keyboard / hash /
//! outcome) are JSON written to one output buffer the host reads via the return
//! pointer + [`out_len`].
//!
//! **Never panics** (a wasm panic aborts the module): every fallible path maps
//! to a status code or an empty/`"null"` buffer. The hidden answer never crosses
//! the boundary — only per-guess patterns and the keyboard state do — so the UI
//! cannot leak it before a win.

use std::sync::OnceLock;

use pond_outcome::{attest, Outcome};
use serde::{Deserialize, Serialize};
use wyrdle_core::pattern::Mark;
use wyrdle_core::{Game, Word, Wyrdle, MAX_GUESSES, WORD_LEN};

// --- embedded answer daily-pack (W3) ----------

static PACK_JSON: &[u8] = include_bytes!("../../../games/wyrdle/daily-pack.json");

#[derive(Deserialize)]
struct PackPayload {
    seeds: Vec<u64>,
}
#[derive(Deserialize)]
struct PackEnvelope {
    payload: PackPayload,
}

/// The embedded daily seeds, parsed once. Never panics: a parse failure yields
/// an empty list (daily mode then falls back to seed 0 in the host).
fn daily_seeds() -> &'static [u64] {
    static SEEDS: OnceLock<Vec<u64>> = OnceLock::new();
    SEEDS
        .get_or_init(|| {
            serde_json::from_slice::<PackEnvelope>(PACK_JSON)
                .map(|e| e.payload.seeds)
                .unwrap_or_default()
        })
        .as_slice()
}

/// The daily seed for `day_index` — a seed from the baked pack. `0` if empty.
#[no_mangle]
pub extern "C" fn wyrdle_daily_seed(day_index: u32) -> u32 {
    let seeds = daily_seeds();
    if seeds.is_empty() {
        return 0;
    }
    u32::try_from(seeds[(day_index as usize) % seeds.len()]).unwrap_or(0)
}

// --- the held session ----------

struct Session {
    seed: u64,
    game: Game,
    assistance_used: bool,
}

static mut STATE: Option<Session> = None;
static mut OUT: Vec<u8> = Vec::new();

fn session_mut() -> Option<&'static mut Session> {
    // SAFETY: single-threaded wasm; host calls are sequential.
    unsafe { (*core::ptr::addr_of_mut!(STATE)).as_mut() }
}

fn set_out(bytes: Vec<u8>) -> *const u8 {
    // SAFETY: single-threaded; the host reads OUT (ptr + out_len) between calls.
    unsafe {
        let p = core::ptr::addr_of_mut!(OUT);
        (*p) = bytes;
        (*p).as_ptr()
    }
}

fn set_out_str(s: &str) -> *const u8 {
    set_out(s.as_bytes().to_vec())
}

/// Length in bytes of the last value written to the output buffer.
#[no_mangle]
pub extern "C" fn out_len() -> u32 {
    // SAFETY: single-threaded read of the static buffer's length.
    unsafe { u32::try_from((*core::ptr::addr_of!(OUT)).len()).unwrap_or(0) }
}

// --- lifecycle ----------

/// Start a fresh daily word game for `seed` (the answer is `seed % pool`).
#[no_mangle]
pub extern "C" fn new_game(seed_lo: u32, seed_hi: u32) {
    let seed = (u64::from(seed_hi) << 32) | u64::from(seed_lo);
    // SAFETY: single-threaded; replaces the held session.
    unsafe {
        *core::ptr::addr_of_mut!(STATE) = Some(Session {
            seed,
            game: Game::new(seed),
            assistance_used: false,
        });
    }
}

// --- helpers ----------

/// Build a [`Word`] from five letter indices, or `None` if any is out of range.
fn word_from(letters: [u32; WORD_LEN]) -> Option<Word> {
    let mut out = [0u8; WORD_LEN];
    for (slot, &l) in out.iter_mut().zip(letters.iter()) {
        *slot = u8::try_from(l).ok().filter(|&b| b < 26)?;
    }
    Some(Word(out))
}

fn mark_code(m: Mark) -> u8 {
    match m {
        Mark::Absent => 0,
        Mark::Present => 1,
        Mark::Correct => 2,
    }
}

// --- reads (JSON via the output buffer) ----------

#[derive(Serialize)]
struct GuessView {
    /// Letter indices `0..26`.
    letters: Vec<u8>,
    /// Per-position marks: `0` absent, `1` present, `2` correct.
    marks: Vec<u8>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BoardView {
    word_len: usize,
    max_guesses: usize,
    /// The guesses played so far, each with its pattern.
    guesses: Vec<GuessView>,
    /// Best-known mark per letter `a..z` (26 entries): `-1` unseen, else `0/1/2`.
    keyboard: Vec<i8>,
    won: bool,
    lost: bool,
    guesses_left: usize,
}

fn board_view(s: &Session) -> BoardView {
    let patterns = s.game.patterns();
    let guesses = s
        .game
        .guesses()
        .iter()
        .zip(patterns.iter())
        .map(|(w, marks)| GuessView {
            letters: w.0.to_vec(),
            marks: marks.iter().map(|&m| mark_code(m)).collect(),
        })
        .collect();
    let keyboard = s
        .game
        .keyboard_state()
        .iter()
        .map(|slot| slot.map_or(-1i8, |m| mark_code(m) as i8))
        .collect();
    BoardView {
        word_len: WORD_LEN,
        max_guesses: MAX_GUESSES,
        guesses,
        keyboard,
        won: s.game.is_won(),
        lost: s.game.is_lost(),
        guesses_left: s.game.guesses_left(),
    }
}

/// The current board + keyboard + won/lost as JSON. `"null"` if no game.
#[no_mangle]
pub extern "C" fn board_json() -> *const u8 {
    match session_mut() {
        Some(s) => match serde_json::to_vec(&board_view(s)) {
            Ok(bytes) => set_out(bytes),
            Err(_) => set_out_str("null"),
        },
        None => set_out_str("null"),
    }
}

/// The canonical `state_hash` of the current state (quoted JSON string).
#[no_mangle]
pub extern "C" fn current_hash() -> *const u8 {
    match session_mut() {
        Some(s) => set_out_str(&format!("\"{}\"", s.game.current_hash())),
        None => set_out_str("\"\""),
    }
}

/// `1` if the five letter indices form a word in the allowed list (a legal
/// guess) — the UI asks before submitting; legality lives in the core.
#[no_mangle]
pub extern "C" fn is_allowed(l0: u32, l1: u32, l2: u32, l3: u32, l4: u32) -> u32 {
    match word_from([l0, l1, l2, l3, l4]) {
        Some(w) => u32::from(wyrdle_core::is_allowed(&w)),
        None => 0,
    }
}

/// `1` if the answer has been found.
#[no_mangle]
pub extern "C" fn is_won() -> u32 {
    u32::from(session_mut().is_some_and(|s| s.game.is_won()))
}

/// `1` if the budget is spent without solving.
#[no_mangle]
pub extern "C" fn is_lost() -> u32 {
    u32::from(session_mut().is_some_and(|s| s.game.is_lost()))
}

// --- moves (status: 0 applied / 1 not-a-word / 2 bad state or over) ----------

/// Submit a guess (five letter indices). A non-word or malformed input leaves the
/// board unchanged (status 1); no session or an already-over game is status 2.
#[no_mangle]
pub extern "C" fn guess(l0: u32, l1: u32, l2: u32, l3: u32, l4: u32) -> u32 {
    let Some(s) = session_mut() else { return 2 };
    let Some(word) = word_from([l0, l1, l2, l3, l4]) else {
        return 1;
    };
    match s.game.play(word) {
        Ok(_) => 0,
        Err(wyrdle_core::GuessError::NotAWord) => 1,
        Err(wyrdle_core::GuessError::GameOver) => 2,
    }
}

/// A hint, packed as `(position << 8) | letter` for the first not-yet-solved
/// position, or `0xFFFF_FFFF` if the game is solved or there is no session.
/// Showing a hint reveals part of the answer — the host also calls
/// [`mark_assistance`].
#[no_mangle]
pub extern "C" fn hint() -> u32 {
    match session_mut().and_then(|s| s.game.hint()) {
        Some((pos, letter)) => ((pos as u32) << 8) | u32::from(letter),
        None => 0xFFFF_FFFF,
    }
}

/// Mark the game assisted (a hint was shown), so the outcome reflects it.
#[no_mangle]
pub extern "C" fn mark_assistance() {
    if let Some(s) = session_mut() {
        s.assistance_used = true;
    }
}

// --- outcome ----------

/// The outcome record for the current game as a `pond-docformat` envelope JSON
/// (`kind = "wyrdle"`). `declare`: 1 = include the self-declared assistance flag,
/// 0 = omit it. Solved = `Won`; a spent budget without solving = `Lost`.
/// Verifiable by replaying `(seed, guesses)` through `wyrdle_core::Wyrdle`.
#[no_mangle]
pub extern "C" fn outcome_json(declare: u32) -> *const u8 {
    let Some(s) = session_mut() else {
        return set_out_str("null");
    };
    let assistance = if declare == 1 {
        Some(s.assistance_used)
    } else {
        None
    };
    let record = attest::<Wyrdle>(s.seed, s.game.guesses().to_vec(), Outcome::Lost, assistance);
    match pond_outcome::to_doc::<Wyrdle>(&record) {
        Ok(bytes) => set_out(bytes),
        Err(_) => set_out_str("null"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Exercises the C-ABI end to end (the "wiring test" for W4): start a game,
    // query legality, submit the answer, and confirm the board + outcome. Runs
    // native (rlib), not wasm.
    #[test]
    fn cabi_new_game_guess_outcome() {
        // Seed 1381 is the committed fixture seed; its answer is "vouch".
        new_game(1381, 0);

        // Legality query: the answer is allowed; "zzzzz" is not.
        let v = Word::try_from("vouch").expect("valid");
        assert_eq!(
            is_allowed(
                u32::from(v.0[0]),
                u32::from(v.0[1]),
                u32::from(v.0[2]),
                u32::from(v.0[3]),
                u32::from(v.0[4]),
            ),
            1,
        );
        assert_eq!(is_allowed(25, 25, 25, 25, 25), 0, "zzzzz is not a word");

        // A hash before any guess.
        let h0 = read_hash();

        // Submit the answer -> solved.
        assert_eq!(
            guess(
                u32::from(v.0[0]),
                u32::from(v.0[1]),
                u32::from(v.0[2]),
                u32::from(v.0[3]),
                u32::from(v.0[4]),
            ),
            0,
            "the answer is a legal, winning guess",
        );
        assert_eq!(is_won(), 1);
        assert_ne!(read_hash(), h0, "the hash advanced");

        // A non-word after the win is rejected (game over -> 2), hash unchanged.
        let h1 = read_hash();
        assert_eq!(guess(25, 25, 25, 25, 25), 2, "no guesses after a win");
        assert_eq!(read_hash(), h1);

        // board_json reflects the win.
        let board = read_board();
        assert_eq!(board["won"], serde_json::json!(true));
        assert_eq!(board["guesses"].as_array().unwrap().len(), 1);

        // Outcome parses to a wyrdle-kind envelope.
        let rec = read_outcome();
        assert_eq!(rec["kind"], serde_json::json!("wyrdle"));

        // Daily seed comes from the embedded pack.
        assert_ne!(wyrdle_daily_seed(0), 0, "pack seeds are embedded");
    }

    fn read_out(ptr: *const u8) -> Vec<u8> {
        let n = out_len() as usize;
        // SAFETY: single-threaded test; the caller just wrote OUT.
        unsafe { std::slice::from_raw_parts(ptr, n).to_vec() }
    }
    fn read_hash() -> String {
        let bytes = read_out(current_hash());
        serde_json::from_slice(&bytes).expect("hash json")
    }
    fn read_board() -> serde_json::Value {
        let bytes = read_out(board_json());
        serde_json::from_slice(&bytes).expect("board json")
    }
    fn read_outcome() -> serde_json::Value {
        let bytes = read_out(outcome_json(1));
        serde_json::from_slice(&bytes).expect("outcome json")
    }
}
