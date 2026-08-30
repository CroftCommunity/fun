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
directory. This isolation matters most for **webxdc-style
bundles**, which are wholly self-contained under their own directory and must not
bleed into the shared chrome (see "The two tiers" below).

### The two tiers

The standards in §§2–8 describe **Tier-1 Croft-native** games (build-fresh,
determinism-first, verifiable). Solitaire is the reference implementation, and
everything in §§2–8 is Tier-1 unless noted.

**Tier-3 — engine-backed originals** (§11) is the other: a game **we build**, on
a **third-party engine we do not control the numerics of**. It is ours like
Tier-1 and unverifiable unlike it.

```
                    outcome re-provable?        YES              NO
   who built it?
   ours (build-fresh)                        Tier-1           Tier-3
```

Emoji Wars (`levelforge`) is Tier-3's reference implementation.

**Tier 2 was retired on 2026-08-29** — it held third-party games taken as-is, in
a sandboxed iframe, with no verifiable outcome. Four games passed through it and
none stayed. Its headstone is §9, and the reasoning worth keeping is recorded
there: honest representation, containment for foreign code, and the inclusion
filter. The numbering is left alone so existing cross-references still resolve.

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
  verifiable result (no faked verifiable outcome). Reference:
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

### Centre the play surface — the frame does it

A game renders into the **stage** of the game frame (§4c), which centres its content and
owns whatever height the frame's fixed bands leave. The rules that used to live here —
one centred column, on-screen keys on the board's centreline, the `inline-flex`
centring trap, the 360px no-overflow check — still hold *inside* the stage: a board
still wants a column wrapper (`display: flex; flex-direction: column; align-items:
center`) so its d-pad or keyboard sits under it, and every board still ships a
narrow-viewport check and ≥ 44px touch targets. The full playbook and the lessons log
are `docs/RESPONSIVE-DESIGN.md`. What changed: controls, HUD, banners and settings are
**no longer the game's to stack above the board** — they are declared to the frame.

### 4c. The game frame — declaring your controls, and how the game will be shown

Every game page shares one structure, `src/game-frame.ts`. A game declares a
`GameFrameSpec` once, calls `frame.update(spec)` whenever its model changes, and never
touches the chrome. Plan and reasoning: `plans/2026-08-30-plan-game-frame.md`; the
mocks it was built from: `mocks/d-game-frame.html`.

```
 PHONE (≤ 899px)                          DESKTOP (≥ 900px)            ← Phase 3
┌──────────────────────────────┐          ┌───────────────────────────┬────────────┐
│ ① shelf bar        56px fixed│          │ ① shelf bar               │            │
├──────────────────────────────┤          ├───────────────────────────┤ ② name  ⋯  │
│ ② game bar   ‹ Othello  ⋯ 48 │          │                           │ ③ meters   │
├──────────────────────────────┤          │                           │            │
│ ③ meter row  (seats / stats) │          │        ④ stage            │ ⑤ verbs    │
│                        56px  │          │    board fills the height │            │
├──────────────────────────────┤          │                           │ setup      │
│ ④ stage — the board          │          │                           │ (read-only)│
│   owns the remaining height  │          │                           │            │
│   transient things overlay   │          │                           │ settings   │
├──────────────────────────────┤          │                           │ (inline)   │
│ ⑤ dock  ↶ Undo · ✦ Hint · ⟳ │          └───────────────────────────┴────────────┘
│                        72px  │            the dock and the rail are ONE panel, reflowed
└──────────────────────────────┘
```

**The rule the frame exists for: nothing above the board changes height while you
play.** Bands ①②③⑤ are fixed-height. Text swaps inside slots that already have the
room. Anything transient overlays the stage. The board's top edge is the same pixel
from the first move to the last — and a browser test per game asserts it.

#### What a game declares

```ts
interface GameFrameSpec {
  title: string;        // "Othello"
  mode?: string;        // a chip beside the title: "Medium" · "Today's deal" · "Campaign · 3 of 6"
  pitch?: string;       // the one line under the name on the start screen (Phase 5)
  meters: Meter[];      // band ③ — seats (versus) or stats (solo). The COUNT is fixed for the life of the frame.
  verbs: Verb[];        // band ⑤ — at most FIVE. Six throws, naming your game and listing them.
  setup?: SettingRow[];        // the New game card (Phase 3/5): decides the game before it starts
  preferences?: SettingRow[];  // your section of the settings sheet (Phase 3): outlives the game
}
```

