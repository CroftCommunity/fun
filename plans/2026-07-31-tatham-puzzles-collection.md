# Tatham Puzzles — a Tier-2 collection (pathfinder: Net)

date: 2026-07-31
status: in progress
owner: chasemp

## Problem statement

The shelf's Tier-2 wraps are one-game-per-drawer-entry (Astray, HexGL, Clumsy
Bird). Simon Tatham's Portable Puzzle Collection is ~40 MIT-licensed,
100%-client-side logic puzzles — far too many to be 40 drawer rows, and wrapping
them one-by-one would bury the shelf. We want **one drawer entry** ("Puzzles")
that opens a **sub-picker** of the vendored puzzles, so the collection grows by
manifest, not by drawer clutter. First puzzle in: **Net**.

## Approach

- **Option A (chosen).** One `GameEntry` (`id: "puzzles"`, tier 2). Its module
  renders an accessible picker (a control per vendored puzzle) plus a host area,
  and mounts the selected puzzle through the shared `mountWrappedGame` iframe
  primitive. Selecting swaps the frame. No drawer/contract change — the "bump
  out" lives in the play area. `?p=<id>` deep-links a puzzle so each still has a
  URL. (Rejected: Option B, a real drawer flyout — heavier, touches the shared
  chrome/contract for no functional gain over A.)
- **Containment: inline the wasm (the load-bearing decision).** Each Tatham
  puzzle is emscripten output: `net.html` + `net.js` + **`net.wasm`**. Our
  containment contract mounts wraps in an **opaque-origin** sandbox
  (`allow-scripts`, no `allow-same-origin`). Stock `net.js` does
  `fetch('net.wasm')` at startup, and from an opaque origin that is a
  cross-origin request (`Origin: null`) that static hosting (GitHub Pages) cannot
  satisfy with a CORS header — so it would die. Fix: base64-inline the wasm into
  a generated `wasm-inline.js` that sets `window.Module.wasmBinary` **before**
  `net.js` runs (emscripten's documented override, present in the glue). The
  engine then uses the in-memory bytes and never fetches. One recorded patch to
  `net.html` (inject the script) + one generated file. **This is the reusable
  pattern for the whole collection** — every puzzle has the same shape.
- **Honest representation.** A wrap keeps no verifiable record; the shared
  `wrappedBanner` (credits Simon Tatham, MIT, links upstream) and the how-to say
  so. `verifiable: false` in the meta.
- **Provenance.** One `tier2.meta.json` for the collection; `net.wasm`
  (sha256 `3195eba328b17eab5d71de3c0c9783139b1083ea67c6e7c88e08f1a8c0e04892`) is
  inlined, not shipped separately, and the hash ties the inlined bytes to
  upstream. Vendored `LICENCE` is Tatham's Expat text (version `20260720.3c36322`).

## Verified assumptions (checked against the real bundle, 2026-07-31)

- `net.html` loads `net.js` with `<script defer src="net.js">` in `<head>`; a
  `defer` `wasm-inline.js` before it runs first (defer preserves document order).
- `net.js` honors `Module['wasmBinary']` (grepped: `instantiateArrayBuffer`
  fallback + `Module['wasmBinary']` present) → setting it skips the fetch.
- `net.js` wires to DOM ids in `net.html` (`puzzlecanvas`, `gamemenu`, `apology`,
  …); keep `net.html`'s body intact — patch is script-injection only.
- Sizes: `net.js` 108.5 KB, `net.wasm` 292.7 KB → inlined base64 ≈ 390 KB;
  disclosed `approxSizeKb` ≈ 500.
- CI (`deploy.yml`) runs typecheck/lint/unit/build, **not** Playwright — so the
  real-browser proof (Net's canvas actually renders under the sandbox) is run
  locally before merge; the parameterized `tier2-containment.spec.ts` auto-enrolls
  the new meta.

## Reasoning

Building fresh is wrong here (the value is 40 correct puzzles we would never
re-implement); a one-per-drawer wrap is wrong (shelf clutter). A manifest-backed
collection is the smallest change that scales. The inline-wasm patch is the one
genuinely new thing versus the existing JS-only wraps, and solving it once
unlocks the entire collection — so Net is a true pathfinder, not a one-off.

## Plan of record (TDD, commit at each green)

1. Collection module + manifest (`puzzles-unit.test.ts` RED → GREEN).
2. Registry entry + `tier2.meta.json` + `build.mjs` (`GAME_PAGES`/`TIER2_VENDORS`)
   + how-to guide; unit suite green (existing meta/how-to gates auto-enroll).
3. Vendor Net (`net.html` patched, `net.js`, `wasm-inline.js`, `LICENCE`);
   `npm run build` green.
4. `puzzles.spec.ts` + containment spec: prove Net renders contained (local
   chromium). 
5. Commit checkpoints → PR → merge after CI green.

## Deferred (TODO/puzzles.md)

- Add the next puzzles (Bridges, Light Up, Loopy, …) — manifest + vendor each.
- The build-vs-wrap fork with the planned Tier-1 hero puzzles (Mines / Solo /
  Pattern): wrap for breadth, build-fresh the heroes for verifiable outcomes.
- A how-to screenshot (shotless for v1).
