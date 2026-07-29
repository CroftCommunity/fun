# TODO — match-3

Status: **not playable** (`status: "soon"` in `src/registry.ts`). The engine
exists; the browser binding and UI do not. Shelf order: solitaire → **match-3** →
cribbage. Plan: `plans/2026-07-27-games-pond-fun-crofting.md` (master Phase 8).

## What exists
- [x] `crates/match3-core` — deterministic engine (match/clear/gravity/refill/
      cascade), rules doc + golden vectors, native==wasm cross-build verified.

## To make it playable (mirror the solitaire slice)
- [ ] **`match3-wasm`** — the browser binding (currently a stub). Follow the
      solitaire raw-C-ABI + serde-JSON pattern: wasm holds state, typed move
      exports, JSON board/legal-moves via the ptr/len output buffer, never
      panics.
- [ ] TS wrapper `src/games/match3-wasm.ts` (typed board/moves API).
- [ ] `src/games/match3.ts` — the `GameModule` board UI; reuse the felt/token
      identity (`tokens.css`) and the chrome mount contract.
- [ ] Verifiable outcome via the shared `pond-docformat` / `pond-outcome`
      substrate (already built) + a share/verify surface like solitaire's.
- [ ] Flip `registry.ts` match-3 to `status: "playable"`; wiring E2E.
- [ ] Meet the shelf standards in `docs/BUILDING-GAMES.md`: tap-first input with
      core-driven highlighting, the shared hints/assistance settings, and a
      "How to play" guide (`src/games/match3-howto.ts` + guide-shots + the
      registry entry).

## Deferred design (owner balance decisions)
- [ ] Cascade multipliers, par/levels, and specials — plain match-3 (no
      specials) is the locked P1 scope; the rest are later balance calls.
