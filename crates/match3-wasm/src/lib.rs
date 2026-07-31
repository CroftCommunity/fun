//! Browser binding over [`match3_core`] for the games shelf — raw C-ABI +
//! serde-JSON, no `wasm-bindgen` (the `xbuild` pattern, like `solitaire-wasm`).
//!
//! The module holds **one game** (one board per tab). The objective is
//! Candy-Crush-style: a fixed **move budget** of legal swaps; when it runs out
//! the score is graded into 0–3 **stars** at per-deal thresholds (derived from a
//! deterministic reference score for the seed), and a run "passes" (`Won`) at
//! ≥1★. Reads (board / legal swaps / hash / outcome) are JSON written
//! to one output buffer the host reads via `out_ptr`/`out_len`.
//!
//! **Never panics** (a wasm panic aborts the module): every fallible path maps
//! to a status code or an empty/`"null"` buffer.

use match3_core::{
    blockers_mode, blockers_remaining, deal, deal_blockers, deal_ingredients, deal_jelly,
    ingredients_mode, ingredients_remaining, jelly_mode, jelly_remaining, legal_swaps,
    reference_score, Cell, Game as M3Game, SpecialKind,
};
use pond_outcome::{attest, Game, Outcome, Replayed};
use serde::{Deserialize, Serialize};

// --- level config (see plans/2026-07-30-match3-playable.md) ---
const WIDTH: usize = 8;
const HEIGHT: usize = 8;
const COLORS: usize = 6;
const MOVE_BUDGET: usize = 20;

/// The objectives this binding serves. All share the 8×8 board and the same
/// `Game` engine; the mode selects the deal, the win check, and how the outcome
/// record is graded.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Mode {
    /// Score at least the 1★ target within the move budget (v1).
    TargetScore,
    /// Clear every `Blocker` cell within the (larger) move budget.
    Blockers,
    /// Scrub every jelly cell within the (larger) move budget.
    Jelly,
    /// Drop every ingredient to the bottom within the (larger) move budget (Track D).
    Ingredients,
}

// --- the baked par table (parity Track P-now / C1) ---
//
// The target-score star thresholds come from a player ladder (weak / greedy /
// beam) computed offline and embedded here, so play-time and verify-time look up
// the same par without running the slow strong player live. Daily seeds are in
// the table; a free-play / `?seed=` board off the table falls back to the cheap
// live greedy tiers (consistent per seed, since membership is fixed).

static PAR_TABLE_JSON: &[u8] = include_bytes!("../../../games/match3/par-pack.json");

#[derive(Deserialize)]
struct ParEntry {
    seed: u64,
    tiers: [u64; 3],
}
#[derive(Deserialize)]
struct ParPayload {
    entries: Vec<ParEntry>,
}
#[derive(Deserialize)]
struct ParEnvelope {
    payload: ParPayload,
}

/// The embedded par table `(seed, tiers)`, parsed once. Never panics: a parse
/// failure yields an empty table, so every seed falls back to live tiers.
fn par_table() -> &'static [(u64, [u64; 3])] {
    static mut TABLE: Option<Vec<(u64, [u64; 3])>> = None;
    // SAFETY: single-threaded wasm; host calls are sequential.
    unsafe {
        let p = core::ptr::addr_of_mut!(TABLE);
        if (*p).is_none() {
            let parsed = serde_json::from_slice::<ParEnvelope>(PAR_TABLE_JSON)
                .map(|e| {
                    e.payload
                        .entries
                        .into_iter()
                        .map(|x| (x.seed, x.tiers))
                        .collect()
                })
                .unwrap_or_default();
            *p = Some(parsed);
        }
        (*p).as_deref().unwrap_or(&[])
    }
}

/// Cheap live fallback tiers for off-table (free-play) seeds: 30% / 60% / 90% of
/// the greedy reference. Kept for boards not in the baked ladder table.
fn fallback_tiers(seed: u64) -> [u64; 3] {
    let par = reference_score(seed, WIDTH, HEIGHT, COLORS, MOVE_BUDGET).max(10);
    [par * 3 / 10, par * 3 / 5, par * 9 / 10]
}

