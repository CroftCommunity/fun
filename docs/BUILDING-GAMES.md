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

## 2. Determinism-first core → wasm

- A Rust core crate holds the rules, with a **rules doc + golden vectors** and a
  `state_hash`. It is cross-build verified so **native == wasm** (`xbuild`).
- The browser binding is **raw C-ABI + serde-JSON** (no `wasm-bindgen`): the wasm
  **holds the game state**, exposes typed integer-arg move exports and JSON reads
  via a `ptr`/`len` output buffer. It **never panics** — every fallible path maps
  to a status code or an empty/`null` buffer (a wasm panic aborts the module).
- A thin typed TS wrapper (`src/games/<game>-wasm.ts`) presents the API the UI
  calls. The UI never re-implements rules.

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

## 4. Interaction model — tap first, the core decides legality

- **Tap a source → tap a destination.** Identical with mouse, touch, or keyboard.
  This is the accessible floor and it is always present.
- **The UI never decides legality.** It reads the core's `legalMoves()`, **glows
  exactly** the legal destinations, and calls the matching `play()`. An illegal
  tap changes nothing. (An E2E asserts this — it is the guardrail against rules
  leaking into the UI.)
- **Drag-and-drop is a fast-follow**, never the only way in. Add convenience
  gestures (double-tap to auto-place) where they fit, on top of tap.

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
