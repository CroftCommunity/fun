# Plan — Loose Ends' second mechanic: the knot has a key

**Status:** **Phase 1 BUILT, 2026-09-08 (owner: "go with the recommendations, build phase 1");
phases 2–4 not started.** Q1–Q5 decided at their recommendations (Review Log). Plan filename
carries no ordinal per `CroftC/.claude/TRACKING.md` § "Plan files". Plan landed from
`claude/looseends-mechanic` (#85); phase 1 on `claude/looseends-locks`, worktree
`CroftC/worktrees/looseends-mechanic/fun`. Mock: `mocks/g-looseends-mechanic.html` v1, its
Current capture in `mocks/snaps/g-looseends-mechanic/` (`current.*` from `fun@5fcb81f`).

## Problem Statement

The play-surface plan (`plans/2026-09-04-plan-play-surface.md`, phase 11) rebased Loose
Ends' curve so level 1 is a puzzle to read — ten arrows on 6×8, snakes of 3–5 — and parked
the rest of mock F's proposal 9 by decision (Q10, 2026-09-08): "colour bands that hide the
flow, locked arrows that need a neighbour freed first, a par with three stars". The
Reasoning there said why: density is a config change over a generator already solvable by
construction, while "a new mechanic is core work with its own determinism tests and
belongs to its own plan". This is that plan.

What the game has today, read from the code, not the screenshot:

- **One read.** An arrow is FREE iff the ray from its head to the edge is empty
  (`board.rs` `is_free`). Every level, first to last, asks one question of every arrow.
  Difficulty rises only through count and length (`config.rs`: 10 arrows on 6×8 at level
  1, 68 on 18×26 at level 100).
- **Stars already grade a clean solve.** `score.rs`: 3★ for no mistake and no hint, 2★ for
  exactly one, 1★ otherwise; mistakes and hints are UI-side declared metadata, never in the
  move list. "A par with three stars" is therefore already the rule — there is no second
  axis to add stars to, and the genre's players reject the one there is (a clock; § Sources).
- **The record is the release order.** `Origin` packs to `≤ 2^33` (a mode bit plus the
  level number or the daily seed) and `replay(packed_seed, moves)` regenerates the board
  from that alone. Any new mechanic must be a pure function of the seed too, or the record
  stops being verifiable.
- **The generator places arrows in reverse solution order** (`generate.rs`): the arrow
  placed last is released first. A second dependency can ride on that order without
  breaking it — or break it, if the dependency points the wrong way.

## Approach

**Locks: a locked arrow needs its key freed first.** A lock is a pair `(locked, key)` of
two arrows whose bodies touch. The locked arrow is BLOCKED while its key is on the board —
even with its ray clear — and unlocks the instant the key slides off. Everything else stays:
the ray rule, the release, the star rule, the record.

1. **Core rule (`board.rs`).** `Board` carries `locks: Vec<(usize, usize)>`; `is_free(id)`
   is false while any `(id, key)` has `is_present(key)`. `release` is unchanged (it asks
   `is_free`). A new `ReleaseError::Locked(key)` lets the UI say *which* arrow, so a tap on a
   lock is information, not a trap.
2. **Generation (`generate.rs`).** After the arrows are placed — after the retry wrapper
   picks its attempt, so the arrow layouts and every existing golden stay byte-identical —
   draw `cfg.locks` pairs from the same RNG stream: pick a locked arrow at placement index
   `i`, then a key among the arrows placed **after** it (`j > i`) whose body is 4-adjacent
   to its body; skip and redraw when none qualifies, give up after a bounded number of
   draws. Placed-later means released-earlier, so releasing in reverse placement order still
   clears the board: **solvability by construction is preserved by the direction of the
   pair**, and the greedy solver in `tests/acceptance.rs` stays the proof.
3. **The curve (`config.rs`).** `locks = 0` through level 7; `1 + floor((n − 8) · 7 / 92)`
   from level 8 (1 at level 8, 8 at level 100). Levels 1–7 are then unchanged to the byte —
   the reader learns the ray rule on a knot before the knot gets a key. The daily config
   stays untouched, as phase 11 left it (Q3 below asks whether it should).
4. **The hash.** `state_hash` is over occupancy + remaining count; a lock's state is a
   function of its key's presence, and the pairs are a function of the seed, so a cleared or
   half-cleared board hashes as today. The domain tag stays `"loose\0"` — a record from
   before this change replays to the same hash on a level with no locks, and levels 1–7 have
   none. Verified-assumption 3 below is the check.
5. **Binding + UI.** `looseends-wasm` exports the pairs; `tap` reports `Locked(key)`;
   `looseends.ts` draws the lock at the locked arrow's head and a tie to its key (sketch in
   mock G), flashes the key on a locked tap, and says so in the toast; the how-to gets a
   panel and its shots regenerate; the a11y name of a locked arrow says "locked by …".