- **A seat** (`kind: "seat"`): `name`, `glyph`, `score`, an optional `sub` ("your move",
  "thinking…") and a `state` (`idle | active | thinking`). The sub-label is a 12px line
  whether or not it has text — that is the reservation. **"Thinking" is a seat state,
  not a line of text you append anywhere.** So is "goes again".
- **A stat** (`kind: "stat"`): a `value` and a `label` — moves, score, lives, swaps left.
- **A verb** acts on the game in progress: `id`, `label`, `icon`, `onPress`, optional
  `primary` / `disabled`. The reserved verbs, in this order when you have them: **Undo ·
  Hint · New game… · Settings**, plus at most one of your own (Solitaire's *Auto*, Trio
  Tumble's *Levels*). A move that is the game itself — Cribbage's *Throw to crib*,
  Bubble's *Fire* — is not a verb; it stays on the board.

#### The test for sorting a control into its home

Ask what it does. **Does it act on the game in progress?** → a verb (dock / rail).
**Does it decide the game before it starts** — daily or free, opponent, difficulty, which
side, which objective? → setup (the start screen and the New game sheet; read-only in the
rail while playing). **Does it outlive the game** — hints on/off, declare assistance,
tutor, sound, a skin, a control feel? → a preference (the settings sheet, common rows
first, yours second). A Difficulty `<select>` beside the board is setup wearing a verb's
clothes; changing it restarts the game, and the New game card says so.

#### What goes in the stage, and what must not

The stage is yours: the board, its on-board inputs (a d-pad, an aim bar, a keyboard),
and any **absolutely positioned** transient — a toast, a first-move hint, the AI's
banter. What must not go there: anything **in flow above the board** whose height can
change — an instruction banner, a status line that appears and disappears, a `<details>`
that opens in place. The instruction sentence belongs on the start screen, in How to play
(§7), and as a one-time toast. A status line that must stay below the board keeps a
`min-height` (Solitaire's `.sol-status` is the model; `.furrow-status` without one was the
bug).

#### How the game will be shown

- **The game bar** (②) carries `‹` back to the shelf, your `title`, the `mode` chip, and
  the `⋯` menu (How to play, open in a new tab — the chrome fills it).
- **Unmigrated games** get the game bar and the stage only, and keep rendering their own
  controls inside the stage until they migrate. The frame with no spec is a legal state,
  not a broken one.
- **The dock becomes a rail on desktop.** At ≥ 900px the same four bands reflow into a
  280px column beside the board (`data-gf-shape="rail"` on the frame's root; `"dock"`
  below). Verbs become a two-column grid, the meters stack, and the rail gains a panel
  the phone does not show: **This game** (your `setup` rows, read-only, as "label · value")
  and **Settings** (the same rows the sheet carries, inline — a preference is never more
  than one click away on desktop). You declare nothing extra for this.
- **Settings is the frame's verb, not yours.** The frame appends it to your verbs (so you
  may declare at most four), and it opens the settings sheet: a bottom-sheet dialog on a
  phone (`role="dialog"`, focus moves in, Escape and the scrim close it and return focus
  to the verb), inline in the rail on desktop. The sheet is **Every game** first — Hints,
  Declare assistance, Sound, and the mirror preference — then a section headed with your
  `title` holding your `preferences`. A game with no preferences still gets the common
  section. Declaring your own `settings` verb throws. The common section's **Controls on
  the left** flips the frame live (`data-gf-side` on the root); your game sees nothing.
- **The New game sheet** renders your `setup` rows and a Start button; Start closes the
  sheet and calls your `onStart()`. Open it from your own *New game…* verb with
  `frame.openSheet("setup", button)` — pass the button so focus returns to it.
  A second `openSheet` replaces the first; there is never more than one sheet.
  **The start screen** shows your
  `splash.jpg`, `title`, `pitch` and setup card on a **bare** `/<id>/` land, and a
  **continue card** (your `icon.jpg`, "In progress · 2 hours ago", the store's summary
  line, Continue / New game…) when the store holds a game — in its "play again" form (no
  Continue, New game primary) when that game is finished. **Any URL with a query — `?r=`,
  `?seed=`, `?play=1` — is a deep link and mounts the board directly**, so every test,
  guide shot and share link keeps landing on a board (plan Q7). Put your `pitch` (and, if
  your New game card has rows, a `setup` factory) on the **registry entry**, because the
  poster renders before your module exists. Play mounts you and writes the store from
  your `snapshot()`; Continue mounts you and calls `resume(progress)`; New game on the card
  clears the store and shows the poster. The frame logs which it showed:
  `[frame] start=poster|continue|direct id=… progress=…`.

