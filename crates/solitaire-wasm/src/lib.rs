//! Browser binding over [`solitaire_core`] for the games-drawer UI — raw C-ABI
//! + serde-JSON, no `wasm-bindgen`.
//!
//! The module holds **one game** (single-player, one tab). Inputs are integer
//! args (typed `play_*`), so there is no string-input marshalling; JSON results
//! (board / legal moves / hash / outcome) are written to a single output buffer
//! the host reads via `out_ptr`/`out_len`. Verification of a shared record is
//! orchestrated host-side through these same exports (`new_game` → replay →
//! `current_hash`), so no input buffer is needed.
//!
//! **Never panics** (a wasm panic aborts the module): every fallible path maps
//! to a status code or an empty/`"null"` buffer, never `unwrap`/`panic!`.

use pond_outcome::{attest, Game, Outcome, Replayed};
use serde::Serialize;
use solitaire_core::{state_hash, Card, GameState, Move};

// ---------- the held session ----------

struct Session {
    seed: u64,
    game: GameState,
    moves: Vec<Move>,
    undo: Vec<GameState>,
    assistance_used: bool,
}

static mut STATE: Option<Session> = None;
static mut OUT: Vec<u8> = Vec::new();

/// Mutable access to the held session, if `new_game` has been called.
///
/// # Safety
/// Single-threaded wasm; host calls are sequential, so there is never an
/// overlapping borrow. Returns `None` rather than panicking if `new_game` was
/// not called first.
fn session_mut() -> Option<&'static mut Session> {
    // SAFETY: see doc; raw-pointer access avoids a reference to the `static mut`.
    unsafe { (*core::ptr::addr_of_mut!(STATE)).as_mut() }
}

