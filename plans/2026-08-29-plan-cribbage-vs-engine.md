# Cribbage vs the engine — the first hidden-information game

**Status:** Phase 0 COMPLETE (2026-08-29, findings recorded below). O3 answered by
measurement; O1, O2, O4 open with recommendations — O1 and O2 must be answered before
Phase 1 writes a golden vector.

**Owner decision (2026-08-29):** un-gate cribbage from the P2P transport + fair-reveal
plan and ship it **against the computer opponent, on one device**. The two-human
version is a later plan that reuses this core (its extension point is named in
"Reasoning → Where the P2P version plugs in").

## Problem Statement

Cribbage has sat third on the shelf since the master plan (`2026-07-27-games-pond-fun-crofting.md`,
Phase 9) with a `status: "soon"` registry tile and a TODO that says **gated**: two humans
need a P2P transport and a commit/reveal so neither peer can cheat the shuffle or the cut
(`TODO/cribbage.md`). That gate is real — and it only exists for two *untrusted peers*.
Against a local engine there is no second party to cheat: the deck is a seed, exactly as it
is in solitaire, and the record replays. The gate evaporates for the single-device version.

What does **not** carry over is the opponent. The shelf's versus stack — five shipped games
on `adversary_core::Adversary`, `adversary_solver::select_in_band`, the `{value, regret,
quality, exact}` tutor, and the scoring rig behind `GameOracle` — is built, in its own words,
for **"perfect-information, deterministic, turn-based, zero-sum"** games
(`crates/adversary-core/src/lib.rs`, the crate header and the trait doc). Cribbage is the
opposite shape on both axes that matter:

```
                       versus stack (5 games)         cribbage
 information           both sides see everything     hidden hands, hidden crib
 randomness            none after the seed           every deal, every cut
 a move's value        an exact win/draw/loss class   an expected point total
 "never throw the game" a class floor                 has no class to preserve
 the exact oracle      minimax to a terminal          exists for ONE decision (discard)
```

So this plan answers two questions the shelf has not asked before, and it is careful to
keep them separate:

1. **The game.** Rules as a determinism-first core with a verifiable record — the same
   Tier-1 shape as every other game (`docs/BUILDING-GAMES.md` §§2–8).
2. **The opponent.** An engine whose strength comes from **expected value over the unseen
   cards**, not from search to a terminal — and, load-bearing, an engine that provably
   **never reads what a human could not see**. A hidden-information opponent that peeks is
   not a strong opponent; it is a cheat, and the difference is invisible from the outside
   unless a test pins it.

The reuse question is answered honestly up front: **the pattern transfers, the engine does
not.** The core/wasm/UI/outcome/settings/how-to standards all apply unchanged. The
`Adversary` trait, the class band, the minimax tutor and the `GameOracle` rig do **not**
apply, and this plan does not bend them to fit — a second game of this kind would be the
time to extract what is shared (rule of three, as `adversary-solver` waited for checkers).

## Reasoning

### The rules, and the three decisions inside "standard cribbage"

Two-hand, six-card cribbage to **121**, the game everyone means. Six cards each, two to
the crib, the crib to the dealer, deal alternates. Non-dealer cuts; a Jack turned scores
**his heels** (2, dealer). Pegging to 31 with go / last card / fifteens / pairs / runs.
The show: non-dealer's hand first, then dealer's hand, then the crib — **in that order,
and the game ends the instant anyone reaches 121**, including mid-pegging and including
non-dealer counting out before the dealer gets to count. That ordering is where a
hand-rolled implementation goes wrong quietly, and it is pinned by its own golden vectors.

Three things "standard" leaves open, decided here (they are O1–O3 if the owner disagrees):

- **Counting is automatic.** The engine never miscounts, so *muggins* — claiming points
  an opponent missed — has no meaning against it. A "count your own hand" mode (the
  player states a total, the core grades it) is a real feature and a natural tutor, and
  it is a follow-up in `TODO/cribbage.md`, not part of this plan.
- **Skunks are recorded, not scored.** A loss by 31+ is a skunk, by 61+ a double skunk.
  The record carries the flag; there is no match play, no "counts as two games" — one
  game to 121 is the unit, as one deal is solitaire's.
- **The dealer is decided by the seed.** Cutting for deal is a ritual with no decision
  in it; the core derives the first dealer from the seed, the UI narrates the cut.

### Why the opponent is an expectation, and what it does and does not know

A cribbage hand has exactly two decision kinds, and they are different problems:

**Discard.** Six cards, keep four. Fifteen ways. For each, the value is the hand's score
averaged over the **46** unseen cards that could be cut, plus (dealer) or minus
(non-dealer) what the two discards contribute to the crib. The first term is exact and
cheap: 15 × 46 = 690 hand scorings. The second depends on the opponent's two unknown
discards; the standard answer is a **crib table** — expected crib value indexed by the
two discarded ranks (and suited-ness), computed once from the scorer under an assumed
opponent discard policy. This is the shelf's build-time-solver pattern (solitaire's
winnable pack): generated by the core, byte-identically regenerable, tiny to ship.

