# ADR-0003: The ground is the game's, and the frame only holds the hook

Tags: layout, chrome, skins, tokens

Date: 2026-09-08
Status: accepted
Gates: Phase 6 of `plans/2026-09-04-plan-play-surface.md` (mock F, Q2)

## Context

ADR-0002 gave every game one structure — bands around a stage the game owns — and the
stage was painted the page's flat ground. Once the boards grew to fill it (phases 1–3 of
the play-surface plan), the owner's read of the phone captures was still "so much negative
space and it's just blah": the room around a board looked like a gallery wall, the same
wall behind a felt table, a wooden mancala board and a sheet of graph paper.

The room around a board is judged with the board. A tint of the board's own colour under
it, fading to a faint vignette at the edges, makes the stage the board's world. The
question was who owns that colour. ADR-0001 says a skin restyles chrome and never a board,
and the stage is chrome — so a skin could claim it. But a skin repainting the ground would
re-grade every game's board against a background the game never chose, in a file the game's
gate does not read.

## Decision

**The frame owns the hook; the game owns the colour.** `GameFrameSpec.ground` is a CSS
colour — by convention the game's own board token, `var(--chs-dark)`, `var(--felt)`,
`var(--dots-paper)` — and the frame sets it as `--stage-ground` on `.gf-stage` (with
`data-ground="on"` so a test can read the state without measuring). The mix is the frame's
and the same for every game: a radial pool of the ground colour at 22% under the board and a
7% ink vignette at the edges, both `color-mix`ed so one rule serves light and dark. A game
that declares no ground gets the flat page, not a default tint.

The tokens a game names live in the GAME-OWNED region of `tokens.css`; nothing new is
skinnable, and a skin that assigns `--stage-ground` is smuggling a game-owned value through a
chrome property. `skinScan()` already refuses an undeclared token; `--stage-ground` is not
declared to skins.

## Consequences

- The room around a board reads as the board's. Every migrated game names a ground
  (`tests/play-surface.spec.ts` F4.1 walks the shelf and requires at least six distinct
  colours across it — one ground for all would be the gallery wall again).
- Nothing text-shaped sits on the ground today: the toast is on `--surface`, the poster is
  its own surface. A future game that puts text on the stage grades it against the tinted
  ground in its own tokens test, the way the boards do.
- A game's ground changes with its spec, so a game with modes (Color Sort's skins) may
  change its ground with them; the frame re-applies it on every `update()`.