/// Write `bytes` to the output buffer and return its pointer. `out_len` reports
/// the length. The host must read before the next call overwrites it.
fn set_out(bytes: Vec<u8>) -> *const u8 {
    // SAFETY: single-threaded wasm; the host reads OUT (ptr + out_len) between
    // calls. Raw pointers avoid a &mut to the `static mut` (static_mut_refs).
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

// ---------- lifecycle ----------

/// Start a fresh game from a `u64` seed (passed as two `u32` halves).
#[no_mangle]
pub extern "C" fn new_game(seed_lo: u32, seed_hi: u32) {
    let seed = (u64::from(seed_hi) << 32) | u64::from(seed_lo);
    let session = Session {
        seed,
        game: GameState::new_game(seed),
        moves: Vec::new(),
        undo: Vec::new(),
        assistance_used: false,
    };
    // SAFETY: single-threaded; replaces the held session.
    unsafe {
        *core::ptr::addr_of_mut!(STATE) = Some(session);
    }
}

// ---------- reads (JSON via the output buffer) ----------

#[derive(Serialize)]
struct CardView {
    suit: u8,
    rank: u8,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SlotView {
    face_up: bool,
    /// Omitted for face-down cards — the UI must not see hidden cards.
    #[serde(skip_serializing_if = "Option::is_none")]
    card: Option<CardView>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BoardView {
    foundations: [u8; 4],
    stock_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    waste_top: Option<CardView>,
    waste_count: usize,
    tableau: Vec<Vec<SlotView>>,
    won: bool,
}

fn card_view(c: Card) -> CardView {
    CardView {
        suit: c.suit,
        rank: c.rank,
    }
}

fn board_view(g: &GameState) -> BoardView {
    BoardView {
        foundations: g.foundations,
        stock_count: g.stock.len(),
        waste_top: g.waste.last().map(|c| card_view(*c)),
        waste_count: g.waste.len(),
        tableau: g
            .tableau
            .iter()
            .map(|pile| {
                pile.iter()
                    .map(|tc| SlotView {
                        face_up: tc.face_up,
                        card: if tc.face_up {
                            Some(card_view(tc.card))
                        } else {
                            None
                        },
                    })
                    .collect()
            })
            .collect(),
        won: g.is_won(),
    }
}

/// The current board as JSON (hidden cards omitted). Returns a pointer into the
/// output buffer; read `out_len` bytes. `"null"` if no game is started.
#[no_mangle]
pub extern "C" fn board_json() -> *const u8 {
    match session_mut() {
        Some(s) => match serde_json::to_vec(&board_view(&s.game)) {
            Ok(bytes) => set_out(bytes),
            Err(_) => set_out_str("null"),
        },
        None => set_out_str("null"),
    }
}

/// The legal moves in the current state, as a JSON array (canonical order).
#[no_mangle]
pub extern "C" fn legal_moves_json() -> *const u8 {
    match session_mut() {
        Some(s) => match serde_json::to_vec(&s.game.legal_moves()) {
            Ok(bytes) => set_out(bytes),
            Err(_) => set_out_str("[]"),
        },
        None => set_out_str("[]"),
    }
}

/// The canonical `state_hash` of the current state (quoted JSON string).
#[no_mangle]
pub extern "C" fn current_hash() -> *const u8 {
    match session_mut() {
        Some(s) => set_out_str(&format!("\"{}\"", state_hash(&s.game))),
        None => set_out_str("\"\""),
    }
}

/// `1` if the current state is a win, else `0`.
#[no_mangle]
pub extern "C" fn is_won() -> u32 {
    u32::from(session_mut().is_some_and(|s| s.game.is_won()))
}

// ---------- moves (status: 0 applied / 1 illegal / 2 bad state or arg) ----------

fn apply(mv: Move) -> u32 {
    let Some(s) = session_mut() else { return 2 };
    let snapshot = s.game.clone();
    match s.game.play_move(mv) {
        Ok(()) => {
            s.undo.push(snapshot);
            s.moves.push(mv);
            0
        }
        Err(solitaire_core::MoveError::Illegal) => 1,
        Err(solitaire_core::MoveError::BadPile(_)) => 2,
    }
}

/// T1 — draw / recycle.
#[no_mangle]
pub extern "C" fn play_draw() -> u32 {
    apply(Move::Draw)
}
/// T2 — waste → foundation.
#[no_mangle]
pub extern "C" fn play_waste_to_foundation() -> u32 {
    apply(Move::WasteToFoundation)
}
/// T3 — waste → tableau pile.
#[no_mangle]
pub extern "C" fn play_waste_to_tableau(pile: u32) -> u32 {
    apply(Move::WasteToTableau {
        pile: pile as usize,
    })
}
/// T4 — tableau pile → foundation.
#[no_mangle]
pub extern "C" fn play_tableau_to_foundation(pile: u32) -> u32 {
    apply(Move::TableauToFoundation {
        pile: pile as usize,
    })
}
/// T5 — move `count` cards from `from` to `to`.
#[no_mangle]
pub extern "C" fn play_tableau_to_tableau(from: u32, count: u32, to: u32) -> u32 {
    apply(Move::TableauToTableau {
        from: from as usize,
        count: count as usize,
        to: to as usize,
    })
}

/// Mark the current game as having used assistance (e.g. a hint was shown).
/// Undo already sets this; hints call it explicitly so the outcome record
/// reflects that the clear was not unaided.
#[no_mangle]
pub extern "C" fn mark_assistance() {
    if let Some(s) = session_mut() {
        s.assistance_used = true;
    }
}

/// Undo the last applied move (marks assistance used). `1` if undone, `0` if
/// there was nothing to undo.
#[no_mangle]
pub extern "C" fn undo() -> u32 {
    let Some(s) = session_mut() else { return 0 };
    match s.undo.pop() {
        Some(prev) => {
            s.game = prev;
            s.moves.pop();
            s.assistance_used = true;
            1
        }
        None => 0,
    }
}

// ---------- outcome ----------

/// The `pond-outcome` [`Game`] impl for solitaire — replay `(seed, moves)`.
struct Solitaire;
impl Game for Solitaire {
    type Move = Move;
    const KIND: &'static str = "solitaire";
    const VERSION: u32 = 1;
    fn replay(seed: u64, moves: &[Move]) -> Replayed {
        let mut game = GameState::new_game(seed);
        for &mv in moves {
            let _ = game.play_move(mv);
        }
        Replayed::new(state_hash(&game), game.is_won())
    }
}

/// The outcome record for the current game, as a `pond-docformat` envelope JSON.
/// `if_unfinished`: 0 = Abandoned, 1 = Stuck (used only if not won).
/// `declare`: 1 = include the (self-declared) assistance flag, 0 = omit it.
#[no_mangle]
pub extern "C" fn outcome_json(if_unfinished: u32, declare: u32) -> *const u8 {
    let Some(s) = session_mut() else {
        return set_out_str("null");
    };
    let unfinished = if if_unfinished == 1 {
        Outcome::Stuck
    } else {
        Outcome::Abandoned
    };
    let assistance = if declare == 1 {
        Some(s.assistance_used)
    } else {
        None
    };
    let record = attest::<Solitaire>(s.seed, s.moves.clone(), unfinished, assistance);
    match pond_outcome::to_doc::<Solitaire>(&record) {
        Ok(bytes) => set_out(bytes),
        Err(_) => set_out_str("null"),
    }
}