This is the one decision in cribbage with an **exact oracle in expectation**. That matters
for the tutor: "you kept a hand worth 7.2 on average; the best keep was 8.9" is a true
sentence, and the shelf's `exact` honesty flag maps onto it cleanly — `exact` for a discard
verdict, never for a pegging one.

**Pegging.** The opponent's holding is unknown but constrained (not the 8 cards you have
seen). The options: a one-ply heuristic (play 15s and pairs, avoid leaving 21 or a run,
lead low, keep a 5 back), or a shallow **expectimax** over the opponent's possible
holdings weighted uniformly over unseen cards. Phase 0 measures whether the second buys
anything over the first — the shelf's record on predicting search payoff is poor enough
(checkers +14% reverted, Othello −41% shipped, dots inapplicable — `docs/AI-PLAYERS.md`)
that the plan does not guess.

**What the engine may read** is the plan's central invariant. The core's `GameState`
holds everything: both hands, the crib, the undealt deck, the cut. The engine gets a
**`View`** — the state as seen from one seat: own hand, cards played so far, the cut once
made, both scores, whose crib — and nothing else. Two consequences:

- The solver's public functions take `&View`, never `&GameState`. That is a type-level
  guarantee that survives refactoring, and it is the cheapest possible enforcement.
- Phase 10 adds the **sensitivity check**: a deliberately peeking engine (given the full
  state) must beat the honest one by a measurable margin in self-play. If it does not, the
  "never peeks" property is not being tested — it is being assumed.

### Why difficulty is a band over expected value, and why the shared band is not reused

`adversary_solver::select_in_band` buckets per-move values into win/draw/loss classes and
picks within the best class; its class floor is what lets a hard opponent "never throw the
game" (`crates/adversary-solver/src/lib.rs`, header). In cribbage no move has a class. A
discard is worth 8.9 expected points against 8.6; neither throws anything. The honest
shape is **noise over a ranked list**: Expert takes the top expectation every time; lower
levels pick from the top-*k* with a probability, exactly the `sloppiness_pct` idea without
the floor. The crate's own doc says the floor is "the whole difficulty model", so reusing
the function with a one-class `class_of` would be reuse in name only. The selector is
~30 lines; cribbage writes its own in `cribbage-solver`, with the same RNG-untouched-when-
deterministic property the shared one pins.

Levels: **Easy / Medium / Hard / Expert**, where Expert is exact-expectation discards and
the best pegging policy Phase 0 finds. Code `3` means "the top level", as for Othello —
not perfect play, because pegging has none.

### Why `pond_outcome::Game` yes and `adversary_core::Adversary` no

`pond_outcome::Game` is `replay(seed, moves) → {final_hash, won, score}`
(`crates/pond-outcome/src/lib.rs`). Cribbage fits it exactly: the seed derives every
shuffle, the move list holds both seats' discards and pegging plays in play order, the
replay reproduces the final board, and the `?r=` share re-verifies. That is the Tier-1
property and it is kept.

`Adversary` could be implemented mechanically — `initial(seed)`, `legal_moves`, `apply`,
`result` all exist — but doing so would be a lie at the type level: the trait's contract
is that a position is fully known to both sides, and every consumer of the trait (the
band, the tutor's `exact`, the rig's oracle-grading) reads it that way. `GameOracle`
likewise exposes `board()` as the whole state (`src/harness/game-oracle.ts`), so any
`Player` plugged into `runMatch` sees the opponent's hand. Cribbage's opponent must be
built where that is impossible, so it is **not** an `Adversary` and does **not** join the
`GameOracle` rig. It gets its own, smaller measurement rig (Phase 10) with the three
non-vacuity assertions the shelf already insists on, plus the peek-sensitivity check.

If a second hidden-information game arrives (poker, gin, a dice game), what those two rigs
share is the extraction candidate. Not before.

### The move code

Every shelf move is one number on the wire so the share is a JSON number array and the
rigs stay game-agnostic (`docs/HARNESS.md`, the first contract). Cribbage:

| move | code | note |
|---|---|---|
| discard two of six | `0..14` | index into the fixed enumeration of 2-of-6 pairs |
| peg a card | `16..19` | `16 + index into the current hand (0..3)` |
| go | `20` | legal only when no card in hand plays under 31 |

The cut is not a move (the seed decides it); the show is not a move (it is forced). A
record is therefore short — around 20–30 codes per deal, ~10 deals per game — and the
core rejects any code that is not legal for the seat to move, so an illegal discard cannot
enter a record.

