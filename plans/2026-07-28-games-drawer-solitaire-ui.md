# Games drawer UI/UX + solitaire (first game) — `fun.croft.ing` front-end

**Status:** Pass 1+2+3 complete; open questions walked through (recommended defaults adopted; none
BLOCKING). Execution STARTED 2026-07-28. See the Review Log for progress.
**Relationship to the master plan:** this is the **front-end / product track**. It **expands and
replaces master-plan Phase 7** ("shelf shell + solitaire playable + deploy") in
`2026-07-27-games-pond-fun-crofting.md`, which treated the whole UI at one compressed altitude. The
**master plan still owns the Rust/determinism spine** — repo scaffold (its P1), cross-build test (P2),
`solitaire-core` determinism (P4), `pond-docformat` (P5), `pond-outcome` (P6). This plan depends on
those and does **not** re-specify them. Master-plan Phase 7 should be annotated to point here.

---

## Problem Statement

The domain `fun.croft.ing` and GitHub Pages are **live as of 2026-07-28**. The owner wants to build
**solitaire (Klondike draw-1) as the first game** in a **slide-out games drawer**, and to use that
build to **establish the overall drawer UI/UX** every future game (match-3, cribbage) plugs into.

The chosen interaction model (owner, 2026-07-28):
- A **slide-out drawer** is the primary navigation — it lists games and switches them over a
  **persistent play area**.
- Each game additionally offers **full-screen** (chrome hidden) and **open-in-new-tab**.
- **Consequence:** "open in new tab" means every game has its **own canonical URL** (e.g.
  `/solitaire`), and a game module must render **chrome-agnostically** into a mount point in all three
  modes — in-drawer, full-screen, standalone-tab.

Constraints:
- **Match croft-pwa's engineering conventions** (the standalone-repo decision reuses them): vanilla
  TypeScript + esbuild, Vitest, Playwright + `@axe-core/playwright`, ESLint, `tsc`, a service worker,
  and a design-token system (`tokens.css` / `theme.ts`). No UI framework.
- **Local-first, no account, no network** for solitaire — it must play offline for a stranger.
- The Rust `solitaire-core` (master-plan P4) is the source of truth for rules, legal moves, and the
  verifiable `state_hash`; the UI never re-implements game logic.

Scope of *this* plan: the **game-agnostic drawer UI/UX foundation** + **solitaire's playable delivery**
+ the **`solitaire-core` → browser binding** + **deploy to `fun.croft.ing`**. Out of scope (owned
elsewhere): the Rust cores and substrate crates (master plan); match-3 and cribbage front-ends (later);
drag-and-drop input (a named fast-follow after the tap foundation).

---

## Reasoning

### Why a separate front-end plan (not just master-plan Phase 7)

Master-plan Phase 7 compressed "shelf shell + solitaire playable + deploy" into one phase because the
master plan's altitude was the whole pond. Building solitaire *as the vehicle to establish the drawer
UI/UX* is a real, multi-phase front-end effort (chrome, routing, design system, wasm binding, board
UI, PWA/a11y, deploy) that deserves its own decomposition. Keeping it separate also lets the
**front-end track run partly in parallel** with the Rust core: the drawer chrome + design system need
no game logic and can be built while `solitaire-core` (master P4) is written.

### Why drawer + full-screen + new-tab ⇒ per-game URLs ⇒ a chrome-agnostic mount contract

The "open in new tab" affordance forces each game to be addressable at its own URL. Rather than a SPA
with client-side routing (which needs a 404-fallback hack on static GitHub Pages), each game gets a
**static per-game entry page** (`/solitaire/index.html`) that mounts the shared drawer chrome + that
game. Clean URLs, new-tab and sharing work with zero routing tricks, and it matches croft-pwa's
multi-page precedent and Pages' static hosting. The **game module implements one contract**
(`mount(container, services)` / `unmount()` / metadata) and is handed a container by whichever chrome
is active — it never knows whether it is in the drawer, full-screen, or a standalone tab. This is the
single most important architectural decision: it is what lets the drawer be built once and every game
reuse it. It also realizes the card-maker thread's "the game is a portable artifact at a URL" principle.

### Why vanilla TS + esbuild (match croft-pwa), not a framework

croft-pwa is deliberately framework-free ("built to the standards it documents"): vanilla TS + esbuild,
a hand-rolled service worker, design tokens, Vitest + Playwright + axe. Reusing that keeps the estate
consistent, keeps the bundle tiny (a games shelf must load fast and run offline), and inherits proven
a11y/PWA tooling. A framework would diverge from the estate and add weight for no gain on a small,
mostly-canvas/DOM card UI.

### Why tap-to-move first, drag as a fast-follow

