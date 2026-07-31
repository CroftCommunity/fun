# SuperTuxKart — Tier-2 wrap (the "big-download-then-offline" class-definer)

**Status:** Pass 1 (planning) 2026-07-31. Not started. This is the **first real
Tier-2 wrap** on `fun.croft.ing`, so it does double duty: it wraps SuperTuxKart
**and** ratifies the reusable Tier-2 standard the Tux Racer spike drafted
(`plans/2026-07-30-tux-racer-wrap-spike.md`) — the vendored-bundle pattern, the
Playwright containment/legibility gate, honest representation, and the
big-download disclosure. Owner adopted SuperTuxKart 2026-07-30 (discovery
COHESION §62). Pass 2/3 pending before execution.

> Wrap, not build. STK is a full 3D kart racer; rebuilding it Tier-1 is not on
> the table. TDD here governs the **wrapper + containment harness** we write, not
> the vendored engine.

## Problem Statement

`fun.croft.ing` is a two-tier shelf. Tier 1 is Croft-native/verifiable
(solitaire, match-3, bubble — all shipped/live). Tier 2 is **opportunistic
ethical wraps**: already-packaged, static, non-extractive games taken as-is, with
**no verifiable outcome — stated honestly** — gated by a real-browser
containment/legibility harness instead of the verifiable-outcome standard. The
owner defined a specific Tier-2 class for heavy titles: a **large one-time
download that then runs fully offline**, admitted *with up-front size
disclosure*. SuperTuxKart is the class-definer.

Goal: SuperTuxKart is playable at `/supertuxkart/`, wrapped as a contained,
honestly-represented Tier-2 game, and the reusable Tier-2 wrapped-game standard
is codified in `docs/BUILDING-GAMES.md`.

## Reasoning

- **Wrap a vendored WASM bundle.** The community WASM port (Emscripten) runs
  fully client-side/static — exactly the Tier-2 shape. We vendor it as a
  self-contained per-game directory (game isolation) and mount it behind our
  chrome; we do not touch the engine.
- **Untrusted code in our chrome → containment is the gate.** A third-party WASM
  bundle can, in principle, navigate the top window, exfiltrate over the network,
  or bleed into our DOM/CSS/storage. So contract-fit is *proven in a real
  browser*: an `iframe[sandbox]` + a network-egress allowlist (the webxdc/Cure53
  lesson — CSP alone does not contain a webview), asserted by a Playwright
  harness. This harness is the reusable Tier-2 gate; STK is where it is first
  built for real.
- **Big-download-then-offline, disclosed.** ~120 MB up front, ~500 MB RAM. The
  wrapper shows a size-and-what-happens notice and requires an explicit tap
  before it fetches — the instant-start ideal does not apply, so we are honest
  about the trade instead of hiding it.
- **No verifiable outcome — say so.** STK has no move-list/state-hash record. The
  game page and registry mark it as an **arcade (Tier-2) game with no verifiable
  result**, so it never reads as one of the verifiable games.
- **GPL, handled as aggregation.** STK is GPL; we redistribute it as its own
  licensed bundle (its `LICENSE`, upstream pin, attribution, source offer),
  aggregated beside our AGPL code — not folded into our copyleft (per the Tux
  spike T1 finding). Confirm the exact engine + asset licenses at Phase 0.

## Verified Assumptions

- **The WASM port is real** (from the discovery catalog + Tux spike, web-verified
  2026-07-30): `ading2210/stk-code` (wasm branch), live at
  `supertuxkart.pages.dev`; **GPL**; **~120 MB initial download / ~500 MB RAM**;
  networking-off / experimental. All still `[UNVERIFIED]` at the byte level — the
  numbers and licenses are confirmed at Phase 0 against the actual bundle.
- **The drawer contract can host it** (from the Tux spike design): `GameModule`
  is chrome-agnostic (`mount`/`unmount`); a wrapped game mounts an
  `iframe[sandbox]` without the shelf knowing it is not verifiable. The hard part
  is containment + honest representation, not mounting — proven at Phase 3.
