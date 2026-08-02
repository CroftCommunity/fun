# fun — the Croft games pond (`fun.croft.ing`)

A determinism-first, local-first **game shelf**. Each game is built so its outcome is verifiable by
replaying its move list against a state hash, it runs offline with no account and no server, and it is
a portable artifact addressable at its own URL.

## The shelf and the drawer

`fun.croft.ing` presents games in a **slide-out drawer** over a persistent play area; each game can
also go **full-screen** or **open in its own tab** (so every game has its own URL). A game is a module
that implements one contract and renders chrome-agnostically into a mount point — the drawer is built
once and every game reuses it. Shelf order: **solitaire → match-3 → bubble → wyrdle → 2048 → align → blockdoku → loose ends → cribbage**.

## Layout

```
crates/
  match3-core/       deterministic match-3 engine (promoted from the discovery spike; self-contained
                     with its RULES.md + vectors/) — green, red-first
  solitaire-core/    Klondike draw-1 engine (master-plan Phase 4) — green
  solitaire-solver/  build-time Klondike solver + winnable-daily pack generator (Phase S) — green
  pond-docformat/    P2 versioned document envelope (saves / codes / outcomes) — built
  pond-outcome/      P8 verifiable-outcome record (replay → state hash)         — built
  match3-wasm/       browser binding over match3-core (raw C-ABI + serde-JSON)   — built
  solitaire-wasm/    browser binding over solitaire-core (raw C-ABI + serde-JSON) — built
  bubble-core/       deterministic bubble-shooter engine (hex board w/ parity-offset top-row
                     insert, quantized-angle aim → fixed-point landing, pop/drop; clear-board
                     + levels mode) — green
  bubble-solver/     build-time clear-the-board solver + winnable-daily pack generator — green
  bubble-wasm/       browser binding over bubble-core (raw C-ABI + serde-JSON)     — built
  wyrdle-core/       deterministic word-guessing engine (two-pass scoring, embedded license-clean
                     word lists, seed→answer map, answer pack) — green (no solver: trivially winnable)
  wyrdle-wasm/       browser binding over wyrdle-core (raw C-ABI + serde-JSON)     — built
  twenty48-core/     deterministic 2048 engine (exponent tiles, seeded spawns, slide/merge,
                     win@2048 / stuck) — green (no solver: every seed is playable)
  align-core/        deterministic falling-block engine (fixed-timestep tick sim, 7-bag,
                     SRS kicks, integer gravity, guideline scoring) — green
  align-wasm/        browser binding over align-core (raw C-ABI + serde-JSON)          — built
  blockdoku-core/    deterministic 9x9 block-sudoku engine (53-shape catalog from the
                     original AGPL game, seeded deal, row/col/box union clearing,
                     ported scoring, endless score-attack) — green (no solver: every deal is playable)
  blockdoku-wasm/    browser binding over blockdoku-core (raw C-ABI + serde-JSON)      — built
  looseends-core/    deterministic arrow-release (tap-away) engine — integer-exact
                     FNV/mulberry32 RNG, FREE test + release, solvable-by-construction
                     generator, state hash — green (no solver: solvable by construction)
  looseends-wasm/    browser binding over looseends-core (raw C-ABI + serde-JSON)   — built
  twenty48-wasm/     browser binding over twenty48-core (raw C-ABI + serde-JSON)   — built
games/solitaire/     daily-pack.json — a year of winnable daily seeds + a fixture win line (v2, seeds-lean)
games/bubble/        daily-pack.json — a year of winnable clear-the-board seeds + a fixture clear line
games/2048/          daily-pack.json — a year of shuffled daily seeds + a fixture replay line
games/blockdoku/     daily-pack.json — a year of daily seeds (no solver: every deal is playable)
games/wyrdle/        daily-pack.json — a year of shuffled answer seeds + a fixture win line;
                     PROVENANCE.md — the word-list sources + licences (all license-clean)
src/                 the games drawer UI (vanilla TS + esbuild); each game owns src/games/<game>/
plans/               the phase-plans governing this repo
```

## Solitaire (playable — front-plan Phase 4)

