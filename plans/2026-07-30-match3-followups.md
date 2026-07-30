# Match-3 follow-ups — cascade animation, deadlock reshuffle, a variant mode, par tuning

**Status:** in progress (2026-07-30). Builds on the shipped v1
(`plans/2026-07-30-match3-playable.md`). Standards: `docs/BUILDING-GAMES.md`.
Backlog source: `TODO/match3.md` → "Deferred".

## Problem Statement

match-3 v1 is playable, verifiable, and live, but four deferred follow-ups
remain, each a real chunk rather than polish:

1. **No step-by-step cascade animation.** `Game::play_move` resolves the whole
   cascade atomically; `board_json` returns only the settled board and
   `MoveReport.steps` carries cleared *positions* but no intermediate board
   snapshots. The UI therefore cannot render the clear→fall→refill sequence that
   gives match-3 its feel.
2. **A mid-run deadlock ends the round** instead of reshuffling. To stay
   verifiable, a reshuffle must live inside the core's move resolution (so
   `Match3::replay` reshuffles identically) — which can move locked
   golden-vector `final_state_hash` values.
3. **Only one objective** (target-score-in-moves). Variant objectives + specials
   are new modes and balance calls the master plan reserved for the owner.
4. **The per-deal par is a myopic greedy playout** and the 30/60/90% fractions
   are a first guess; both could be fairer, with a verification-versioning
   wrinkle to respect.

## Approach

Do them safest → owner-gated, each shipped green + deployed on its own commit:

- **Item 1 (contained):** add an *additive* `Game::play_move_traced` in
  `match3-core` that does exactly what `play_move` does — same RNG stream, so the
  final board + `state_hash` are byte-identical — but also pushes a
  `board.clone()` after each phase (after-swap, each clear, each gravity, each
  refill). `play_move` and the pure ops are untouched, so **golden vectors do not
  move**. Bind a traced swap that returns the snapshot sequence as JSON; the
  committed state is the last snapshot (identical to `play_swap`). UI animates the
  sequence with a short per-phase delay; **reduced-motion → skip straight to
  settled** (as the win cascade does); input disabled during the animation.
- **Item 2 (contained, determinism-anchor care):** in `Game::play_move`, after the
  cascade settles, if `has_legal_move` is false, reshuffle deterministically from
  `self.rng` (a Fisher-Yates permutation of the gem cells consuming `rng.index`
  draws) until the board has a legal move and no free matches; bound the attempts.
  This folds into `state_hash` and is reproduced on replay. Re-lock only the
  golden vectors whose final board was actually deadlocked, and document which +
  why in the commit; assert `move_legal` / `step0_cleared` / `step0_score` are
  unchanged. Update `RULES.md`.
- **Item 3 (OWNER DECISION FIRST):** surface the objective choice with real costs,
  recommend clear-the-blockers, get a decision, then build the chosen mode as its
  own slice per `BUILDING-GAMES.md`. Clear-the-blockers reuses solitaire's
  winnable-daily solver+pack shape.
- **Item 4 (fuzzy + versioning):** evaluate a shallow lookahead/beam
  `reference_score` and/or retune fractions. **Versioning wrinkle:** `verify`
  re-derives targets via `targets_for(seed)`, so any par change re-grades every
  seed. With no real records in the wild, change in place; if records exist, bump
  `Match3::VERSION` and keep the old par for old-version records. Ship with a
  recorded rationale, or explicitly re-defer with the versioning note captured.

## Reasoning

- **Determinism is the anchor.** Item 1 is deliberately additive so the
  verifiable-outcome property (locked golden hashes) is never touched — the
  animation is a pure *view* of the same resolution. Item 2 deliberately changes
  the core (not just the UI) because a UI-only reshuffle would desync replay; the
  cost is re-locking hashes, which we pay openly (documented per vector).
- **The board UI never decides legality** — every legal/scoring decision stays in
  the core, so items 1 and 2 add rendering + core rules respectively, never rules
  in TypeScript.
- **Item 3 is genuinely the owner's call** (a new mode + balance), so it is
  surfaced, not invented — mirroring how the target-score objective was decided.
- **Item 4's real risk is silent re-grading of existing records**, so the plan
  treats a par change as a rules-version bump and makes the version decision
  explicit rather than changing par quietly.

## Decisions to track

- **D1 (item 3 objective):** which variant mode — clear-the-blockers (rec.) /
  jelly / ingredients / specials / defer. → **DECIDED 2026-07-30: clear-the-blockers.**
  Build a blocker-placing deal + a winnable-daily solver + pack (solitaire's
  shape), win = all blockers cleared, metric = swaps-to-clear.
- **D2 (item 4 versioning):** **DECIDED 2026-07-30: build the stronger reference,
  hold the switch.** Add a beam `reference_score_beam` to match3-core and validate
  it, but keep `targets_for` on the greedy `reference_score` so **no shared result
  is re-graded**. The fraction/par retune is "best driven by real play data" that
  does not exist yet, so it waits.
  **Adoption procedure (when real data justifies it):** switch `targets_for` to
  the beam reference and/or new fractions, bump `Match3::VERSION` to 2, and keep
  the greedy par for version-1 records (read the version from the `pond-docformat`
  envelope in `Match3::replay`). Treat any par change as a rules-version bump.
- **Doc drift:** `TODO/match3.md` says fractions are 40/66/100%; the shipped code
  (`match3-wasm` `targets_for`) is 30/60/90%. Fix the doc during item 4.

## Phases (one commit each)

- [x] **Item 1** — `play_move_traced` + traced binding + animated UI + tests.
  Shipped 2026-07-30. Golden vectors unchanged; `play_move` refactored to share a
  behaviour-identical inner with the traced path.
- [x] **Item 2** — deadlock reshuffle in `play_move` + `RULES.md`. Shipped
  2026-07-30. Empirical re-lock result: **no golden vector changed** — all three
  corpus vectors' final boards are live, so the reshuffle never fires on them
  (verified explicitly). Pure op + post-move invariant pinned in
  `tests/reshuffle.rs`.
- [x] **Item 3** — clear-the-blockers, shipped 2026-07-30 as a full slice across
  four green commits: 3a core (`deal_blockers` + `blockers_remaining`), 3b the
  `match3-solver` crate + committed winnable-daily pack, 3c the mode-aware binding
  (`new_blockers_game`, `Match3Blockers` outcome kind), 3d the UI objective toggle
  + blocker tiles + blockers-left HUD + verifiable clear result + how-to.
- [x] **Item 4** — shipped 2026-07-30 as "build the tool, hold the switch."
  Added a validated beam `reference_score_beam` (deterministic, monotone,
  provably ≥ greedy, strictly better on some seeds) but left `targets_for` on the
  greedy par, so nothing re-grades. Fixed the stale 40/66/100% doc figure
  (code is 30/60/90%). Versioning/adoption procedure recorded in D2 + RULES.md.
  The fraction retune is explicitly deferred to when real play data exists.

## The gate (must stay green every commit)

`npm run test` (typecheck · lint · unit[builds wasm] · build) + `npm run e2e`
(Playwright incl. axe) in `fun/`; Rust `cargo test --workspace`,
`cargo fmt --all --check`, `cargo clippy --workspace --all-targets`. Visual
changes → rerun `npm run build:wasm && npm run build && npm run guide:shots` and
commit the shots. Pushing `main` auto-deploys to `fun.croft.ing`.
