# TODO — cribbage

Status: **not started, gated.** Third on the shelf (solitaire → match-3 →
**cribbage**). Unlike the single-player games, cribbage is two-player, so it is
**gated to its own plan** on the P2P transport + a fair-reveal primitive
(master-plan Phase 9). Not yet in the registry.

## Why it's gated
- [ ] **P2P transport** — browser-native peer play ("iroh but browser-native")
      via WebRTC / matchbox (see `beta/cairn/iroh-app-pond-building-blocks.md`,
      GGRS + matchbox). The single-player games need none of this; cribbage does.
- [ ] **Fair reveal** — the cut and hidden hands need a commit-reveal (or
      equivalent) so neither peer can cheat the shuffle/cut. This is the new
      primitive cribbage forces.

## Before any code
- [ ] Write the cribbage plan (its own doc), resolving transport + fair-reveal
      before board/scoring work. Reuse `pond-docformat` / `pond-outcome` for the
      verifiable game record where it applies.

## Then (mirrors the other games)
- [ ] `cribbage-core` (deal/scoring/pegging, determinism-first, golden vectors).
- [ ] `cribbage-wasm` binding + `src/games/cribbage.ts` board UI on the shared
      tokens + chrome contract.
- [ ] Add to `src/registry.ts`.
