# Building games for fun.croft.ing

A living build guide + standards for every game on the shelf. It is what "standard
game work" means here: a new game is not done until it meets each section below.
The bar is **determinism-first, local-first, verifiable, accessible, tap-first**.
Solitaire is the reference implementation — when in doubt, read how it does it.

> This doc grows. When a new game teaches us something general, fold it back
> here (and, if it's a mechanic, into the relevant section) rather than leaving
> it in one game's code.

---

## 1. The shape — the game-module contract

Each game is a `GameModule` (`src/contract.ts`): `mount(container)` / `unmount()`.
It renders chrome-agnostically into a mount point and never knows whether it is in
the drawer, full-screen, or a standalone tab. It becomes playable by a registry
entry (`src/registry.ts`) with `status: "playable"` and a `load` factory. Every
game gets its own static URL `/<id>/` (shareable, new-tab-able, no client router).

### Game isolation — one directory per game

Each game owns a **self-contained directory**; the shelf infrastructure is built
once and shared, never duplicated per game. Keep mechanics from leaking between
games.

```
crates/<game>-core/     the deterministic rules + RULES.md + golden vectors (per game)
crates/<game>-wasm/      the raw C-ABI browser binding                       (per game)
src/games/<game>/        the game's front end: <game>.ts (GameModule),
                         <game>-wasm.ts (typed wrapper), <game>-howto.ts,
                         and any game-specific assets                        (per game)
games/<game>/            baked data packs (daily seeds, etc.), if any        (per game)

src/  (chrome.ts, contract.ts, registry.ts, settings.ts, theme.ts,
      how-to.ts, how-to-page.ts, how-to-registry.ts)                          SHARED
crates/pond-docformat, crates/pond-outcome, crates/xbuild                     SHARED
tokens.css, styles.css                                                        SHARED
```

A game touches SHARED files only at its wiring points (a `registry.ts` entry, a
`how-to-registry.ts` entry, append-only `tokens.css` tokens, `Cargo.toml` +
`build.mjs` for its crates/wasm). It never reaches into another game's
directory. This isolation matters most for **Tier-2 wraps / webxdc-style
bundles**, which are wholly self-contained under their own directory and must not
bleed into the shared chrome (see "The two tiers" below).

### The three tiers

The standards in §§2–8 describe **Tier-1 Croft-native** games (build-fresh,
determinism-first, verifiable). The shelf also admits **Tier-2** opportunistic
ethical wraps/ports (already-packaged, static, non-extractive, taken as-is, **no
verifiable outcome — stated honestly**), gated by a real-browser
containment/legibility harness rather than by the verifiable-outcome + tap-first
standards. **The Tier-2 wrapped-game standard is ratified in §9 below**. It has
**no live reference implementation** since 2026-08-28 — see the note at the head
of §9 — where solitaire remains the one for
Tier-1. Everything in §§2–8 is Tier-1 unless noted.

**Tier-3 — engine-backed originals** (§11) is the third: a game **we build**, on a
**third-party engine we do not control the numerics of**. It is ours like Tier-1
and non-verifiable like Tier-2, and it is neither of them. The two axes that
actually separate the tiers are *who built it* and *can the outcome be re-proved*:

```
                    outcome re-provable?        YES              NO
   who built it?
   ours (build-fresh)                        Tier-1           Tier-3
   theirs (taken as-is)                         —             Tier-2
```

Emoji Wars (`levelforge`) is Tier-3's reference implementation.

## 2. Determinism-first core → wasm

- A Rust core crate holds the rules, with a **rules doc + golden vectors** and a
  `state_hash`. It is cross-build verified so **native == wasm** (`xbuild`).
- The browser binding is **raw C-ABI + serde-JSON** (no `wasm-bindgen`): the wasm
  **holds the game state**, exposes typed integer-arg move exports and JSON reads
  via a `ptr`/`len` output buffer. It **never panics** — every fallible path maps
  to a status code or an empty/`null` buffer (a wasm panic aborts the module).
- A thin typed TS wrapper (`src/games/<game>-wasm.ts`) presents the API the UI
  calls. The UI never re-implements rules.
- **Adding a new board state (the overlay pattern).** When a game grows a new
  per-cell facet (Trio Tumble's jelly, then its special candies), model it as a
  **parallel overlay grid** beside `cells`, and append it to `state_hash`
  **only when some cell carries it** (`if any: marker || per-cell bytes`). A
  gem-only / overlay-free board then hashes byte-identically to before, so
  **existing golden vectors do not re-lock** — every state addition is additive.
  Author it via a `from_rows_with_<facet>` helper, expose it as a parallel grid in
  the `BoardView`, and render it as a badge/backing with an a11y label (never
  colour-only). Keep the base cell a plain `Gem` where the facet must not change
  match/legality (a special candy still matches/swaps/falls as its colour), so the
  determinism-critical core stays untouched. If the new state changes scoring or
  clearing, remember it also shifts any committed solver/par packs — regenerate
  and re-lock them in the same commit (see the Trio Tumble B0 plan). An overlay can sit
  on a non-gem cell too: Trio Tumble's **obstacle flavour** (Track D — licorice / meringue)
  is an overlay on a `Blocker`, giving two distinct, mechanically-separate tiles that
  reuse the blocker's clear mechanic while rendering distinctly (the flavour is
  additive to `state_hash`, so no pre-obstacle vector re-locks).
- **When the new state is a new *kind* of cell, not a facet of a gem, add a `Cell`
  variant instead of an overlay.** Trio Tumble's **ingredient** (Track D) is a non-gem
  object that occupies a cell and *falls* — no gem lives under it, so an overlay
  cannot model it. A new `Cell::Ingredient` with an **additive hash tag** (a byte no
  pre-existing board carries) keeps the additive property — gem-only boards hash
  unchanged, so vectors still do not re-lock — while the compiler's exhaustive-match
  checks guide the edits. Gate matching/legality on `Cell::Gem` so the new kind is
  inert there (an ingredient never matches or swaps), and generalize gravity to the
  behaviour you want (an ingredient *falls* like a gem; a blocker stays a fixed
  shelf). Same pack-regeneration rule applies if it shifts play (see the Trio Tumble
  Track D ingredients plan).

## 3. Verifiable outcomes — the pond property

- Durable documents use the versioned **`pond-docformat`** envelope; a finished
  game emits a **`pond-outcome`** `Record { kind, seed, moves, move_count,
  final_hash, result, assistance }`.
- `verify` re-replays `(seed, moves)` through the core and re-hashes — it **never
  trusts a stored field**. A **clean clear** = `result === Won && assistance ===
  false`. `Stuck` / `Abandoned` and `assistance` are declared metadata.
- The win screen is **verification-forward**: lead with the clean-clear, show the
  record + moves-to-clear, offer one-tap **re-verify**, and a **share link**
  (`?r=`) carrying the full self-verifying record — **deflated** (a long win must
  stay a portable URL) — whose open path **re-verifies before display** (a shared
  claim is checked, not trusted).
- **The daily pack, and when it needs a solver.** A game whose deal may be
  *unwinnable* bakes a **winnable-daily pack** certified by a build-time solver
  (solitaire, bubble). A game that is **trivially winnable** — every deal is always
  solvable, e.g. a word game where the answer is itself a legal guess — keeps the
  same pack *machinery* (a `pond-docformat` `{ seeds, fixture }` envelope, byte-
  identically regenerable, embedded in the wasm, indexed by UTC day) but has **no
  solver crate**; the pack is just a deterministic seed schedule + a fixture
  win-line (wyrdle). Don't ship an empty solver to look symmetric — say it's
  trivially winnable and note why.
- **Board-state vs path-accumulated objectives.** Most win checks are a function of
  the *current* board (clear every blocker / scrub all jelly / drop all ingredients).
  An objective can instead be **path-accumulated** — met by what the run has produced,
  not any single board — like Trio Tumble's **order/mixed checklist** (clear N of a colour,
  make N striped + N wrapped). Model it with a small **progress accumulator** in the
  core, fed by **neutral, off-hash per-move report signals** (never add it to
  `state_hash` — it is not board state), and derive the per-seed targets from a
  deterministic seed template. Share that accumulator + target fn across the binding,
  the solver, and outcome replay so all three agree bit-for-bit; the solver then needs a
  progress-carrying search (memoize on `(state_hash, progress)`), not the board-state
  one. Winnability is still a solver-filtered pack (see the Trio Tumble Track D checklist plan).