`/solitaire/` is a real Klondike draw-1 game over the wasm binding: tap a source → the core's legal
targets glow → tap a target to move; double-tap auto-sends to a foundation; the stock draws and
recycles. Daily deal by default (a winnable seed from `daily-pack.json`, UTC rollover), with a
free-play toggle (`?seed=<n>` for deterministic runs). Undo and an "I'm stuck" control exist; a
"Declare assistance used" setting (on by default) records whether undo/hints were used. A win leads
with a verification-forward screen — "Cleared clean ✓ — verifiable" — the full `pond-outcome` record,
moves-to-clear, one-tap re-verify (replays the record through the core), and a `?r=` share link that
re-verifies the shared result before display (deflated, so even a long win stays a portable URL).

## Match-3 (playable — Candy-Crush-style)

`/match3/` is a target-score-in-moves game: an 8×8 board of big, glossy, distinctly-shaped candies
(colour-blind safe), **swipe** a candy toward a neighbour to swap — or tap gem-then-neighbour, the
accessible floor; only match-making swaps are legal (the core decides and they glow). A 20-swap budget
graded into 0–3 stars. Clears hold long enough to read, spray a particle **burst**, and a multi-cascade
flashes an escalating **Nice/Sweet/Divine**. Moves out → a verifiable score+stars record with re-verify +
a `?r=` share. New players land in a **level campaign** (curated levels over verifiable seeds; the first
are gentle and Level 1 glows an opening move); best-stars progress and the in-progress board (as a move
list) persist, so a reload resumes. A **skippable narrative overlay** (Biscuit's beats) rides a small
game-event bus — placeholder now, real clips later (`docs/MATCH3-STORY.md`). Also: Today's board (date
seed), free-play (`?seed=`), six objectives. Plans: `plans/2026-08-02-match3-gameplay-feel.md`,
`plans/2026-07-30-match3-playable.md`.

## Bubble (playable — aim-and-shoot, leveled)

`/bubble/` is a real Bubble-Shooter: a launcher at the bottom, **aim an angle**
(point/drag on the board, the ←/→ keys, or the slider), and fire — the bubble
flies up, **bounces off the walls**, and sticks where it first touches; groups of
3+ pop and unsupported bubbles drop. The catch is determinism: aim is a
**quantized integer angle**, resolved in the core by a **fixed-point** ray-cast
(a committed integer direction table — `wasm32` has no runtime trig), so there
are no floats on the hashed path and `native == wasm`. The smooth flight is
cosmetic; the core owns every landing.

The default mode is **Levels** — escalating, point-gated survival: earn each
level's points target (arcade scoring — 10 per pop, big drops score the most) to
climb, while every few **shots** a new row is pushed in at the top and the stack
marches toward the bottom deadline (a `parity_offset` on the hex board makes a
single-row top insert a shift-down + parity flip). Each level adds colours,
raises the target, and tightens the insert cadence; you lose when the stack
crosses the line. Pressure is **shot-driven** (seeded rows folded into the hash)
so `(seed, angles)` replays the whole run; an **optional timer** is a
presentational practice clock only — never a verified loss. The result (highest
level + score + star grade) is verifiable with a re-checking `?r=` share.
**Classic** mode (the toggle, or `?variant=classic`) keeps the original
clear-the-board game (winnable daily pack, its own verifiable win). Plans:
`plans/2026-07-31-bubble-shooter-rebuild.md`,
`plans/2026-08-01-bubble-shooter-levels-difficulty.md`.

## Wyrdle (playable — daily word game)

`/wyrdle/` is a daily 5-letter word-guessing game (Wordle-family, built fresh — original name, original
license-clean word lists, our own look). Guess the hidden word in six tries; each guess is scored per
letter (correct / present / absent, with correct duplicate-letter handling). Tap the on-screen keyboard
or type on a physical one; the **core decides legality** — a non-word shakes and changes nothing. The
answer is a pure function of the seed (`ANSWERS[seed % N]`, no runtime RNG), so a game replays exactly
from `(seed, guesses)`. Daily word (a shuffled seed from `games/wyrdle/daily-pack.json`, UTC rollover) +
free-play (`?seed=`). Win or lose leads with a verification-forward result — the `pond-outcome` record,
one-tap re-verify, and **two shares**: a spoiler-free **emoji grid** to copy (🟩🟨⬛) and a self-verifying
`?r=` link (which carries the guesses, so it re-verifies but reveals the word). Word-list sources +
licences: `games/wyrdle/PROVENANCE.md`. Plan: `plans/2026-07-31-wyrdle-daily-word-game.md`.

## 2048 (playable — tile-slide)

