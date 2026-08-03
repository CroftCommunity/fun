# Bubble shooter — next-piece preview + orphan drop animation (phase plan)

**Status:** IN PROGRESS (worktree `worktrees/fun/bubble-preview`, branch
`claude/bubble-preview` off `main`). Two owner-requested polish features on the
shipped trajectory-aim bubble shooter. Git identity: chasemp
(`chase@owasp.org`). Do not push unless asked.

## Problem statement

The shipped bubble shooter (`/bubble/`, a Puzzle-Bobble-style trajectory-aim
game: aim an angle, fire, bounce, stick, pop 3+, drop orphans) has two gaps the
owner flagged against the genre norm:

1. **No next-piece preview.** The launcher shows only the *current* colour. Every
   mainstream bubble shooter also shows the **next** colour on deck so the player
   can plan two shots ahead.
2. **Orphans vanish instantly.** When a pop severs bubbles from the ceiling, the
   now-floating ("orphan") bubbles just disappear on the next render. They should
   **fall (and/or burst)** so the cause→effect reads, and so a big drop feels
   rewarding rather than glitchy.

## Reasoning — why these are non-trivial (core-level), and the key constraint

**Preview.** The launcher colour is not pre-generated. In
`bubble-core/src/game.rs`, `Game::play` loads the next colour *after* the shot
resolves, from the colours **present on the post-shot board**
(`pick_color(&self.board, &mut self.launcher)`). That keeps every shot able to
make progress and keeps daily boards provably clearable (the winnable pack). So
the next colour is a function of the board state *after* the current shot —
which the player controls by aiming — and cannot be shown before the shot is
committed.

To preview accurately, the colour stream must be **one step deeper**: generate
`current` **and** `next` up front (both from the initial board), and on each
shot promote `next → current` and generate one fresh `next` from the post-shot
board (owner's framing: "create the next 2 when we fire the first, then just
create 1 per shot after, lined up"). Colours stay board-derived (unchanged
`pick_color`); only the pipeline depth changes.

**Consequence (intrinsic, unavoidable for any accurate preview):** the colour
fired *now* was chosen from the board one shot ago, not the board as it stands —
so it loses the "loaded colour is always present on the board" guarantee by
exactly one step (normal bubble-shooter behaviour: you're sometimes handed a
colour that matches nothing). Because the fired-colour *sequence* changes:
- the outcome **state hash** shifts → bump `Bubble::VERSION` **2 → 3** (old `?r=`
  shares from v2 stop verifying — acceptable on a personal shelf, and honest);
- the **winnable daily pack** must be **regenerated + re-verified** under the new
  stream (the solver already searches over `Game::play`, so no solver-logic
  change — just re-run the generator; the byte-identical drill re-locks it).

**Drop animation.** `ShotReport` currently carries only **counts** (`popped`,
`dropped`); `apply_shot`/`drop_floating` blank cells in place, and the UI just
re-renders the settled board. To animate, the core must expose *which* cells
popped and dropped, with their colours (captured before clearing). This is
**additive** — it does not touch the board, score, RNG draws, or hash — so it
needs **no** version bump and **no** pack regen. It ships alongside the preview.

## Verified assumptions (read on 2026-07-31 against `main`)

- Game is trajectory-aim: moves are `Angle`, `Game::play(Angle)` →
  `shoot_angle` → `apply_shot`. `Bubble::VERSION == 2`. (`game.rs`, `engine.rs`)
- Colour scheme is 1-deep board-derived `pick_color`; `current` set in
  `with_params` and refreshed in `play`. (`game.rs:42,95,173`)
- `ShotReport { popped: usize, dropped: usize, score_gain: u64 }`;
  `connected_same_color` already returns cluster `Vec<Pos>`; `drop_floating`
  returns a count. (`engine.rs:46,102,126`)
- Call sites reading `rep.popped`/`rep.dropped` as counts: solver
  `dfs` (`solver/src/lib.rs:124`) and wasm `hint_angle` (`wasm/src/lib.rs:298`).
- Pack: `games/bubble/daily-pack.json`, embedded via `include_bytes!`; regenerated
  by the `#[ignore]` `generate_daily_pack` test and locked by the `#[ignore]`
  `pack_regenerates_byte_identical` drill; `committed_pack_is_wellformed`
  (non-ignored) replays the fixture line under `Game` and asserts it clears — so
  the scheme change and the pack regen MUST land in the same commit.