#### Continue — the progress store

`src/progress.ts` keeps one record per game (`fun-progress-<id>`); the newest wins, there
is no history. A game opts in with two members on its module:

```ts
snapshot(): Progress;        // the frame asks after every move; you answer with seed + moves + a summary line
resume(progress: Progress);  // replay
```

The record is `{ v: 1, status: "in-progress" | "finished", startedAt, updatedAt,
setup: { mode: "daily:YYYY-MM-DD" | "free", … }, record: <yours, opaque>, summary: { line } }`.
**`summary.line` is what the continue card and the rail print without loading your
engine** — "Move 14 · you lead 9–4" — so write it for a reader, and never leave it
blank (a record without one is rejected). A daily record dies at the local rollover after
its last update, in progress or finished (so the card can say "won today" until then); a
free record never expires. Undo state is part of your record. `?r=` never touches the
store. Storage denied → no card, never an error. A stored record is validated on the way
in and a rejected one is cleared with its reason at `debug` — a store written by a previous
version is untrusted data. The placeholder (`src/games/placeholder.ts`) is the smallest
possible client: its counter is its record.

#### A worked example — the versus archetype (Othello, `src/games/othello/othello.ts`)

```ts
const spec = (): GameFrameSpec => ({
  title: "Othello",
  mode: LEVEL_LABELS[level],                                    // the chip beside the name
  meters: [
    { kind: "seat", id: "you",    name: "You", glyph: "●", score: you,
      state: humanTurn ? "active" : "idle", sub: humanTurn ? "your move" : undefined },
    { kind: "seat", id: "engine", name: "The Engine 🤖", glyph: "○", score: them,
      state: engineThinking ? "thinking" : "idle", sub: engineThinking ? "thinking…" : undefined },
  ],
  verbs: [{ id: "new", label: "New game", icon: "⟳", onPress: (btn) => frame?.openSheet("setup", btn) }],
  setup: othelloSetupRows({ level: (l) => (level = l), disc: (d) => (disc = d) }),   // one builder, shared with the poster
  preferences: [tutorToggle, ...(localAiAvailable ? [localAiToggle] : [])],
  onStart: () => void startGame(),
});
// in render(): container.replaceChildren(board, tutor?, statusLine); frame?.update(spec());
// banter and the opening hint: frame?.toast(text) — never a <p> above the board
// the store: snapshot() → { setup: { mode, seed, level, disc }, record: { seed, moves }, summary: { line } }; resume() replays
```

What moved where: the turn bar → seats; "X is thinking…" → the engine's seat state; the
Difficulty / You play selects → `setup` (start screen + New game sheet, read-only in the
rail); Show tutor and the local-AI toggle → `preferences`; the two-sentence banner →
`pitch` on the registry entry plus a one-time toast; the AI's banter `<p>` → a toast.
The status line stays **below** the board for the forced-pass sentence, in its
reserved-height slot. Two things the sampler caught on the way: the fanfare line at the
end of a game rendered *above* the final board (it sits below now), and the rail's stage
was vertically centring, so a status line growing below the board moved it by half.

#### The test every migration ships

`tests/<game>.spec.ts` records the board's `boundingBox().y` at move 1 and asserts it is
unchanged after the game's own triggers — the engine's reply, a hint, a rejected word, a
selection, the settings sheet opening. Run it against the pre-migration page first and
record the movement it finds (Othello moved 24.8px on WebKit; plan Phase 0 D4). A
stability spec that was never red proves nothing.

## 5. Identity + tokens

- `tokens.css` is the **only file with raw hex**. Components use semantic `var()`
  tokens; a unit test forbids hex in `styles.css`.
- **Light + dark**, driven by `[data-theme]`: a pre-paint inline script (no flash)
  + a header toggle (`src/theme.ts`, `resolveTheme` is pure and unit-tested).
- **Every text/UI colour pair clears WCAG AA in both themes** — ratios recorded in
  `tokens.css` and re-computed by `tests/tokens.test.ts`; axe runs on chrome +
  each board in both themes. The shelf identity is a **felt table + ivory cards**;
  see `docs/DESIGN.md`.

### Re-rendering: the model owns the board, the player owns the panel

Every game renders with `container.replaceChildren(…)` — fourteen of them do, measured
2026-08-29. Rebuilding the whole subtree from the game model is the right shape and should
stay: it is simple, it has no diffing to get wrong, and everything the model owns is
correct by construction.

