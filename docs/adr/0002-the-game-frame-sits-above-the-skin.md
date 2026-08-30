# ADR-0002: The game frame sits above the skin and below the board

Tags: layout, chrome, skins, accessibility

Date: 2026-08-30
Status: accepted
Gates: Phase 1 of `plans/2026-08-30-plan-game-frame.md`

## Context

Every game page stacked its own controls, HUD, instruction banner and `<details>`
settings in flow above its board, in a different order per game, and each of them could
change height mid-game — the board moved under a player's thumbs (Othello: 24.8px on
WebKit every engine turn, plan Phase 0 D4). The shelf header wrapped to 110px on every
game page at 390px. No two games agreed on where a control lived, and the shared settings
sheet had one caller.

A skin cannot fix this. ADR-0001 adopted forage's rule that a skin **restyles anything
and restructures nothing** — it has no layout power by construction, and that is a
feature. The fix is structural, so it needs a layer of its own.

## Decision

One shared component, `src/game-frame.ts`, mounted for every game page, renders four
fixed-height bands around a stage the game owns: game bar (48px), meter row (56px), stage,
dock (72px). A game declares a `GameFrameSpec` — title, mode, meters, at most five verbs,
setup, preferences — and never touches the chrome. **Nothing above the board changes
height while you play**: text swaps inside slots that already have the room, the meter
count is fixed for the life of the frame, transients overlay the stage.

The frame is **chrome**: it takes chrome tokens only (`--surface`, `--border`, `--accent`,
`--ink-muted`, `--font-display`, `--focus`) and a skin restyles it freely. It is **not the
board**: it never reaches into a game's palette or its stage, so every board still looks
the same under every skin and is graded once.

The frame is the **only** place a game's controls, HUD and settings render. A game that
needs a control the spec cannot express extends the spec (a plan, a test, this ADR's
successor) rather than rendering its own row above the board.

## Consequences

- Sixteen games migrate one at a time (plan Phases 6–21); until a game migrates it
  renders as before inside the frame's stage, which is a legal state.
- The five-verb cap is a design constraint games plan around, not a limit to raise: five
  labelled 44px targets is what 390px holds.
- A browser test per game asserts the board's top edge is unchanged across the game's
  own triggers; the reserved heights are pixels in `tests/game-frame.spec.ts`.
- Full screen (⤢) becomes the Fullscreen API with the frame intact (plan D5); a common
  preference mirrors the dock/rail (plan D4). Neither is a skin's business.
