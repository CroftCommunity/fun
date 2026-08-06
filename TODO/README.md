# TODO

Per-game (and per-subsystem) backlog for the `fun.croft.ing` shelf — one file per
game, holding the follow-ups deferred out of each delivery. The authoritative
phase plans live in `plans/`; the **standards every game must meet** live in
`docs/BUILDING-GAMES.md` (module contract, verifiable outcomes, tap-first input,
identity/tokens, the shared hints/assistance settings, the "How to play" guide,
and — for two-player games — §10's adversarial + AI-opponent checklist). These
files are the running, checkbox-level worklist.

## Shipped — Tier-1 Croft-native (playable)

- [solitaire.md](solitaire.md) — input/solver/a11y/identity follow-ups.
- [match3.md](match3.md) — par-tuning/variants/specials follow-ups.
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
- blockdoku, looseends, color-sort — shipped; no open backlog file yet.

## Shipped — Tier-2 wrapped (playable)

- astray, hexgl, clumsybird, orchard-drop — shipped wraps (see `docs/BUILDING-GAMES.md`
  §9). [supertuxkart.md](supertuxkart.md) is the one under review (below).

## Subsystems

- [harness.md](harness.md) — the browser AI-scoring harness (P6). **Generalized**
  (P8 Phases 1–3): it drives a `GameOracle` port, names no game, and grades Drop 4,
  Othello **and checkers** on CI — the last with a move that is a jump chain, and
  with no rig edit at all (P8 Phase 15). A new game plugs in with one adapter file.
  Full guide: `docs/HARNESS.md`.

## Next games (proposed, ordered)

Checkers (the third adversarial game) shipped 2026-08-06 and took the
`adversary-solver` extraction with it, so the rule-of-three trigger is spent. More
adversarial games still exercise the shared trait + harness + hybrid + tutor
stack, but the abstraction now has a real generality proof behind it and the next
build no longer has to be one. Write a `phase-plan` (three passes) before starting
any of these.

1. **Chess** — Tier-1 adversarial, **heavy**. Needs a vetted move-gen (castling,
   en passant, promotion, checkmate/stalemate/draws) + a **Stockfish-WASM** Oracle
   (a large binary — depends on the larger-binary hosting thread). Deferred behind
   checkers; its own multi-phase plan. The honest-Oracle shape (centipawns, exact
   only in tablebase endgames) is already anticipated in `docs/AI-PLAYERS.md`.
2. **Digger** — [digger.md](digger.md). Tier-1 build-fresh (our own take on an
   LD29 digger; the original is all-rights-reserved, so not wrappable). Not
   adversarial — a single-player action/puzzle.
3. **Logic puzzles** — [puzzles.md](puzzles.md). Tier-1 build-fresh family
   (Minesweeper / Nonograms / Sudoku / …); the Tatham Tier-2 embed was tried and
   torn out as unreadable, so these are build-fresh with verifiable outcomes.
4. **Cribbage** — [cribbage.md](cribbage.md). **Gated:** a real two-human game
   needs a P2P transport + fair-reveal (commit/reveal) first; not startable until
   that lands.
5. **SuperTuxKart** — [supertuxkart.md](supertuxkart.md). Tier-2, **under owner
   review** — local preview built + served; the awesome-or-not call is pending
   (and the Emscripten + runtime-untar class is discouraged, `docs/BUILDING-GAMES.md`).

## Cross-game open threads (span more than one game)

- ~~**Extract `crates/adversary-solver`**~~ — **done 2026-08-05** (P8 Phases 6–8).
  The class-preserving band selector lives in `crates/adversary-solver`, generic
  over the move type; Drop 4, Othello and checkers all consume it, and a new game
  supplies only its own `capped_class` and per-level tuning.
- **Selectable persona roster from external prompt files** — the hybrid opponent's
  persona is inlined per game (Chip in Drop 4, Rowan in Othello, Alder in
  checkers). Broaden to a roster of temperaments managed as external text files,
  one place to add a persona (`drop4.md`, `othello.md`, `checkers.md`).
- **The banter filter only checks length** — `cleanBanter` is copied per game and
  rejects a line only if it is empty or over 90 characters, so a small model can
  and does assert false board facts (observed in checkers' P8 Phase 14 WebGPU
  run). The move is always engine-safe, so this is honesty polish, not safety; if
  it is worth fixing it belongs in one shared place (`checkers.md`).
- **Self-host the LLM model weights + `model_lib` WASM** — for true offline + to
  close the CDN-served-code vector; ~1 GB, needs a binary host (`drop4.md`,
  `harness.md`).