/// Per-deal 1★ / 2★ / 3★ thresholds: the baked ladder tiers if the seed is in the
/// daily par table, else the live greedy fallback. A pure function of the seed,
/// so play-time and verify-time agree.
fn targets_for(seed: u64) -> [u64; 3] {
    par_table()
        .iter()
        .find(|(s, _)| *s == seed)
        .map_or_else(|| fallback_tiers(seed), |&(_, tiers)| tiers)
}

/// The target-score daily seed for `day_index` — a seed from the baked par table
/// (so its par is the ladder, not the fallback). `0` if the table is empty.
#[no_mangle]
pub extern "C" fn target_daily_seed(day_index: u32) -> u32 {
    let table = par_table();
    if table.is_empty() {
        return 0;
    }
    let i = (day_index as usize) % table.len();
    u32::try_from(table[i].0).unwrap_or(0)
}

fn star_count(score: u64, targets: [u64; 3]) -> u8 {
    u8::try_from(targets.iter().filter(|&&t| score >= t).count()).unwrap_or(3)
}

// --- the held session ----------

struct Session {
    seed: u64,
    mode: Mode,
    game: M3Game,
    /// Legal-swap budget for this mode (target-score: 20; blockers: 30).
    budget: usize,
    /// Per-deal star thresholds derived from the seed (target-score mode).
    targets: [u64; 3],
    /// Blockers present in the deal (blockers mode); `0` otherwise.
    blockers_total: u32,
    /// Jellied cells present in the deal (jelly mode); `0` otherwise.
    jelly_total: u32,
    /// Ingredients present in the deal (ingredients mode); `0` otherwise.
    ingredients_total: u32,
    /// Applied legal swaps `[from_row, from_col, to_row, to_col]` — the outcome proof.
    swaps: Vec<[u8; 4]>,
    assistance_used: bool,
}

impl Session {
    /// Whether the objective is met: the 1★ target (target-score), every blocker
    /// cleared (blockers), or every jelly scrubbed (jelly).
    fn won(&self) -> bool {
        match self.mode {
            Mode::TargetScore => self.game.score >= self.targets[0],
            Mode::Blockers => blockers_remaining(&self.game.board) == 0,
            Mode::Jelly => jelly_remaining(&self.game.board) == 0,
            Mode::Ingredients => ingredients_remaining(&self.game.board) == 0,
        }
    }
}

static mut STATE: Option<Session> = None;
static mut OUT: Vec<u8> = Vec::new();

fn session_mut() -> Option<&'static mut Session> {
    // SAFETY: single-threaded wasm; host calls are sequential. Raw-pointer
    // access avoids a reference to the `static mut`.
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

fn set_session(session: Session) {
    // SAFETY: single-threaded; replaces the held session.
    unsafe {
        *core::ptr::addr_of_mut!(STATE) = Some(session);
    }
}

/// Start a fresh **target-score** game: deal a settled board from `seed` and
/// reset the budget.
#[no_mangle]
pub extern "C" fn new_game(seed_lo: u32, seed_hi: u32) {
    let seed = (u64::from(seed_hi) << 32) | u64::from(seed_lo);
    let board = deal(seed, WIDTH, HEIGHT, COLORS);
    set_session(Session {
        seed,
        mode: Mode::TargetScore,
        game: M3Game::new(board, seed, COLORS),
        budget: MOVE_BUDGET,
        targets: targets_for(seed),
        blockers_total: 0,
        jelly_total: 0,
        ingredients_total: 0,
        swaps: Vec::new(),
        assistance_used: false,
    });
}