- **Verifiable share vs spoiler.** The `?r=` record contains the move list (it
  must, to replay), so opening it reveals the solution — it is a *completed-result*
  artifact, honestly a spoiler for that seed. Where the game's social object is
  itself spoiler-free (a word game's emoji grid), ship **both**: the spoiler-free
  brag to copy, and the verifiable `?r=` (wyrdle).

## 4. Interaction model — tap first, the core decides legality

- **Tap a source → tap a destination.** Identical with mouse, touch, or keyboard.
  This is the accessible floor and it is always present.
- **The UI never decides legality.** It reads the core's `legalMoves()`, **glows
  exactly** the legal destinations, and calls the matching `play()`. An illegal
  tap changes nothing. (An E2E asserts this — it is the guardrail against rules
  leaking into the UI.)
- **Drag-and-drop is a fast-follow**, never the only way in. Add convenience
  gestures (double-tap to auto-place) where they fit, on top of tap.
- **Continuous-feeling games quantize the input, not the illusion.** A real
  aim-and-shoot (the bubble shooter) or anything that *feels* analog stays
  verifiable by splitting physics from presentation: (1) quantize the player's
  input to an **integer move** (an aim *angle*, not a pixel); (2) resolve it in
  the core with **fixed-point integer** physics (a ray-cast + wall reflection,
  no floats on the hashed path, so `native == wasm`); (3) treat the smooth
  on-screen motion as **cosmetic** — the rAF/float flight animation only
  visualises the path the core already computed and never touches the hash. The
  core still owns the outcome (the resolved landing), and the accessible floor
  becomes a keyboard-operable control (an angle slider + Fire, ←/→ + Space)
  rather than tap-a-cell. Reference: `crates/bubble-core/src/aim.rs` +
  `src/games/bubble/`.
- **Pressure and progression must be move-derived, never wall-clock.** Difficulty
  ramps — descending stacks, level tiers, spawn cadences — have to be pure
  functions of the seed and the recorded move list, so replay reproduces every
  transition and the outcome stays verifiable. The bubble shooter's levels mode
  pushes a new row in on a **shot count** (not a timer) and fills it from the
  seeded RNG, so `(seed, angles)` replays the whole escalation. A **clock may
  inform the player** (an optional countdown for felt pressure) but must **never
  decide the verified outcome** — real elapsed time can't be reproduced by
  replay, and a client-asserted time is forgeable, so a time-out loss can't be a
  verifiable result (§9 "no faked verifiable outcome"). Reference:
  `crates/bubble-core/src/levels.rs`.
- **A real-time game is verifiable by a tick-stamped input record.** When play is
  continuous *and* clock-driven (a falling-block stacker, where gravity advances
  whether or not the player acts), model the core as a **fixed-timestep integer
  tick engine** and record the run as a **tick-stamped stream of atomic actions**
  (`[(tick, action)]`). Each `tick()` advances one integer timestep of gravity +
  lock resolution; the front-end's wall clock only drives the accumulator (how
  many `tick()`s this frame) and stamps captured inputs with the engine's current
  tick — it never decides the outcome. Handling (DAS/ARR/SDF) resolves held keys
  into the *atomic* actions in the input layer, so the record is
  handling-independent and a shared `?r=` reproduces the exact moves. The float
  gravity curve is baked into an integer ticks-per-row table so nothing float
  touches the hashed path. The state hash includes the tick, pinning the whole
  timeline: a run and its replay agree only if every gravity/lock tick lined up.
  Align (`crates/align-core/`, `src/games/align/`) is the reference — the same
  move-derived-pressure contract as the bubble shooter, applied to a clock-driven
  game.

### Centre the play surface — the default layout

A game mounts into the shared play area as a **single centred column**: controls,
board, and any on-screen control keys stack on one vertical axis, centred in the
play area, not hugging the left edge. Centre by default; only deviate with a
reason. The full layout playbook + running lessons log is `docs/RESPONSIVE-DESIGN.md`.

- **This matters most when the board has directional/on-screen keys** (a 2048-style
  d-pad, an on-screen keyboard). Those keys only read as belonging to the board
  when they sit on the board's centreline directly beneath it. A left-aligned board
  over a centred key cluster looks broken. An E2E should assert the board and its
  key cluster share a centreline (`boundingBox` centres within a few px).
- **Watch the `inline-flex` trap.** `margin-inline: auto` does **not** centre an
  `inline-flex`/`inline-block` element — it is inline-level, so the margins
  collapse. Centre via the column wrapper (`display: flex; flex-direction: column;
  align-items: center`) or `width: fit-content; margin-inline: auto` on a
  block-level element.
- **Mobile is part of the pass, not a follow-up.** Every board ships with a
  narrow-viewport check (no horizontal overflow at 360 px) and comfortable touch
  targets for any on-screen keys (`touch-action: manipulation`, ≥ 44 px hit area).

## 5. Identity + tokens

- `tokens.css` is the **only file with raw hex**. Components use semantic `var()`
  tokens; a unit test forbids hex in `styles.css`.
- **Light + dark**, driven by `[data-theme]`: a pre-paint inline script (no flash)
  + a header toggle (`src/theme.ts`, `resolveTheme` is pure and unit-tested).
- **Every text/UI colour pair clears WCAG AA in both themes** — ratios recorded in
  `tokens.css` and re-computed by `tests/tokens.test.ts`; axe runs on chrome +
  each board in both themes. The shelf identity is a **felt table + ivory cards**;
  see `docs/DESIGN.md`.

## 6. Standard settings (shared, persisted) — `src/settings.ts`

Settings are shared across games and persisted; both default **on**:

- **Enable hints** (on). A **Hint** points at a good legal move and explains it;
  using a hint **counts as assistance**. When there is genuinely no move left, it
  ends the game as `Stuck`.
- **Declare assistance used** (on). Controls whether the outcome record carries the
  (self-declared) assistance flag. Undo and hints set it; assistance is not
  replay-derivable, so it is an honesty declaration.

When **hints are off**, the control flips to **"I'm stuck"**: it **ends the game**
and reports honestly **whether a legal move was still available** at that moment.