`/2048/` is the tile-sliding number game (build-fresh; 2048 is MIT and not
trademarked). Slide the 4×4 board and equal tiles that collide merge into their
sum; reach the 2048 tile to win, or play until the board is stuck. Three input
paths all go through the core, which decides legality (a slide that changes
nothing is a no-op): an on-screen **arrow pad**, **swipe**, and **arrow/WASD
keys**. Tiles are stored as exponents and the only randomness is the seeded
post-move spawn (ChaCha20), so a game replays exactly from `(seed, directions)` —
no floats, native==wasm. Daily board (a shuffled seed from
`games/2048/daily-pack.json`, UTC rollover) + free-play (`?seed=`). Reaching 2048
/ stuck / "I'm done" leads with a verification-forward result — the `pond-outcome`
record (score + best tile, re-derived by replay), one-tap re-verify, and a `?r=`
share. No solver: every seed is playable (reaching 2048 is skill, not seed).
Plan: `plans/2026-07-31-2048.md`.

## Align (playable — falling-block stacker)

`/align/` is a real-time falling-block stacker (build-fresh; original name,
palette, and presentation — no "-tris" name, not the guideline shape-to-colour
mapping). Pieces fall; slide/rotate them (with SRS-compatible wall kicks) to pack
complete rows, which clear; four at once is an **Align**. It is the shelf's first
real-time game, and it earns a verifiable outcome the same way the turn-based ones
do: the core is a **fixed-timestep integer tick engine** whose recorded artifact
is a **tick-stamped stream of atomic actions**, so a whole run replays
byte-identically from `(seed, moves)` — no floats, no wall clock on the hashed
path, native==wasm. The wall clock only drives the render accumulator and stamps
inputs, never the outcome (BUILDING-GAMES §4). Guideline scoring (T-spins,
back-to-back, combo, perfect clear); Marathon + Sprint modes; hold, ghost, a
five-piece preview; keyboard + on-screen touch controls; hints/assistance.
Daily board (`games/align/daily-pack.json`, UTC rollover) + free-play (`?seed=`).
A top-out / "End run" leads with a verification-forward result and a
self-verifying `?r=` share. No solver: every seed is playable.
Plan: `plans/2026-08-01-align-falling-blocks.md`.

## Identity (light/dark)

The pond has its own playful **card-table** identity on croft-pwa's token architecture: a green **felt**
play surface, warm **ivory cards** with classic red/black suits, a **brass-gold** accent, moss for the
verifiable win, rust for a failed verification. `tokens.css` is the only file with raw hex; every
text/UI pair clears WCAG AA in both light and dark (asserted by `tests/tokens.test.ts`, and axe runs in
both themes in `tests/theme.spec.ts`). A header toggle (`☾`/`☀`) flips the theme with no flash of the
wrong one (pre-paint inline script). Full palette, roles, and recorded ratios: `docs/DESIGN.md`.

Each game has a **How to play** guide (a header link → `/how-to/?game=<id>`) with generated screenshots
and a plain walkthrough — starting with the interaction model (you tap a source then a destination; you
don't drag). Hints (on by default) point at a legal move; with hints off, "I'm stuck" ends the game and
says whether a move was available. Both are **shelf standards** every game meets.

## Building a game

`docs/BUILDING-GAMES.md` is the living build guide + standards: the module contract, determinism-first
core → wasm, verifiable outcomes, tap-first input (the core decides legality), identity/tokens with
WCAG-AA in both themes, the shared hints/assistance settings, and the How-to-play user-guide standard.
It ends with a new-game checklist. Screenshots regenerate from the built app via `npm run guide:shots`.

## Build

```sh
cargo test --workspace     # game cores (match3-core: 19 tests green)
cargo fmt --all --check
cargo clippy --workspace --all-targets
npm run build              # static site -> dist/  (esbuild toolchain lands in the front-end plan)
```

## Build discipline

Determinism-first, red-first, per the Croft per-pond build discipline. Rust → wasm buys the native +
wasm cross-build determinism test essentially free. Dependencies are few, pinned exactly (`=x.y.z`),
and `Cargo.lock` is committed. See `plans/` for the governing phase-plans:

- `2026-07-27-games-pond-fun-crofting.md` — the pond master plan (Rust/determinism spine).
- `2026-07-28-games-drawer-solitaire-ui.md` — the front-end plan (drawer UX + solitaire, first game).

Provenance: `match3-core` was promoted from `discovery/alpha/experiments/match3-p1/` (2026-07-28).