/// Start a fresh **clear-the-blockers** game: deal a blocker board from `seed`
/// (winnable — the daily seeds come from the solver pack) with the blockers-mode
/// budget. The objective is to clear every blocker.
#[no_mangle]
pub extern "C" fn new_blockers_game(seed_lo: u32, seed_hi: u32) {
    let seed = (u64::from(seed_hi) << 32) | u64::from(seed_lo);
    let board = deal_blockers(
        seed,
        blockers_mode::WIDTH,
        blockers_mode::HEIGHT,
        blockers_mode::COLORS,
        blockers_mode::BLOCKERS,
    );
    let blockers_total = blockers_remaining(&board);
    set_session(Session {
        seed,
        mode: Mode::Blockers,
        game: M3Game::new(board, seed, blockers_mode::COLORS),
        budget: blockers_mode::MOVE_BUDGET,
        targets: [0; 3],
        blockers_total,
        jelly_total: 0,
        ingredients_total: 0,
        swaps: Vec::new(),
        assistance_used: false,
    });
}

/// Start a fresh **clear-the-jelly** game: deal a winnable jelly board from
/// `seed` (the daily seeds come from the solver pack) with the jelly-mode budget.
/// The objective is to scrub every jellied cell.
#[no_mangle]
pub extern "C" fn new_jelly_game(seed_lo: u32, seed_hi: u32) {
    let seed = (u64::from(seed_hi) << 32) | u64::from(seed_lo);
    let board = deal_jelly(
        seed,
        jelly_mode::WIDTH,
        jelly_mode::HEIGHT,
        jelly_mode::COLORS,
        jelly_mode::JELLY,
    );
    let jelly_total = jelly_remaining(&board);
    set_session(Session {
        seed,
        mode: Mode::Jelly,
        game: M3Game::new(board, seed, jelly_mode::COLORS),
        budget: jelly_mode::MOVE_BUDGET,
        targets: [0; 3],
        blockers_total: 0,
        jelly_total,
        ingredients_total: 0,
        swaps: Vec::new(),
        assistance_used: false,
    });
}

/// Start a fresh **clear-the-ingredients** game (Track D): deal a winnable
/// ingredient board from `seed` (the daily seeds come from the solver pack) with
/// the ingredients-mode budget. The objective is to drop every ingredient to the
/// bottom row.
#[no_mangle]
pub extern "C" fn new_ingredients_game(seed_lo: u32, seed_hi: u32) {
    let seed = (u64::from(seed_hi) << 32) | u64::from(seed_lo);
    let board = deal_ingredients(
        seed,
        ingredients_mode::WIDTH,
        ingredients_mode::HEIGHT,
        ingredients_mode::COLORS,
        ingredients_mode::INGREDIENTS,
    );
    let ingredients_total = ingredients_remaining(&board);
    set_session(Session {
        seed,
        mode: Mode::Ingredients,
        game: M3Game::new(board, seed, ingredients_mode::COLORS),
        budget: ingredients_mode::MOVE_BUDGET,
        targets: [0; 3],
        blockers_total: 0,
        jelly_total: 0,
        ingredients_total,
        swaps: Vec::new(),
        assistance_used: false,
    });
}

// --- reads (JSON via the output buffer) ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BoardView {
    /// `"target-score"`, `"blockers"`, or `"jelly"` — the UI branches on this.
    mode: &'static str,
    width: usize,
    height: usize,
    /// Row-major gem colours `0..COLORS`; `0` where the cell is a blocker (see
    /// `blockers`) or an (never at rest) hole.
    cells: Vec<Vec<u8>>,
    /// Row-major blocker mask: `true` where a `Blocker` sits (blockers mode).
    blockers: Vec<Vec<bool>>,
    /// Row-major jelly layers per cell (`0` = none), jelly mode.
    jelly: Vec<Vec<u8>>,
    /// Row-major ingredient mask: `true` where an `Ingredient` sits (ingredients mode).
    ingredients: Vec<Vec<bool>>,
    /// Row-major special-candy overlay: `""` (plain) / `"striped-h"` /
    /// `"striped-v"` / `"wrapped"` / `"color-bomb"` / `"fish"`. The UI badges +
    /// labels these.
    specials: Vec<Vec<&'static str>>,
    score: u64,
    moves_left: usize,
    move_budget: usize,
    /// Target-score mode: the 1★/2★/3★ thresholds and stars earned.
    targets: [u64; 3],
    stars: u8,
    /// Blockers mode: how many blockers remain and how many the deal had.
    blockers_remaining: u32,
    blockers_total: u32,
    /// Jelly mode: how many jellied cells remain and how many the deal had.
    jelly_remaining: u32,
    jelly_total: u32,
    /// Ingredients mode: how many ingredients remain and how many the deal had.
    ingredients_remaining: u32,
    ingredients_total: u32,
    won: bool,
}