6. **Not this plan.** Colour bands (research says colour as camouflage is what the genre's
   players punish hardest — § Reasoning), a clock, a move limit, a par beyond the star rule.

## Reasoning

- **Why locks and not the other two.** The research pass (2026-09-08, sources below)
  sorted the three parked ideas by what they add to *reading the knot*, which is the fun the
  genre's players name. Locks add a **second dependency graph** on top of the ray graph —
  find the key before the path — which is new reasoning. Colour bands make the same reasoning
  slower, and the one datapoint on colour-as-obscurity is a 1★ review ("almost impossible to
  see the arrows"). A par collapses to the clean solve the star rule already grades; every
  2D arrow game surveyed markets "no timer", and the one post-solve penalty found drew a 3★.
- **Why the pair points backward in placement order.** The generator's invariant is that
  the arrow placed last has a clear ray at placement; releasing in reverse order never
  blocks. A key placed *after* its lock is released *before* it, so the same order still
  clears the board — the invariant is kept by construction, not by a solver's luck. A key
  placed before its lock would release after it: unsolvable by construction, and the
  acceptance test would say so on the first run.
- **Why the pairs are drawn after the retry wrapper.** The wrapper keeps the attempt with
  the most arrows and the RNG stream continues across attempts. Drawing locks inside an
  attempt would shift every later draw and re-record every golden board; drawing them after
  the chosen attempt leaves the level-1 and level-50 boards and all 100 counts as they are.
  The new goldens are the lock pairs only.
- **Why level 8, why one.** Easy is levels 1–15 (`looseends.ts` `bandOf`). Seven levels of
  the ray rule alone, then one key on the knot, then more with `t` — the difficulty saw the
  design write-ups describe (a new wave with its own learning curve), on the shelf's own
  band. The count at level 100 (8 of 68 arrows) keeps the read the point: locks are the
  spice, the knot is the meal.
- **Why a locked tap is not a mistake.** The genre's loudest complaints are interruptions
  and fake difficulty. A tap on a lock that costs a droplet punishes not knowing a rule the
  board can show; a tap that flashes the key teaches it. The star rule is untouched: a
  mistake is still a tap on an arrow whose ray is blocked.
- **Why a sketch before a build.** MOCKS.md P1: a drawing is a sketch while a direction is
  being chosen; mock G asks five decisions and the owner asked to see it before any build.

Sources for the genre read (2026-09-08, the research pass this plan names): App Store
listings and reviews of Tap Away 3D (Popcore), Arrow Puzzle – Tap Away (Easybrain), Tangled
Snakes (Popcore), Screw Jam, Unpuzzle: Tap Away, Block Away; Kek Games' Unpuzzle 2 (Armor
Games: "Hooked squares can be moved in one direction", "Connected squares can only be moved
together"); Ragendom's Tap Away 3D template ("Count Down Blocks (Locked)"); arrowpuzzle.org
(the hint "knows the reverse order"); Flow Free's fewest-moves star; Deconstructor of Fun on
hybridcasual puzzles (2025-02-03); Gamigion on tuning by attempt count; davetech.co.uk on the
difficulty saw. No Reddit thread surfaced; player sentiment is store reviews.

## Verified Assumptions

- `Board::is_free` is the one place the FREE rule lives; `release`, `free_arrows`,
  `greedy_solve` and `Game::hint` all go through it (`board.rs`, `game.rs`, read 2026-09-08)
  — so a lock is one predicate, not four.
- The retry wrapper continues one RNG stream across attempts and returns the best attempt
  (`generate.rs` `generate`); draws appended after it cannot change an arrow.
- `Origin` is what a record carries, not `Config` — so a lock count derived from the level
  number needs no new bits in the JS-safe packed seed (`game.rs` `Origin::to_packed`).
- The daily config draws `w`, `h`, `target` from the seed's own stream before the generator
  restarts it (`config.rs` `daily_config`); a daily lock count would be a fourth draw and a
  golden change for every daily — one reason Q3 is a question.

Still to verify at phase 1 (each is a RED test before the code): that a lock pair with the
key placed later is always released first by `greedy_solve` (100 levels + 365 dailies); that
`state_hash` of a board with locks equals the same board's hash without them (occupancy
only); that a bounded redraw finds a pair on every level from 8 up (or the count comes down
honestly).

## Documentation Impact

- `crates/looseends-core/RULES.md`: a "Locks" section under FREE and release, the curve's
  `locks` term, the goldens.
- `src/games/looseends/looseends-howto.ts`: a panel on locks and its shot.
- `CHANGELOG.md` `## 2026-09`: the looseends entry, when it lands.
- `mocks/README.md`, `mocks/index.html`: mock G listed (done on this branch).

