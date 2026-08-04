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
- [othello.md](othello.md) — **adversarial** (the generality proof); extract a
  shared `adversary-solver` on the 3rd game, tune `TRACTABLE_EMPTIES`/depths in
  wasm, takes-corner band enrichment.
- blockdoku, looseends, color-sort — shipped; no open backlog file yet.

## Shipped — Tier-2 wrapped (playable)

- astray, hexgl, clumsybird, orchard-drop — shipped wraps (see `docs/BUILDING-GAMES.md`
  §9). [supertuxkart.md](supertuxkart.md) is the one under review (below).

## Subsystems

- [harness.md](harness.md) — the browser AI-scoring harness (P6). Next: generalize
  it from Drop-4-specific to an injected game/oracle adapter so it grades Othello
  (and future games) too — the same rule-of-three moment as the `adversary-solver`
  extraction. Full guide: `docs/HARNESS.md`.

## Next games (proposed, ordered)

The generality proof (Othello) makes **more adversarial games** the highest-value
next builds: each exercises and hardens the shared trait + harness + hybrid +
tutor stack, and the third one triggers the `adversary-solver` extraction. Write a
`phase-plan` (three passes) before starting any of these.

1. **Checkers / Draughts** — [checkers.md](checkers.md). Tier-1 adversarial. The
   **third** adversarial game → extract `crates/adversary-solver`. Different move
   space (multi-jump chains, forced captures, kinging) stresses the `Adversary`
   trait harder than Othello. Effort: medium (mostly reuse; the jump-chain `Move`
   encoding is the new work). Honest Oracle: heuristic + exact endgame.
   - *Cheaper alternative to trigger the extraction:* a light **solvable**
     adversarial game — **Nim** (exact Oracle, tiny; a very different move space:
     remove k from a heap) or **Dots and Boxes** (chain/parity strategy). Lower
     effort than checkers if the goal is just the rule-of-three extraction.
2. **Chess** — Tier-1 adversarial, **heavy**. Needs a vetted move-gen (castling,
   en passant, promotion, checkmate/stalemate/draws) + a **Stockfish-WASM** Oracle
   (a large binary — depends on the larger-binary hosting thread). Deferred behind
   checkers; its own multi-phase plan. The honest-Oracle shape (centipawns, exact
   only in tablebase endgames) is already anticipated in `docs/AI-PLAYERS.md`.
3. **Digger** — [digger.md](digger.md). Tier-1 build-fresh (our own take on an
   LD29 digger; the original is all-rights-reserved, so not wrappable). Not
   adversarial — a single-player action/puzzle.
4. **Logic puzzles** — [puzzles.md](puzzles.md). Tier-1 build-fresh family
   (Minesweeper / Nonograms / Sudoku / …); the Tatham Tier-2 embed was tried and
   torn out as unreadable, so these are build-fresh with verifiable outcomes.
5. **Cribbage** — [cribbage.md](cribbage.md). **Gated:** a real two-human game
   needs a P2P transport + fair-reveal (commit/reveal) first; not startable until
   that lands.
6. **SuperTuxKart** — [supertuxkart.md](supertuxkart.md). Tier-2, **under owner
   review** — local preview built + served; the awesome-or-not call is pending
   (and the Emscripten + runtime-untar class is discouraged, `docs/BUILDING-GAMES.md`).

## Cross-game open threads (span more than one game)

- **Extract `crates/adversary-solver`** — the class-preserving band selector is
  duplicated in `drop4-solver` + `othello-solver`; the 3rd adversarial game
  extracts it (`othello.md`, `checkers.md`, `harness.md`).
- **Selectable persona roster from external prompt files** — the hybrid opponent's
  persona is inlined per game (Chip in Drop 4, Rowan in Othello). Broaden to a
  roster of temperaments managed as external text files, one place to add a persona
  (`drop4.md`, `othello.md`).
- **Self-host the LLM model weights + `model_lib` WASM** — for true offline + to
  close the CDN-served-code vector; ~1 GB, needs a binary host (`drop4.md`,
  `harness.md`).