fn board_view(s: &Session) -> BoardView {
    let b = &s.game.board;
    let cells = (0..b.height)
        .map(|r| {
            (0..b.width)
                .map(|c| match b.get(r, c) {
                    Cell::Gem(g) => g,
                    _ => 0, // blocker / hole — see the `blockers` mask
                })
                .collect()
        })
        .collect();
    let blockers = (0..b.height)
        .map(|r| (0..b.width).map(|c| b.get(r, c).is_blocker()).collect())
        .collect();
    let jelly = (0..b.height)
        .map(|r| (0..b.width).map(|c| b.jelly_at(r, c)).collect())
        .collect();
    let ingredients = (0..b.height)
        .map(|r| (0..b.width).map(|c| b.get(r, c).is_ingredient()).collect())
        .collect();
    let specials = (0..b.height)
        .map(|r| {
            (0..b.width)
                .map(|c| match b.special_at(r, c) {
                    None => "",
                    Some(SpecialKind::StripedH) => "striped-h",
                    Some(SpecialKind::StripedV) => "striped-v",
                    Some(SpecialKind::Wrapped) => "wrapped",
                    Some(SpecialKind::ColorBomb) => "color-bomb",
                    Some(SpecialKind::Fish) => "fish",
                })
                .collect()
        })
        .collect();
    BoardView {
        mode: match s.mode {
            Mode::TargetScore => "target-score",
            Mode::Blockers => "blockers",
            Mode::Jelly => "jelly",
            Mode::Ingredients => "ingredients",
        },
        width: b.width,
        height: b.height,
        cells,
        blockers,
        jelly,
        ingredients,
        specials,
        score: s.game.score,
        moves_left: s.budget.saturating_sub(s.swaps.len()),
        move_budget: s.budget,
        targets: s.targets,
        stars: star_count(s.game.score, s.targets),
        blockers_remaining: blockers_remaining(b),
        blockers_total: s.blockers_total,
        jelly_remaining: jelly_remaining(b),
        jelly_total: s.jelly_total,
        ingredients_remaining: ingredients_remaining(b),
        ingredients_total: s.ingredients_total,
        won: s.won(),
    }
}

/// The current board + score/budget/stars as JSON. `"null"` if no game started.
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

/// Legal swaps in the current state as `[[r1,c1,r2,c2], …]` JSON.
#[no_mangle]
pub extern "C" fn legal_moves_json() -> *const u8 {
    match session_mut() {
        Some(s) => {
            let swaps: Vec<[usize; 4]> = legal_swaps(&s.game.board)
                .into_iter()
                .map(|(f, t)| [f.0, f.1, t.0, t.1])
                .collect();
            match serde_json::to_vec(&swaps) {
                Ok(bytes) => set_out(bytes),
                Err(_) => set_out_str("[]"),
            }
        }
        None => set_out_str("[]"),
    }
}

/// The canonical `state_hash` of the current state (quoted JSON string).
#[no_mangle]
pub extern "C" fn current_hash() -> *const u8 {
    match session_mut() {
        Some(s) => set_out_str(&format!("\"{}\"", s.game.state_hash())),
        None => set_out_str("\"\""),
    }
}

/// Current score.
#[no_mangle]
pub extern "C" fn score() -> u32 {
    session_mut().map_or(0, |s| u32::try_from(s.game.score).unwrap_or(u32::MAX))
}

/// Legal swaps remaining in the move budget.
#[no_mangle]
pub extern "C" fn moves_left() -> u32 {
    session_mut().map_or(0, |s| {
        u32::try_from(s.budget.saturating_sub(s.swaps.len())).unwrap_or(0)
    })
}

/// `1` if the objective is met (1★ target; every blocker cleared; all jelly
/// scrubbed — per mode).
#[no_mangle]
pub extern "C" fn is_won() -> u32 {
    u32::from(session_mut().is_some_and(|s| s.won()))
}

