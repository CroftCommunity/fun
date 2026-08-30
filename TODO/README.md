# TODO

> Known work only — items whose shape is already decided, and which may therefore be
> proposed as work (per-game follow-ups). Anything still an open question (decide /
> verify / investigate / reconcile) belongs in the backlog of record,
> `discovery/alpha/ROADMAP_TODO.md`, however small or operational it is — as does
> anything spanning games or the platform. Tracking scheme:
> `CroftC/.claude/TRACKING.md`; the two piles and why: its § "Two piles".
> Per-topic files in this directory inherit this header.

Per-game (and per-subsystem) backlog for the `fun.croft.ing` shelf — one file per
game, holding the follow-ups deferred out of each delivery. The authoritative
phase plans live in `plans/`; the **standards every game must meet** live in
`docs/BUILDING-GAMES.md` (module contract, verifiable outcomes, tap-first input,
identity/tokens, the shared hints/assistance settings, the "How to play" guide,
and — for two-player games — §10's adversarial + AI-opponent checklist). These
files are the running, checkbox-level worklist.

## Shipped — Tier-1 Croft-native (playable)

- [solitaire.md](solitaire.md) — input/solver/a11y/identity follow-ups.
- [trio-tumble.md](trio-tumble.md) — par-tuning/variants/specials follow-ups.
- [bubble.md](bubble.md) — aim-preview/specials/ceiling-advance follow-ups.
- [wyrdle.md](wyrdle.md) — word-list/daily follow-ups.
- [2048.md](2048.md) — follow-ups.
- [align.md](align.md) — follow-ups.
- [drop4.md](drop4.md) — **adversarial** (vs the engine); persona roster,
  larger-binary hosting, and the checkers/chess "Later" list (now → next-games).
- [othello.md](othello.md) — **adversarial** (the generality proof); tune
  `TRACTABLE_EMPTIES`/depths in wasm, takes-corner band enrichment. (The hybrid
  trial's aborted games — a forced pass with an empty band — were **fixed
  2026-08-06** in the shared players.)
- [checkers.md](checkers.md) — **adversarial** (the third game); shipped
  2026-08-06 with a recorded harness baseline. Thin graded fraction, the midgame
  latency floor, and the shared banter-honesty thread.
- [dots.md](dots.md) — **adversarial** (the fourth game); shipped 2026-08-07. The
  first with a move that does **not** pass the turn and a band value that is a
  margin — neither of which needed a change to anything shared. Open: the live
  WebGPU trial has never been run.
- [furrow.md](furrow.md) — **adversarial** (the fifth game, mancala); shipped
  2026-08-10. The first built to *inherit* the abstraction rather than prove or
  stress it, and it needed no shared change either. Brought one move that rewrites
  thirteen cells and a terminal that rewrites the score. Open: the live WebGPU
  trial (same item as dots'), and `eval`'s weights are reasoned but never tuned.
- [cribbage.md](cribbage.md) — **adversarial, hidden information** (the sixth
  versus game, the first where the state is not the observation); shipped
  2026-08-29 against the engine, on one device. Deliberately does *not* use the
  `Adversary` / band / `GameOracle` stack — a per-seat `View`, an expectation
  engine, and a Rust rig with a peek check instead. Open: the LLM-as-player
  trial, match play, P2P.
- blockdoku, looseends — shipped; no open backlog file yet. color-sort: `color-sort.md`.

## Shipped — Tier-2 wrapped (playable)

- Astray, HexGL and Clumsy Bird were **removed 2026-08-28** as not fitting the
  shelf's model, which leaves the tier with no third-party instance
  (see `docs/BUILDING-GAMES.md`
  §9). [supertuxkart.md](supertuxkart.md) is the one under review (below).

## In flight / not yet moved

- [emojiwars.md](emojiwars.md) — **the first Tier-3 game** (`docs/BUILDING-GAMES.md` §11), still
  living in `CroftCommunity/levelforge`. Decided to move into `fun`; **nothing moved yet**. Blocked
  on a layout decision (it has no Rust core) and on the catalog contract not knowing `tier: 3`
  exists. Carries the reshape (frontstage/backstage/lobby — `main.ts` is 3,721 lines and 39% of that
  codebase), the mode rename + schema migration, and the canvas-library extraction that is blocked
  on two unnamed use cases.

## Subsystems

- [pwa.md](pwa.md) — **installability + offline.** Nothing built: the shelf has no manifest and no
  service worker at all. Gated on one unverified claim — whether distinct manifest `id` values really
  produce separate installs under nested scope — which is the owner's stated condition and is settled
  by shipping **two** manifests before twenty. Plan:
  `plans/2026-08-11-pwa-install-per-game-and-shelf.md`.
- [harness.md](harness.md) — the browser AI-scoring harness (P6). **Generalized**
  (P8 Phases 1–3): it drives a `GameOracle` port, names no game, and grades Drop 4,
  Othello **and checkers** on CI — the last with a move that is a jump chain, and
  with no rig edit at all (P8 Phase 15). A new game plugs in with one adapter file.
  Full guide: `docs/HARNESS.md`.

## Next games (proposed, ordered)

Checkers (the third adversarial game) shipped 2026-08-06 and took the
`adversary-solver` extraction with it, so the rule-of-three trigger is spent. Dots
and Boxes followed on 2026-08-07 as the first game built to *use* the abstraction
rather than to prove it — and needed no change to any shared file. More
adversarial games still exercise the stack, but the next build no longer has to be
one. Write a `phase-plan` (three passes) before starting any of these.

**The candidate catalogs live in `discovery`, and this list is a subset of them.**
Read them before proposing a game, rather than treating the five below as the
field:

- `discovery/alpha/thinking/app/ponds/games-pond-authoritative-list.md` — the
  ranked pick-list (Dots and Boxes was entry 6, "the most underrated pick").
- `discovery/alpha/thinking/app/ponds/client-side-static-game-candidates.md` — the
  Tier-2 wrap inventory plus the inclusion filter.
- `discovery/alpha/thinking/app/ponds/p2p-games-pond-launch-set.md` — the
  candidate hunt for the P2P-gated set (cribbage's cohort), which is a different
  question from what is buildable today.

0. **Mancala — done.** Shipped as **Furrow** on 2026-08-10 (`TODO/furrow.md`,
   `plans/2026-08-07-mancala.md`). Left here only as a pointer: it was picked for
   the shapes it stresses rather than the fun, and all four showed up — one move
   rewriting as many as thirteen cells, a terminal that transforms the score, all
   three result classes reachable, and dots' extra-turn rule **transferring** with
   no change to anything shared, which is what makes the dots result a property of
   the abstraction rather than luck.
1. **Chess** — Tier-1 adversarial, **heavy**. Needs a vetted move generator
   (castling, en passant, promotion, checkmate/stalemate/draws), which is the real
   weight. Its own multi-phase plan.
   - **The "gated on larger-binary hosting" note was wrong, corrected 2026-08-07.**
     It was written in a documentation pass (`2327dbc`) and attached chess to the
     WebLLM weights thread by analogy; no binary was ever measured. Those are
     different problems — that thread is ~1 GB of *model weights*, and a Stockfish
     build is orders of magnitude smaller. The nearby real constraint is that
     multi-threaded Stockfish-WASM needs `SharedArrayBuffer`, which needs COOP/COEP
     response headers, which GitHub Pages will not serve; a single-threaded build
     sidesteps that at a strength cost.
   - **The better objection to a Stockfish Oracle is architectural.** Every game
     here grades against its own solver, and the harness grades a move only when
     the oracle reports `exact` — a proven win/draw/loss class. Stockfish reports
     centipawns and has no `exact` to give, so a Stockfish-backed oracle would
     report `scoredMoves == 0` forever and the tutor would have nothing honest to
     bind its wording to. If chess ships, its Oracle is most likely ours, with the
     shape `docs/AI-PLAYERS.md` already anticipates.
2. **Digger** — [digger.md](digger.md). Tier-1 build-fresh (our own take on an
   LD29 digger; the original is all-rights-reserved, so not wrappable). Not
   adversarial — a single-player action/puzzle.
3. **Logic puzzles** — [puzzles.md](puzzles.md). **A direction, not a queued
   item** — "maybe later", and that file says "not started" for a reason. What was
   actually decided (2026-08-03) is that the Tatham Tier-2 **embed** is out: it was
   tried and torn out as unreadable. The build-fresh family (Minesweeper /
   Nonograms / Sudoku / …) remains a plausible later direction, and note it is
   **single-player** — it reuses none of the adversarial trait / band / tutor /
   harness stack, so it is not an answer to "what else can that stack carry".
4. **Cribbage — done.** Shipped 2026-08-29 against the engine
   (`TODO/cribbage.md`, `plans/2026-08-29-plan-cribbage-vs-engine.md`). The gate
   (P2P + fair-reveal) only ever applied to two *untrusted peers*; against a local
   engine the deck is a seed. The two-human version is a follow-on on the same
   core.
5. **SuperTuxKart** — [supertuxkart.md](supertuxkart.md). Tier-2, **under owner
   review** — local preview built + served; the awesome-or-not call is pending
   (and the Emscripten + runtime-untar class is discouraged, `docs/BUILDING-GAMES.md`).

## Cross-game open threads (span more than one game)

- [x] **Every game page's `<title>` is a slug, not a name.** Closed 2026-08-30 (plan
  `2026-08-30-plan-game-frame.md` Phase 2b): `tools/registry-titles.mjs` reads
  `src/registry.ts` as text, each entry as a unit, and `build.mjs` takes both the page
  list and each page's display name from it; `tests/page-titles.test.ts` pins the parse
  to the real registry and is the first test that ties `build.mjs`'s pages to `REGISTRY`.

- [ ] **Nothing in this repo's workflow compiles the solvers with overflow checks
  on.** The gate runs `cargo test --workspace --release`, for the documented
  reason that debug takes over twenty minutes (bubble-solver's search). Release
  **wraps** on integer overflow instead of panicking. So a solver can be
  arithmetically wrong in a way its own green suite cannot see.

  This is not hypothetical: furrow's search opened its alpha-beta window at
  `i32::MIN + 1` and shifted it by each move's gain, which overflows on the first
  shift. In release the wrap turned alpha into a large *positive* number, so the
  child failed high immediately and returned a bound reported as a value — and
  every test still passed. It surfaced only because `cargo mutants` builds in
  debug, and it surfaced *before the first mutant ran*
  (`plans/2026-08-07-mancala.md` → Phase 4).

  **Every other solver on the shelf uses window sentinels of the same shape** —
  checkers, Othello, drop4, dots — and none of them has been compiled with
  overflow checks by anything except a mutation run. Each should get one
  `cargo test --package <crate>` in debug, once, and the ones that are slow in
  debug should say so rather than be skipped quietly. If any of them is clean,
  that is worth recording too; the point is that right now nobody knows.

- ~~**Extract `crates/adversary-solver`**~~ — **done 2026-08-05** (P8 Phases 6–8).
  The class-preserving band selector lives in `crates/adversary-solver`, generic
  over the move type; Drop 4, Othello and checkers all consume it, and a new game
  supplies only its own `capped_class` and per-level tuning.
- ~~**The midgame is the latency floor in every adversarial game.**~~ **Closed
  2026-08-07** (P9: `plans/2026-08-07-midgame-latency-floor.md` and
  `-othello-midgame.md`). Every adversarial game's worst move is now under a
  second, and the standing guidance this entry used to give was wrong in three
  places, so read the closure rather than the history:

  | worst single `live_move`, wasm | before | after |
  |---|---|---|
  | Othello Expert | 2,115ms | **753ms** |
  | Drop 4 Perfect | 914ms (never previously measured) | **158ms** |
  | checkers Expert | 337ms | 337ms — untouched |

  - **It was not "time-bounded" iterative deepening.** Bound work in **nodes**:
    a clock would put machine speed into the numbers `tests/baselines.test.ts`
    asserts, and the wasm modules have no host import to ask the time with.
    `adversary_solver::NodeBudget` + `deepen`.
  - **It was not one fix for three games.** Deepening pays where the budget
    actually bites often, or where the static move ordering is poor. Othello has
    both (−41% nodes, free); checkers has neither (+14% tax, 0% of its moves over
    400ms) and **ships none of it** — do not "helpfully" add it back. Drop 4's
    problem was its *opening*, not its midgame.
  - **Most of it cost no strength at all.** Othello's 60% came from deepening +
    best-move ordering returning byte-identical values; all three baselines
    reproduce exactly.
  - **No midgame budget was set** (decided 2026-08-07). At 753ms with nothing over
    800ms, buying the last 28%-over-400ms would spend strength a 40-game rig is
    not sensitive enough to price. The machinery is plumbed and tested, so it is
    a one-line change if revisited — but revisit the *measurement* first (400+
    games, or a reference opponent stronger than the same engine).
  - Still true: **do not** re-tune `TRACTABLE_EMPTIES` / `TRACTABLE_PIECES` for
    speed. Both are at their measured knee and both sit below the midgame cost.
  - The durable reasoning now lives in `docs/AI-PLAYERS.md` → "Search cost", the
    harness caveat in `docs/HARNESS.md` → "What it is not: a strength instrument",
    and the short version in `docs/BUILDING-GAMES.md` §10.

- **Othello's endgame stall, found and fixed on the way** (P9 Phase 2). `Mode::Exact`
  ignored `depth`, so the endgame solve cost the same at Easy as at Expert —
  510–580ms on a level whose median move is 0.1ms. Now budgeted with an honest
  whole-result fallback. It hid for months because **every prior measurement was
  taken at Expert**, where the midgame sat on top of it. Measure every level.
- **Selectable persona roster from external prompt files** — the hybrid opponent's
  persona is inlined per game (Chip in Drop 4, Rowan in Othello, Alder in
  checkers). Broaden to a roster of temperaments managed as external text files,
  one place to add a persona (`drop4.md`, `othello.md`, `checkers.md`).
- ~~**`HybridDecision.source` never reaches the Report**~~ — **done 2026-08-06.**
  The `Scorecard` now carries `llmMoves` / `fallbackMoves` and `renderReport`
  prints the split (only when there is a second path to report). It immediately
  corrected a hand-counted number: checkers' P8 Phase 14 run was read as 50%
  fallback from the *banter*, and the real move-level rate is 0%.
- ~~**The banter filter only checks length**~~ — **done 2026-08-06.**
  `src/harness/banter.ts` is now the one filter, used by all three games: a line
  is rejected if it is empty, an essay, or makes a checkable positional claim
  (any digit, or row/column/square/position/diagonal). Measured after: 2 of 8
  lines were the model's own, 6 canned. It removes the false-board-fact class; it
  does not make a small model articulate, and is not a fact-checker.
- **Self-host the LLM model weights + `model_lib` WASM** — for true offline + to
  close the CDN-served-code vector; ~1 GB, needs a binary host (`drop4.md`,
  `harness.md`).

## Device queue — a note for the next session in this repo (2026-08-30)

The device-testing needs in this file are **registered in the workspace device queue**
(`CroftC/.claude/TESTBED.md` § The device queue; `CroftC/.claude/DEVICE-QUEUE.md` is
generated from the `[device: …]` tags). Nothing here was removed or reworded: a tag was
appended to the line that records each need, or a pointer bullet was added below where the
need sits inside a longer item. Going forward:

- a new item that needs a phone carries a tag — `[device: android]`, `[device: android x2, ios]`,
  `[device: android=samsung]` when the check is about that unit (tokens: TESTBED's table);
- a run that fulfils one turns its tag into `[device done YYYY-MM-DD: …]` in the same commit as
  the evidence;
- when you next touch an item registered by a pointer bullet, fold the tag into the item and
  drop the pointer — the pointer is scaffolding for the migration, not the shape.

`bash CroftC/.claude/bin/device-queue.sh --have samsung` shows what a phone in hand can seat.

Tagged in this directory: `color-sort.md` (Mock E Q1, pour timings on a real phone). The game-frame plan carries its four owed device checks in its own review log (`plans/2026-08-30-plan-game-frame.md`).
