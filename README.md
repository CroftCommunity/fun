# fun — the Croft games pond (`fun.croft.ing`)

A determinism-first, local-first **game shelf**. Each game is built so its outcome is verifiable by
replaying its move list against a state hash, it runs offline with no account and no server, and it is
a portable artifact addressable at its own URL.

> **Returning after a gap?** `docs/STATE-OF-PLAY.md` is a dated snapshot of what
> is true, what was learned the hard way, and what is worth doing next — written
> to be read in one sitting, pointing at the living docs for detail.

## The shelf and the drawer

`fun.croft.ing` presents games in a **slide-out drawer** over a persistent play area; each game can
also go **full-screen** or **open in its own tab** (so every game has its own URL). A game is a module
that implements one contract and renders chrome-agnostically into a mount point — the drawer is built
once and every game reuses it. Since 2026-08-30 every game page is the **game frame**
(`docs/BUILDING-GAMES.md` §4c): a game bar (back · name · ⋯ with How to play and open-in-new-tab), a
meter row, the stage the game renders into, and a dock of at most five verbs — four fixed-height bands
around the board, so nothing above it moves while you play. Games are migrating onto it one at a time;
an unmigrated game still shows its own controls inside the stage. Shelf order: **solitaire → trio tumble → bubble → wyrdle → 2048 → drop 4 → align → blockdoku → loose ends → cribbage** (cribbage shipped 2026-08-29, against the engine).

## Layout