### Where the P2P version plugs in

The only thing a two-human game changes in the core is **where the seed comes from**: it
must be a value neither peer chose alone (a joint commit/reveal). The core's
`GameState::new(seed)` is that boundary already. A P2P plan adds a transport, a fair-seed
protocol, and a `View`-only wire (each peer must receive only its own view, which is why
the `View` type is built now rather than later). Nothing in this plan should be designed
so that a future peer needs the full state — that is the one rule the P2P follow-on
imposes on this one.

### Alternatives considered and rejected

- **Bend `Adversary` to fit.** Rejected above; it would make the first hidden-information
  game claim perfect information to every shared consumer.
- **Monte-Carlo the whole game (deal out the unknowns, play out with the perfect-info
  stack, average).** Strong, general, and the way a chess engine might do it. Rejected for
  the first ship: it is far more computation than the two-decision expectation model for
  a game whose decisions are that separable, and it would make the "never peeks" property
  much harder to state. It is the right *second* engine if measurement shows Expert is
  beatable by a good human, and `TODO/cribbage.md` will carry it.
- **LLM as the player.** `docs/AI-PLAYERS.md` names hidden-information games as the one
  place an LLM might earn its keep as a player rather than a narrator. True, unmeasured,
  and **explicitly out of this plan**: the expectation engine is the shipped opponent; an
  LLM trial against it is a follow-on experiment, with the engine as its baseline.
- **Ship without a tutor.** Rejected: the discard tutor is the one part of cribbage
  coaching that is exactly right by construction, and it costs one function the engine
  already needs.

## Verified Assumptions

Each confirmed by reading the named file this session, not inferred.

