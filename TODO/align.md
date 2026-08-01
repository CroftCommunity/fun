# Align — follow-ups

Align ships as a Tier-1 game at `/align/`: a real-time falling-block stacker with
a verifiable `pond-outcome` (score + lines, re-derived by tick-stamped replay),
keyboard + touch input (the core decides legality), hold/ghost/next-5, guideline
scoring (T-spins, back-to-back, combo, perfect clear), Marathon + Sprint modes,
hints/settings, daily + free-play + `?r=` share, and a How-to guide. Plan:
`plans/2026-08-01-align-falling-blocks.md`. Ideas for later, none blocking.

## Modes
- **Rush (Ultra) + Zen.** The plan's other two modes. Both need the run's
  **stop-tick** carried in the record (Rush ends on a fixed tick budget, Zen on a
  recorded quit / buffer-trim) so `replay` stops at the exact tick — a small
  addition to the `Begin` header / a trailing marker. Marathon + Sprint ship now
  because they are state-terminal (goal lines / top-out) and need no stop-tick.
- **Battle (multiplayer).** Deferred and gated exactly as cribbage is — needs the
  P2P transport + a fair primitive. Garbage table (Jstris/Friends) recorded in the
  plan for when it lands.

## Handling + controls
- **Configurable DAS / ARR / SDF + key rebinding**, persisted to `localStorage`.
  v1 ships conventional fixed defaults (DAS 133 / ARR 12 ms; soft ≈ 2 cells/frame)
  and the standard keymap; the settings UI is the follow-up. A "Jstris-feel"
  time-based lock preset can live here too.
- **Selectable start level** (Marathon) — the core + record already carry it
  (`Begin{start_level}`); surface a picker. Also 180° rotation is implemented but
  unbound by default; add a rebindable key.
- **Swipe/flick touch gestures** in addition to the on-screen buttons (swipe-DAS
  shift, flick-down hard drop), per the plan's Phase 7.

## Feel / polish
- **Line-clear + lock animations** (a short flash / row-collapse, reduced-motion
  aware) — v1 clears instantly (the flash is cosmetic-only and minimal).
- **Audio.** Original SFX (move/rotate/lock/clear tiers/hold/level-up/top-out) +
  ambient music via WebAudio, unlocked on first interaction, with volume/mute —
  the plan's Phase 9. No audio ships in v1.
- **Colourblind-safe alternate palette + per-piece patterns**, high-contrast board,
  and settings export/import JSON (Phase 9 accessibility).
- **PWA manifest + offline** — install from `fun.croft.ing`, service-worker offline
  (all modes are client-side).

## Records
- **Local per-mode records** (best score / fastest Sprint + per-run stats: PPS,
  max combo, T-spins, Aligns) in `localStorage`, and instant retry — the plan's
  Phase 6 result/records screen. v1 shows a per-run result but does not persist a
  local leaderboard yet.