Tap-source → tap-target works identically for mouse, touch, and keyboard; it is the accessible baseline
and makes legal-move highlighting natural (the core returns legal targets; the UI glows them). Drag is
tactile and card-native but is an *enhancement* that must not become the only path (touch/keyboard/
screen-reader users need the tap model regardless). Building tap first establishes an accessible
foundation; drag layers on later against the same core legal-move check without re-architecting.

### Why its own playful identity on croft-pwa's token architecture

A games property at `fun.croft.ing` reads wrong in the estate's utilitarian look. It gets its **own
palette, type, and card/felt motifs**, but built on croft-pwa's **token architecture** (`tokens.css`
structure, `theme.ts`, light/dark, the axe contrast gate) so the engineering discipline is inherited
while the surface is distinct. The `frontend-design` skill guides this phase; the `dataviz` palette
discipline applies to any stats surfaces (clean-clear counts).

### Why wasm-bindgen + serde-JSON board state for the browser binding

The UI needs the **full board** (tableau/foundations/stock/waste, legal moves), not just the
`state_hash`. `solitaire-core` already uses serde, so the binding exposes a **string-in/string-out**
surface — `new_game(seed) → board JSON`, `legal_moves(state) → JSON`, `play_move(state, mv) → board
JSON`, `is_won`, plus the `state_hash` / outcome hooks — marshalled by **wasm-bindgen** (the standard,
well-maintained browser-wasm path; "boring" in the good sense). Determinism is a property of the
*core* compiled to `wasm32-unknown-unknown`, verified once by the master plan's cross-build test;
wasm-bindgen only adds a marshalling layer over that same core, so the browser build and the
determinism-test build share identical game logic. (The master plan's determinism *test* keeps its
minimal `wasm32-unknown-unknown` + node path; this is not in tension — same target, same core.)

### Alternatives considered and rejected

- **SPA client-side routing** — rejected: needs a 404-fallback hack on static Pages; per-game static
  entry pages are simpler and give clean shareable URLs for free.
- **React/Svelte** — rejected: diverges from the framework-free estate, adds bundle weight for a small
  DOM card UI.
- **Drag-first input** — rejected as the *foundation*: accessibility risk; tap-first is the baseline,
  drag is the enhancement.
- **Full-screen-launch-only or single-page-scroll drawer** — rejected: owner chose the slide-out
  drawer + full-screen + new-tab model.
- **Inherit croft-pwa's utilitarian look** — rejected: reads wrong for a games property (own identity,
  shared token architecture).
- **Manual (non-wasm-bindgen) linear-memory string marshalling** — rejected: error-prone pointer/len
  bookkeeping for no real dependency-minimalism win at the app layer; wasm-bindgen is the boring choice.

---

## Verified Assumptions

Confirmed firsthand this session:

- **croft-pwa stack** (`croft-pwa/package.json`, `croft-pwa/src/`): vanilla TS + **esbuild**
  (`build.mjs`), **Vitest**, **Playwright** + **`@axe-core/playwright`**, ESLint, `tsc --noEmit`; a
  hand-rolled service worker (`sw.ts`/`sw-register.ts`/`sw-nav.ts`), `theme.ts`, **`tokens.css`** +
  `styles.css` + a `brand.html`, `manifest.webmanifest`, and a **multi-page** layout (per-topic
  `.html` entry files + `nav.ts`). This is the convention set to inherit.
- **`fun.croft.ing` domain added and GitHub Pages active** (owner, 2026-07-28) — deploy target is
  unblocked.
- **`solitaire-core` does not exist yet** — it is master-plan Phase 4 (Klondike draw-1). This plan's
  Phases 3–4 depend on it; Phases 0–2 do not.

Unverified — resolve in Phase 0 or note:

- **wasm-bindgen / wasm-pack are not installed** (only the `wasm32-unknown-unknown` rustup target is
  present, per the master plan's discovery). Phase 0 installs/pins the toolchain and proves a
  hello-world `solitaire-core → browser` round-trip.
- The exact **board-state JSON shape** `solitaire-core` should expose for the UI (piles, card
  face-up/down, legal-move descriptors) — pinned in Phase 0 against the core's model, then frozen as
  the binding contract.
- Whether the slide-out drawer's **focus-trap + ESC + gesture** can be made clean and accessible in
  vanilla TS without a library — validated by a throwaway spike in Phase 0.

---

## Documentation Impact

- **`fun/README.md`** — add the drawer UX + per-game-URL model + "how to add a game" (the module
  contract). Phase 1.
- **`fun/docs/GAME-MODULE-CONTRACT.md`** (NEW) — the interface a game implements (`mount`/`unmount`/
  metadata) and the three presentation modes. Phase 1.
- **`fun/docs/DESIGN.md`** + **`fun/src/tokens.css`** (NEW) — the playful identity + token system.
  Phase 2.
- **`discovery/alpha/plans/2026-07-27-games-pond-fun-crofting.md`** — annotate master-plan **Phase 7**
  to "expanded/replaced by `2026-07-28-games-drawer-solitaire-ui.md`"; this edit is a **discovery-repo**
  edit and is done **once, sequentially** (not inside any parallel set). Phase 1 of this plan.
- **`discovery/alpha/ROADMAP_TODO.md` E46** — breadcrumb to this companion plan. Phase 1 (sequential).
- **`fun/plans/2026-07-28-games-drawer-solitaire-ui.md`** — this plan copied into the repo once it
  exists (master P1 creates the repo). Phase 1.
- **`discovery/alpha/thinking/app/prds/games-pond.md`** — the drawer UX + solitaire-first shelf order
  recorded when the shelf goes live. Phase 6 (shared with master-plan Phase 7's doc update — do it once,
  here).

If the plan adds a file and no reference exists yet: grepped `fun.croft.ing` and `games drawer` in
`discovery/` — the only references are the two plan docs and E46, all updated above.

---

## Concurrency Map

```
Cross-plan spine:
  master P1 (repo + web skeleton)
    ├─ THIS P1 (drawer chrome) → THIS P2 (design system)      ┐ front-end track,
    │                                                          │ parallel with ↓
    └─ master P2/P4 (cross-build test + solitaire-core)       ┘ the Rust track
        → THIS P3 (solitaire-core → browser binding)   [needs master P4]
          → THIS P4 (solitaire playable UI)            [needs THIS P3 + master P6]
            → THIS P5 (PWA + a11y + responsive)
              → THIS P6 (deploy to fun.croft.ing)
  Fast-follow: THIS P7 (drag-and-drop enhancement)
```

**Cross-plan parallelism:** **Only THIS-P1 + THIS-P2** (drawer chrome + design system) run in parallel
with the Rust track (master P2/P4) — they are game-logic-free and write only `fun/app/**`, `fun/src/**`,
`fun/docs/**`, disjoint from the Rust track's `fun/crates/**`, with the workspace `Cargo.toml` frozen by
master P1. **THIS-P3 onward is sequential** (P3 depends on master P4 and itself writes
`fun/crates/solitaire-wasm/**`, so it must not overlap the Rust track). During the P1/P2‖Rust window the
**only writer of the discovery repo is THIS-P1** (the one-time master-P7 annotation + E46 breadcrumb);
the Rust track (master P2/P4) touches no discovery file, so there is no shared-tree collision.
**Re-entry checks (if run as concurrent agents):** parent-repo HEAD unchanged; the front-end agent left
`fun/crates/**` untouched and the Rust agent left `fun/app|src|docs/**` untouched; `git -C discovery
status` clean apart from THIS-P1's single pointer commit; no orphan `node`/`esbuild`/`cargo` processes;
no dev-server port left bound.

**Within this plan:** phases are otherwise **sequential** — each builds on the prior UI layer (chrome →
design → binding → board UI → PWA/a11y → deploy). No intra-plan parallel set. Re-entry checks apply
only if the cross-plan tracks are run as concurrent agents: parent-repo HEAD unchanged; `fun/crates/**`
untouched by the front-end agent; `git -C discovery status` clean except the single sequential pointer
commit; no orphan `node`/`esbuild`/`cargo` processes; no dev-server port left bound.

---

## Phases

### Phase 0: Discovery / throwaway spikes

**Goal:** De-risk the two things that could invalidate the build — the wasm-browser binding and the
accessible slide-out drawer — and freeze the binding's board-state shape.

- [ ] **D1: wasm-bindgen browser round-trip.** Install/pin `wasm-pack` + `wasm-bindgen-cli`; build a
  throwaway crate exposing `hello(seed:u64)->String` compiled to wasm; load it in a browser via esbuild
  and call it from TS. **Success:** a value computed in Rust appears in the DOM from a wasm module built
  the way the real binding will be. **Disposition:** `throwaway`.
- [ ] **D2: board-state JSON shape.** Against `solitaire-core`'s model (master P4; if not yet built,
  against its `RULES.md` state-hash field layout), pin the JSON the UI consumes: piles (tableau ×7,
  foundations ×4, stock, waste), each card's rank/suit/face-up, and the legal-move descriptor shape.
  **Success:** a written schema the binding (P3) and the UI (P4) both target. **Disposition:**
  `keep-as-fixture` — becomes the binding contract + UI test fixtures.