## Phases

### Phase 1: The rule in the core — BUILT
`Board::with_locks`, `locks()`, `key_of(id)`; `is_free` is `ray_clear && key_of.is_none()`
(the ray walk is now `ray_clear`, so the two clauses are readable apart); `release` reports
`Blocked` before `Locked(key)` — the ray is the visible fault (Q2); `Tap::Locked(key)`; the
wasm `tap` returns status 3 for it (the key export is phase 3). RED first on hand-built
boards: a locked arrow with a clear ray is not free until its key goes; a locked arrow with
a blocked ray reports Blocked; a lock on a gone or unknown key is inert; locks never enter
the hash; `greedy_solve` releases the key before the lock; a locked tap names its key, is
not a move, the hint is the key. Done-when met: crate tests green (23 unit + acceptance),
clippy clean, mutation audit run twice and triaged (Review Log). **Executed 2026-09-08**
(`d27e166`, `0486a31`).

### Phase 2: The generator and the curve
`Config.locks`, `level_config` from level 8, pairs drawn after the wrapper; goldens: the
lock pairs for levels 8, 50 and 100 and the count for all 100; the acceptance suite's
solvability over 100 levels + 365 dailies with the pair rule; `xbuild` replays a locked level
natively and in `wasm32` to the same hash. Done-when: existing goldens unchanged to the byte
(the diff shows only additions), the new ones recorded from the generator once read.

### Phase 3: The binding and the board
`looseends-wasm` exports pairs and the `Locked(key)` tap; `looseends.ts` draws the lock and
the tie, flashes the key, names it for a screen reader; the toast; the how-to panel and its
shots; the wiring spec plays level 8 through its lock on both engines. Done-when: the
looseends specs green on both engines, shots regenerated, `npm run gate` green.

### Phase 4: The mock's record
Mock G v2 with Shipped captures (`tools/mock-snaps.mjs looseends --out g-looseends-mechanic
--tag shipped`; the tool needs a level-8 route — a `?level=8` deep link is the hermetic
form) beside the sketch; the decisions table marked. Done-when: MOCKS.md rule 4 — the
decision as built is the decision in the mock.

## Open Questions

Q1–Q5 are in mock G's decisions table with a recommendation each; the plan repeats none.

## Review Log

### Phase 1 — 2026-09-08 (owner: "go with the recommendations, build phase 1")
- Decisions, all at the mock's recommendation: **Q1** locks from level 8, one, then
  `1 + floor((n − 8) · 7 / 92)`; **Q2** a locked tap costs nothing, the key flashes; **Q3**
  no locks on daily boards this pass; **Q4** colour bands parked indefinitely; **Q5** the
  locked arrow dim, a badge at its head, a dashed tie to its key.
- Verified on the way (each a test): `state_hash` of a board with locks equals the same
  board's without, fresh and after a release; `greedy_solve` orders key before lock; the
  hint never names a locked arrow.
- **Mutation audit** (`cargo mutants --in-place` over `board.rs` + `game.rs`, first run):
  118 mutants — 81 caught, 12 timeouts (kills: the greedy loop hangs when the FREE rule
  lies), 11 unviable, **14 missed, none in the lock path**. Triage of the 14: nine were the
  hash's inputs (`width`, `height`, `occupancy_bytes`) with no golden pinning the encoding —
  real gap, closed by three vectors in `hash.rs` recorded from the generator; three were
  `Origin::to_packed`'s operators with no round-trip — `<<`→`>>` and `|`→`&` real, closed by
  a round-trip over both modes with the JS-safe bound, `|`→`^` **equivalent** (bit 0 of a
  shifted value is clear) and left; `Game::hint → Some(1)` survived because the locked test's
  key happened to be id 1 — real, the ids swapped; `Game::is_won → true` survived because
  no test asserted a live board is not won — real, asserted twice. **Second run** (board,
  game, hash): 120 mutants — 95 caught, 12 timeouts, 11 unviable, **2 missed**: the
  equivalent `|`→`^`, and `hint → Some(0)`, which the id swap had made the key — closed by
  asserting the hint moves to id 1 once the key is gone (a constant cannot be both), watched
  red by hand against the mutant and restored from HEAD.

### Pass 1 — 2026-09-08 (research + sketch)
- Reconstructed: `main@5fcb81f`, clean; worktrees `chess-emoji` and `poster-desktop-art`
  (this session) on fun, none on Loose Ends. New worktree `worktrees/looseends-mechanic/fun`.
- Research pass delegated (web only), report summarised in § Reasoning and in mock G.
- Current captured (`fun@5fcb81f`, four routes); the sketch drawn in mock F's `.le` style
  with a lock badge and a tie; five decisions asked.
- Nothing built. The owner asked to see the sketch first.