**It is wrong for the few things the model does not own.** Whether the player opened the
settings panel, where their focus was, and where the caret sat are not in the model, so a
rebuild silently discards them. Wrap the replacement:

```ts
const ui = captureUiState(container);   // src/ui-state.ts
container.replaceChildren(/* … */);
restoreUiState(container, ui);
```

**Any asynchronous work that calls `render()` can race the player.** Four games probe for
a WebGPU adapter and re-render when it resolves — at a moment nothing in the UI predicts.
On a CI runner that landed between a test opening the settings panel and clicking a
checkbox inside it: the checkbox was detached, its replacement arrived inside a closed
panel, and `main` did not deploy for two days. A player on a slow device sees a panel that
shuts by itself. The probe is not special; it is only the async caller that exists today.

**State the tutor computes is app state, not DOM state.** A band of reasonable moves is
*true* until a move is made and *stale* the instant one is, so hold it **with the state
hash it was computed for** and repaint it only while that still matches (`tutorView` in
furrow, `tutorReading` in the others). Restoring it unconditionally trades a lost answer
for a wrong one.

As of 2026-08-29 the four adversarial games with a probe are wrapped; the other ten are
not, because nothing yet re-renders them asynchronously. Adding any async re-render to a
game means wrapping it first.

## 6. Standard settings (shared, persisted) — `src/settings.ts`

Settings are shared across games and persisted; both default **on**:

- **Enable hints** (on). A **Hint** points at a good legal move and explains it;
  using a hint **counts as assistance**. When there is genuinely no move left, it
  ends the game as `Stuck`.
- **Declare assistance used** (on). Controls whether the outcome record carries the
  (self-declared) assistance flag. Undo and hints set it; assistance is not
  replay-derivable, so it is an honesty declaration.

Since the game frame (§4c) these two rows, plus **Sound** (the music bar's switch,
mirrored) and **Controls on the left** (the frame's mirror preference, `fun-controls-left`:
the rail moves left of the board on desktop, the dock's verbs reverse on a phone — plan
2026-08-30 D4), are the **"Every game"** section at the top of every settings sheet; the
chrome supplies them and a game never re-declares them. A game's own preferences follow in
a section headed with its name.

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

**Pacing is not a thing the browser suite asserts.** A full-game test asserts rules
and wiring; at the engine's real pace it holds a CI worker for a minute per engine
doing nothing. A game with beats (think, settle, fanfare) reads `?fast=1` and collapses
them to a frame, and its game-playing tests — tagged `@long` — pass it. Tag the wiring
test `@smoke`; `npm run smoke` is the human's quick check. (2026-08-29, the shards plan.)

## 9. Tier-2 — wrapped games (RETIRED 2026-08-29)

**This tier no longer exists.** The standard, its containment harness, its
`tier2.meta.json` schema, its honest-representation banner, and its four
implementations have all been removed at the owner's call.

It is recorded here rather than deleted outright because §11 refers to it, the
plans that built it are still in `plans/`, and a standard that was ratified and
applied deserves a headstone rather than a silent gap. **The full text is in git
history** — `git log --follow -- docs/BUILDING-GAMES.md` — along with the
containment spec, the meta schema, and the four wraps.

### What it was

A Tier-2 game was an **already-packaged, ethical game taken as-is**: fully
client-side, non-extractive, redistribution-licensed, run inside an
opaque-origin sandboxed iframe, and **honestly represented** — it kept no
verifiable outcome and the shelf said so on the page. Astray was its reference
implementation.

### Why it went

Four games entered the tier and none stayed.

- **Astray, HexGL and Clumsy Bird** were removed on 2026-08-28: they did not fit
  the shelf's model.
- **Orchard Drop** left on 2026-08-29, rebuilt as a Tier-1 game
  (`plans/2026-08-28-1-plan-orchard-drop-tier1.md`). It had always been the
  awkward one — it was *ours*, wrapping a physics engine rather than somebody
  else's game, so `tier: 2` misdescribed it from the start. Replacing 80KB of
  Matter.js with a fixed-point core turned it into exactly the thing the tier
  said it could never be: a wrapped game with a verifiable record.

That left the machinery with no instances. It was kept for one day as a ratified
standard awaiting a future wrap, then purged: **an empty tier is a maintenance
cost and a false promise.** Its containment spec went green *by skipping*, which
is the shape of a test that no longer tests anything, and the `tier: 2` variant
in `src/contract.ts` was a branch nothing could take.

### What is worth carrying forward