- [ ] **D3: accessible drawer spike.** One throwaway page: a slide-out drawer with focus-trap, ESC to
  close, a keyboard-reachable toggle, and a full-screen toggle — in vanilla TS, no library. Run axe on
  it. **Success:** yes/no that the interaction is clean and axe-clean without a framework; notes on the
  gesture/animation approach. **Disposition:** `throwaway` — delete; do not let it become the real chrome.

**Done when:** D1 proves the binding path, D2 freezes the board schema, D3 confirms the drawer is
tractable and accessible in vanilla TS (or surfaces a blocker to resolve before Phase 1). Findings +
schema recorded here.
**Discovery Exemption applies** (phase-plan/execute.md): spikes are exempt from TDD/commit rules; honor
each Disposition.

---

### Phase 1: Front-end scaffold + game-agnostic drawer chrome

**Goal:** In the `fun` repo (created by master P1), a working web app scaffold matching croft-pwa, plus
the **slide-out drawer chrome + play-area mount point + per-game static URLs + the three presentation
modes**, proven with a **placeholder game module** — no solitaire logic yet.

**Changes:**
- [ ] App scaffold: `build.mjs` (esbuild), Vitest, Playwright + `@axe-core/playwright`, ESLint, `tsc`,
  service worker registration, `manifest.webmanifest` — mirroring croft-pwa's setup.
- [ ] The **game-module contract** (`fun/docs/GAME-MODULE-CONTRACT.md` + a TS type): `mount(container,
  services)`, `unmount()`, and static metadata (id, title, icon). A game renders only into `container`
  and knows nothing about the chrome.
- [ ] Slide-out **drawer chrome**: game list, slide in/out, focus-trap + ESC + keyboard toggle (from
  the D3 spike, rebuilt for real, tested), a play-area mount region, a **full-screen** toggle (chrome
  hidden), and an **open-in-new-tab** affordance.
- [ ] **Per-game static entry pages** (`/<game>/index.html`) that mount the chrome + that game by id —
  clean shareable URLs, new-tab works, no SPA-routing hack. A `/` home lists games.
- [ ] A **placeholder game module** implementing the contract (renders "hello, I am mounted in <mode>")
  to exercise the chrome in all three modes.