- **fun.croft.ing is GitHub Pages** (`.github/workflows/deploy.yml` publishes
  `dist/`). **Open risk:** GitHub Pages recommends < 100 MB per file and ~1 GB per
  site — a 120 MB asset set must be **chunked (< 100 MB files) or hosted off-Pages
  (release asset / CDN)**. Resolved at Phase 0 D2 (BLOCKING).

## Documentation Impact

- `docs/BUILDING-GAMES.md` — add the **wrapped-game (Tier-2) addendum**: the
  inclusion filter, the containment/legibility harness as the required gate (in
  place of verifiable-outcome + tap-first), honest representation, big-download
  disclosure. Phase 4 (the standard lands when ratified, per the spike).
- `README.md` — shelf list + the Tier-2/arcade section + `games/supertuxkart/`
  (or the chosen asset host) map. Phase 4.
- `TODO/supertuxkart.md` — **new**. Phase 4.
- `fun/CLAUDE.md` — already describes Tier-2; update only if the standard shifts.

## Concurrency Map

All phases sequential — Phase 0 (hosting + license + containment feasibility)
gates everything; Phase 1 vendors, Phase 2 wraps, Phase 3 proves containment,
Phase 4 wires + documents + deploys. No parallel set (no re-entry field).
Write-set is disjoint from other games (`games/supertuxkart/*`,
`src/games/supertuxkart/*`) except the shared wiring files (`registry.ts`,
`build.mjs`, `README.md`, `docs/BUILDING-GAMES.md`) touched only at Phase 4.

## Phases

### Phase 0: Discovery (BLOCKING — resolve before vendoring)
**Goal:** confirm STK clears the Tier-2 inclusion filter and decide how to host
120 MB. Discovery Exemption applies (no TDD; produce knowledge + findings).
- [ ] **D0.1 License + redistribution.** Read the actual repo/bundle: engine
  license (GPL-2/3?), **asset licenses** (STK art/audio are commonly CC-BY-SA —
  confirm), and what a compliant redistribution needs (LICENSE files, source
  offer, attribution). **Probe:** read the wasm-branch repo + its asset
  manifests/licenses. **Success:** a written LICENSE-FINDINGS with a clear
  "redistributable as aggregation: yes/no + obligations." **Gate:** a "no" stops
  the plan. **Disposition:** findings doc (keep).
- [ ] **D0.2 Bundle weight + hosting.** Build (or fetch) the static bundle;
  measure total MB + per-file sizes. Decide the host given GitHub Pages limits:
  (a) chunked assets < 100 MB each on Pages, (b) a GitHub **release asset** /
  external CDN fetched at runtime, or (c) Git LFS. **Success:** a measured size +
  a chosen, tested hosting mechanism the wrapper can fetch. **Disposition:**
  throwaway build; the decision + numbers recorded.
- [ ] **D0.3 Non-extractive scan.** Load the bundle and watch the network: does
  it phone home, load ads/analytics, or require an account? **Probe:** run it
  behind a request-logging proxy / Playwright request interception. **Success:**
  a list of every origin it contacts; confirm none are extractive (or document
  what to block). **Gate:** extractive-by-design → stop. **Disposition:** feeds
  the Phase 3 egress allowlist.
- [ ] **D0.4 Mount + input feasibility.** Throwaway `iframe[sandbox]` mount of
  the bundle in our chrome; confirm it renders + takes keyboard/touch input under
  sandbox, and note the a11y reality (canvas game — likely an a11y exception to
  document). **Success:** it runs sandboxed; input works; teardown observed.
  **Disposition:** throwaway.
**Done when:** license/redistribution confirmed, a hosting mechanism chosen +
tested, egress characterized, and sandboxed mount demonstrated — or a documented
"reject/park" if a gate fails.

### Phase 1: Vendor the bundle (self-contained, licensed)
**Goal:** STK's static bundle lives in the repo (or the chosen host) as a
self-contained, attributed, GPL-compliant artifact.
**Changes:**
- [ ] `games/supertuxkart/` (or the D0.2 host): the built bundle + its own
  `LICENSE`, an `UPSTREAM` pin (repo + commit), and attribution/credits.
