# TODO — solitaire

Status: **playable** at `/solitaire/` (delivery slice A–E shipped). These are the
known follow-ups deferred out of the delivery slice, roughly in priority order.
Plans: `plans/2026-07-28-games-drawer-solitaire-ui.md` (front-end),
`plans/2026-07-27-games-pond-fun-crofting.md` (pond master).

## Gameplay / input
- [ ] **Drag-and-drop** as a fast-follow (tap-to-move stays as the accessible
      floor). Front-plan Phase 7.
- [ ] **Hint** control (counts as assistance, like undo). Called out in the
      UI/UX research; not yet built.
- [ ] **Win cascade** animation on clear (the classic flourish).
- [ ] Auto-play obvious foundation moves (opt-in) — convenience, must not change
      the recorded move list's verifiability.

## Solver / daily pack (Phase S follow-ups)
- [ ] **Short-line tuning** — the solver sometimes returns long draw-heavy
      winning lines (the current `pack[0]` fixture is 500 moves). Bias toward
      shorter lines so the daily fixture and share payloads stay small.
- [ ] **Scale the pack to a full year** of dated winnable seeds (currently 6),
      keeping byte-identical regeneration (the P10 drill).
- [ ] Wire the bounded `is_hopeless` check to *confirm* a player-declared
      `Stuck` (optional).

## Responsive / a11y polish
- [ ] Narrow-screen layout: tighten the tableau fan and keep stock/waste/
      foundations reachable (front-plan Phase 5).
- [ ] Finer keyboard focus restoration after a move (today a move rebuilds the
      board and focus falls back to the board root).

## Identity (Phase E follow-ups)
- [ ] Self-hosted **display webfont** (the result headline currently falls back
      to a system rounded face; `--font-display` names Fredoka/Baloo 2). Add an
      `@font-face` + build copy, keeping it offline/self-hosted per the standard.

## Deploy / ops
- [ ] Consider adding an `@live` smoke check against `fun.croft.ing` once a
      credentialed browser path exists (the sandbox here can't reach live OAuth/
      egress; the hermetic Playwright gate covers behaviour).