**Call chain:** `/` (or `/placeholder`) → chrome boot → drawer lists games → select → `module.mount(
container, services)` → placeholder renders; full-screen toggle re-parents/re-styles the same mount;
`/placeholder` loaded directly (new tab) mounts the same module chrome-agnostically.
**Wiring test:** a Playwright E2E `drawer.spec.ts` — load `/`, open the drawer (assert focus-trap +
ESC + keyboard toggle), launch the placeholder into the play area, toggle full-screen (assert chrome
hidden **and the same mounted instance is preserved — not remounted/reset**, verified via an instance
marker/counter the placeholder increments on `mount`), and load `/placeholder` directly in a fresh page
(assert it mounts with no drawer dependency). axe clean on the chrome. RED before the chrome exists,
GREEN after.
**Depends on:** master-plan Phase 1 (repo + workspace + web skeleton stub); Phase 0 (D3 drawer, D1
build path).
**Read-set:** croft-pwa config (read for convention reuse), master-plan repo skeleton.
**Write-set:** `fun/app/**`, `fun/src/**` (chrome, router-less per-game pages, SW), `fun/docs/GAME-
MODULE-CONTRACT.md`, `fun/README.md`; **and the single sequential discovery-repo edit** — annotate
master-plan Phase 7 to point here + E46 breadcrumb.
**Shared-state contract:** Front-end-only in the `fun` tree; the one discovery-repo edit is done here
sequentially (not in any parallel set). Dev server binds a port only locally, never in CI. Does not
touch `fun/crates/**` (the Rust track's tree).
**Risks:** the drawer's focus-trap/gesture is the classic a11y trap — mitigated by the D3 spike and the
axe gate in the wiring test. Full-screen re-parenting must not unmount/reset the game (preserve the
mount instance) — asserted by the wiring test.
**Done when:**
1. **Behavioral:** A user can open the drawer, launch the placeholder game into the play area, expand
   it full-screen, and open it in a new tab at its own URL — all keyboard-accessible — with no game
   logic present. The chrome is reusable by any game implementing the contract.
2. **Verification:** `npm run e2e -- drawer.spec.ts` + axe pass; the placeholder mounts in all three modes.
**Validation:** **Moderate.** Wiring E2E across the three modes + axe + a manual keyboard-only pass.

---

### Phase 2: Design system — the playful identity

**Goal:** `fun.croft.ing`'s **own playful visual identity** built on croft-pwa's token architecture,
applied to the drawer chrome and placeholder. Establishes the look every game inherits.

**Changes:**
- [ ] `fun/src/tokens.css` + `theme.ts`: palette, type scale, spacing, radii, elevation, light/dark —
  structured like croft-pwa's tokens but with a distinct games palette and card/felt motifs. Guided by
  the `frontend-design` skill; contrast validated (the `dataviz` palette discipline for any stat tiles).
- [ ] `fun/docs/DESIGN.md`: the identity, tokens, and usage rules.
- [ ] Apply the theme to the drawer chrome + placeholder; light/dark toggle via `theme.ts`.

**Call chain:** chrome + game modules consume CSS custom properties from `tokens.css`; `theme.ts`
switches themes at the root.
**Wiring test:** `theme.spec.ts` — the drawer + placeholder render with the tokens applied; toggling
light/dark updates computed styles; axe contrast passes in **both** themes (the edges: light and dark,
not one happy-path theme).
**Depends on:** Phase 1 (chrome to theme).
**Read-set:** croft-pwa `tokens.css`/`theme.ts`/`brand.html` (reference), Phase 1 chrome.
**Write-set:** `fun/src/tokens.css`, `fun/src/theme.ts`, `fun/docs/DESIGN.md`, chrome style files.
**Shared-state contract:** Front-end-only; no shared mutable state beyond the file write-set.
**Risks:** contrast failures in dark mode (the common miss) — caught by the both-themes axe assertion.
Over-designing before a game exists — keep it to tokens + chrome; card/felt specifics land with the
solitaire UI (Phase 4).
**Done when:**
1. **Behavioral:** The drawer and placeholder wear a distinct, accessible games identity in light and
   dark; a new game inherits it by using the tokens.
2. **Verification:** `npm run e2e -- theme.spec.ts` + axe contrast green in both themes.
**Validation:** **Moderate.** Wiring test + axe in both themes + a manual look review against `DESIGN.md`.

---

### Phase 3: `solitaire-core` → browser binding

**Goal:** A `solitaire-wasm` binding (wasm-bindgen) exposing the D2 board-state surface to TS, so the
UI can drive the Rust core in the browser. The UI never re-implements rules.

**Changes:**
- [ ] `fun/crates/solitaire-wasm` (wasm-bindgen) over `solitaire-core`: `new_game(seed) → board JSON`,
  `legal_moves(state) → JSON`, `play_move(state, mv) → board JSON`, `is_won(state) → bool`, plus
  `state_hash` / outcome hooks (via `pond-outcome`, master P6). Board JSON matches the D2 schema.
- [ ] Generated/curated TS types for the board + moves; a `build.mjs` step that builds the wasm and
  places it for esbuild.
- [ ] A TS-side wrapper that loads the wasm and presents a typed API to the UI.
- [ ] **Mismatch diagnostics:** if a golden vector's hash diverges *through the binding*, the test logs
  the vector id + the native (core) hash + the binding hash, so a boundary regression is debuggable —
  not a bare "hashes differ."

**Call chain:** UI → `solitaireWasm.newGame(seed)` → wasm → `solitaire-core` → board JSON → typed TS
object the UI renders.
**Wiring test:** `binding.spec.ts` (Vitest, node-hosting the wasm) — load the wasm, replay a
golden-vector `(seed, move list)` **through the binding**, assert the board states and the final
`state_hash` equal the core's committed vector anchors. Proves determinism survives the browser
boundary, not just in Rust. RED before the binding, GREEN after.
**Depends on:** master-plan **Phase 4** (`solitaire-core` exists), Phase 0 (D1 toolchain, D2 schema).
**Read-set:** `fun/crates/solitaire-core/**`, its `vectors/**`, `fun/crates/pond-outcome/**`.
**Write-set:** `fun/crates/solitaire-wasm/**`, the TS wrapper under `fun/src/games/solitaire/`, the
`build.mjs` wasm step.
**Shared-state contract:** Builds to a wasm target dir; the test hosts wasm in node, no port. Does not
touch other games' trees.
**Risks:** the binding's board JSON drifts from the core model → a UI that renders stale state; pinned
by the D2 schema + the golden-vector wiring test asserting through the boundary. wasm-bindgen version
skew — pin it exactly (P10 posture).
**Done when:**
1. **Behavioral:** TS can start a solitaire game, read the full board, enumerate legal moves, apply a
   move, and detect a win — all computed by the Rust core over wasm — reproducing the golden-vector
   hashes through the browser boundary.
2. **Verification:** `npm run unit -- binding.spec.ts` green (golden-vector replay through the binding).
**Validation:** **Broad.** Wiring test + confirm the same wasm target the master cross-build test
covers + one manual `newGame → play → win` from a REPL/console.

---

### Phase 4: Solitaire playable UI (the first game module)

**Goal:** Solitaire is **playable** in the drawer: a real board over `solitaire-wasm`, **tap-source →
tap-target** input with legal-move highlighting from the core, draw-1 stock cycling, win detection, and
a **verifiable outcome record** (`pond-outcome`, master P6). It implements the Phase 1 game-module
contract, so it mounts in all three modes.

**Changes:**
- [ ] `fun/src/games/solitaire/` — board renderer (tableau/foundations/stock/waste) using the design
  tokens + card/felt motifs; reads board JSON from the binding.
- [ ] **Tap-to-move** input: tap a card/stack → core `legal_moves` → glow legal targets → tap target →
  `play_move` → re-render. Illegal taps rejected by the core (UI never decides legality). Draw-1 stock
  → waste cycling; stock pass-limit per `RULES.md`.
- [ ] Win detection → a celebration + a `pond-outcome` record (clean-clear count; verifiable by replay).
- [ ] Register solitaire in the drawer catalog; ensure it mounts in-drawer, full-screen, and at
  `/solitaire`.

**Call chain:** `/solitaire` (or drawer launch) → `module.mount` → `newGame(seed)` → render board →
tap → `legal_moves`/`play_move` → re-render → win → `pond-outcome.attest` → record shown.
**Wiring test:** `solitaire.spec.ts` (Playwright E2E) — load `/solitaire`, play a **scripted winning
deal** entirely via taps, assert the win state **and** a verifiable outcome record. Name the UI-layer
edges (not one happy path): an illegal tap is rejected (core-enforced, board unchanged); tapping a card
glows exactly the core's legal targets; stock draw-1 cycling and the pass-limit boundary behave; the
win celebration fires exactly when all 52 are on the foundations, not before. Repeat the launch
in-drawer and full-screen. The single most important test that the whole chain — URL → chrome → module
→ wasm core → outcome — is live. RED before the UI, GREEN after.
**Depends on:** Phase 3 (binding), Phase 1 (chrome + contract), Phase 2 (design tokens), master-plan
Phase 6 (`pond-outcome`).
**Read-set:** the binding wrapper, `fun/src/tokens.css`, the game-module contract.
**Write-set:** `fun/src/games/solitaire/**`, the drawer catalog registration.
**Shared-state contract:** Front-end-only; no shared mutable state beyond the file write-set.
**Risks:** the UI drifting into deciding legality (must delegate to the core) — the illegal-tap
assertion guards it. Rendering a large tableau on small screens — deferred to Phase 5's responsive pass,
but keep the renderer layout-driven not fixed-pixel.
**Done when:**
1. **Behavioral:** A player can open Solitaire (in the drawer, full-screen, or at `/solitaire`), play a
   Klondike draw-1 deal to a win using taps with legal-move highlighting, and get a verifiable
   clean-clear record — the first game is real.
2. **Verification:** `npm run e2e -- solitaire.spec.ts` green (scripted win + illegal-tap rejection +
   all three modes).
**Validation:** **Broad.** Wiring E2E + a manual play session (mouse and touch) + confirm the outcome
record re-verifies (Phase 6 / master P6 integration).

---

### Phase 5: PWA + accessibility + responsive/touch polish

**Goal:** Solitaire and the drawer are **installable, offline-playable, accessible, and good on a
phone** — the durability + a11y posture (master P6) applied to the front-end.

**Changes:**
- [ ] Service worker caches the app shell + wasm so solitaire plays **offline**; `manifest.webmanifest`
  for install; iOS Home-Screen install copy (per the Web-Push/P6 note — install gates persistent
  storage).
- [ ] Responsive, mobile-first board layout; touch targets sized; the drawer becomes an edge sheet on
  small screens.
- [ ] Full keyboard nav + screen-reader labels for cards/piles/moves; the tap model already supports
  keyboard-select + Enter.
- [ ] Bundle budget enforced (code-split the wasm so the shelf doesn't ship every game's wasm up front).

**Call chain:** first load caches shell+wasm via SW → subsequent loads work offline → install → runs
from Home Screen.
**Wiring test:** `offline.spec.ts` — load, go offline (SW), reload, assert solitaire still launches and
plays a move; axe full-page pass on `/solitaire`; a bundle-size assertion under budget. RED before SW/
a11y, GREEN after.
**Depends on:** Phase 4 (a game to make offline/accessible).
**Read-set:** the SW, the solitaire module, the manifest.
**Write-set:** `fun/src/sw.ts`, `manifest.webmanifest`, responsive styles, a11y attributes, bundle config.
**Shared-state contract:** SW registration is per-origin in the browser; no server state. No shared
mutable state beyond the file write-set.
**Risks:** SW caching the wrong wasm version (stale play) — content-addressed asset names + a version
bump on release (the croft-pwa update-toast pattern). Safari 7-day eviction — Home-Screen install is
the mitigation, surfaced in onboarding copy.
**Done when:**
1. **Behavioral:** Solitaire installs to the Home Screen, plays fully **offline**, is keyboard- and
   screen-reader-navigable, and fits a phone screen; the bundle is within budget.
2. **Verification:** `npm run e2e -- offline.spec.ts` + axe + bundle-budget assertion green.
**Validation:** **Broad.** Wiring tests + a manual install + airplane-mode play on a real phone if
available (browser drift is real-device territory per P10).

---

### Phase 6: Deploy to `fun.croft.ing`

**Goal:** The drawer + solitaire are **live at `fun.croft.ing`** (domain + Pages already active), with
per-game URLs resolving, PR previews, and telemetry.

**Changes:**
- [ ] Wire the GitHub Pages deploy (build → `gh-pages`); confirm `/` and `/solitaire` resolve on the
  live domain; PR-preview deploys enforce the a11y + bundle gates (croft-pwa conventions).
- [ ] Telemetry via the borrowed hook: game-launch / game-complete / outcome-verify events (no PII,
  local-first).
- [ ] Update `prds/games-pond.md` (candidate → building; drawer UX + solitaire-first recorded) and E46
  ("drawer + solitaire live"). Both discovery-repo edits, done here sequentially. (This is the shared
  doc update with master-plan Phase 7 — done once, here.)

**Call chain:** push → CI build → Pages deploy → `fun.croft.ing/solitaire` serves the live game.
**Wiring test:** `live.spec.ts` (Playwright) — against a **local production build** (sandbox egress may
block a live-domain E2E per memory `sandbox-browser-egress-blocks-live-tests`): `/` lists games, drawer
works, `/solitaire` plays to a win. The live-domain smoke check is handed to a networked env.
**Depends on:** Phase 5 (shippable PWA); the live domain/Pages (owner, 2026-07-28).
**Read-set:** the built app, CI config.
**Write-set:** CI deploy config; discovery-repo edits `prds/games-pond.md`, E46.
**Shared-state contract:** Deploy is the one **outward-facing** action — public and hard to fully
un-publish; **confirm with owner before the first production deploy.** PR previews are fine unattended.
**Risks:** Pages custom-domain/HTTPS propagation quirks — verify the cert + apex/subdomain config; the
live smoke check catches it. Sandbox egress blocks the live E2E — mitigated by the local-prod-build E2E
+ handing the live check to a networked env.
**Done when:**
1. **Behavioral:** A stranger opens `fun.croft.ing`, uses the drawer, and plays solitaire to a
   verifiable win — the first game is live on the real domain.
2. **Verification:** `live.spec.ts` green against the local prod build; the deploy job succeeds and the
   live domain smoke check passes (in a networked env if the sandbox can't reach it).
**Validation:** **Broad.** Wiring E2E + confirm deploy + a manual visit to the live domain (or handoff)
+ verify a live outcome record re-verifies.

---

### Phase 7 (fast-follow): drag-and-drop input enhancement

**Goal:** Layer pointer **drag-and-drop** onto the tap foundation for card-native feel, with the tap
model retained as the always-present accessible fallback. Not required for the first live slice.

**Changes:** pointer drag with a ghost card; drop targets validated by the **same** core `legal_moves`
check the tap path uses; tap/keyboard/screen-reader paths unchanged.
**Wiring test:** `drag.spec.ts` — a drag from a source to a legal target moves the card; a drag to an
illegal target snaps back (core-enforced); the tap fallback still passes `solitaire.spec.ts`.
**Depends on:** Phase 4.
**Done when:** drag works on pointer devices without regressing the tap/keyboard/a11y paths.
**Validation:** **Moderate.** Wiring test + manual drag on mouse + touch; re-run the a11y suite.

---

## Open Questions

- **[PHASE-GATED (Phase 3) — recommendation stands]** Confirm the D2 board-state JSON shape once
  `solitaire-core` (master P4) is built — the binding + UI both target it. Pinned against the real model
  in Phase 3, not now; does not block Phases 0–2.
- **[RESOLVED 2026-07-28 — execute-time]** Routing: **per-game static entry pages** (`/<game>/index.html`),
  not a client router. Clean shareable URLs, new-tab works, no Pages 404-hack. Locked because Phase 1
  is executing now. Overridable if it proves awkward.
- **[ADVISORY — recommendation adopted, revisit at Phase 4]** solitaire **undo / hints**: undo allowed,
  but a **clean clear means none used** (the binary assistance-used axis from the corpus). Confirm the
  exact UX when Phase 4 lands.
- **[RESOLVED 2026-07-28]** Theme: **follow system preference with a manual toggle** (croft-pwa
  `theme.ts` pattern). Applies at Phase 2.

---

## Review Log

- **2026-07-28 — Pass 1+2 (combined).** Authored as the front-end/product companion to the master plan
  (`2026-07-27-games-pond-fun-crofting.md`), expanding its compressed Phase 7. Inputs: owner decisions
  this session (slide-out drawer + full-screen + new-tab; own playful identity on croft-pwa token
  architecture; tap-to-move first, drag as fast-follow), the confirmed live domain + Pages (2026-07-28),
  and the verified croft-pwa stack (vanilla TS + esbuild + Vitest + Playwright + axe + SW + tokens,
  multi-page). Agent-decided technical items with rationale: stack = match croft-pwa; browser binding =
  wasm-bindgen + serde-JSON board state.
  - **Key architecture:** drawer + full-screen + new-tab ⇒ per-game canonical URLs ⇒ a chrome-agnostic
    game-module mount contract (`mount`/`unmount`/metadata). Built once, reused by every game. Realizes
    the card-maker thread's "game is a URL" principle.
  - **Pass 2 gap analysis folded in:** (1) The front-end track (Phases 1–2) runs parallel with the Rust
    track (master P2/P4) on disjoint write-sets (`fun/app`+`fun/src` vs `fun/crates`), converging at
    Phase 3 — documented in the Concurrency Map with re-entry checks. (2) All discovery-repo edits
    (master-P7 annotation, E46, prds) are done **once, sequentially** (Phase 1 and Phase 6), never in a
    parallel context — same lesson as the master plan's Pass 3 fix. (3) Determinism-vs-binding
    reconciled: wasm-bindgen and the master cross-build test compile the same core to the same wasm
    target, so no conflict. (4) Named the sandbox browser-egress limit (memory) as a Phase 6 risk with
    the local-prod-build-E2E mitigation. (5) Every phase has a wiring test through the real entry point
    (URL/chrome/wasm), not isolated component tests.
  - **Honesty holds:** does not re-specify the Rust cores/substrate (master plan owns them, referenced
    by dependency). Board-state schema is pinned against the real model in Phase 0/3, not assumed. Drag
    input is a fast-follow, not smuggled into the accessible foundation.
  - **Pending:** Pass 3 quality gates (fresh context) + annotate master-plan Phase 7 to point here.

### Pass 3: Quality Gates — 2026-07-28
**TDD ordering:** Every phase is test-first with a wiring test through the real entry point (URL/chrome/
wasm boundary). No ordering changes.
**Specificity / mutation resistance:** Strengthened Phase 1 (full-screen must preserve the *same* mount
instance, checked via a counter) and Phase 4 (named UI-layer edges: illegal-tap rejected + board
unchanged, legal-target glow matches the core, stock cycling + pass-limit boundary, win fires exactly
at 52-on-foundations).
**Observability:** Added Phase 3 mismatch diagnostics (vector id + core hash + binding hash on
divergence); Phase 6 telemetry events already present.
**Debugging readiness:** commit-per-phase + wiring tests as checkpoints; the binding-boundary hash
diagnostics are the key instrumented failure.
**Validation calibration:** Broad for the wasm-boundary / playable / offline / deploy phases (3–6),
Moderate for chrome/design/drag (1, 2, 7). Holds.
**Concurrency honesty:** Clarified that **only THIS-P1/P2** run parallel with the Rust track (disjoint
`fun/app|src|docs` vs `fun/crates`); THIS-P3 onward is sequential (it writes `fun/crates/solitaire-wasm`
and depends on master P4). Confirmed THIS-P1 is the sole discovery-repo writer in the parallel window;
added a one-to-one cross-agent re-entry checklist. No new parallelism to surface.
**Discovery (Phase 0):** spikes are concrete with dispositions (D1 throwaway, D2 keep-as-fixture, D3
throwaway); D1 (wasm-bindgen round-trip) is the first execution probe.
**Coherence:** solves the stated problem (drawer UX + solitaire first); scope matches; Documentation
Impact complete; master-P7 annotation done. No end-of-plan docs phase.
**Documentation impact:** every doc has an owning phase; discovery-repo edits are sequential (P1, P6).
**Confirmed ready:** yes. Open-question walk-through: routing → per-game static pages (locked); theme →
follow-system + toggle (locked); undo/hints → undo allowed, clean-clear = none used (adopted, confirm
at P4); board-state schema → pinned at Phase 3 against the real core. None BLOCKING.

### Execution log
- **2026-07-28 — execution started.** Beginning at master-plan **Phase 1** (create `CroftCommunity/fun`,
  Cargo workspace, promote `match3-core`), since this front-end plan's Phases 1–2 depend on the repo +
  web skeleton. Progress recorded below as phases complete.