```
crates/
  trio-tumble-core/       deterministic match-3 engine (promoted from the discovery spike; self-contained
                     with its RULES.md + vectors/) — green, red-first
  solitaire-core/    Klondike draw-1 engine (master-plan Phase 4) — green
  solitaire-solver/  build-time Klondike solver + winnable-daily pack generator (Phase S) — green
  pond-docformat/    P2 versioned document envelope (saves / codes / outcomes) — built
  pond-outcome/      P8 verifiable-outcome record (replay → state hash)         — built
  trio-tumble-wasm/       browser binding over trio-tumble-core (raw C-ABI + serde-JSON)   — built
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

## Trio Tumble: Jewel Drop (playable — Candy-Crush-style)

`/trio-tumble/` is a target-score-in-moves game: an 8×8 board of big, glossy, distinctly-shaped candies
(colour-blind safe), **swipe** a candy toward a neighbour to swap — or tap gem-then-neighbour, the
accessible floor; only match-making swaps are legal (the core decides and they glow). A 20-swap budget
graded into 0–3 stars. Clears hold long enough to read, spray a particle **burst**, and a multi-cascade
flashes an escalating **Nice/Sweet/Divine**. Moves out → a verifiable score+stars record with re-verify +
a `?r=` share. New players land in a **level campaign** (curated levels over verifiable seeds; the first
are gentle and Level 1 glows an opening move); best-stars progress and the in-progress board (as a move
list) persist, so a reload resumes. A **skippable narrative overlay** (Biscuit's beats) rides a small
game-event bus — placeholder now, real clips later (`docs/TRIO-TUMBLE-STORY.md`). Also: Today's board (date
seed), free-play (`?seed=`), six objectives. Plans: `plans/2026-08-02-trio-tumble-gameplay-feel.md`,
`plans/2026-07-30-trio-tumble-playable.md`.

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

## Drop 4 (playable — vs a computer opponent)

`/drop4/` is the shelf's first **two-player adversarial** game: you versus **The
Engine**, the classic computer opponent. Tap anywhere in a column to drop your
disc into its lowest empty slot; four in a row — across, up, or diagonally —
wins, and a full board is a draw. A turn bar shows both players and whose move it
is; The Engine's reply is ringed so you can see it; on a win the four is
highlighted before a final board you can re-verify. You choose your disc (✕ or ○)
and the opponent's strength (Easy / Medium / Hard / Expert); both persist. The
core owns legality (a full column is not a legal target); a match records **both**
sides' drops in one list, so the finished game replays to a verifiable
`pond-outcome` record with a self-verifying `?r=` share, same as every Tier-1
game. The opponent is the **live** depth-capped engine (fast from any position) —
the exact solver stays the oracle for scoring/tutoring. A built-in **tutor**
(on by default, no download) coaches from the engine's own facts: "Explain my
options" lists the reasonable moves with a reason each, and it flags a blunder
after the engine replies — honestly, only calling a move a mistake when the
endgame makes it certain, softening to "looks risky" earlier. An **experimental
local-AI opponent** ships behind a WebGPU-gated toggle (offered only when your
browser has a real GPU adapter): the engine builds a never-throw band, an
in-browser LLM picks within it and speaks a reason — characterful, not stronger,
with the classic engine staying the default. The LLM runs fully on your device
(a one-time model download, embedded — no third-party CDN for code). How the
shelf builds AI opponents: `docs/AI-PLAYERS.md`.
Plans: `plans/2026-07-31-drop4-ai-harness.md`, `plans/2026-08-03-drop4-playable-and-hybrid-buildout.md`.

## Othello (playable — the generality proof)

`/othello/` is the shelf's second two-player game vs a computer opponent, and the
proof that the adversarial machinery generalizes. It is a full Tier-1 build — an
8×8 place-and-flip board with forced passes, a verifiable `?r=` outcome (passes
encoded so it replays exactly), the engine-grounded tutor, and the same
WebGPU-gated experimental local-AI opponent — but it plays a very different game.
The key difference: **Othello is not solved from the opening**, so its engine is a
strong *heuristic* alpha-beta (corners, mobility, stable edges) with an **exact
full solve only in the deep endgame**. That carries the honesty flag from
exact/capped to **exact/heuristic**: the tutor says a move "threw the game" only
once the endgame makes it certain, and "looks risky" otherwise — it never claims a
win/draw/loss class it cannot prove.

The generality result: the game-agnostic TS harness (`src/harness/hybrid-player.ts`,
`ai-runtime.ts`) reused **unchanged**; the tutor/experimental-opponent UI was
reused as a *pattern* (copied per-game TS); and only the Rust `othello-{core,
solver,wasm}` and the front-end wrapper were new — implementing the shared
`Adversary` trait + `pond_outcome::Game`. That split is the finding: a new game
plugs into the trait + the harness + the tutor's `{quality, exact}` interface.
Plan: `plans/2026-08-03-othello-game.md`. AI rationale: `docs/AI-PLAYERS.md`.

## Checkers (playable — the third adversarial game, and a move that is a path)

`/checkers/` is English draughts on an 8×8 board against the engine, and the third
two-player game on the shelf. It is a full Tier-1 build — tap a man, tap where it
goes, with a **multi-jump tapped one landing at a time**; the engine-grounded
tutor; the WebGPU-gated experimental local-AI opponent (persona: Alder); and a
verifiable `?r=` outcome.

What makes it worth a section is the **move**. Drop 4's is a column, Othello's is a
cell — both a single byte naming a destination. A checkers move is a *jump chain*:
a piece plus an ordered list of landings, which is why `(from, to)` cannot name it
(a king can reach one square by two capture paths). It ships as `(from, to,
variant)` packed into a 14-bit code, so the `?r=` share stays a plain array of
numbers like every other game's, and the chain detail the UI needs rides alongside
on `legal_moves_json`. The UI never decides legality: it *filters* the core's own
chains by the landings you have tapped, and commits only a complete one.

Two rules the guide leads with, because both read as bugs otherwise: **capture is
mandatory** (when a jump exists it is the only move you are offered), and
**crowning ends the move** (a man that jumps into the far row is crowned and stops
there). Checkers as codified has no terminating draw rule a deterministic core can
use, so it adopts the standard tournament one — a draw after 40 moves each with no
capture and no man advanced — and the counter is part of the hashed state, because
two identical boards with different counters have different legal futures.

The generality result, third time: `buildBand`/`HybridPlayer`, `ai-runtime.ts`, the
shared `adversary-solver` band selector and the whole scoring rig reused
**unchanged** — checkers' `GameOracle` adapter is a pure pass-through, *smaller*
than Othello's. Its honesty flag is the third shape: not "solved" and not "solved
in the endgame" but **proven** — a fact is `exact` when its value came from a real
terminal reached inside the search, because checkers positions cycle and no piece
count bounds the tree.
Plan: `plans/2026-08-04-checkers-game.md`. AI rationale: `docs/AI-PLAYERS.md`.

## Dots and Boxes (playable — the fourth adversarial game, and a turn that does not pass)

`/dots/` is the folk game on a 4×4 lattice of dots against the engine: tap a line
between two dots, and whoever draws the fourth side of a box claims it. Full
Tier-1 build — opt-in tutor, hints that declare themselves as assistance, a
WebGPU-gated experimental local-AI opponent (persona: Bramble), and a verifiable
`?r=` outcome.

What makes it worth a section is the **turn**. Every other game on the shelf
alternates strictly — even Othello's pass is a turn transfer. Here, closing a box
gives you another move, so whose turn it is is a fact about the *board* and never
about the move count, and a match record is one list of both sides' moves that is
not alternating. Nothing shared had to change to carry that: the trait already
took the position, the scoring rig already re-read the side from the live board.
The prose in three files said "alternating" and was simply wrong — that was the
whole cost.

Two more firsts. The engine's value is a **box margin** rather than a win/draw/loss
class, and the class is its sign; nine boxes cannot split, so **no draw is
reachable** at this size. And 3×3 is **solved** — a second-player win, 6–3, with
perfect play — so the difficulty picker's top level is honestly named *Perfect*,
and the game seats you second by default, because opening against a perfect
opponent is a lost position before anyone has moved.

The game underneath the rules is not really about taking boxes: it is about
running out of safe lines **second**. A perfect engine will decline the last two
boxes of a chain to force you to open the next one, which looks like a blunder and
is the opposite.
Plan: `plans/2026-08-07-dots-and-boxes.md`. AI rationale: `docs/AI-PLAYERS.md`.

## Furrow (playable — mancala, and a score that changes after the last move)

`/furrow/` is mancala on the board most people mean by it: six pits a side, four
seeds each, a store at either end. Tap one of your pits and every seed in it is
sown one at a time around the board, skipping the opponent's store. Land your last
seed in your own store and you go again; land it in an empty pit of yours and you
take that seed and everything facing it. Full Tier-1 build — opt-in tutor, hints
that declare themselves as assistance, a WebGPU-gated experimental local-AI
opponent (persona: Millet), and a verifiable `?r=` outcome.

It was built to **inherit** the shelf's adversarial abstraction rather than to
prove or to stress it, and it did: nothing under `src/harness/` or in the shared
crates changed. The extra-turn rule dots introduced transferred with no edit,
which is what makes dots' result a property of the design rather than luck.

Two things it brought that were genuinely new. **One move rewrites many cells** —
a sow can write to thirteen of fourteen, and skips exactly one of them by rule, so
replay correctness depends on a loop and the UI animates from the core's own
`sow_path` preview rather than counting cells itself. And **a terminal rule
rewrites the score**: when either side empties, the other sweeps every remaining
seed into its store, so the final score is not what accumulated during play. The
board says so when it fires, because a score that jumps at the last move otherwise
reads as a bug.

The difficulty picker tops out at **Expert, not Perfect**, and that is a claim
about what was measured rather than modesty. The opening does not solve — 100M
nodes, exhausted — so about 70% of a game is above the exact threshold and the
engine is searching there, not proving. The tutor says which it is doing, every
time.

Worth knowing before you play: running *yourself* out of seeds while the
opponent's row is full hands them everything left on it. It is the fastest way to
lose a game you were winning.

Plan: `plans/2026-08-07-mancala.md`. AI rationale: `docs/AI-PLAYERS.md`.

## Cribbage (playable — the first hidden-information game, vs the engine)

`/cribbage/` is two-hand, six-card cribbage to 121 against the shelf's engine, on
one device. Tap two cards and throw them to the crib, peg to 31, then the show
counts the hands in the order the rules fix — non-dealer, dealer, crib — and the
game ends the instant anyone reaches 121. The app counts every hand and shows its
work; switch **Count my own hands** on and you type the total, the core grades it,
and an under-count goes to the engine by muggins. A win is worth 1, a skunk 2, a
double skunk 3, and the verifiable `?r=` record carries the value.

It is the first game here whose **state is not the observation**. The five versus
games share a stack built for perfect information — `adversary-core` says so in
its first line — and none of it applies: no move has a win/draw/loss class, the
value of a throw is an expected point total, and the engine must provably never
read the other hand. So the core hands out a per-seat `View`; the solver's public
surface takes a `View` and nothing else (a test reads the crate's own source to
pin it); the wasm binding has **no state export**, only the human's view; and the
rig plays a test-only peeking player against the honest Expert and asserts the
cheat wins by a wide margin (measured 81%; a leak would shrink it).

Strength is expectation, not search. Phase 0 measured that the throw is the
whole game — random throws lose 24 games in 25, the crib term is worth about five
points of win rate — and that two plies of pegging lookahead beat the folk
heuristic by ~6 while a third buys nothing. The tutor's `exact` flag is true for
a throw (exhaustive over the 46 cuts) and never for pegging (the other hand is a
model), and the wording is bound to it in Rust.

The two-human version — the reason this game sat gated for a month — is a
follow-on: the only thing it changes in the core is where the seed comes from.

Plan: `plans/2026-08-29-plan-cribbage-vs-engine.md`. Rules: `crates/cribbage-core/RULES.md`.

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
cargo test --workspace     # game cores (trio-tumble-core: 19 tests green)
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

Provenance: `trio-tumble-core` was promoted from `discovery/alpha/experiments/match3-p1/` (2026-07-28).
