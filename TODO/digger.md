# TODO — digger (working name)

Status: **concept, not started.** Tier-1 build-fresh candidate on the pile.

## Origin / why build-fresh (not a Tier-2 wrap)
- Inspired by the *feel* of a Ludum Dare 29 (theme "Beneath the Surface") Phaser
  digger by **Dream Show Adventures**
  (<https://dreamshowadventures.github.io/LudumDare29/>). Architecturally a clean
  self-contained Phaser/HTML5 static build — but its README is
  **all-rights-reserved**: "Copyright (c) 2014 Dream Show Adventures. Don't
  steal." No redistribution license and no derivative-work grant, so it **fails
  the Tier-2 filter (leg 3)** and cannot be vendored or patched.
- Game *mechanics* aren't copyrightable — only code, assets, and name. So we
  build a fresh determinism-first version with our **own name and art**. This
  also sidesteps the owner's dislike of the original's "DEPTH / CASH" game-over
  screen: building fresh means we design our own end screen, so the thing to
  remove never exists.

## Mechanic sketch (to be pinned in the plan)
- Drill/dig downward; manage descent depth and a collected resource; dodge or
  clear hazards on the way down.
- **Determinism-first**: seeded world (ChaCha20-style), discrete or fixed-tick
  moves on the hashed path (no floats), native == wasm — a run replays to a
  **verifiable outcome** (depth reached / resource, re-derived by replay) with a
  `?r=` re-verifying share, same as the rest of the Tier-1 shelf.
- Tap-first input, core decides legality; hints/assistance + a "How to play"
  guide per the shelf standards (`docs/BUILDING-GAMES.md`).

## Before any code
- [ ] Phase-plan it (own doc in `plans/`), resolving: **name** (do NOT reuse the
      original's name), the exact **scoring metric(s)** carried in the verifiable
      record, and whether motion is **discrete-step or fixed-tick** (the
      determinism model — the same fork bubble had to resolve).
- [ ] Decide art / identity on the shared tokens.

## Then (mirrors the other games)
- [ ] `digger-core` (+ golden vectors) → `digger-wasm` → `src/games/digger/`.
- [ ] Register in `src/registry.ts`; wiring test through the `/digger/` URL.
- [ ] Meet the shelf standards (tap-first, hints/assistance, How-to-play guide).
