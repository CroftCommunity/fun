# Chess — shipped 2026-08-30

`/chess/` is the shelf's **sixth** versus game and its fifth on the shared
`Adversary` / band / tutor / `GameOracle` stack (cribbage, the hidden-information
game, sits beside it). Built to `plans/2026-08-30-plan-chess-vs-engine.md`, whose
Review Log holds the per-phase execution record — every number, and every
measurement that contradicted the plan. This file is the running worklist of what
was deferred.

## What shipped

- `crates/chess-{core,solver,wasm}` — **build-fresh** FIDE chess (rules table in
  `crates/chess-core/RULES.md`, §1–§15): castling, en passant, promotion, check
  and checkmate, stalemate, **automatic** threefold repetition and 50-move draws,
  and an insufficient-material subset. Verified by **perft** against the six
  published reference positions and by differential perft (200 random positions,
  0 disagreements) against a vetted crate kept in `spike/` and never shipped.
  `from_fen` is strict — a position whose side *not* to move is in check is
  refused (`OppositeCheck`), because a test FEN that broke that rule once let
  generation offer a king capture.
- The move is a 15-bit `from | to<<6 | promo<<12` code (max 20479) — the widest
  the shelf has graded, and the first that carries a **promotion piece**. UCI text
  bridges it; SAN is rendered for the seats, the tutor and the guide, never parsed.
- The engine: negamax + quiescence + a transposition table keyed on
  `(zobrist, halfmove)`, iterative deepening under a node budget, strict-depth
  storage, and **repetition-derived values never stored**. The ladder is Easy d2 /
  10k · Medium d3 / 40k · Hard d4 / 100k · Expert d5 / 150k — measured **0 of 50
  moves over 400 ms in Chromium** (~730k nps); the tutor searches d6 / 600k.
- `src/games/chess/{chess,chess-wasm,chess-outcome,chess-oracle,chess-howto}.ts` —
  playable at `/chess/` in the game frame (seats with captured material, the last
  move in SAN, Undo · Hint · New game), the promotion picker as a native overlay,
  Black flips the board through one geometry function, the tutor panel, the
  WebGPU-gated experimental opponent (persona **Ash** 🌳), a verifiable `?r=`
  share, the guide with three shots.
- Grades through the AI-scoring harness with **no rig change**
  (`HARNESS_TRIAL_GAME=chess npm run harness:trial`); anchor recorded in
  `tests/baselines.test.ts` (1-0-1, 6 graded of 169, 0 blunders); the hybrid's
  first real run: 52 model moves, 0 fallbacks, 0 blunders.
- Mutation-tested: `chess-core` 674 mutants, 60 → 23 survivors, all equivalent;
  `chess-solver` 422, 302 → 69, the real gaps closed and hand-verified.

## Owed device checks (the plan's Phase 13 — no phone was attached)

The queue script finds these from the plan's `[device: …]` lines; this list is
the same debt in one place. Fulfil by editing the tag on its line in
`plans/2026-08-30-plan-chess-vs-engine.md` to `[device done YYYY-MM-DD: …]`.

- [ ] **The tap flow, the picker at 44px, the glyphs in both themes** — both
  Androids. `[device: android x2]`
- [ ] **The Samsung half of the latency table** — `spike/chess-latency/` on the
  phone, beside Phase 4's Chromium column (the same harness, so the two columns
  are comparable). `[device: android=samsung]`
- [ ] **D5 — Unicode glyphs or an SVG set.** Pieces are Unicode glyphs
  (filled shapes for both sides, CSS-coloured with an outline); whether they read
  on the phones is the device answer still owed. If they do not, the swap is one
  function (`pieceNode` in `chess.ts`). `[device: android x2]`

## Open follow-ups

- [ ] **The CI tournament test costs ~74 s** (`tests/chess-harness.test.ts`,
  Engine(1) v Engine(1), 2 games) inside `npm run unit`. Checkers' is the
  precedent and is in the same range; if the unit gate's wall-clock becomes the
  complaint, these two are where to look first (a `?fast`-style seam does not
  apply — the cost is the search, not pacing).
- [ ] **The graded fraction is the thinnest on the shelf** — 6 of 169 plies at
  the baseline, 3 of 52 in the hybrid run — because `exact` means a proven
  terminal inside the analysis search. The checkers lever (a deeper tutor budget)
  is already applied (d6 / 600k). A `scoredMoves` of 0 is the finding, not a pass.
- [ ] **Persona roster** — Ash is inlined in `chess.ts`, as Alder is in checkers
  and Chip in Drop 4; the shared roster is the same open item as theirs.
- [ ] **The Stockfish question, carried from `TODO/README.md`'s old entry.** A
  Stockfish-WASM Oracle was considered and declined for an architectural reason,
  not a hosting one: the harness grades only `exact` facts, and centipawns carry
  no proof, so a Stockfish-backed oracle would report `scoredMoves == 0` forever
  and the tutor would have nothing honest to bind its wording to. A Stockfish
  *level* (a stronger opponent, ungraded) remains possible as a separate opponent.
- [ ] Opening book; Chess960 via the seed; PGN export; a move list; Resign — none
  started; each is a plan of its own.
- [ ] `tests/how-to.test.ts` precedent worth fixing elsewhere: checkers'
  `checkers-board` shot alt describes seats and buttons its clip does not
  contain. Chess's alts describe the clip; checkers' owner should align theirs.

## Deferred by design (not defects)

- **Draws are automatic, never claimed.** Threefold and the 50-move rule end the
  game the moment they occur (FIDE's 75-move / fivefold *forced* rules are the
  same thing one step earlier, and the claimable versions need a clock and an
  arbiter this game has neither of). The result screen names the rule.
- **The result screen is reached only through a UI move.** A game scripted to a
  terminal through the `__chess` hook and then `refresh()`ed re-renders the
  board; `finish()` runs from the move path. The guide's result shot opens the
  game's own `?r=` link instead, which is the honest route anyway.
- **No clocks, no two-human mode, no PGN import.** The verifiable record is
  `(seed, moves)`; a game entered from PGN would have no seed to verify against.