Rationale: hints keep casual players unstuck; the assistance flag keeps a clean
clear meaningful; the hints-off path serves players who want the game to end
honestly. Good default for card and tabletop games.

## 7. How to play — the user-guide standard

Every game ships a **"How to play"** guide, reached by the header link on the game
page (`/how-to/?game=<id>`). It follows the Croft user-guide pattern:

- **Content is pure data** (`src/games/<game>-howto.ts`): an ordered list of
  entries, each a sequence of typed blocks — `prose | steps | note | shot`
  (`src/how-to.ts`). Registered in `src/how-to-registry.ts`.
- **One shared renderer** (`renderGuide`) → intro + table of contents + one section
  per entry. **One shared page** (`src/how-to-page.ts`) reads `?game=`.
- **Screenshots are generated from the built app** by `npm run guide:shots`
  (`tools/guide-shots.mjs`) into `assets/guide/<name>.jpg`, so the guide can never
  show a UI that no longer exists. Regenerate after any visual change.
- **Sync guarantee, enforced by tests:** a unit test fails if a guide names a shot
  not on disk (`tests/how-to.test.ts`); an E2E fails if any guide image doesn't
  load, and asserts TOC-count == entry-count + axe clean (`tests/how-to.spec.ts`).
- **Voice:** explain what a thing is FOR and **how you actually do it**. **Lead with
  the interaction model** — the first thing players ask is "do I drag or tap?".

## 8. Discipline — the gate

- **TDD first**, always: the wiring test runs through the real entry point (the
  crate API, the wasm boundary, the `/<game>/` URL) and is RED before GREEN.
- `npm run test` = **rust** · typecheck · lint · unit (builds the wasm first) ·
  build. `npm run test:rust` alone (`tools/rust-gate.sh`) = `cargo fmt --all
  --check` · `cargo clippy --workspace --all-targets -- -D warnings` ·
  `cargo test --workspace --release`, run through **rustup's** stable toolchain —
  Homebrew's cargo/clippy shadow it on PATH and lag behind, so a bare
  `cargo clippy` can pass code CI rejects. `npm run e2e` = Playwright incl. axe.
  All green before shipping.
- **A new crate must pass the Rust gate**, and opts into the pedantic tier with
  `[lints] workspace = true` in its `Cargo.toml` (see `[workspace.lints.clippy]`
  in the root manifest, and `CLAUDE.md` for why it excludes the cast lints).
- Deploy is GitHub Actions → Pages (`.github/workflows/deploy.yml`): a `build` job
  (wasm · typecheck · lint · unit · site) and a parallel `rust` job (the three
  commands above). `deploy` needs **both**, and is guarded to `refs/heads/main` —
  so a Rust regression blocks publication, and a `workflow_dispatch` aimed at a
  branch cannot publish it.

---

## 9. Tier-2 — wrapped games (the ratified addendum)