// --- moves (status: 0 applied / 1 illegal / 2 bad state or budget spent) ----------

/// Play a swap of two adjacent gems. Illegal swaps (non-adjacent, non-gem, or no
/// resulting match) leave the board unchanged and do not consume the budget.
#[no_mangle]
pub extern "C" fn play_swap(r1: u32, c1: u32, r2: u32, c2: u32) -> u32 {
    let Some(s) = session_mut() else { return 2 };
    if s.swaps.len() >= s.budget {
        return 2; // budget spent
    }
    let from = (r1 as usize, c1 as usize);
    let to = (r2 as usize, c2 as usize);
    if from.0 >= HEIGHT || from.1 >= WIDTH || to.0 >= HEIGHT || to.1 >= WIDTH {
        return 2;
    }
    if s.game.play_move(from, to).legal {
        s.swaps.push([r1 as u8, c1 as u8, r2 as u8, c2 as u8]);
        0
    } else {
        1
    }
}

/// Play a swap and return the **per-phase board snapshots** as JSON — a list of
/// boards, each a list of row strings (`.` empty, `0`-`9` gem, `A`-`Z` blocker),
/// from the after-swap frame through each clear/fall/refill to the settled board.
/// The committed state is the last snapshot (identical to [`play_swap`]). The UI
/// animates the sequence. Illegal / bad-state / budget-spent → `"[]"` and the
/// board is unchanged (no budget consumed), so the caller simply skips animating.
#[no_mangle]
pub extern "C" fn play_swap_traced(r1: u32, c1: u32, r2: u32, c2: u32) -> *const u8 {
    let Some(s) = session_mut() else {
        return set_out_str("[]");
    };
    if s.swaps.len() >= s.budget {
        return set_out_str("[]"); // budget spent
    }
    let from = (r1 as usize, c1 as usize);
    let to = (r2 as usize, c2 as usize);
    if from.0 >= HEIGHT || from.1 >= WIDTH || to.0 >= HEIGHT || to.1 >= WIDTH {
        return set_out_str("[]");
    }
    let (report, snapshots) = s.game.play_move_traced(from, to);
    if !report.legal {
        return set_out_str("[]");
    }
    s.swaps.push([r1 as u8, c1 as u8, r2 as u8, c2 as u8]);
    let frames: Vec<Vec<String>> = snapshots.iter().map(match3_core::Board::to_rows).collect();
    match serde_json::to_vec(&frames) {
        Ok(bytes) => set_out(bytes),
        Err(_) => set_out_str("[]"),
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

/// The `pond-outcome` [`Game`] impl for match-3 — replay `(seed, swaps)` by
/// dealing the board and applying the swaps, grading the final score.
struct Match3;
impl Game for Match3 {
    type Move = [u8; 4];
    const KIND: &'static str = "match3";
    const VERSION: u32 = 1;
    fn replay(seed: u64, moves: &[[u8; 4]]) -> Replayed {
        let board = deal(seed, WIDTH, HEIGHT, COLORS);
        let mut game = M3Game::new(board, seed, COLORS);
        for m in moves {
            let _ = game.play_move(
                (m[0] as usize, m[1] as usize),
                (m[2] as usize, m[3] as usize),
            );
        }
        let s = game.score;
        let targets = targets_for(seed);
        Replayed::scored(
            game.state_hash(),
            s >= targets[0],
            s,
            star_count(s, targets),
        )
    }
}

/// The `pond-outcome` [`Game`] impl for **clear-the-blockers** — replay
/// `(seed, swaps)` by dealing the blocker board and applying the swaps; the win
/// is verifiable (`Won` ⟺ no blockers remain). The compare metric is
/// `move_count` (fewer swaps to clear = better); no score/stars.
struct Match3Blockers;
impl Game for Match3Blockers {
    type Move = [u8; 4];
    const KIND: &'static str = "match3-blockers";
    const VERSION: u32 = 1;
    fn replay(seed: u64, moves: &[[u8; 4]]) -> Replayed {
        let board = deal_blockers(
            seed,
            blockers_mode::WIDTH,
            blockers_mode::HEIGHT,
            blockers_mode::COLORS,
            blockers_mode::BLOCKERS,
        );
        let mut game = M3Game::new(board, seed, blockers_mode::COLORS);
        for m in moves {
            let _ = game.play_move(
                (m[0] as usize, m[1] as usize),
                (m[2] as usize, m[3] as usize),
            );
        }
        Replayed::new(game.state_hash(), blockers_remaining(&game.board) == 0)
    }
}

/// The `pond-outcome` [`Game`] impl for **clear-the-jelly** — replay
/// `(seed, swaps)` by dealing the jelly board and applying the swaps; the win is
/// verifiable (`Won` ⟺ no jelly remains). Metric is `move_count`; no score/stars.
struct Match3Jelly;
impl Game for Match3Jelly {
    type Move = [u8; 4];
    const KIND: &'static str = "match3-jelly";
    const VERSION: u32 = 1;
    fn replay(seed: u64, moves: &[[u8; 4]]) -> Replayed {
        let board = deal_jelly(
            seed,
            jelly_mode::WIDTH,
            jelly_mode::HEIGHT,
            jelly_mode::COLORS,
            jelly_mode::JELLY,
        );
        let mut game = M3Game::new(board, seed, jelly_mode::COLORS);
        for m in moves {
            let _ = game.play_move(
                (m[0] as usize, m[1] as usize),
                (m[2] as usize, m[3] as usize),
            );
        }
        Replayed::new(game.state_hash(), jelly_remaining(&game.board) == 0)
    }
}

/// The `pond-outcome` [`Game`] impl for **clear-the-ingredients** (Track D) —
/// replay `(seed, swaps)` by dealing the ingredient board and applying the swaps;
/// the win is verifiable (`Won` ⟺ no ingredients remain). Metric is `move_count`;
/// no score/stars.
struct Match3Ingredients;
impl Game for Match3Ingredients {
    type Move = [u8; 4];
    const KIND: &'static str = "match3-ingredients";
    const VERSION: u32 = 1;
    fn replay(seed: u64, moves: &[[u8; 4]]) -> Replayed {
        let board = deal_ingredients(
            seed,
            ingredients_mode::WIDTH,
            ingredients_mode::HEIGHT,
            ingredients_mode::COLORS,
            ingredients_mode::INGREDIENTS,
        );
        let mut game = M3Game::new(board, seed, ingredients_mode::COLORS);
        for m in moves {
            let _ = game.play_move(
                (m[0] as usize, m[1] as usize),
                (m[2] as usize, m[3] as usize),
            );
        }
        Replayed::new(game.state_hash(), ingredients_remaining(&game.board) == 0)
    }
}

/// The outcome record for the current game, as a `pond-docformat` envelope JSON.
/// `declare`: 1 = include the (self-declared) assistance flag, 0 = omit it. A
/// run that did not meet the objective is `Lost`; a met objective is `Won`. The
/// envelope `kind` distinguishes the modes (`match3` / `match3-blockers` /
/// `match3-jelly`).
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
    let bytes = match s.mode {
        Mode::TargetScore => {
            let record = attest::<Match3>(s.seed, s.swaps.clone(), Outcome::Lost, assistance);
            pond_outcome::to_doc::<Match3>(&record)
        }
        Mode::Blockers => {
            let record =
                attest::<Match3Blockers>(s.seed, s.swaps.clone(), Outcome::Lost, assistance);
            pond_outcome::to_doc::<Match3Blockers>(&record)
        }
        Mode::Jelly => {
            let record = attest::<Match3Jelly>(s.seed, s.swaps.clone(), Outcome::Lost, assistance);
            pond_outcome::to_doc::<Match3Jelly>(&record)
        }
        Mode::Ingredients => {
            let record =
                attest::<Match3Ingredients>(s.seed, s.swaps.clone(), Outcome::Lost, assistance);
            pond_outcome::to_doc::<Match3Ingredients>(&record)
        }
    };
    match bytes {
        Ok(bytes) => set_out(bytes),
        Err(_) => set_out_str("null"),
    }
}