The reasoning survives the tier:

- **Honest representation.** A game that cannot prove its outcome must say so on
  the page. §11 still carries this for engine-backed originals, and it is the
  rule that made Orchard Drop's rebuild worth doing rather than papering over.
- **Containment is for foreign code.** An opaque-origin sandbox is the right
  answer when the code is not ours. Nothing on the shelf is foreign today; if
  something is again, the harness is in git history and is worth re-reading
  before being rewritten.
- **The inclusion filter** — client-side, non-extractive, redistribution
  licensed, honestly represented — is a good filter for *any* third-party thing,
  not only a game.

**If a wrap is ever wanted again, restore this from history rather than
reinventing it.** It was ratified, it was applied four times, and the harness it
produced worked.

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

**Variation — hidden information (cribbage).** Everything above assumes both
sides see the whole position; `adversary-core` says so in its first line, and the
band's class floor, the tutor's `exact` and the rig's oracle-grading all read it
that way. Cribbage is the first game where that is false, and the honest shape is
to **not** implement `Adversary` rather than to bend it (landed 2026-08-29,
`plans/2026-08-29-plan-cribbage-vs-engine.md`). What replaces each piece:

- **The state is not the observation.** The core keeps a full `GameState` and
  hands out a per-seat `View` (`cribbage_core::View::for_seat`). The solver's
  public functions take a `View` and nothing else — a test reads the crate's own
  source and fails if `GameState` appears outside `#[cfg(test)]`. The wasm binding
  has **no state export**: `view_json` is the human's view, and a test asserts no
  engine card code is in it.
- **Strength is expectation, not search.** A throw's value is the kept hand's
  mean over the 46 possible cuts ± a build-time crib table; pegging is a two-ply
  expectimax over the unseen ranks. There is no class floor because no move has
  a class; difficulty is noise over the ranked options, with the same
  RNG-untouched-at-zero property the shared selector pins.
- **`exact` means exhaustive, not proven.** A discard verdict is exact (the
  expectation is complete); a pegging verdict never is (the other hand is a
  model). `coach_line` is bound to the flag in Rust, as in every other game.
- **The rig is Rust, not `GameOracle`.** `GameOracle.board()` exposes the whole
  position, so any `Player` plugged into `runMatch` sees the other hand. Cribbage
  measures itself in `crates/cribbage-solver/tests/rig.rs`: self-play by level,
  the discard-oracle check (Expert's throw equals the exhaustive optimum, every
  deal), and the **peek check** — a test-only player given the full state must
  beat the honest Expert by a wide margin (measured 81%). A leak makes the honest
  engine *stronger*, so the symptom to fear is that margin shrinking.