- **The versus stack declares itself perfect-information.** `crates/adversary-core/src/lib.rs`
  header: "perfect-information, deterministic, turn-based, zero-sum"; the `Adversary`
  trait's doc repeats it. `initial / side_to_move / legal_moves / apply / result /
  state_hash` — no chance node, no per-side observation.
- **The band is class-first by design.** `crates/adversary-solver/src/lib.rs` header: the
  class floor "is the whole difficulty model"; `capped_class` and `live_band` are
  deliberately per-game. Sloppiness never crosses the floor; the RNG is untouched at 0%.
- **The rig sees the whole board.** `GameOracle.board(): OracleBoard` and `renderText()`
  (`src/harness/game-oracle.ts`); `Player.chooseMove(game: GameOracle)`
  (`src/harness/match-runner.ts`). A player has the full state.
- **`pond_outcome::Game` is seed + moves → hash/won/score** and is game-agnostic
  (`crates/pond-outcome/src/lib.rs`); `assistance` is self-declared metadata.
- **The wasm-safe RNG exists.** `solitaire_core::rng` wraps `ChaCha20Rng::seed_from_u64`
  with a `shuffle`; `rand`/`rand_chacha` are pinned with default features off so the
  cores build for `wasm32-unknown-unknown` (`Cargo.toml`, workspace dependencies). The
  lineage note there is the same primitive every core uses.
- **The registry already has the tile.** `src/registry.ts:60` —
  `{ id: "cribbage", title: "Cribbage", emoji: "🎴", status: "soon" }`.
- **The gate was written for two humans.** `TODO/cribbage.md`: "cribbage is two-player,
  so it is gated … on the P2P transport + a fair-reveal primitive".
- **The spike pattern is a detached crate.** `spike/dots-solve/`, `spike/mancala-solve/`
  — an empty `[workspace]` table keeps it out of the Rust gate.
- **Plan filenames carry no ordinal as of 2026-08-29** (`CroftC/.claude/TRACKING.md` §
  "Plan files"). `fun/CLAUDE.md` still shows the retired `[-N]` form; Phase 11 fixes it.

## Documentation Impact

- `crates/cribbage-core/RULES.md` — **new.** The core's contract: the rule decisions above
  (automatic counting, skunk as a flag, seed-derived dealer, the show order and the
  win-mid-count rule), the move code table, the `View` boundary.
- `docs/BUILDING-GAMES.md` §10 — a new **"Variation — hidden information (cribbage)"**
  block: what the `Adversary` trait cannot carry, the `View` rule, the peek-sensitivity
  check, and the statement that the `GameOracle` rig is not the home for such a game.
  The adversarial checklist gets a line saying which of its items apply to a
  hidden-information game (verifiable record, tutor honesty, identity) and which do not
  (`Adversary`, `select_in_band`, the rig). Phase 11.
- `docs/AI-PLAYERS.md` — one paragraph under the "Corollary for game choice": the first
  game of that kind shipped with an expectation engine, and the LLM-as-player trial is
  now possible against a real baseline. Phase 11.
- `TODO/cribbage.md` — **rewritten** from "gated" to the per-game backlog (manual
  counting, Monte-Carlo engine, LLM trial, P2P follow-on). `TODO/README.md` — move it to
  shipped. Phase 11.
- `fun/CLAUDE.md` — the plan-filename line loses its `[-N]`. Phase 11.
- `README.md` — the game list. Phase 11.

## Concurrency Map

All phases sequential (core → cross-build → solver → mutants → wasm → front end →
measurement → docs → gate), each reading what the prior wrote, and everything after
Phase 5 sharing `build.mjs` / `registry.ts` / `dist/`. Phase 0 is the only phase that
could run beside another session's work, and it is the only phase that writes nothing
inside the workspace.

Mutation testing (Phase 4) runs in its numbered place, before the binding — the mancala
plan's deviation from dots, kept for the reason recorded there.

## Phases

### Phase 0: Discovery — measure the engine before designing it

**Goal:** Know the cost of the exact-expectation discard, the cost and payoff of pegging
lookahead, and the strength ladder between random play and the best policy, before a
constant is chosen.

**Changes:**
- [ ] `spike/cribbage-solve/` — throwaway, detached crate. A minimal scorer (fifteens,
  pairs, runs, flush, nobs) verified against the known extremes: **29** is the maximum
  hand, **28** the next, **19** is unreachable (the folk "19 hand" is a zero), **0** is
  common. Any disagreement is in the spike, not the rules.
- [ ] Measure the scorer: nanoseconds per hand, release build.
- [ ] Measure exhaustive discard: 15 keeps × 46 cuts, with and without a crib term.
  Record wall-clock; this is the number that decides whether the crib table is a
  build-time artefact or a runtime computation.
- [ ] Generate a crib table under a simple opponent policy and measure how much the
  choice of policy moves the table (two policies, compare).
- [ ] Pegging: implement the one-ply heuristic and a 2- and 3-ply expectimax; self-play
  each against random and against each other, 2,000 games per pair; record win rate
  **and** points-per-deal, because a policy can win more deals and fewer games.
- [ ] Record the peeking baseline: the same policies with the full state. This is the
  margin Phase 10's sensitivity check must reproduce.

**Call chain:** N/A — standalone spike.

**Wiring test:** N/A. The gate is the recorded measurements.

**Depends on:** nothing.

**Read-set:** `spike/mancala-solve/**` (the pattern), `crates/solitaire-core/src/rng.rs`.

**Write-set:** `spike/cribbage-solve/**`, this plan (findings).

**Shared-state contract:** None.

**Risks:** Measuring against a wrong scorer. Every number is worthless if the 29 check
was skipped. The scorer is verified first, and the spike's scorer is thrown away — Phase 1
writes the real one test-first from the rules doc, not by copying the spike.

**Done when:**
1. **Behavioral:** A recorded table of discard cost, crib-table sensitivity, and the
   pegging ladder (win rate + points per deal, honest and peeking).
2. **Verification:** The spike re-runs and reproduces the numbers from its fixed seeds.

**Validation:** Broad — this phase is validation.

### Phase 0 findings (measured 2026-08-29, `spike/cribbage-solve/`, results in `results.txt`)

Machine: darwin/arm64, release build, Rust 1.97.1. Every ladder pair alternates the
first dealer; win rates at 1,000 games carry a 95% interval of about ±3%, at 10,000
about ±1% — the second run exists because the first could not separate several rungs.

**The scorer was verified before any number was trusted.** Enumerating every
(four-card hand, cut) — 12,994,800 pairs, 0.2 s — reproduced the published score
distribution exactly: 29 × 4, 28 × 76, 0 × 1,009,008, and 19/25/26/27 unreachable.
Two of the spike's own unit tests were wrong on first run (a missed 5+K fifteen; a
missed 2+4+9), the scorer was not. That is the expected direction and the reason the
enumeration, not the hand-written tests, is the verification.

#### 1. Cost is not a design input — everything is instant

| decision | cost |
|---|---|
| score one hand | 19 ns |
| exhaustive discard, hand term only (15 × 46) | 19 µs |
| exhaustive discard with crib-table lookup | 21 µs |
| crib table, 20k Monte-Carlo samples | 0.4 s |
| expectimax-3 pegging, whole game of self-play | ~0.5 ms |

The plan's Phase 0 question "is the crib table a build-time artefact or a runtime
computation" has a boring answer: the *table* is cheap enough to build at startup, and
the *lookup* costs nothing. Ship it as a build-time artefact anyway, for the reason the
solitaire pack is one — byte-identical regeneration is a test, and a table computed at
runtime is a table nobody diffs.

#### 2. Discard is the whole game; the crib term is real but small

| discard policy (peg fixed = heuristic) | vs full-expect | pts/deal |
|---|---|---|
| random | **3.8%** | 9.3 vs 13.4 |
| hand-only expectation (ignore the crib) | 45.1% (10k) | 12.8 vs 13.1 |
| full expectation (hand ± crib table) | 50.2% (10k, self, the seat-bias check) | 12.9 vs 12.9 |

Random discarding loses 24 of 25 games; getting the hand term right closes almost all
of that; the crib term is worth about **5 points of win rate** — clearly present at 10k
games, invisible at 1k. The crib table's sensitivity to the assumed opponent policy is
smaller still: random-opponent vs hand-only-opponent tables differ by 0.17 pts mean,
0.80 max, against a same-policy two-seed noise floor of 0.11 / 0.40. **The table's
opponent policy is not a decision worth agonizing over**; build it under the shipped
policy and move on.

#### 3. Pegging lookahead buys ~6 points; three plies buy nothing over two

| peg policy (discard fixed = full-expect) | vs heuristic | pts/deal |
|---|---|---|
| random | 34.8% | 12.1 vs 13.0 |
| heuristic (points, avoid 5/21, lead low) | 50.2% (self) | — |
| expectimax-2 | **56.4%** (10k) | 12.9 vs 12.6 |
| expectimax-3 | 56.8% (10k) | 13.1 vs 12.7 |
| expectimax-3 vs expectimax-2 | 49.7% (10k) | 12.7 vs 12.8 |

**O3 is answered: expectimax-2.** The third ply is indistinguishable from the second at
10,000 games and costs 50% more. The plan's prior ("2-ply beats the heuristic by a few
points per deal and 3-ply buys nothing") was right in shape — and the shelf's record made
that a coin flip, so it was worth the run. Note the pts/deal margin is 0.3–0.4 for a
6-point win-rate gain: cribbage games are close enough that a third of a point per deal
decides one game in fifteen.

#### 4. The peek margin is large, which is what makes the honesty check testable

| cheat | vs the honest equivalent | pts/deal |
|---|---|---|
| peeking discard (knows the cut + opponent's throw) | **79.7%** | 14.0 vs 12.1 |
| peeking pegging (minimax over the real hand) | **71.6%** | 13.2 vs 11.9 |
| both | **92.8%** vs full-expect / expectimax-2 | 14.0 vs 10.9 |

This is Phase 10's sensitivity target: a test-only peeking engine must beat the honest
Expert by a margin of this order (≥ 20 points of win rate at 1,000 games is a safe floor
against a 92.8% measurement). An honest engine that leaks the cut or the opponent's hand
would show up as the peeking margin *shrinking* — a leak makes the honest engine
stronger, not weaker, so "Expert got better" is the symptom to fear, not celebrate.

#### 5. The ends of the ladder

random/random vs itself: 48.6% (sanity). The best honest engine (full-expect +
expectimax-2) beats random/random **99.5%** of the time at 13.5 vs 8.4 points per deal.
So the difficulty ladder has real room: the gap between "a player who has never seen the
game" and Expert is nearly the whole interval, and Easy/Medium/Hard can be placed in it
by *how much* of the discard expectation is thrown away rather than by pegging depth.

#### What this changes in the plan

- **Phase 3 ships expectimax-2 for pegging**, not the heuristic and not 3-ply (O3).
- **The crib table is built under the shipped discard policy**, one table, no policy knob.
- **Difficulty is a discard knob first.** Random discard is 3.8%; hand-only is 45%; that
  gap is where Easy and Medium live. Pegging sloppiness is the finer adjustment.
- **The self-play rig needs 10,000 games, not 1,000**, to make a strength claim between
  adjacent levels; at 19 µs a decision that is seconds, so Phase 10's baseline test can
  afford it.
- **The pegging model in the spike is approximate** (go/reset inside the lookahead is
  simplified). Phase 1's core will implement the real pegging state machine; Phase 3
  should re-run this ladder on the real core before the numbers above are quoted as the
  shipped engine's.

### Phase 1: `cribbage-core` — rules, `View`, hash, verifiable outcome

**Goal:** The complete game as a pure state machine with a replayable record and a
per-seat view.

**Changes:**
- [ ] `crates/cribbage-core` (workspace member, `[lints] workspace = true`):
  `Card` (rank 1–13, suit), `Deck::from_seed` over the shared ChaCha20 pattern,
  `GameState` (both hands, crib, cut, deck, scores, dealer, phase: Discard / Peg /
  Show / Over), `Seat`, `Move` (the code table above) with `to_code`/`from_code`.
- [ ] `legal_moves(&GameState, Seat)`, `apply(&GameState, Move) -> Result<GameState,
  RuleError>` — the show is applied inside the last pegging move's transition so a
  terminal state is canonical (mancala's lesson: the transformation lives in `apply`).
- [ ] Scoring as free, pure functions: `score_hand(cards, cut, is_crib)`,
  `score_peg(stack) -> PegPoints` — each with golden vectors.
- [ ] `View::for_seat(&GameState, Seat)` — the observation type. Its serde form is what
  the wasm exposes to the UI and the solver.
- [ ] `state_hash` (no floats; `usize→u32` at the boundary), `impl pond_outcome::Game`.
- [ ] `RULES.md` written **before** the vectors, and the vectors cite its sections.
- [ ] Golden vectors: 29 / 28 / 0 hands; a flush in hand vs crib (crib needs five);
  his heels; his nobs; a double run, a triple run, a double-double run; pegging 15,
  31, pair-royal, a run out of order, go and last card; **a game won by non-dealer
  during the show before the dealer counts**; **a game won mid-pegging**; a full game
  from a seed replayed to a stable hash.

**Call chain:** `Deck::from_seed → deal → apply(Discard×2) → cut → apply(Peg…) →
show → next deal … → Over`.

**Wiring test:** A full game from a fixed seed with a fixed move list replays to a
pinned hash and result, native.

**Depends on:** Phase 0 (rules verified; O1, O2 answered).

**Read-set:** `crates/solitaire-core/src/{rng,board}.rs`, `crates/furrow-core/src/lib.rs`,
`crates/pond-outcome/src/lib.rs`.

**Write-set:** `crates/cribbage-core/**`, root `Cargo.toml` members.

**Shared-state contract:** `Cargo.toml` members list — one line, additive.

**Risks:** The show order and the mid-count win. Both are pinned as vectors because both
are the kind of rule an implementation gets "nearly right". Second: the pegging run rule
(runs count in any order, but only among the cards since the last reset) — a classic
off-by-one, also pinned.

**Done when:**
1. **Behavioral:** All vectors green; a full game replays.
2. **Verification:** `npm run test:rust` green; no `unwrap` outside tests.

**Validation:** Narrow — `cargo test -p cribbage-core --release`.

### Phase 2: native == wasm cross-build

**Goal:** The same seed and moves hash identically under both compilers.

**Changes:**
- [ ] The workspace's existing cross-build check extended with the cribbage fixture
  (the same mechanism every core uses; no new tooling).

**Depends on:** Phase 1. **Read-set:** `tools/build-wasm.sh`, the existing cross-build
test. **Write-set:** the cross-build fixture list.

**Done when:** the fixture's hash matches native and wasm in the gate.

**Validation:** Narrow.

### Phase 3: `cribbage-solver` — expectation, crib table, pegging policy, band, tutor

**Goal:** The shipped opponent, taking a `View` and nothing else.

**Changes:**
- [ ] `discard::expectation(&View) -> Vec<(Move, Expected)>` — the exhaustive 15 × 46
  with the crib term; `Expected` is a fixed-point integer (hundredths of a point) so the
  hashed/recorded path stays float-free.
- [ ] `crib_table` — generated by a `build`-time binary (the solitaire-pack pattern) into
  a checked-in, byte-identically regenerable artefact with a regeneration test.
- [ ] `peg::policy(&View, level)` — the policy Phase 0 chose, behind one function.
- [ ] `Level` (Easy…Expert) → `Band { top_k, sloppiness_pct }`; `select(values, band,
  rng)` with the RNG-untouched-at-zero property pinned.
- [ ] `tutor::assess(&View, Move) -> { expected, regret, quality, exact }` — `exact` is
  `true` for a discard assessment (the expectation is exhaustive) and `false` for a
  pegging one, always. This is the honesty flag the tutor panel binds to.
- [ ] The type-level rule: **no public function in this crate takes `&GameState`.** A
  unit test compiles the crate's public surface against `View` only (a doc-test that
  fails to compile if a `GameState` parameter appears is enough).

**Call chain:** `live_move(view, level, rng) → phase match → discard::expectation |
peg::policy → select`.

**Depends on:** Phases 0, 1. **Read-set:** `crates/adversary-solver/src/lib.rs` (the
selector's properties to reproduce), `crates/solitaire-solver` (the build-time artefact
pattern). **Write-set:** `crates/cribbage-solver/**`, the crib-table artefact.

**Risks:** The crib term's sign. Dealer adds it, non-dealer subtracts it; get it
backwards and the engine feeds its opponent's crib. Pinned with a vector where the two
seats disagree on the same six cards.

**Done when:**
1. **Behavioral:** Expert's discard equals the exhaustive best on every vector; the
   band is deterministic at 0% sloppiness; the crib table regenerates byte-identically.
2. **Verification:** `npm run test:rust` green.

**Validation:** Narrow.

### Phase 4: mutation-test the core and the solver

**Goal:** Find what the green suite hides before it ships — a scorer is exactly the
"encoders and searches" case `fun/CLAUDE.md` names.

**Changes:**
- [ ] `cargo mutants --package cribbage-core -j 4`, then `--package cribbage-solver`.
- [ ] Triage every survivor: equivalent or real gap; record both lists in the Review Log.
- [ ] Close the real gaps test-first; the expected ones are the shelf's three (a
  delegating impl, an untested convenience API, a `render`/`View` that passes on
  `contains`).

**Depends on:** Phase 3. **Write-set:** tests only, and this plan.

**Done when:** every survivor is classified and every real gap has a killing test.
Commit before each round (`CLAUDE.md`, the restore rule).

**Validation:** Broad — the full Rust gate after each restore.

### Phase 5: `cribbage-wasm` — the C-ABI binding

**Goal:** The core and solver reachable from TypeScript, exposing **views**, never the
state.

**Changes:**
- [ ] `new_game(seed)`, `view_json(seat)`, `legal_moves_json(seat)`, `play(code) →
  status`, `current_hash`, `live_move(level)`, `assess_json(code)`, `tutor_json()`,
  `replay_json(seed, moves)`. There is deliberately **no `state_json`**: the UI receives
  the human's `View` and, at the show, the revealed cards through the view's
  `revealed` field — the binding cannot hand out the engine's hand early even by
  accident.
- [ ] Holds state, never panics (every entry point returns a status or `null`).
- [ ] `src/games/cribbage/cribbage-wasm.ts` — the typed wrapper.

**Depends on:** Phases 3, 4. **Read-set:** `crates/furrow-wasm/src/lib.rs`,
`src/games/furrow/furrow-wasm.ts`. **Write-set:** `crates/cribbage-wasm/**`,
`src/games/cribbage/cribbage-wasm.ts`, `build.mjs`.

**Risks:** A `View` that leaks through the show. At the show every card is public; the
view for the *next* deal must not carry the previous deal's revealed cards forward. A
test plays two deals and asserts the second view's `revealed` is empty until its show.

**Done when:** a full game plays through the wrapper in vitest and hashes as native.

**Validation:** Narrow.

### Phase 6: the front end — playable at `/cribbage/`

**Goal:** A complete game against the engine, tap-first, on the shared chrome.

**Changes:**
- [ ] `src/games/cribbage/cribbage.ts` — `GameModule`. Registry entry flips to
  `status: "playable"`, `group: "versus"`.
- [ ] Discard: tap two cards, confirm; core-driven legality (a third tap is a no-op).
- [ ] Pegging: the count, the stack, tap-to-play with the legal cards lit; "Go" appears
  only when the core says it is legal. The engine's play is **visible**: a beat, a ring,
  the count updating.
- [ ] The show, narrated: non-dealer, dealer, crib, each with its breakdown (fifteens,
  pairs, runs, flush, nobs) — automatic counting, shown, not skipped.
- [ ] The peg board: 121 in two tracks, both pegs, front and back — the one piece of
  cribbage furniture that has to look like itself.
- [ ] The opponent as a *who*: a turn bar naming both seats, the crib marker, whose
  turn. Persona name per O4.
- [ ] End screen: verification-forward, skunk flag shown, `?r=` share that re-verifies.
- [ ] `cribbage-outcome.ts` — record/verify/share, the `drop4-outcome.ts` shape.
- [ ] Wiring test through the entry point (`BUILDING-GAMES` §8).

**Depends on:** Phase 5. **Read-set:** `src/games/furrow/furrow.ts`,
`src/games/drop4/drop4-outcome.ts`, `docs/RESPONSIVE-DESIGN.md`. **Write-set:**
`src/games/cribbage/**`, `src/registry.ts`, `tests/cribbage*.test.ts`.

**Risks:** Six cards plus a stack plus a board at 360px. Cards must stay ≥44px tap
targets; the board may have to collapse to a numeric score with the pegs as a
compact strip on narrow viewports. Measure at 320/360/390 per `MOBILE-FIRST.md`, and
measure element geometry — not `scrollWidth`.

**Done when:** a game plays to 121 in Playwright on both engines with axe clean.

**Validation:** Broad — `npm run gate`.

### Phase 7: identity, tokens, accessibility

**Goal:** Cribbage's own look on `tokens.css`, WCAG AA in both themes, on both skins.

**Changes:**
- [ ] Card faces reuse solitaire's tokens where they exist (suits, ivory, the red/black
  pair) — one card language on the shelf, not two.
- [ ] Peg-board and peg colours as skin-aware tokens (`CroftC/.claude/SKINS.md`: a skin
  restyles, never restructures).
- [ ] Contrast recorded and asserted; axe in both themes.

**Depends on:** Phase 6. **Validation:** Narrow — the a11y suite.

### Phase 8: standard settings, hints, and the tutor panel

**Goal:** The shared assistance mechanism, plus the honest tutor.

**Changes:**
- [ ] Standard settings wired (`src/settings.ts`): hints on by default → Hint marks the
  engine's top discard / suggested peg; hints off → no "I'm stuck" (cribbage always has
  a legal move, so the button is not offered — recorded as a deliberate deviation).
- [ ] Declare assistance → the record's `assistance` flag.
- [ ] Tutor panel, opt-in, off by default: after a discard, "you kept X (avg 7.2); best
  was Y (avg 8.9)" — worded as a fact because `exact` is true. After a peg: a hedged
  sentence, never a verdict, because `exact` is false. The `coachFor` unit test pins
  both wordings to the flag.

**Depends on:** Phase 6. **Validation:** Narrow.

### Phase 9: "How to play"

**Goal:** The guide, as pure data, with shots that show the shipped UI.

**Changes:**
- [ ] `cribbage-howto.ts`: the deal, the discard and the crib, the cut and his heels,
  pegging (15, 31, pairs, runs, go), the show and its order, the peg board, winning at
  121 and the skunk line.
- [ ] `npm run guide:shots`; commit **only** the cribbage shots.

**Depends on:** Phases 6–8. **Validation:** Narrow — the guide sync tests.

### Phase 10: the measurement rig — strength, honesty, and the peek check

**Goal:** Replace "the engine is strong and does not cheat" with numbers, in CI.

**Changes:**
- [ ] `tests/cribbage-rig.test.ts` — self-play over the real wasm, level × level, N
  games from fixed seeds. The three non-vacuity assertions in the shelf's form:
  every game finishes; the games scored are more than zero; Expert beats Easy.
- [ ] **The discard oracle check:** Expert's discards equal the exhaustive expectation
  on every deal of the run (it is the one decision with an exact answer; regret must be
  zero there).
- [ ] **The peek-sensitivity check:** a test-only peeking player (given the full state
  through a test-only binding path, never shipped) beats the honest Expert by at least
  the margin Phase 0 recorded, within tolerance. If this ever passes at zero margin,
  the honest engine is reading something it should not, or the check is broken —
  either way it is a failure.
- [ ] `tests/baselines.test.ts` — the recorded win-rate table by level pair.

**Depends on:** Phases 5, 6. **Read-set:** `docs/HARNESS.md` (the non-vacuity rule),
`tests/furrow-harness.test.ts` (the shape). **Write-set:** the two tests and a
test-only wasm export.

**Risks:** The peeking path leaking into the shipped binding. It is compiled under a
feature flag the production build does not set, and the `build.mjs` step asserts the
symbol is absent from the shipped `.wasm`.

**Done when:** all three checks green and the baseline recorded.

**Validation:** Broad — `npm run gate`.

### Phase 11: documentation

Everything in "Documentation Impact", plus the Review Log entries for every phase above.

**Validation:** the doc sync tests, and `bash ../.claude/bin/workspace-audit.sh`.

### Phase 12: gate and deploy

- [ ] `npm run gate` green locally (named: it is the repo's declared gate).
- [ ] Push; CI's three parallel jobs green; `deploy` runs.
- [ ] Play one game to 121 on the phone from the live URL — the shelf's rule that
  built means wired means tested does not stop at the gate.

## Open Questions

1. **O1 — Automatic counting only, or offer manual counting now?** Recommendation:
   **automatic in this plan**; manual counting (the player states a total, the core
   grades it, with optional muggins against a counting engine) is the first follow-up in
   `TODO/cribbage.md`. It is a genuine feature, and the tutor's exactness makes it a
   good one, but it is a second interaction model on top of a first that does not exist
   yet. Must be answered before Phase 1 (it changes whether the show is a move).
2. **O2 — Skunk: a flag, or a scored match?** Recommendation: **a flag on the record**,
   one game to 121 as the unit. Match play is a persistence feature, and the shelf has no
   cross-game persistence yet. Must be answered before Phase 1 (it is in the record).
3. **O3 — Pegging engine: heuristic or expectimax?** **Answered by Phase 0
   (2026-08-29): expectimax-2.** +6 points of win rate over the heuristic at 10,000
   games; a third ply is indistinguishable (49.7% head-to-head) at 1.5× the cost.
4. **O4 — The opponent's name.** Every shipped engine is "The Engine 🤖"; the
   crofting-idiom persona names (Chip / Rowan / Alder / Bramble / Millet) belong to the
   opt-in LLM hybrid, which this plan does not ship. Recommendation: **"The Engine"**
   for the first ship, with a persona reserved for the LLM trial in `TODO/cribbage.md`;
   the tile stays "Cribbage" (a generic name, no mark to collide with — the Trio Tumble
   rename is the reason to check anyway).

## Review Log

*(Execution notes go here, one entry per phase, in the shape the mancala plan uses:
what was measured, what the measurement refuted, and what changed as a result.)*
