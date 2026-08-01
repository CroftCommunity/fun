# Align — core rules + determinism contract

`align-core` is the deterministic, headless engine for **Align**, a browser
falling-block stacker (Tier-1, build-fresh). It is the single source of truth for
the rules; the wasm binding and the UI never re-implement them.

> **IP posture.** Align never uses the trademarked falling-block name or the "-tris" suffix, nor the trademarked
> glossary; a 4-line clear is an **Align**. The palette is original (violet I /
> coral O / teal T / gold S / sky Z / rose J / green L) — deliberately *not* the
> guideline shape-to-colour mapping. Piece letters are internal shape ids only.

## Board

- 10 wide × 40 tall, `+y` up, **row 0 at the bottom**. Rows 0..=19 are visible;
  20..=39 are the hidden buffer where pieces spawn. Cells hold a colour id
  (`0` empty, else the locked piece's `PieceKind::color_id`, `1..=7`).

## Pieces, spawn, 7-bag

- Seven 4-cell pieces (I,O,T,S,Z,J,L), four rotation states each, stored as
  `(dx, dy)` box-origin offsets (`piece::CELLS`). Canonical SRS shapes.
- Spawn: horizontal, in the buffer just above the visible field. I/O centred,
  the rest rounded left; base at `y = 20`.
- The randomiser is a **7-bag**: a Fisher-Yates shuffle of the seven kinds over
  the seeded `DetRng`, dealt out then refilled. Guarantees each kind once per 7
  and a max wait of 12 across bag boundaries. `first_piece_not_szo` biases the
  opening piece away from S/Z/O.

## Rotation + wall kicks (SRS-compatible)

- Rotation tries five kick offsets in order and applies the first that fits; all
  five failing is a silent no-op. J/L/S/T/Z share one table; I has its own; O
  never kicks; a 180° turn uses a single no-op test. Tables are verbatim from the
  build plan (`piece::kicks`). The piece records whether its last successful
  action was a rotation and the kick-test index that succeeded (both feed T-spin
  detection).

## The tick model — determinism's foundation

- The simulation runs at a **fixed 60 ticks/second of integer time**. A frame is:
  apply the queued atomic actions (each stamped with the current tick and
  recorded), then call `tick()` once. `tick()` advances gravity, resolves lock
  delay, then `tick += 1`. **No wall clock ever enters the core.**
- **Atomic actions** (`Action`): `ShiftL/R`, `RotCW/CCW`, `Rot180`, `SoftStep`,
  `HardDrop`, `Hold`, `Quit`. Handling (DAS/ARR/SDF) lives in the front-end input
  layer, which resolves held keys into these atomic actions — so the **recorded
  action stream is handling-independent** and a shared record reproduces the exact
  moves that happened.
- **Gravity** is an integer `TICKS_PER_ROW[level]` table baked from the guideline
  "Worlds" formula (`gravity.rs`) — no float on the hashed path.
- **Lock delay**: on grounding, a 30-tick (~0.5 s) timer. Move-reset: a successful
  shift/rotation resets the timer, capped at 15 resets; descending to a lower row
  restores the budget. Hard drop bypasses the delay.
- **Hold**: one slot, one use per piece; swaps the active piece and respawns,
  locked out until the next lock.
- **Line clear** happens at lock: full rows are removed and the rows above shift
  down (0..=4 lines).
- **Top-out**: a spawned piece overlapping the stack (block out), or a piece
  locking entirely above the visible field (lock out).

## Scoring (guideline; `level` = level before the clear)

- Single/Double/Triple/**Align** = 100/300/500/800 × level; T-spin and mini
  T-spin rows per the table (`scoring.rs`); soft drop 1/cell, hard drop 2/cell.
- **Back-to-back** ×1.5 for consecutive difficult clears (Align or line-clearing
  T-spin); a no-line T-spin keeps the chain, a plain clear breaks it.
- **Combo** 50 × combo × level for consecutive line-clearing placements.
- **Perfect clear** bonus when the board is empty after a clear.
- **T-spin detection (3-corner rule)**: the locking piece is a T, its last
  successful action was a rotation, and ≥3 of the 4 diagonal corners of its 3×3
  box are filled (walls/floor count; open ceiling does not). Both front corners +
  ≥1 back = full T-spin; otherwise mini. Kick-test 5 upgrades to a full T-spin.

## Modes

- **Marathon**: level 1→15, 150 lines; `is_won` at the goal. Selectable start
  level (fixed-goal 10 lines/level curve).
- **Sprint**: 40 lines fastest; fixed low gravity; the tick count is the metric.
- Both are **state-terminal** (a board/line condition ends the run), so
  `replay(seed, events)` runs to that terminal with no wall-clock budget. Rush (a
  tick budget) and Zen (endless) are follow-ups.

## Verifiable outcome

- A run replays byte-identically from `(seed, moves)` where a move list is a
  required `AlignMove::Begin { mode, start_level }` header + the tick-stamped
  `InputEvent`s. `game::Align` implements `pond_outcome::Game` (`KIND = "align"`);
  `replay` re-derives the final hash + score and never trusts a stored field, so a
  tampered header, event, or hash fails verification.

## State hash

- SHA-256 over a domain tag (`algn\0`) + the RNG draw count, score, lines, combo,
  back-to-back, **simulation tick**, over/won flags, the active piece
  (colour/rot/x/y), the hold colour, and the board cells — all little-endian
  fixed-width integers, so the hash is byte-identical on native and `wasm32`.
  Including the tick pins the whole timeline: a run and its replay agree only if
  every gravity/lock tick lined up.

## Daily pack

- No solver (every seed is playable). The pack is a seeded shuffle of a seed pool
  (a year of non-repeating dailies) + one fixture recorded line, in a
  `pond-docformat` `"align-daily-pack"` envelope, byte-identically regenerable.
