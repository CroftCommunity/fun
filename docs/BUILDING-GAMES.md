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

The standards in this doc describe **Tier-1 Croft-native** games (build-fresh,
determinism-first, verifiable). The shelf also admits **Tier-2** opportunistic
ethical wraps/ports (already-packaged, static, non-extractive, taken as-is, **no
verifiable outcome — stated honestly**), gated by a real-browser
containment/legibility harness rather than by the verifiable-outcome + tap-first
standards. The Tier-2 wrapped-game addendum is drafted in the Tux Racer wrap
spike (`plans/`) and lands here when ratified. Everything below §1 is Tier-1
unless noted.

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
  and re-lock them in the same commit (see the match-3 B0 plan).

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

## New-game checklist

- [ ] Rust core + rules doc + golden vectors; native==wasm verified.
- [ ] Raw C-ABI + serde-JSON binding (holds state, never panics) + typed TS wrapper.
- [ ] `GameModule` + registry `status: "playable"`; own `/<id>/` URL; mounts in all modes.
- [ ] Tap-source → tap-target with **core-driven** legal-move glow; illegal tap = no change.
- [ ] Verifiable outcome (`pond-outcome`), verification-forward end screen, re-verifying `?r=` share.
- [ ] Identity on `tokens.css`; WCAG AA both themes; axe clean.
- [ ] Standard settings wired (Enable hints on; Declare assistance on; hints-off → "I'm stuck" ends + reports).
- [ ] "How to play" guide (pure data) + `guide:shots` screenshots + sync tests; header link.
- [ ] Gate green (unit + e2e + Rust) and deployed.