> **Status, 2026-08-28: this tier has no third-party instance.** Astray, HexGL and
> Clumsy Bird were removed at the owner's call — they did not fit the shelf's
> model. What remains marked `tier: 2` is **Orchard Drop**, which is *ours* (the
> Croft shelf, on @liabru's Matter.js), so it is a wrap of a physics engine rather
> than of somebody else's game. By the definitions above that is closer to Tier 3.
>
> The standard below is kept, not struck: it was ratified, it was applied four
> times, and the containment harness and `tier2.meta.json` schema it produced are
> still live and gate whatever carries a `tier2.meta.json`. But **nothing here is
> currently demonstrated by a real opportunistic wrap**, and the next one to
> arrive should expect to re-earn the reference-implementation role rather than
> inherit it.
>
> Whether Tier 2 survives as a category at all is an open owner decision.

A Tier-2 game is an **already-packaged, ethical game taken as-is**. We do **not**
rebuild it and we do **not** fake a verifiable outcome. It earns a place by being
honestly represented and provably contained, not by the Tier-1 verifiable-outcome
standard. **The reference implementation was Astray, removed 2026-08-28** (see
the note at the head of this section); the Tux
Racer spike (`plans/2026-07-30-tux-racer-wrap-spike.md`) is the origin of this
standard, and the SuperTuxKart cut (`plans/2026-07-31-supertuxkart-wrap.md`) is
the cautionary tale — **avoid the Emscripten + runtime-asset-untar class**; prefer
a self-contained JS/WebGL bundle that vendors as plain static files.

### The inclusion filter (all must hold)

1. **Already fully client-side / static** — runs in-browser, no backend.
2. **Non-extractive** — no ads, tracking/telemetry-home, account-as-data-grab, or
   dark patterns. Any such code is **stripped at vendor time** and the removal is
   recorded as a patch (see HexGL's Google-Analytics strip).
3. **Redistribution-licensed** — an OSS/freeware-assets license that lets us
   vendor, host, and attribute. Copyleft (GPL) is allowed but carries a
   **source-offer** obligation — record it in the meta.
4. **Fits our chrome** — mounts through the `GameModule` contract, gets its own
   `/<id>/` URL, and passes the containment/legibility gate in all modes.
5. **Honestly represented** — the shelf must not imply a verifiable record where
   there is none.

Bundle weight is **not** a disqualifier — a large one-time download that then runs
fully offline is an allowed class *with up-front size disclosure* (recorded in the
meta's `approxSizeKb`).

### Which Tier-1 standards change for a wrap

| Tier-1 standard | For a Tier-2 wrap |
|---|---|
| Determinism-first Rust core → wasm (§2) | **N/A** — the game is vendored, not built |
| Verifiable outcome / `pond-outcome` / `?r=` (§3) | **Replaced** by honest "no verifiable record" representation |
| Tap-first, core-decides-legality (§4) | **N/A** — native input; document the input model in the meta |
| Identity + tokens, WCAG AA, axe (§5) | **Required for our chrome** around the game (the embedded canvas is exempt) |
| Standard settings (§6) | **N/A** |
| How to play (§7) | **Required** — and it must state plainly that the game keeps no verifiable record |
| TDD + gate (§8) | **Required** for the wrapper + the containment gate we write (not the vendored engine) |

### The Tier-2 mechanics (as built)

- **Vendor, don't fetch.** The bundle lives under `src/games/<id>/vendor/`
  (license file verbatim), is committed, and is served from our own origin —
  no runtime third-party fetch, no untar step. `build.mjs` copies it to
  `dist/<id>/vendor/`; `tools/serve.mjs` (and GitHub Pages) send
  `Access-Control-Allow-Origin: *` so opaque-origin WebGL texture loads succeed.
- **Provenance + posture in one file.** Every wrap ships
  `src/games/<id>/tier2.meta.json` — the single source of truth for where it came
  from (upstream URL/ref/date, author, license, license file) and how it is
  contained (containment, sandbox flags, `egress: "same-origin"`, input, size,
  and **every vendor patch with its reason**). `parseTier2Meta` is fail-loud; a
  gate test ties the registry's `attribution` to the meta's `provenance` so they
  cannot drift.
- **Contained mount.** The `GameModule` mounts through the shared
  `mountWrappedGame` primitive: an `iframe[sandbox="allow-scripts"]` (opaque
  origin; `allow-same-origin` is refused because, with scripts, it lets the frame
  remove its own sandbox). Clean teardown on `unmount`. The primitive also
  **focuses the frame on load** — see "Keyboard focus" below for why this is
  mandatory for any keyboard-driven wrap.
- **Honest representation.** The chrome renders a persistent "Wrapped game — no
  verifiable record" banner + attribution (author · license · source link) above
  the game, driven by `GameEntry.tier === 2`.
- **The gate.** `tests/tier2-containment.spec.ts` is a real-browser gate
  parameterized over every `tier2.meta.json`. It asserts the game's real behavior
  matches its declared posture: sandbox flags, **zero off-origin egress**, no
  breakout, our-origin storage untouched, legible in our chrome at 360px +
  desktop, axe-clean chrome, the frame **auto-focuses so the keyboard reaches the
  game without a click**, and focus still returns to our chrome (no focus trap).

### Porting a game — the step-by-step recipe

Read this section straight — there is no wrap to copy from right now (the
bundle). The whole thing is a wrapper + a metadata file; you write no game code.

1. **Recon against primary sources.** Confirm the real repo, the **license**
   (file-by-file if assets differ from code), and that it is **non-extractive** —
   look for `ads.txt`, analytics snippets (`ga.js`, `gtag`), telemetry, and a
   trademark on the name/characters. Reject trademarked clones (Pac-Man, the
   Chrome dino) even when the code license is clean. Prefer a self-contained
   JS/WebGL bundle; steer clear of the Emscripten + runtime-untar class.
2. **Vendor it, don't fetch it.** Copy the runtime files into
   `src/games/<id>/vendor/` (skip dev/deploy cruft — `.git`, `Gruntfile`,
   `package.json`, `Procfile`), **including the license file verbatim**. Nothing
   loads from a third-party origin at runtime.
3. **Patch minimally, record every change.** Strip any extractive code
   (analytics/ads); repoint external asset URLs (favicons, textures) to local or
   relative paths so nothing leaves our origin. Each edit becomes a `patches`
   entry in the meta with a `reason`. A zero-patch bundle (Clumsy Bird) is ideal;
   an honest patch list (HexGL) is fine.
4. **Write `src/games/<id>/tier2.meta.json`.** Provenance (upstream URL/ref/date,
   author, license, license-file path; `basedOn` if it descends from another
   work) and posture (`sandbox`, `egress: "same-origin"`, input model,
   `approxSizeKb`, the patch list). `parseTier2Meta` is fail-loud; get it right.
5. **Wrap + wire.** A ~20-line `GameModule` that calls `mountWrappedGame({ src:
   "/<id>/vendor/index.html", title })`. Add the registry entry (`tier: 2` +
   `attribution` matching the meta's provenance), add `<id>` to `GAME_PAGES` and
   `TIER2_VENDORS` in `build.mjs`, and register a how-to.
6. **Pay homage.** Attribution/homage is shared code — the banner credits the
   original dev "with thanks" and links to the source automatically from the
   registry `attribution`; set `basedOn` to credit lineage. The how-to's closing
   note repeats the credit + source link. Keep this consistent for every wrap.
7. **Prove it.** The containment/legibility gate enrols the game automatically
   from its meta. Run `npm run test` + `npm run e2e`; both green before shipping.

### Mobile + desktop — what a wrap must still honour

The house rules (works on a phone and a desktop, honest, contained) apply to the
*frame around* the game even though we don't control the game's own input.
`docs/RESPONSIVE-DESIGN.md` is the full layout/touch playbook; for a wrap it
governs the chrome + frame, not the vendored game's internals:

- **Both viewports.** The gate checks **no horizontal overflow at 360px** and a
  desktop width; the `.wrapped-game-frame` fills the play area (70vh; 100vh in
  full-screen). Confirm the game is actually playable at phone width, not just
  non-overflowing — some ports assume a desktop canvas.
- **Input honesty.** Declare the real input model in the meta (`keyboard`,
  `pointer`, `touch`, `gamepad`). If a game is keyboard-only, **say so**
  in the how-to — do not imply our tap-first floor. A game that needs a physical
  keyboard is admissible but must be honest that it plays best with one.
- **Focus + full-screen.** Input reaches the frame, but focus must return to our
  chrome (Esc / the drawer toggle) — no focus trap. Full-screen must keep the
  game mounted and legible. The gate asserts both.
- **Keyboard focus — the sandboxed-iframe gotcha.** An **opaque-origin sandboxed
  iframe never takes keyboard focus on its own.** Pointer events land on the game
  canvas regardless of focus (so mouse/touch "just work"), but *key* events go to
  the parent document and never reach the wrapped game — a keyboard game looks
  dead to the keyboard while clicks flap fine. This bit Clumsy Bird: the space bar
  did nothing until the frame was focused. Two layers fix it, and a keyboard wrap
  needs both:
  1. **Initial focus (shared, automatic).** `mountWrappedGame` focuses the frame
     on its `load` event, so the keyboard works from the first key with no click.
     Every wrap gets this for free; the containment gate asserts it
     (`await expect(frame).toBeFocused()` after load, with no manual `focus()`).
  2. **Re-grab on interaction (per-vendor).** If the player clicks our surrounding
     chrome and then clicks back onto the game, only the frame can observe that
     pointer event (the parent can't reach across the opaque origin), so the
     vendored bundle must restore its own focus. Add a tiny script to the wrap's
     `index.html`: `window.addEventListener("pointerdown", () => window.focus(),
     true)` (also on `load` as a belt-and-braces). Record it as a `patches` entry.
  Any remapped or added keys likewise belong in a recorded `index.html` patch —
  Clumsy Bird wraps `me.input.bindKey` so the Up arrow mirrors the space bar.
- **Size disclosure.** A heavy bundle (HexGL, ~17 MB) is allowed but its size
  goes in `approxSizeKb` **and** in the how-to lede, up front, before the player
  commits to the download.
- **Our chrome stays accessible.** Tokens/WCAG-AA/axe apply to the banner and
  surrounding chrome (the embedded game canvas is exempt).

## 10. Adversarial two-player games + the AI-player standard

*(Stub — grows as the harness lands. The full guide is `docs/AI-PLAYERS.md`; the
governing plans are `plans/2026-07-31-drop4-ai-harness.md` and
`plans/2026-08-03-drop4-playable-and-hybrid-buildout.md`.)*

> **Measuring the players.** The browser AI-scoring harness (`src/harness/`,
> `npm run harness:trial`) grades the shipped browser players move-by-move
> against the wasm's exact oracle — the browser mirror of `drop4-harness`. Full
> guide: `docs/HARNESS.md`.

A **two-player adversarial** game (two sides taking turns, a win/draw/loss
result) is still a Tier-1 Croft-native game: it keeps §§2–8 (determinism-first
core → wasm, verifiable outcome, tap-first core-decides-legality, tokens/WCAG,
standard settings, how-to, the gate). It adds a **computer opponent**. **Drop 4**
(`src/games/drop4/`, `crates/drop4-*`) is the reference implementation, **Othello**
(`src/games/othello/`, `crates/othello-*`) is the second, **checkers**
(`src/games/checkers/`, `crates/checkers-*`) is the third — the generality proof
that the trait + band + tutor + harness carry to a **move that is a path**, not a
destination square (landed 2026-08-06, `plans/2026-08-04-checkers-game.md`) — and
**Dots and Boxes** (`src/games/dots/`, `crates/dots-*`) is the fourth, which broke
two assumptions nobody had written down (landed 2026-08-07,
`plans/2026-08-07-dots-and-boxes.md`), and **Furrow** (`src/games/furrow/`,
`crates/furrow-*`) is the fifth — mancala, the first game built to *inherit* the
abstraction rather than to prove or to stress it (landed 2026-08-10,
`plans/2026-08-07-mancala.md`).

**Variation — a move that does not pass the turn (Dots and Boxes).** Closing the
fourth side of a box claims it and the mover **moves again**. So `side_to_move` is
a function of the *position*, never of the move index, and a match record is one
list of both sides' moves in play order that is **not** alternating. Nothing
shared had to change for this — `Adversary::side_to_move` already took the
position, `runMatch` already re-read `toMove` from the live board each iteration,
and `gradeSide` already re-derived whose move it was during replay — but the
*prose* in three places said "alternating" and was wrong the moment this game
existed. If your game has an extra-turn rule, the code is ready for it; read the
turn from the board and never from parity.

**Variation — one move that rewrites many cells (Furrow).** A sow lifts every seed
out of one pit and drops them around the board one at a time, so a single move code
can write to **thirteen of fourteen cells** — and it skips exactly one of them (the
opponent's store), which is a rule, not arithmetic. Two consequences worth planning
for if your game has a move like this:

- **Replay correctness now depends on a loop.** Every other core on this shelf
  writes one or two cells per move, so "the hash matched" meant a couple of fields
  matched. Here it has to mean all fourteen counts matched, and the golden vectors
  are chosen to walk the loop: one is driven deliberately through extra-turn chains
  and captures because those are the paths most likely to diverge native-vs-wasm.
- **The UI must not re-derive the path.** `furrow-wasm` exports `sow_path_json`,
  which returns the cells a sow would fill *in order* plus what it keeps and takes.
  A front end animating the sow from the board alone would have to re-implement the
  skip rule in TypeScript, and a second copy of a rule is a second place for it to
  be wrong. The core decides; the UI draws what it is told.

Nothing in the shared stack noticed. The rig sends a move code and re-reads the
board, so a thirteen-cell write is no different to it than a single-cell one.

**Variation — a terminal rule that rewrites the score (Furrow).** When either side
runs out of seeds the game ends and the other side **sweeps** every remaining seed
into its store. The final score is therefore *not* what accumulated during play,
and a sweep can move a dozen seeds at once. Three things follow, and the first two
are easy to get wrong:

- **Apply the transformation in `apply_move`**, so a terminal position is always
  canonical — both sides empty, the stores holding the final score, `legal_moves`
  returning nothing. Leaving it to the caller means every caller can forget.
- **Make `result` apply it too**, to a position it is handed. A caller that
  constructed a terminal without routing through `apply_move` otherwise reads the
  wrong winner, and that caller exists: the scorer replays records.
- **Tell the player.** A score that jumps at the final move reads as a bug unless
  the UI says the sweep happened.

**Variation — a band value that is a margin (Dots and Boxes).** Drop 4, Othello
and checkers all produce a value the band buckets into three classes. Here the
natural value is a **box differential**, and the class is its *sign* — `class_of`
is `value.signum()`. The shared `select_in_band` never looks at what a value
means, so a margin drops straight in; what a value's class means stays the game's
own judgement, which is why `class_of` and `live_band` deliberately live in the
game's solver and not in `adversary-solver`. On an odd box count **no draw is
reachable at all**, which is worth asserting as a property rather than papering
over.

**Variation — an honesty flag that is mostly `true` (Dots and Boxes).** 3×3 is
small enough to solve outright from four plies in, so `exact` holds for nearly the
whole game and the scoring rig grades **83% of a side's moves** — against
checkers' 9 of 163, where `exact` means a terminal was proven. Same rig, same
honesty gate, opposite denominators. A near-empty `scoredMoves` is not a failure
and a near-full one is not a triumph; what matters is that the number is reported
either way, because a class floor over an empty denominator asserts nothing.

**Variation — a heuristic Oracle (Othello).** §10's "exact when tractable" assumes
a solvable game. Othello is **not solved from the opening**, so its Oracle is a
*heuristic* alpha-beta with an **exact full solve only in the deep endgame**. The
honesty flag generalizes from exact/capped to **exact/heuristic**: the tutor
claims a win/draw/loss class (and words a blunder as "threw the game") only when
`exact`; otherwise it hedges ("looks risky") because a heuristic proves no class.
When your game is unsolved, this is the honest shape — do not fake an exact
verdict. The game-agnostic TS harness (`src/harness/*`) reuses unchanged; only the
Rust core/solver/tutor and the front-end wrapper are new. See `docs/AI-PLAYERS.md`
→ "Generality: a second game (Othello)".

What is the same, and what is new:

- **Rules as code — the `Adversary` trait** (`crates/adversary-core`): `initial`
  / `side_to_move` / `legal_moves` / `apply` / `result` / `state_hash` + a text
  bridge. Each game core implements it *and* `pond_outcome::Game`.
- **Verifiable outcome carries over.** A match records **both** sides' moves in
  one list in play order (alternating in most games; see the extra-turn variation
  above), so replaying `(seed, moves)` reproduces the final board
  regardless of who chose each move — the `?r=` share re-verifies exactly as for
  a single-player game. (Drop 4: the record is A-centric — `Won` = the opening
  human won; the human-facing screen derives a draw-aware label from the live
  result code.)
- **The engine is strength; the LLM is UX.** In a solved / perfect-information
  game a strong move is a *computable fact*, so the classic engine is the shipped
  opponent (fast, strong, deterministic, tiny). An LLM adds legality by
  construction, personality, explanation, and tutoring — **not** strength. See
  `docs/AI-PLAYERS.md` for the full rationale and the measured findings.
- **Live play uses a depth-capped engine, not the exact oracle.** The exact
  solver is minutes from the opening; the shipped opponent is the depth-capped
  `live_move`. The exact oracle stays the source of scoring / tutoring / the
  difficulty band on tractable positions.
- **Difficulty** is a knob on the *engine*, never on the LLM — two knobs: a
  **class floor** (`PreserveBestClass` never throws the game) × **within-class
  sloppiness**. Drop 4's picker (Easy/Medium/Hard/Perfect) maps to these over
  per-move values that are **exact when the position is tractable** (provably
  never-throws in the endgame) and **depth-capped otherwise** (never throws a
  horizon-visible loss) — the full-solve speed wall means those are the honest
  bounds. See `docs/AI-PLAYERS.md` → "How Drop 4 ships it".
- **Give the opponent an identity.** A computer opponent should be legible as a
  *who*, not a silent force: a turn bar naming both sides (Drop 4: "The Engine
  🤖") and showing whose turn it is, the opponent's move made **visible** (a ring
  on its last drop + a brief "thinking" beat), and — on a decisive end — the
  winning move shown with a beat of fanfare before the result screen (which
  carries the final board). Where the marks are symmetric, let the player choose
  which they are.

- **The tutor is a Tier-1 feature, not an LLM feature.** Because a strong move is
  a computable fact, engine-grounded coaching ships **without** any model: Drop 4's
  on-by-default tutor (explain the options, flag a blunder, hint with a reason)
  runs entirely on `drop4-solver::tutor::assess` over the wasm C-ABI
  (`assess_json` / `tutor_json`), is fully on the CI gate, and is **honest about
  certainty** — it only calls a move a blunder ("that threw the game") when the
  facts are provably exact (endgame), softening to "looks risky" when they are the
  horizon-approximate capped search's. An LLM later only *narrates* these facts.

- **A browser LLM is an embedded, lazy, same-origin runtime — never a CDN.** The
  `AIRuntime` port (`src/harness/ai-runtime.ts`) has a deterministic `MockRuntime`
  (CI) and a real `WebLLMRuntime`. `@mlc-ai/web-llm` is a dependency **bundled to
  a same-origin `/vendor/webllm.js`** and dynamic-imported only on first use — no
  third-party CDN serves executable code (offline-capable PWA + no injection
  vector), and `app.js` is unchanged for non-AI games. The real runtime is
  validated by the standalone `npm run ai:trial` (system Chrome, WebGPU), **not**
  the CI gate. Model weights + `model_lib` WASM stream from the model CDN on first
  load then cache; self-hosting them is a named follow-on.

- **The experimental hybrid opponent is engine-first, toggle-gated, and never
  loses to itself.** `HybridPlayer` (`src/harness/hybrid-player.ts`) has the engine
  build a never-throw band (class-preserving moves only), the LLM pick within it
  under a schema, and ANY failure (malformed output, out-of-band pick, runtime
  error) fall back to the engine's top-of-band — so a broken model degrades to
  the engine, never to an illegal or losing move. In Drop 4 it is a **separate
  toggle** offered only when a real (non-fallback) WebGPU adapter is present, with
  an up-front download disclosure; the classic engine stays the default and the
  stronger player. Validated by `AI_TRIAL_MODE=hybrid npm run ai:trial`, not CI.

The scorer/tournament harness has landed (`src/harness/{match-runner,scorer,
tournament}.ts`, `npm run harness:trial`): it plays two `Player`s over the shipped
wasm, grades each move against the wasm's exact oracle (only where provably
`exact`), and aggregates a `Scorecard`/`Report`. Full guide: `docs/HARNESS.md`.
This section is the shelf-standards anchor.

### Recipe — adding an AI opponent to a new adversarial game

Othello proved the split generalizes, and checkers proved it against a move space
that is genuinely different. When you add another adversarial game, this is what
you write vs what you reuse:

**Reuse unchanged (shared code — do not fork):**
- `crates/adversary-core` — the `Adversary` trait your core implements.
- `src/harness/ai-runtime.ts` — the `AIRuntime` port + `MockRuntime` (CI) +
  `WebLLMRuntime` (embedded, same-origin, lazy).
- `src/harness/banter.ts` — `speak(decision, cannedLine)`, the shared filter on
  what the persona may say. The band constrains the model's *move*; this
  constrains its *claims*, rejecting any line with a coordinate or a board noun.
  Do not re-implement it per game (all three did, identically, and all three let
  a small model narrate the board wrongly).
- `src/harness/hybrid-player.ts` — `buildBand(tutorFacts)` + `HybridPlayer.pick`.
  Your wasm tutor view must be a **structural superset of `TutorFactMove`**
  (`col`, `value`, `quality`, `immediateWin`, `blocksOpponentWin`) — carry the
  Drop-4-flavored one-ply facts as `false` if your game has no such notion.
  **Supply your game's own `idea`** (optional, on the same shape) if it has a
  one-ply fact worth narrating: the shared fallback knows only those two
  booleans, so without it every band move in your game reads "your strongest
  line" or "stays safe", and the engine's own insight is dropped on the floor
  right where the personality is meant to come from. Set it in **both** places
  that build a band — your game module and your `<game>-oracle.ts` — so the UI
  opponent and the harness's hybrid say the same thing. It is a label, not a
  licence: the band still excludes blunders.
- `src/harness/{match-runner,scorer,tournament}.ts` — the scoring rig. It is
  **game-agnostic**: it drives a `GameOracle` (`src/harness/game-oracle.ts`), so
  your game plugs in by shipping one adapter, `src/games/<game>/<game>-oracle.ts`
  — no rig change. Two contracts: a move is your game's compact **numeric wire
  code** (the same code your `?r=` share carries), and `liveMove` takes a level
  `0..3` (Easy → *your* top level), because the games' own `Level` unions disagree
  on the top member. Drop 4, Othello and checkers are the three worked examples —
  and the checkers adapter is the smallest of the three (a pure pass-through),
  which is the point: what the rig asks of a game is only that a move be a number.

**Reuse as a pattern (copy the per-game TS, don't share it):** the tutor panel,
the WebGPU-availability probe + experimental toggle + disclosure, the AI-banter
line, the result screen.

**Write new (game-specific):** the Rust `<game>-{core,solver,wasm}` (rules +
`Adversary` + `pond_outcome::Game`; the solver's Oracle + a class-preserving band
+ `tutor::assess`), and the front-end `<game>-{wasm.ts,outcome.ts,ts,howto.ts}`.
Use `crates/adversary-solver` for the band selector — it is generic over the move
type, so a new game supplies only its own `capped_class` and per-level tuning. (It
was duplicated per game until checkers became the third consumer; the extraction
landed 2026-08-05.)

**Budget the tutor panel separately from the tap path.** The panel is opened
deliberately, once, and is the only surface allowed to say a move *threw the
game* — so it can afford a deeper search than a move can, and depth is what buys
proofs. Checkers measured 2.2% → 4.9% of move values proven by going one ply
deeper than the strongest opponent. Two traps come with it: the deep call must not
also serve the per-move coach (the UI assesses a tapped move *before* applying it,
so one shared budget puts the panel's cost on every tap — checkers exports
`coach_json` and `tutor_json` for exactly this reason), and a search of that size
blocks the main thread, so paint the reading state **before** starting it or the
button looks dead.

**Bound the search in nodes, and measure before you pick a mechanism.** The full
guide is `docs/AI-PLAYERS.md` → "Search cost — bounding a move without lying about
it"; the parts you cannot afford to rediscover:

- Use `adversary_solver::NodeBudget`, never a clock. A wall-clock bound puts
  machine speed into the numbers `tests/baselines.test.ts` asserts, and the wasm
  modules have no host import to ask the time with.
- **Measure median, p95, worst and the fraction over your target, at *every*
  level** — not the worst case at the top level. Othello's endgame stall hid for
  months behind a bigger midgame cost that only existed at Expert.
- `adversary_solver::deepen` (iterative deepening) is **not automatically worth
  adopting**. It pays where the budget bites often, or where your static move
  ordering is poor. Measured: Othello −41% nodes (weak static ordering, 38% bite
  rate) against checkers +14% (mandatory captures already order well, 0% bite
  rate) — checkers ships none of it. Measure your game rather than copying either.
- Never return a partial iteration, never store a truncated search in the
  transposition table, and never let the `exact` flag be derived from the position
  when a budget can cut the search short.

**Honesty gate (non-negotiable):** if your game is **not solved from the opening**
(Othello, chess), the Oracle is *heuristic early, exact only in the deep endgame*.
Carry an `exact` flag on every tutor fact and **bind the wording to it**: claim a
win/draw/loss class (and word a blunder as "threw the game") only when `exact`;
hedge ("looks risky") otherwise. Never fake an exact verdict from a heuristic.
Pin it with a `coachFor`-style unit test.

## New-game checklist (Tier-1 Croft-native)

- [ ] Rust core + rules doc + golden vectors; native==wasm verified.
- [ ] Raw C-ABI + serde-JSON binding (holds state, never panics) + typed TS wrapper.
- [ ] `GameModule` + registry `status: "playable"`; own `/<id>/` URL; mounts in all modes.
- [ ] Tap-source → tap-target with **core-driven** legal-move glow; illegal tap = no change.
- [ ] Verifiable outcome (`pond-outcome`), verification-forward end screen, re-verifying `?r=` share.
- [ ] Identity on `tokens.css`; WCAG AA both themes; axe clean.
- [ ] Standard settings wired (Enable hints on; Declare assistance on; hints-off → "I'm stuck" ends + reports).
- [ ] "How to play" guide (pure data) + `guide:shots` screenshots + sync tests; header link.
- [ ] Gate green (`npm run gate` — Rust + typecheck + lint + unit + build + e2e)
  and deployed. CI runs the same three parts as parallel jobs and **`deploy` needs
  all three**, so a failing wiring test or axe violation blocks publication.

## New-game checklist (adversarial + AI opponent — §10, on top of Tier-1)

For a two-player game vs a computer opponent, add these to the Tier-1 checklist.
Reference implementations: **Drop 4** (solvable), **Othello** (heuristic Oracle),
**checkers** (heuristic Oracle, `exact` only where a terminal is *proven*).

- [ ] Core implements `adversary_core::Adversary` (rules) **and**
  `pond_outcome::Game` (replay/verify); moves — passes included — serialize so
  `(seed, moves)` replays exactly (prefer a compact numeric code over a tagged enum).
  **A move need not be a destination.** Checkers' is a jump *chain* — a piece plus
  an ordered list of landings — and it still serializes as one number: `(from, to,
  variant)` packed into 14 bits, where `variant` disambiguates the chains that
  share an origin and destination (measured: at most 3 across 2.25M positions, so
  2 bits would do). `(from, to)` alone is **not** enough — a king can reach one
  square by two capture paths, and a cyclic capture can even end where it began.
  Keeping the code a plain number is what lets the share format and the harness
  stay identical across games; the chain detail the UI needs to step a player
  through a multi-jump rides along on `legal_moves_json`, not on the wire code.
- [ ] Solver: an Oracle (exact where tractable, else heuristic depth-capped), a
  difficulty `Level` → class-preserving **band** (`adversary_solver::select_in_band`,
  shared), and `tutor::assess` → `{value, regret, quality, exact}` per move.
- [ ] wasm C-ABI adds the opponent (`live_move`) + tutor (`assess_json`/`tutor_json`,
  a superset of the shared `TutorFactMove`) + any special move export (e.g. `pass()`).
- [ ] Opt-in tutor panel (off by default) with **honesty bound to `exact`**
  (`coachFor` unit test): "threw the game" only when exact, "looks risky" otherwise.
- [ ] Experimental hybrid opponent behind a **WebGPU-gated toggle** (real,
  non-fallback adapter only) + up-front download disclosure, reusing
  `hybrid-player.ts`/`ai-runtime.ts` **unchanged**; engine stays the default and
  falls back on any LLM failure. Validated by an `ai:trial`-style run, not CI.
- [ ] CI proves the hybrid plug-in with a `MockRuntime` (no GPU on the gate).
- [ ] Plug into the AI-scoring harness — **four files, none of them the rig**:
  the adapter (`src/games/<game>/<game>-oracle.ts`), the trial wiring
  (`harness-trial-entry.ts`), the CI proof (`tests/<game>-harness.test.ts`, with
  all three non-vacuity assertions), and a recorded baseline
  (`tests/baselines.test.ts`). Step-by-step in `docs/HARNESS.md` → "Adding your
  game to the rig". Not optional: it is how "the AI never blunders" stops being a
  claim and starts being a number
  (`docs/HARNESS.md`).

See §10's "Recipe — adding an AI opponent to a new adversarial game" for what
reuses vs what is new.

## 11. Tier-3 — engine-backed originals

A Tier-3 game is **ours**, built fresh, on a **third-party simulation engine whose
numerics we do not control** — a physics engine, a solver, anything whose output
we cannot reproduce bit-for-bit across machines. It is not a wrap: we wrote the
game, we own the code, it lives in our chrome directly with no sandbox. It simply
cannot carry §3's verifiable outcome, and it does not pretend to.

Emoji Wars (`levelforge`, matter-js) is the reference implementation.

**This tier is a decision, not a default.** For Emoji Wars specifically, a
deterministic path was *measured, found to work, and declined*: Rapier's
`enhanced-determinism` produces bit-identical results on native and wasm
(`discovery/alpha/experiments/rapier-determinism`, commit `eb70cff`). The cost
was re-deriving every phone-tuned feel constant in ~1,700 lines of play code
against a different solver, to buy a replay proof that a hand-authored physics
level does not especially want. The shelf chose feel over provability **with the
numbers in hand**. Any future Tier-3 admission should be able to say something
equally specific about why determinism was not worth its price here.

### The inclusion filter (all must hold)

1. **Ours.** We wrote the game. If it is someone else's game taken as-is, it is
   Tier-2 and §9 governs it. A game we build *using* a third-party engine is
   Tier-3; a game someone else built that we merely host is not.
2. **The engine is the only non-deterministic part.** Non-determinism is a
   property we accept in one named dependency, not a general licence to be loose.
   See "the data/sim line" below — it is the heart of this tier.
3. **Fully client-side / static, non-extractive, local-first.** Unchanged from the
   shelf bar. No backend, no telemetry-home, no ads, no dark patterns.
4. **The engine is redistribution-licensed, pinned, and vendored.** It is not our
   code, so it follows the workspace dependency rule: **vendor it and add a CI
   drift check.** No CDN, no floating range, license recorded, size disclosed.
5. **Honestly represented.** The shelf must not imply a verifiable record where
   there is none — the same rule §9 imposes on wraps, and for the same reason.

### The sharing rule: inputs yes, outcomes never

This is the sharp edge of "honestly represented," and it is implementable rather
than aspirational:

> **A Tier-3 game may share an input. It may never share a claimed outcome.**

A level, a seed, a challenge, an authored puzzle — all fine, because they are
data, and data reproduces. A score, a time, a win, a "cleared in 3 shots" — not
shareable as a *record*, because nothing on the receiving end can re-derive it.
Tier-1's `?r=` share re-verifies by replaying a move list into a deterministic
core (§3); Tier-3 has no such core, so a share link carries the puzzle, not the
result.

Concretely: Emoji Wars sharing a level JSON is exactly right. Emoji Wars sharing
"I beat this in 3 shots" as a verified claim is exactly the faked verifiable
outcome §9 forbids. A *self-reported* score shown as self-reported is fine; the
lie is in the framing, not the number.

### The data/sim line (the load-bearing requirement)

Tier-3 is **not "Tier-1 minus rigour."** It is Tier-1 discipline applied to the
half of the game that can carry it. Every Tier-3 game must draw an explicit line
between:

- **The data side** — level schema, migrations, authored content, rules that are
  pure functions of data (scoring thresholds, mode state machines, break-model
  *decisions* as distinct from break-model *physics*). This side is deterministic,
  and it keeps **full Tier-1 discipline**: golden vectors, TDD red-first,
  mutation testing where the logic is non-trivial (§8).
- **The sim side** — whatever the engine actually integrates. Not reproducible,
  not golden-vectored, not mutation-tested.

The line must be visible in the directory structure, not just asserted in prose.
If you cannot point at which modules are on which side, the tier is being used as
an excuse rather than a category.

Emoji Wars is a good example of why this matters: its levels are authored JSON
with a versioned schema and a `migrate()`. Content determinism and simulation
determinism are different properties, and Tier-3 gives up only the second.

### What replaces golden vectors on the sim side

Tier-1 pins behaviour with golden vectors — exact expected outputs. Tier-3 cannot,
so the analogue is a **tolerance probe**: record the current engine's behaviour on
a fixed scenario, assert future runs stay within a recorded tolerance.

- Probes are **feel regression nets**, not correctness proofs. They catch "someone
  changed a constant and the hop is now mushy," which is Tier-3's characteristic
  failure — a change that leaves every test green and the game feeling wrong.
- Tolerances are **recorded from the engine's own run-to-run variance**, never
  invented. The bar is "as close as the engine is to itself."
- Probes should isolate one subsystem each (free fall, a bounce, a slide, a
  settle) so a failure is diagnostic rather than a shrug.

### Which Tier-1 standards change for an engine-backed original

| Tier-1 standard | For a Tier-3 original |
|---|---|
| Determinism-first Rust core → wasm (§2) | **Split** — required on the data side; **N/A** on the sim side. The line must be explicit. |
| Verifiable outcome / `pond-outcome` / `?r=` (§3) | **Replaced** by the sharing rule: inputs shareable, outcomes never presented as records |
| Tap-first, core decides legality (§4) | **Required** — we wrote the input model, so we own it. (This is where Tier-3 is stricter than Tier-2, which is exempt.) |
| Identity + tokens, WCAG AA, axe both themes (§5) | **Required**, fully — this is our own UI, not an embedded foreign canvas |
| Standard settings (§6) | **Required** — again, ours |
| How to play (§7) | **Required**, and it must state plainly that the game keeps **no verifiable record** |
| TDD + the gate (§8) | **Required.** Red-first on the data side; tolerance probes on the sim side. Mutation testing expected on the data side only. |
| Game isolation, `GameModule`, `/<id>/` URL, wiring test (§1) | **Unchanged** |

### What admitting the first Tier-3 game requires in code

As of this section being written, **the code does not yet know Tier-3 exists**.
The catalog contract in `src/contract.ts` is a discriminated union with a Tier-1
variant (`tier?: 1`) and a Tier-2 variant (`tier: 2`), and nothing else — so
`tier: 3` will not typecheck today. Two changes are needed when the first Tier-3
game lands, and both are **test-first**, not speculative groundwork to do now:

1. **A Tier-3 variant in `src/contract.ts`**, carrying the engine's provenance
   (name, pinned version, license, `approxSizeKb`) the way the Tier-2 variant
   carries the game's.
2. **The honest-representation banner must fire for it.** `src/wrapped-banner.ts`
   currently returns `null` unless `entry.tier === 2`. A Tier-3 game has no
   verifiable record either, so shipping one without widening that check would
   put an unmarked non-verifiable game on the shelf — the precise failure the
   honesty rule exists to prevent. Widen the condition, do not add a second banner.

Until both exist, this section is a **ratified standard with no implementation**.
That is a normal state for this repo — §9 was written the same way — but it is
worth stating plainly so nobody reads the checklist, writes `tier: 3`, and
concludes the docs are lying.

### Tier-3 vs Tier-2 — the differences that bite

Both give up the verifiable outcome, so they are easy to conflate. They are not alike:

| | Tier-2 wrap | Tier-3 original |
|---|---|---|
| Authorship | theirs, taken as-is | **ours** |
| Runs in | sandboxed iframe (`allow-scripts`, no `allow-same-origin`) | **our page directly** — it is our code |
| Containment harness (§9) | **required** | **N/A** — nothing foreign is executing |
| Provenance artifact | `tier2.meta.json` (the *game's* provenance) | **the engine's** provenance: pin, license, size, drift check |
| Tap-first (§4) | exempt (native input, documented) | **required** |
| Standard settings (§6) | exempt | **required** |
| Accessibility | our chrome only; embedded canvas exempt | **whole surface** |

The short version: Tier-2 buys safety with **containment**, because the code is
not ours. Tier-3 has nothing to contain and instead owes the **full first-party
standard** everywhere except the one property the engine denies it.

## New-game checklist (Tier-3 engine-backed original — see §11)

- [ ] Passes the inclusion filter (ours; engine is the only non-deterministic part; client-side/static + non-extractive; engine vendored/pinned/licensed with a CI drift check; honestly represented).
- [ ] The **data/sim line** is visible in the directory structure, and the data side is named in the game's README.
- [ ] Data side: TDD red-first, golden vectors, mutation testing triaged (equivalent vs real gap) per §8.
- [ ] Sim side: tolerance probes recorded from the engine's own run-to-run variance, one subsystem each.
- [ ] Sharing carries **inputs only** (level/seed/challenge). No outcome is presented as a verified record; any self-reported number is shown as self-reported.
- [ ] Tap-first honoured (§4); standard settings wired (§6); tokens + WCAG AA + axe clean in both themes across the **whole** surface (§5).
- [ ] "How to play" guide states plainly there is **no verifiable record**; `guide:shots` + sync tests; header link (§7).
- [ ] `GameModule` mounts; registry `tier: 3` + `status`; own `/<id>/` URL with a wiring test (§1). **First Tier-3 game only:** widen `src/contract.ts` and the `wrapped-banner.ts` tier check first, test-first — see "What admitting the first Tier-3 game requires in code".
- [ ] Engine bundle size disclosed; no runtime third-party fetch, no CDN.
- [ ] Full gate green (`npm run gate`) and deployed.

## New-game checklist (Tier-2 wrap — see §9)

- [ ] Passes the inclusion filter (client-side/static, non-extractive, redistribution-licensed, fits our chrome, honestly represented).
- [ ] Bundle **vendored** under `src/games/<id>/vendor/` (license verbatim); no runtime third-party fetch; each modification recorded as a patch.
- [ ] `src/games/<id>/tier2.meta.json` complete (provenance + posture + patches); `parseTier2Meta` passes; registry `attribution` matches the meta's `provenance`.
- [ ] Any extractive code (analytics/ads) stripped; copyleft source-offer recorded if applicable.
- [ ] `GameModule` mounts via `mountWrappedGame` (sandbox `allow-scripts`, no `allow-same-origin`); registry `tier: 2` + `status: "playable"`; own `/<id>/` URL.
- [ ] Honest-representation banner shows on the game page; our surrounding chrome is WCAG AA + axe clean.
- [ ] "How to play" guide (pure data) states plainly there is **no verifiable record**; `guide:shots` + sync tests; header link.
- [ ] `tests/tier2-containment.spec.ts` green for the game (containment + legibility + interaction) on both engines; full gate green and deployed.