- [ ] `build.mjs`: copy/serve the bundle (or wire the runtime fetch of the
  external host) into `dist/`.
**Call chain:** `build.mjs` → `dist/supertuxkart/…` served statically.
**Wiring test:** an e2e (Phase 3) that the bundle's entry actually loads from the
served path; here, a build assertion that the bundle + LICENSE are in `dist/`.
**Read-set:** `build.mjs`. **Write-set:** `games/supertuxkart/**`, `build.mjs`.
**Shared-state:** edits shared `build.mjs` (merge-time only). No runtime state.
**Risks:** GPL compliance (LICENSE + source offer must ship with the bundle);
Pages size limits (per D0.2).
**Done when:** the bundle + license/attribution are vendored and served; **Verify:**
`npm run build` places them in `dist/` (build assertion).
**Validation:** Moderate — build check + a manual load of the served bundle.

### Phase 2: The GameModule wrapper (mount, disclose, represent honestly)
**Goal:** a `GameModule` that mounts STK behind our chrome, discloses the
download, and represents it honestly.
**Changes:**
- [ ] `src/games/supertuxkart/supertuxkart.ts` (per-game dir): `mount` shows a
  **big-download disclosure** ("≈120 MB download, then plays offline; ~500 MB
  memory") with an explicit **Play** button that only then loads the
  `iframe[sandbox]` (sandbox tokens: allow scripts + same-origin-as-needed;
  **no** `allow-top-navigation`, **no** popups), plus an **honest banner**
  ("Arcade game — no verifiable result"). `unmount` fully tears down (remove the
  iframe, revoke object URLs, stop audio, clear listeners).
- [ ] a settings/consent note; no `pond-outcome` (there is no verifiable outcome).
**Call chain:** `/supertuxkart/` URL → registry `load` → `supertuxkart.ts mount`
→ disclosure → `iframe[sandbox]` (the vendored bundle).
**Wiring test:** Phase 3's harness loads `/supertuxkart/`, clicks Play, and
asserts the sandboxed frame mounts + the honest banner shows.
**Read-set:** `src/contract.ts`, `src/chrome.ts`, `tokens.css`.
**Write-set:** `src/games/supertuxkart/*`, `styles.css` (wrapper chrome via tokens).
**Shared-state:** append-only classes in `styles.css` (hex-in-styles test holds).
**Risks:** iframe sandbox tokens must be minimal-yet-functional (D0.4 informs);
the disclosure must precede any fetch (no surprise 120 MB).
**Done when:** opening `/supertuxkart/` shows the disclosure; Play mounts the
sandboxed game with the honest banner; leaving tears it down. **Verify:** Phase 3
harness green.
**Validation:** Moderate — wiring e2e + manual play + teardown check.

### Phase 3: The containment / legibility harness (TDD-first — the reusable Tier-2 gate)
**Goal:** prove in a real browser that STK stays contained, is legible, and does
not trap the user. This harness is reused by **every** future Tier-2 wrap.
**Changes (RED before GREEN):**
- [ ] `tests/tier2-containment.spec.ts` (parametrizable; first target = STK):
  - **Containment:** no top-window navigation / no frame escape; **no network
    request outside the D0.3 allowlist** (fail on any); no writes to our origin's
    `localStorage`/cookies; no global/CSS bleed into our chrome; a console-error
    budget.
  - **Legibility:** renders inside the drawer + full-screen + `/supertuxkart/`
    without overflow (desktop + a sane mobile floor); our header/back-chrome stays
    usable; the honest "no verifiable result" banner is present; axe clean on our
    surrounding chrome (the game canvas is an documented exception).
  - **Interaction + lifecycle:** input reaches the game while focus can still
    return to our chrome (Esc/back; no focus trap); `unmount()` leaves no leaked
    iframe / audio context / listeners across mount→unmount→mount.
**Call chain:** the spec drives the real `/supertuxkart/` page.
**Wiring test:** this spec *is* the wiring test — RED until Phase 2's wrapper
mounts and passes each dimension.
**Read-set:** `src/games/supertuxkart/*`, the served bundle.
**Write-set:** `tests/tier2-containment.spec.ts`.
**Shared-state:** none (test-only).
**Risks:** the egress allowlist must be exact (D0.3); a sandboxed cross-origin
frame limits some assertions — prefer same-origin serving so the harness can
introspect, or assert via request interception at the network layer.
**Done when:** the harness is green across all three dimensions on STK. **Verify:**
`npm run e2e -- tests/tier2-containment.spec.ts`.
**Validation:** Broad — this is the security/behaviour gate; run in CI.

### Phase 4: Wire, document the standard, deploy
**Goal:** STK is a first-class (Tier-2) shelf game; the reusable standard is
codified; live.
**Changes:**
- [ ] `src/registry.ts`: `{ id: "supertuxkart", status: "playable", tier: 2?, load }`
  + its own `/supertuxkart/` URL, labelled as an arcade/heavy game.
- [ ] a How-to (or an about page) that states the download size + offline nature +
  no-verifiable-result, and credits the STK project.
- [ ] `docs/BUILDING-GAMES.md`: the **wrapped-game (Tier-2) addendum** (ratifies
  the harness as the gate + the honest-representation + disclosure rules).
- [ ] `README.md` (Tier-2/arcade section + host map), `TODO/supertuxkart.md`.
- [ ] full gate + deploy.
**Call chain:** drawer → registry → `/supertuxkart/`.
**Wiring test:** an e2e that the drawer lists + launches STK and shows the arcade
label.
**Read-set:** `src/registry.ts`, `README.md`, `docs/BUILDING-GAMES.md`.
**Write-set:** `src/registry.ts`, `docs/BUILDING-GAMES.md`, `README.md`,
`TODO/supertuxkart.md`, how-to files.
**Shared-state:** edits shared `registry.ts` + docs (merge-time coordination).
**Risks:** the registry may need a `tier`/`verifiable` field so the drawer can
badge Tier-2 games honestly — a small shared-contract change.
**Done when:** the drawer launches STK, honestly labelled, live at
`fun.croft.ing/supertuxkart/`. **Verify:** full gate + a live smoke.
**Validation:** Broad — full gate + deployed-URL smoke.

## Open Questions

- [RECOMMENDED: BLOCKING] **Q1 — where do 120 MB of assets live?** GitHub Pages
  limits (~100 MB/file, ~1 GB/site) may not suit a 120 MB bundle. Chunk on Pages,
  a GitHub release asset / CDN fetched at runtime, or Git LFS? *Rationale:
  everything downstream depends on the host; resolve in Phase 0 D0.2. Recommend
  chunked-on-Pages if each file < 100 MB and the site stays < 1 GB, else a release
  asset.*
- [RECOMMENDED: PHASE-GATED (Phase 0)] **Q2 — exact asset licenses.** STK art/audio
  are likely CC-BY-SA; confirm and satisfy attribution. *Rationale: redistribution
  compliance; a "no" would reject.*
- [RECOMMENDED: ADVISORY] **Q3 — registry `tier`/`verifiable` field.** Does the
  drawer badge Tier-2 games (e.g., "arcade · no verifiable result") so they read
  honestly next to the verifiable games? *Rationale: honest representation is a
  filter requirement; a small shared-contract addition. Recommend yes.*
- [RECOMMENDED: ADVISORY] **Q4 — start with a lighter Tier-2 exemplar?** The Tux
  spike flagged HexGL (MIT, complete, small) as a lower-risk *first* wrap. STK is
  the class-definer but the heaviest case. *Rationale: could de-risk the harness
  on HexGL first, then STK. Owner's call; this plan targets STK as requested.*

## Review Log

- **2026-07-31 Pass 1.** Authored from the Tux Racer wrap spike (the reusable
  Tier-2 path) + the owner's SuperTuxKart adoption (COHESION §62, the
  big-download-then-offline class). Phase 0 Discovery carries the real unknowns
  (license, 120 MB hosting, egress, sandbox mount); Phases 1–4 vendor → wrap →
  prove-containment → wire+document+deploy. TDD governs the wrapper + the reusable
  containment harness. **Pass 2 (gaps) + Pass 3 (quality gates) pending** before
  execution; Q1 (hosting) is BLOCKING.
