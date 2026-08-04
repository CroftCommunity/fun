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

### The two tiers

The standards in §§2–8 describe **Tier-1 Croft-native** games (build-fresh,
determinism-first, verifiable). The shelf also admits **Tier-2** opportunistic
ethical wraps/ports (already-packaged, static, non-extractive, taken as-is, **no
verifiable outcome — stated honestly**), gated by a real-browser
containment/legibility harness rather than by the verifiable-outcome + tap-first
standards. **The Tier-2 wrapped-game standard is ratified in §9 below**; Astray
(`src/games/astray/`) is its reference implementation, as solitaire is for
Tier-1. Everything in §§2–8 is Tier-1 unless noted.

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
  per-cell facet (match-3's jelly, then its special candies), model it as a
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
  and re-lock them in the same commit (see the match-3 B0 plan). An overlay can sit
  on a non-gem cell too: match-3's **obstacle flavour** (Track D — licorice / meringue)
  is an overlay on a `Blocker`, giving two distinct, mechanically-separate tiles that
  reuse the blocker's clear mechanic while rendering distinctly (the flavour is
  additive to `state_hash`, so no pre-obstacle vector re-locks).
- **When the new state is a new *kind* of cell, not a facet of a gem, add a `Cell`
  variant instead of an overlay.** match-3's **ingredient** (Track D) is a non-gem
  object that occupies a cell and *falls* — no gem lives under it, so an overlay
  cannot model it. A new `Cell::Ingredient` with an **additive hash tag** (a byte no
  pre-existing board carries) keeps the additive property — gem-only boards hash
  unchanged, so vectors still do not re-lock — while the compiler's exhaustive-match
  checks guide the edits. Gate matching/legality on `Cell::Gem` so the new kind is
  inert there (an ingredient never matches or swaps), and generalize gravity to the
  behaviour you want (an ingredient *falls* like a gem; a blocker stays a fixed
  shelf). Same pack-regeneration rule applies if it shifts play (see the match-3
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
  not any single board — like match-3's **order/mixed checklist** (clear N of a colour,
  make N striped + N wrapped). Model it with a small **progress accumulator** in the
  core, fed by **neutral, off-hash per-move report signals** (never add it to
  `state_hash` — it is not board state), and derive the per-seed targets from a
  deterministic seed template. Share that accumulator + target fn across the binding,
  the solver, and outcome replay so all three agree bit-for-bit; the solver then needs a
  progress-carrying search (memoize on `(state_hash, progress)`), not the board-state
  one. Winnability is still a solver-filtered pack (see the match-3 Track D checklist plan).
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
- `npm run test` = typecheck · lint · unit (builds the wasm first) · build.
  `npm run e2e` = Playwright incl. axe. Rust: `cargo test --workspace`, `fmt
  --check`, `clippy`. All green before shipping.
- Deploy is GitHub Actions → Pages (`.github/workflows/deploy.yml`): it builds the
  wasm, runs the gate, and publishes `dist/` to `fun.croft.ing`.

---

## 9. Tier-2 — wrapped games (the ratified addendum)

A Tier-2 game is an **already-packaged, ethical game taken as-is**. We do **not**
rebuild it and we do **not** fake a verifiable outcome. It earns a place by being
honestly represented and provably contained, not by the Tier-1 verifiable-outcome
standard. Astray (`src/games/astray/`) is the reference implementation; the Tux
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

Follow Astray (`src/games/astray/`, the simplest) or HexGL (a bigger, patched
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
  `pointer`, `touch`, `gamepad`). If a game is keyboard-only (Astray), **say so**
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

A **two-player adversarial** game (two sides, alternating turns, a win/draw/loss
result) is still a Tier-1 Croft-native game: it keeps §§2–8 (determinism-first
core → wasm, verifiable outcome, tap-first core-decides-legality, tokens/WCAG,
standard settings, how-to, the gate). It adds a **computer opponent**. **Drop 4**
(`src/games/drop4/`, `crates/drop4-*`) is the reference implementation, and
**Othello** (`src/games/othello/`, `crates/othello-*`) is the second — the
generality proof that the trait + harness carry to a different game.

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
  one alternating list, so replaying `(seed, moves)` reproduces the final board
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

Othello proved the split generalizes. When you add a second (or third) adversarial
game, this is what you write vs what you reuse:

**Reuse unchanged (shared code — do not fork):**
- `crates/adversary-core` — the `Adversary` trait your core implements.
- `src/harness/ai-runtime.ts` — the `AIRuntime` port + `MockRuntime` (CI) +
  `WebLLMRuntime` (embedded, same-origin, lazy).
- `src/harness/hybrid-player.ts` — `buildBand(tutorFacts)` + `HybridPlayer.pick`.
  Your wasm tutor view must be a **structural superset of `TutorFactMove`**
  (`col`, `value`, `quality`, `immediateWin`, `blocksOpponentWin`) — carry the
  Drop-4-flavored one-ply facts as `false` if your game has no such notion, and
  `buildBand` reuses with no change (its ideas degrade to quality-based).
- `src/harness/{match-runner,scorer,tournament}.ts` — the scoring rig (today it
  grades via `drop4-wasm`; generalizing it to an injected game/oracle adapter is
  the tracked follow-on — see `TODO/harness.md`).

**Reuse as a pattern (copy the per-game TS, don't share it):** the tutor panel,
the WebGPU-availability probe + experimental toggle + disclosure, the AI-banter
line, the result screen.

**Write new (game-specific):** the Rust `<game>-{core,solver,wasm}` (rules +
`Adversary` + `pond_outcome::Game`; the solver's Oracle + a class-preserving band
+ `tutor::assess`), and the front-end `<game>-{wasm.ts,outcome.ts,ts,howto.ts}`.
Duplicate the ~30-line band selector into your solver until a **third** game
exists (rule of three), then extract a shared `adversary-solver`.

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
- [ ] Gate green (unit + e2e + Rust) and deployed.

## New-game checklist (adversarial + AI opponent — §10, on top of Tier-1)

For a two-player game vs a computer opponent, add these to the Tier-1 checklist.
Reference implementations: **Drop 4** (solvable), **Othello** (heuristic Oracle).

- [ ] Core implements `adversary_core::Adversary` (rules) **and**
  `pond_outcome::Game` (replay/verify); moves — passes included — serialize so
  `(seed, moves)` replays exactly (prefer a compact numeric code over a tagged enum).
- [ ] Solver: an Oracle (exact where tractable, else heuristic depth-capped), a
  difficulty `Level` → class-preserving **band** (`select_in_band`, duplicated per
  rule-of-three), and `tutor::assess` → `{value, regret, quality, exact}` per move.
- [ ] wasm C-ABI adds the opponent (`live_move`) + tutor (`assess_json`/`tutor_json`,
  a superset of the shared `TutorFactMove`) + any special move export (e.g. `pass()`).
- [ ] Opt-in tutor panel (off by default) with **honesty bound to `exact`**
  (`coachFor` unit test): "threw the game" only when exact, "looks risky" otherwise.
- [ ] Experimental hybrid opponent behind a **WebGPU-gated toggle** (real,
  non-fallback adapter only) + up-front download disclosure, reusing
  `hybrid-player.ts`/`ai-runtime.ts` **unchanged**; engine stays the default and
  falls back on any LLM failure. Validated by an `ai:trial`-style run, not CI.
- [ ] CI proves the hybrid plug-in with a `MockRuntime` (no GPU on the gate).
- [ ] (Optional) measure the shipped players with the browser harness
  (`docs/HARNESS.md`).

See §10's "Recipe — adding an AI opponent to a new adversarial game" for what
reuses vs what is new.

## New-game checklist (Tier-2 wrap — see §9)

- [ ] Passes the inclusion filter (client-side/static, non-extractive, redistribution-licensed, fits our chrome, honestly represented).
- [ ] Bundle **vendored** under `src/games/<id>/vendor/` (license verbatim); no runtime third-party fetch; each modification recorded as a patch.
- [ ] `src/games/<id>/tier2.meta.json` complete (provenance + posture + patches); `parseTier2Meta` passes; registry `attribution` matches the meta's `provenance`.
- [ ] Any extractive code (analytics/ads) stripped; copyleft source-offer recorded if applicable.
- [ ] `GameModule` mounts via `mountWrappedGame` (sandbox `allow-scripts`, no `allow-same-origin`); registry `tier: 2` + `status: "playable"`; own `/<id>/` URL.
- [ ] Honest-representation banner shows on the game page; our surrounding chrome is WCAG AA + axe clean.
- [ ] "How to play" guide (pure data) states plainly there is **no verifiable record**; `guide:shots` + sync tests; header link.
- [ ] `tests/tier2-containment.spec.ts` green for the game (containment + legibility + interaction) on both engines; full gate green and deployed.