- **Counting is a move.** The show is three `Claim(n)` codes per deal, graded by
  the core; automatic counting submits the exact claim, manual counting submits
  the player's, and the record is the same shape either way.

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
  *who*, not a silent force: a turn bar naming both sides (Drop 4: "The Engine — since the game frame, the seats in band ③ with "thinking" as a seat state (§4c)
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

- [ ] **The game frame (§4c):** a `GameFrameSpec` declared with `frame.update()` — meters,
      at most four verbs, `setup`, `preferences`; `pitch` (and a `setup` factory) on the
      registry entry; nothing in flow above the board; transients via `frame.toast()`;
      `snapshot()` / `resume()` for Continue; a browser stability spec
      (`tests/helpers/board-top.ts`) run red against the pre-migration page first.

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

**For a hidden-information game** (cribbage is the reference) the items above that
name `Adversary`, `select_in_band`, the `GameOracle` rig and `baselines.test.ts` do
**not** apply; what replaces them is the "Variation — hidden information" block:
a `View` type, a solver whose public surface takes only a `View` (source-pinned),
a binding with no state export (leak-tested), and a Rust rig with the discard-
oracle and peek checks. The verifiable record, the honest `exact`, the identity
and the assistance standards apply unchanged.

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
   not a game for this shelf at all — the tier that admitted third-party games
   was retired (§9). A game we build *using* a third-party engine is Tier-3.
2. **The engine is the only non-deterministic part.** Non-determinism is a
   property we accept in one named dependency, not a general licence to be loose.
   See "the data/sim line" below — it is the heart of this tier.
3. **Fully client-side / static, non-extractive, local-first.** Unchanged from the
   shelf bar. No backend, no telemetry-home, no ads, no dark patterns.
4. **The engine is redistribution-licensed, pinned, and vendored.** It is not our
   code, so it follows the workspace dependency rule: **vendor it and add a CI
   drift check.** No CDN, no floating range, license recorded, size disclosed.
5. **Honestly represented.** The shelf must not imply a verifiable record where
   there is none. This rule outlived the tier that first stated it (§9), and it
   is the rule that made Orchard Drop's rebuild worth doing rather than papering
   over.

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
outcome the shelf forbids. A *self-reported* score shown as self-reported is fine; the
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
| Tap-first, core decides legality (§4) | **Required** — we wrote the input model, so we own it. |
| Identity + tokens, WCAG AA, axe both themes (§5) | **Required**, fully — this is our own UI, not an embedded foreign canvas |
| Standard settings (§6) | **Required** — again, ours |
| How to play (§7) | **Required**, and it must state plainly that the game keeps **no verifiable record** |
| TDD + the gate (§8) | **Required.** Red-first on the data side; tolerance probes on the sim side. Mutation testing expected on the data side only. |
| Game isolation, `GameModule`, `/<id>/` URL, wiring test (§1) | **Unchanged** |

### What admitting the first Tier-3 game requires in code

As of this section being written, **the code does not yet know Tier-3 exists**.
The catalog contract in `src/contract.ts` is a discriminated union with a Tier-1
single entry type with no `tier` discriminant at all — so
`tier: 3` will not typecheck today. Two changes are needed when the first Tier-3
game lands, and both are **test-first**, not speculative groundwork to do now:

1. **A Tier-3 variant in `src/contract.ts`**, carrying the engine's provenance
   (name, pinned version, license, `approxSizeKb`).
2. **An honest-representation banner must be written for it.** There used to be
   one (`src/wrapped-banner.ts`, retired with Tier-2 on 2026-08-29 — it is in git
   history and is worth reading before rewriting). A Tier-3 game has no
   verifiable record, so shipping one without a banner would put an unmarked
   non-verifiable game on the shelf — the precise failure the honesty rule exists
   to prevent.

Until both exist, this section is a **ratified standard with no implementation**.
That is a normal state for this repo — §9 was written the same way, before it
was retired — but it is
worth stating plainly so nobody reads the checklist, writes `tier: 3`, and
concludes the docs are lying.

### What Tier-3 owes, now that Tier-2 is gone

Tier-2 used to be the comparison: it bought safety with **containment**, because
the code was not ours. Tier-3 has nothing to contain, and so owes the **full
first-party standard** everywhere except the one property the engine denies it.

| | Tier-3 original |
|---|---|
| Authorship | **ours** |
| Runs in | **our page directly** — it is our code |
| Containment harness | **N/A** — nothing foreign is executing |
| Provenance artifact | **the engine's**: pin, license, size, drift check |
| Tap-first (§4) | **required** |
| Standard settings (§6) | **required** |
| Accessibility | **whole surface** |

- [ ] **Seats, not a turn bar (§4c):** both sides as `kind: "seat"` meters; "thinking",
      "passing", "goes again" as seat states / sub-labels; the AI's banter as a toast;
      difficulty, side and opponent as `setup`; tutor and local-AI as `preferences`.

## New-game checklist (Tier-3 engine-backed original — see §11)

- [ ] Passes the inclusion filter (ours; engine is the only non-deterministic part; client-side/static + non-extractive; engine vendored/pinned/licensed with a CI drift check; honestly represented).
- [ ] The **data/sim line** is visible in the directory structure, and the data side is named in the game's README.
- [ ] Data side: TDD red-first, golden vectors, mutation testing triaged (equivalent vs real gap) per §8.
- [ ] Sim side: tolerance probes recorded from the engine's own run-to-run variance, one subsystem each.
- [ ] Sharing carries **inputs only** (level/seed/challenge). No outcome is presented as a verified record; any self-reported number is shown as self-reported.
- [ ] Tap-first honoured (§4); standard settings wired (§6); tokens + WCAG AA + axe clean in both themes across the **whole** surface (§5).
- [ ] "How to play" guide states plainly there is **no verifiable record**; `guide:shots` + sync tests; header link (§7).
- [ ] `GameModule` mounts; registry `tier: 3` + `status`; own `/<id>/` URL with a wiring test (§1). **First Tier-3 game only:** add a `tier` discriminant to `src/contract.ts` and write the honest-representation banner first, test-first — see "What admitting the first Tier-3 game requires in code".
- [ ] Engine bundle size disclosed; no runtime third-party fetch, no CDN.
- [ ] Full gate green (`npm run gate`) and deployed.
