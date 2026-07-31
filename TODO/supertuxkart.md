# TODO — SuperTuxKart (Tier-2 wrap)

Status: **UNDER REVIEW (owner)** — a local preview is built and served; the
"is it awesome?" test is pending. Plan: `plans/2026-07-31-supertuxkart-wrap.md`.
Class: the big-download-then-offline Tier-2 wrap (not GitHub Pages — object
storage if adopted).

## Proven (2026-07-31)
- [x] STK's WASM engine **builds on macOS-arm64** (emsdk + 9 deps + engine →
      `supertuxkart.js` + a 15 MB `.wasm`), via 8 documented Linux→macOS build
      fixes in the port's own scripts (not this repo).
- [x] **Assets** pack: the 101 MB mobile low-quality set → 20 MB chunks (~125 MB)
      + manifest.
- [x] **Served + loads locally**: shell renders, recognizes the Low tier, Start
      Game downloads + caches assets into IndexedDB. Full 3D render is the
      real-browser test (headless SwiftShader is unreliable for it).
- Build tree is throwaway at `~/stk-build` (nothing committed here); the
      reproducible recipe lives in the plan's "Phase 0 recon findings".

## The decision (owner's, pending)
Play the local preview → **is it awesome enough to earn a shelf slot?**
- **If YES →** execute `plans/2026-07-31-supertuxkart-wrap.md`: host the bundle
  on **object storage** (the blob candidate), build the honest-representation
  wrapper (big-download disclosure + "no verifiable result" banner +
  `iframe[sandbox]`) and the reusable **Tier-2 containment/legibility harness**,
  then wire it onto the shelf + the `BUILDING-GAMES.md` wrapped-game addendum.
- **If NO →** drop it; the build recipe stays documented in the plan for any
  future revisit. We answered the feasibility question cheaply.

## Follow-ups (only if adopted)
- [ ] Confirm asset licences (GPL engine + CC-BY-SA art) for redistribution.
- [ ] Object-storage hosting + the wrapper's fetch URL.
- [ ] Higher-quality asset tiers (mid/high) — the preview used low only.
- [ ] The Tier-2 containment harness (reusable for every future wrap).