- UI is fully canvas-rendered (`bubble.ts` `drawScene`); launcher drawn at
  `launcherOrigin` (board-centre, bottom). HUD has a DOM `bub-loaded` chip
  (current colour) beside score/shots. `fire()` = flight animation → `shoot` →
  `render()`.
- E2E `tests/bubble.spec.ts` reads the fixture from the pack dynamically (no
  hardcoded line), so it survives regeneration.
- CLAUDE.md: any UI-look change requires regenerating `assets/guide/bubble-*.jpg`
  via `npm run build:wasm && npm run build && npm run guide:shots` (add only the
  bubble shots).

## Approach — phases (each a green, committed checkpoint; TDD RED→GREEN first)

**P1 — Core: 2-deep colour queue + `next_color`, VERSION 2→3, regen pack.**
- RED (game.rs): a fresh game exposes distinct `current_color()` and a new
  `next_color()`; after a `play`, the old `next` becomes `current` and a fresh
  `next` is loaded; replay/verify still holds; VERSION is 3.
- GREEN: add `next: u8`; in `with_params` draw `current` then `next` from the
  initial board; in `play` promote `next→current` then refill `next` from the
  post-shot board; add `next_color()`; bump `VERSION`.
- Regenerate the pack: run `generate_daily_pack` (ignored) then the byte-identical
  drill; update the golden fixture expectations if the doc-comment cites a line.
- Gate: `cargo test -p bubble-core -p bubble-solver` green (incl. non-ignored pack
  wellformed test replaying under the new scheme).

**P2 — Core: `ShotReport` carries popped/dropped cells (drop-animation data).**
- RED (engine.rs): after a pop, `report.popped` lists the popped cells (with the
  shot colour); after a bridge pop, `report.dropped` lists the stranded cells
  (with their own colours); `score_gain` and the golden hash are unchanged.
- GREEN: `popped: Vec<(Pos,u8)>`, `dropped: Vec<(Pos,u8)>`; capture colours before
  clearing; `score_gain = popped.len() + 2*dropped.len()`. Update call sites
  (solver `dfs`, wasm `hint_angle`) to `.len()`.
- Gate: `cargo test --workspace` green.

**P3 — Wasm binding: `nextColor` in BoardView, `last_shot_json`.**
- RED (`cabi_end_to_end`): board JSON has `nextColor`; version assertion → 3;
  after a `shoot`, `last_shot_json` returns `{popped:[[r,c,color]…],
  dropped:[…]}`.
- GREEN: add `next_color` to `BoardView` + a `next_color()` extern; store the last
  `ShotReport` in `Session` and add `last_shot_json`.

**P4 — TS wrapper: types + methods; rebuild wasm.**
- Add `nextColor` to `BoardView`, `LastShot` type, `nextColor()` + `lastShot()`.
- `npm run build:wasm && npm run build`; `npm run typecheck` green.

**P5 — UI: next-piece preview.**
- Add a DOM `bub-next` HUD chip (primary, E2E-assertable) beside `bub-loaded`,
  and an on-canvas on-deck bubble drawn beside the launcher (smaller/dimmer),
  both driven by `board.nextColor`. E2E: the next indicator reflects
  `__bubble.game.board().nextColor` and updates after a shot.

**P6 — UI: orphan pop/drop resolve animation (canvas).**
- Between `game.shoot(angle)` and `render()` in `fire()`, read `game.lastShot()`
  and run a short rAF pass over the settled board: popped cells **burst**
  (quick scale-up + fade), dropped cells **fall** (translate down off-board +
  fade). Reduced-motion → skip straight to render. Keep the outcome path intact.

**P7 — How-to copy + guide shots + full gate.**
- Refine howto lede/caption to name the on-deck preview; regenerate
  `assets/guide/bubble-*.jpg` (add only bubble shots). Full gate: `cargo test
  --workspace`, `cargo fmt --check`, `clippy::pedantic`, `npm test`
  (typecheck+lint+unit+e2e+build).

## Out of scope
- No change to `pick_color`'s board-derived selection (colours stay relevant).
- No change to aim/trajectory/geometry, scoring formula, or the outcome envelope
  shape (only the version integer).
