# P8 — Checkers (English draughts), the harness generalization, and `adversary-solver`

**Status:** planned — **ready for execution** (Pass 1 + Pass 2 + Pass 3 complete)
**Standards anchor:** `docs/BUILDING-GAMES.md` §10 + the two new-game checklists
**Scoping note it supersedes:** `TODO/checkers.md`
**Related backlogs it closes items in:** `TODO/harness.md`, `TODO/othello.md`, `TODO/drop4.md`

---

## Problem Statement

Three tracked threads on the shelf are all waiting on the same event — a **third
adversarial game**:

1. **The browser AI-scoring harness is Drop-4-only.** `src/harness/{match-runner,
   scorer,tournament}.ts` import `Drop4` by type and call `Drop4`-shaped methods
   (`liveMove(level)`, `assess(col)`, `board().toMove`). Othello shipped with the
   same `assess`/`tutor` `{quality, exact}` surface but **cannot be graded** by the
   rig. `TODO/harness.md` names the fix: inject a game/oracle adapter.
2. **The class-preserving band selector is duplicated.** `select_in_band` +
   `LiveBand` are the same ~40 lines in `crates/drop4-solver/src/live.rs:208-277`
   and `crates/othello-solver/src/live.rs:30-98`, differing only in the move type
   (`Col` vs `othello_core::Move`). Two copies was the deliberate rule-of-three
   call; a third consumer is the trigger to extract `crates/adversary-solver`.
3. **The `Adversary` trait's generality is unproven against a hard move space.**
   Drop 4's move is a column; Othello's is a cell index. Both are a single `u8`
   naming a destination. Neither exercises `Move: Copy + Serialize + Eq` against a
   move that is a *path* — so we do not actually know whether the trait, the band,
   the tutor, or the `?r=` verifiable-outcome property carry to a real move space.

**What we are building:** Checkers (English draughts, 8×8) as the third Tier-1
adversarial game, with the harness generalized to grade any shelf game and the
band selector extracted to a shared crate. Checkers is chosen over the cheaper
rule-of-three triggers (Nim, Dots and Boxes) precisely because its move is a
**jump chain** — a piece plus an ordered list of landing squares — which is the
first real stress on every shared abstraction at once.

**Constraints:**
- Every Tier-1 standard in `docs/BUILDING-GAMES.md` §§2–8 applies, plus §10's
  adversarial + AI-opponent checklist.
- No regression to shipped Drop 4 or Othello. Both are migrated onto the extracted
  crate and the generalized harness; their existing tests are the safety net.
- The exact/heuristic honesty flag is non-negotiable: checkers is not solved from
  the opening, so the Oracle hedges early and only claims a win/draw/loss class in
  the exact endgame — the Othello shape, not the Drop 4 shape.

---

## Reasoning

### Why checkers, and why now

The shelf's own `TODO/README.md` ranks checkers first among next games, for a
reason worth restating: the value is not another board on the shelf, it is the
**generality signal**. Drop 4 and Othello share a move shape (one `u8` naming a
destination square/column), so every shared abstraction built so far has only ever
been tested against that shape. Checkers breaks it:

| | Drop 4 | Othello | Checkers |
|---|---|---|---|
| Move | column `0..6` | cell `0..63`, pass `64` | **jump chain** |
| Move is a destination | yes | yes | **no — a path** |
| Legality is local | yes | yes | **no — mandatory capture is global** |
| Turn order | strict alternation | alternation + forced pass | strict alternation |
| Solved from opening | yes (tractable endgame) | no | no |

If `Adversary`, `buildBand`, `TutorFactMove`, the `?r=` replay property, and the
generalized harness all carry to *that* without change, the abstraction is real.
If any of them break, we would rather find out on game three than on chess.

### Why the harness generalization comes first (Phases 1–3), before checkers

Two reasons, and the second is the load-bearing one:

1. **It does not depend on checkers.** The `GameOracle` port needs exactly two
   consumers to be designed honestly — Drop 4 and Othello — and both already ship.
   Deferring it behind checkers would gate a finished piece of work on an
   unfinished one.
2. **It de-risks the whole plan.** If checkers stalls (the jump-chain encoding is
   the genuinely novel work), Phases 1–3 have still closed `TODO/harness.md`'s top
   open thread and made Othello gradeable. The plan degrades to a partial win
   instead of nothing.

The alternative — build checkers first, generalize the harness last — was rejected
because it front-loads all the risk and leaves the shipped-but-ungradeable Othello
gap open for the whole build.

### Why the extraction sits mid-plan (Phase 6), not first and not last

The rule of three says wait for the third consumer before extracting. Taken
literally that means extracting *after* `checkers-solver` exists. But that would
mean writing a **third copy** of `select_in_band` and then deleting it — churn for
ceremony's sake.

The resolution: extract at the moment the third consumer *needs* the band, i.e.
immediately before `checkers-solver` is written (Phase 6, before Phase 10). By then
`checkers_core::Move` exists (Phase 4), so the generic signature is designed
against three real, structurally different move types — which is the actual point
of the rule of three. Drop 4 and Othello migrate onto it (Phases 7–8) before
checkers consumes it, so the extraction is proven by two existing test suites
before it has a new dependent.

### The move encoding — the central design decision

This is the one piece with no precedent on the shelf. Four options were considered:

- **(A) Index into `legal_moves`.** A move over the wire is its index in the
  position's legal-move list. Rejected: it is not self-describing, and a tampered
  `?r=` share replays as *a different legal move* rather than being rejected —
  which degrades the tamper story from "the move was not legal" to "the hash
  diverged". Othello deliberately chose a self-describing code (`othello-core/src/
  game.rs:25-28`); breaking that precedent for the harder game is backwards.
- **(B) Pack the whole chain.** Origin + up to 9 landings × 5 bits = 50 bits. Fits
  a JS number (< 2^53) but only just, and the encoding is opaque and fragile.
  Rejected as over-engineering for a case the rules already bound.
- **(C) `(from, to)` only.** Rejected: ambiguous. A king can reach the same
  destination by two different capture paths (a cyclic capture can even return to
  its origin), so `(from, to)` does not name a unique move.
- **(D) `(from, to, variant)` packed into one integer.** ✅ **Chosen.**
  `from` (5 bits) | `to` (5 bits) << 5 | `variant` (4 bits) << 10 → a 14-bit code,
  `0..16383`, comfortably a plain JSON number. `variant` disambiguates chains that
  share an origin and destination; `legal_moves` assigns it deterministically by
  chain order, and simple (non-capture) moves are always `variant 0`.

(D) preserves the property that matters most: **every shelf game's `?r=` share is
a plain JSON number array**, which is exactly what lets the generalized harness
type moves as `number` rather than needing a generic move parameter. The encoding
is validated empirically in Phase 0 (D2) — the plan does not assume 4 bits of
variant is enough, it measures it.

**Rules note that shrinks the problem:** English draughts terminates a move when a
man is crowned ("if a man moves into the kings row or if it jumps into the kings
row, the current move terminates" — Wikipedia, see Verified Assumptions). That
bounds chain length and removes a whole class of would-be ambiguity, because a
promoting man cannot continue as a king in the same turn.

### Why the generalized harness types moves as `number`, not a generic `M`

Because every shelf game already encodes its move as a compact numeric wire code
(Drop 4: column; Othello: `0..63` place / `64` pass; checkers: the packed code
above), a generic `GameOracle<M>` would buy nothing and cost type noise in every
signature. The port is `GameOracle` over `number`, and each game ships a thin
adapter that normalizes its wrapper's sentinels into "a numeric move code or
`null`". Othello's adapter is where `liveMove()`'s `"pass"` sentinel becomes
`PASS_CODE` (64) and where `play(64)` routes to `pass()` — precedent already
exists for exactly this in `othello-outcome.ts`'s `verifyRecord`.

### Rejected: renaming `TutorFactMove.col`

The shared harness field is named `col` (a Drop 4 legacy); Othello already reuses
it for a cell index and checkers will reuse it for a packed move code. Renaming it
to `code` would be more honest, but the name is also the **wasm JSON wire field**
in three crates' `AssessView`, so the rename ripples through 3 Rust crates and 3
front-ends for zero behavioural gain. Decision: keep `col`, document it precisely
at the port. Recorded as an ADVISORY open question rather than silently dropped.

### The draw rule — a gap the scoping note missed

English draughts as codified has **no move-count draw rule**: "The game is a draw
if neither side can force a win, or by agreement." Agreement is not available to a
deterministic core, and "cannot force a win" is not computable at tap speed. A core
with no terminating draw condition can produce a **non-terminating game**, which
would hang `runMatch` (it loops until `board().result !== -1`) and break the
verifiable-outcome property.

So the core must adopt an explicit, deterministic draw rule. **Decided (owner,
2026-08-04): the standard tournament no-progress rule — a draw after 40 moves by
each side (80 plies) with no capture and no man advanced.** It is deterministic, it
is a real draughts rule rather than an invention, and it makes `Draw` reachable in
the exact endgame where the harness grades. The counter is position state, so it
**joins `state_hash`**: two identical boards with different counters have different
legal futures.

Two alternatives were put up and rejected. A **hard ply cap** is simpler and
trivially terminating, but it is not a draughts rule — it truncates a legitimately
long fight into a draw the players did not earn, which is dishonest on a result
screen the shelf asks people to trust. **Repetition + no-progress** is closest to
how draughts is actually adjudicated and catches king shuffles faster, but it needs
position history in the state: a heavier hash, a bigger core, and more to get wrong
in wasm — for a case the no-progress counter already terminates.

---

## Verified Assumptions

**Codebase — read firsthand:**

- `crates/adversary-core/src/lib.rs:83-113` — the `Adversary` trait requires
  `Move: Copy + Serialize + DeserializeOwned + Eq`. A `{from, to, variant}` struct
  satisfies this; a `Vec`-based chain would **not** (`Copy`). Confirms option (D)
  and eliminates any chain-as-vector design.
- `crates/othello-core/src/game.rs:29-50` — the precedent for a custom
  `Serialize`/`Deserialize` that maps a `Move` to a single number, with an
  out-of-range code rejected at deserialize (`:45-48`). Checkers copies this shape.
- `crates/othello-core/src/game.rs:252-276` — `pond_outcome::Game::replay` skips
  moves not in `legal_moves`, so a tampered list diverges the hash and fails
  `verify`. Reused unchanged.
- `crates/drop4-solver/src/live.rs:256-277` and
  `crates/othello-solver/src/live.rs:77-98` — `select_in_band` is **identical**
  apart from the move type (`Col` vs `Move`). `LiveBand`
  (`drop4-solver/src/live.rs:208-215`, `othello-solver/src/live.rs:31-38`) is
  identical. Extraction target confirmed as `select_in_band` + `LiveBand`, generic
  over `M: Copy`.
- `crates/drop4-solver/src/live.rs:193` vs `crates/othello-solver/src/live.rs:22` —
  `capped_class` **differs** (Drop 4 classifies a horizon class; Othello returns a
  constant `0` because it is unsolved early). It stays per-game and is **not**
  extracted. Likewise `live_band(level)` (per-game tuning).
- `src/harness/match-runner.ts:14,22-25,51-53` — the rig's Drop-4 coupling is
  precisely: the `Drop4` type import, `Player.chooseMove(game: Drop4)`, and
  `EnginePlayer` calling `game.liveMove(level)`. `scorer.ts:13,92-110` couples via
  `Drop4`/`MoveQuality`/`SideCode` and `verifier.assess(col)`. `tournament.ts:12,
  44-49` couples via `Drop4`/`SideCode`. That is the whole surface to generalize.
- `src/harness/match-runner.ts:84,101` — `GreedyPlayer`'s `CENTRE_OUT` tie-break is
  Drop-4-specific and must become injectable (default: legal-move order).
- `src/games/othello/othello-wasm.ts:150-161` — `liveMove` returns
  `number | "pass" | null`, which is why Othello cannot plug into the current rig
  (`Player` returns `number | null`). The adapter normalizes it.
- `src/harness/hybrid-player.ts:14-21,50-55` — `buildBand` reads only
  `{col, value, quality}` plus the two Drop-4 one-ply booleans, filters
  `quality !== "blunder"`, sorts by value. Nothing about it is column-shaped, so it
  reuses **unchanged** for a packed move code.
- `tests/match-runner.test.ts:22-35` — the CI wasm shim (`readFile` + a `fetch`
  stub) is per-wasm-path and generalizes by parameterizing `WASM`.
- `crates/othello-solver/src/search.rs:19` — `TRACTABLE_EMPTIES = 10`, chosen
  conservatively for wasm rather than at the native breakpoint, with in-wasm
  wall-clock validation deferred to a later phase. Checkers copies this discipline
  (Phase 0 D3) instead of repeating the deferral.
- `crates/othello-solver/src/search.rs:141-152,181-201` — the exact endgame is
  cross-checked against an **independent plain minimax**. Checkers reuses this test
  shape; it is the only thing that makes "exact" a claim rather than a hope.
- `build.mjs:16` (`GAME_PAGES`), `build.mjs:133-135` (per-game wasm copy),
  `tools/build-wasm.sh` (`-p <game>-wasm`), `src/registry.ts`,
  `src/how-to-registry.ts`, `tools/guide-shots.mjs:34+` (`SHOTS`) — the six places
  a new game must be registered. All read; none are auto-discovered.
- `Cargo.toml:14-48` — workspace `members` is explicit; a new crate must be added
  there. `[workspace.dependencies]:71-81` lists internal crates by path.
- `package.json:7-20` — `preunit` runs `build:wasm` before `unit`, so any wasm a
  vitest test loads must be in `tools/build-wasm.sh`'s `-p` list or CI fails.

**Added in Pass 3 — read firsthand:**

- **The two games' `Level` unions are not the same type.** `drop4-wasm.ts:69` is
  `"Easy" | "Medium" | "Hard" | "Perfect"`; `othello-wasm.ts:68` is
  `"Easy" | "Medium" | "Hard" | "Expert"`. Two consequences the plan previously
  glossed: (1) `Drop4` is **not** structurally assignable to a `GameOracle` whose
  `liveMove` takes a numeric level code, which is what makes the Phase 2 seam work
  the way Pass 3 rules below; (2) the port needs an explicit level vocabulary, and
  "Expert" in Phases 3/15 means *each game's top level*, which for Drop 4 is
  `Perfect`. Pinned in Phase 1's doc comment and tested there.
- **CI runs no Rust gate at all.** `.github/workflows/deploy.yml` runs `build:wasm`,
  `typecheck`, `lint`, `unit`, `build` — there is no `cargo test`, no
  `cargo clippy`, no `cargo fmt --check` anywhere in CI, and `npm run test`
  (`package.json:19`) is `typecheck && lint && unit && build`. So the per-phase
  `cargo …` commands in this plan are the **only** thing standing between a Rust
  regression and `main`. Every Rust phase's Verification is widened accordingly
  (Pass 3), because `fun/CLAUDE.md` mandates `clippy::pedantic` + `cargo fmt
  --check` clean and nothing automated enforces it.
- `crates/othello-core/src/lib.rs:12` / `crates/othello-solver/src/lib.rs:12` —
  crate-level `#![warn(missing_docs)]` with a prose `//!` header describing the
  crate's role. There is **no** `[lints]` table in `Cargo.toml` and no
  `clippy::pedantic` attribute; the discipline is per-crate and by hand. The three
  new checkers crates copy the same header shape.
- `src/harness/match-runner.ts:169-176` — the two abort causes (`chooseMove`
  returned `null`; `play` was rejected) collapse into one `aborted: boolean`, and
  `tournament.ts:32-37`'s `Report` carries **no abort count at all**. A tournament
  in which every match aborted on move one renders a perfectly well-formed report
  (`W-D-L 0-0-0`, `graded moves 0`). This is the observability gap Phase 2c closes.
- `src/harness/hybrid-player.ts:33-35,122` — `HybridDecision.source` already
  distinguishes `"llm"` from `"fallback"`, but `match-runner.ts:140-148`
  (`HybridAiPlayer.chooseMove`) returns `decision.move` and **discards `source`**.
  A hybrid that falls back on every move is indistinguishable from one that never
  does. Recorded as a tracked follow-on, not fixed here (see Open Questions).

**English draughts rules — verified against sources, not memory:**

- **Square numbering:** all 32 dark squares numbered 1–32, starting in Black's
  double-corner; Black's first rank is 1–4, next 5–8, and so on. Each side starts
  with 12 men on the three rows nearest them (so Black 1–12, White 21–32).
  — [Wikipedia: English draughts](https://en.wikipedia.org/wiki/English_draughts)
- **First move:** the player with the darker pieces moves first → maps to
  `Side::A`. — Wikipedia (same).
- **Capture is mandatory**, but the *maximum* capture is **not** required: "if a
  player has the option to jump, they must take it"; with several available "the
  player can choose which piece to jump with, and which sequence of jumps to
  make … however, a player must make all available jumps in the sequence chosen."
  — Wikipedia (same); corroborated by
  [draughts.org](https://draughts.org/the-rules-of-draughts) ("captures are still
  mandatory, but players are not required to choose the sequence that captures the
  most pieces") and
  [checkercruncher.com](https://www.checkercruncher.com/rules) ("If there are
  multiple capturing paths available you may choose any path but you must follow
  that path to the end").
- **Crowning terminates the move:** "If a man moves into the kings row or if it
  jumps into the kings row, the current move terminates; the piece is crowned as a
  king but cannot jump back out as in a multi-jump until the next move."
  — Wikipedia (same); corroborated by checkercruncher.com ("Promotion ends your
  turn").
- **Kings are not flying:** kings move and jump in any diagonal direction, one
  square at a time. — Wikipedia (same); draughts.org ("kings can only move one
  square at a time and are limited to capturing just one piece per move" [per
  jump]).
- **Win:** capture all the opponent's pieces, or leave the opponent with no legal
  move. **Draw:** "if neither side can force a win, or by agreement" — **no
  move-count rule is specified**. — Wikipedia (same). This is the gap that forces
  the Open Question on an explicit draw rule.
- **Move notation:** `11-15` is a simple move; `11x18` is a capture landing on 18;
  `11x25` captures on 15 and 22 and lands on 25. — checkercruncher.com. Adopted for
  `move_to_text` / `parse_move` (the LLM text bridge).

**Not verified — deliberately deferred to Phase 0 probes:**

- The maximum jump-chain length and the maximum number of distinct chains sharing
  an `(from, to)` pair in real play → **D2** (decides the `variant` bit width).
- The piece count at which an exact endgame solve fits a tap budget **in wasm** →
  **D3**.
- Whether any shelf wrapper method the `GameOracle` port needs is missing from
  Drop 4 or Othello → **D1c**.

---

## Documentation Impact

Every file whose content or cross-references this plan makes stale, and the phase
that fixes it. Scheduled in the phase that breaks it — not a trailing docs phase.

- `docs/HARNESS.md` — the whole doc is framed as Drop-4-specific ("grades the
  shipped browser players … over the shipped `drop4-wasm`"; the `Player`
  vocabulary section names `Drop4.liveMove`). Rewritten to the `GameOracle` port
  in **Phase 3**, and the checkers trial added in **Phase 15**.
- `TODO/harness.md` — "Generalize the rig to an injected game/oracle adapter" moves
  from Open threads to Done in **Phase 3**.
- `docs/BUILDING-GAMES.md` §10 — three stale claims: (a) "today it grades via
  `drop4-wasm`; generalizing it … is the tracked follow-on" (`:532-534`), fixed in
  **Phase 3** — *and listed in Phase 3's own Changes/write-set (Pass 3 fix: it was
  scheduled here but missing from the phase)*; (b) "Duplicate the ~30-line band
  selector into your solver until a **third** game exists (rule of three), then
  extract a shared `adversary-solver`" (`:544`) — *Pass 3 moved this from Phase 6
  to* **Phase 8**: Phase 6 creates the crate but **both duplicates still exist**,
  so the instruction only becomes false at Phase 8, which is also where the
  `grep "fn select_in_band" → 1 hit` gate lives; (c) "**Drop 4** is the reference
  implementation, and **Othello** is the second" (`:433-435`), extended with
  checkers in **Phase 17**.
- `docs/AI-PLAYERS.md` — two separate edits, at two different phases (Pass 3 split
  what was one line): (a) `:280-283` "`src/harness/` mirrors the rig over the
  browser substrate — the shipped `drop4-wasm` + the TS players" goes stale the
  moment the rig is game-agnostic → **Phase 3**; (b) the generality section
  ("a second game (Othello)") becomes a third-game note and the anticipated chess
  Oracle shape gains a real precedent → **Phase 17**. (`:140`, `:183` are genuine
  Drop-4 examples describing the Drop 4 implementation — verified in Pass 3's D5
  sweep as **not** stale; they stay.)
- `TODO/othello.md` — "Extract a shared `adversary-solver` crate once a third
  adversarial game lands" → Done. **Phase 8**.
- `TODO/drop4.md` — the checkers/chess "Later" list; the shared `adversary-solver`
  thread → Done. **Phase 7**.
- `TODO/checkers.md` — rewritten from a scoping note into the running checkbox
  worklist (the Othello pattern), pointing at this plan. **Phase 17**.
- `TODO/README.md` — checkers moves from "Next games (proposed)" to "Shipped —
  Tier-1"; the two cross-game threads it closes are struck. **Phase 17**.
- `README.md` — the game list / shelf inventory gains checkers. **Phase 17**.
- `fun/CLAUDE.md` — "Drop 4 (`/drop4/`) is the shelf's first two-player game";
  the §10 pointer stays valid but the adversarial roster line is extended.
  **Phase 17**.
- **Registration points** (not docs, but the same "stale reference" failure mode,
  all in **Phase 13** except the crate list): `src/registry.ts`,
  `src/how-to-registry.ts` (Phase 16), `build.mjs` `GAME_PAGES` + the wasm copy
  block, `tools/build-wasm.sh` `-p` list, `tools/guide-shots.mjs` `SHOTS`
  (Phase 16), `Cargo.toml` `members` (Phases 4/6/9/11).

**Grep evidence (re-run in Pass 3 — this *is* Phase 0's D5, resolved during
planning):**

`grep -rn "drop4-wasm\|drop4_wasm" docs/ TODO/ src/harness/ README.md CLAUDE.md`
→ `docs/HARNESS.md:4,64`; `docs/AI-PLAYERS.md:140,183,282`;
`docs/BUILDING-GAMES.md:533`; `TODO/harness.md:17`; `TODO/drop4.md:21,23,107`;
`src/harness/{match-runner:2,14, scorer:13, tournament:12, harness-trial-entry:9}.ts`.

`grep -rn "rule of three\|adversary-solver" docs/ TODO/ README.md CLAUDE.md`
→ `docs/BUILDING-GAMES.md:544`; `TODO/othello.md:33-34`;
`TODO/README.md:22,35,42,46,74`; `TODO/checkers.md:4,12`;
`TODO/harness.md:18,20,23`; `TODO/drop4.md:165`.

All covered above, with two amendments Pass 3's sweep forced: `docs/AI-PLAYERS.md`
was under-scoped (`:282` is a harness claim, not a Drop 4 example — now Phase 3),
and `TODO/drop4.md:21,23,107` are **historical done-item records** describing what
Drop 4 shipped, which stay true and are deliberately not touched (`TODO/drop4.md`
is still edited in Phase 7 for `:165`'s shared-selector thread). `README.md` and
`CLAUDE.md` have no hits for either pattern — their Phase 17 edits are inventory
lines, not stale cross-references.

---

## Concurrency Map

```
Sequential spine:
  Phase 0
  → [A] 1 → 2a → 2b → 2c → 3
  → [B] 4 → 5 → 6 → 7 → 8 → 9 → 10
  → [C] 11 → 12 → 13 → 14 → 15 → 16 → 17
```

**All phases sequential.** Reasons, per boundary:

- **Within Part A:** Phases 2a/2b rewrite the modules Phase 1 introduces the port
  for, and 2b reads the seam 2a leaves; 2c adds the abort field 3's gate asserts on;
  Phase 3 grades through the rig 2a–2c migrated. Each reads what the prior wrote.
- **Part B is a dependency chain:** the extraction (6) needs `checkers_core::Move`
  (4) to design the generic signature against three types; the migrations (7, 8)
  need the extracted crate; `checkers-solver` (9, 10) needs both.
- **Part C is a build chain:** wasm (11) → TS wrapper (12) → wired page (13) → AI
  layer (14) → harness adapter (15) → guide shots (16, which need a *running* page
  to screenshot) → docs (17, which describe what landed).

**Named near-miss — Phases 7 and 8 (the Drop 4 and Othello migrations).** These
look parallel-safe: disjoint file write-sets (`crates/drop4-solver/src/live.rs` +
its `Cargo.toml` vs `crates/othello-solver/src/live.rs` + its `Cargo.toml`), no
shared module. They are **still sequential**, because both add a dependency on
`adversary-solver` and therefore both write **`Cargo.lock`** — a shared write-set
entry. Per the hard rule, any shared write-set entry forces sequential. Recording
the near-miss rather than the conclusion alone, so a future reader does not
re-derive it.

**Second named near-miss (Pass 3) — Part A (1–3) alongside Phases 4–5.** This is
the plan's most tempting parallel split and the only one worth re-examining: Part A
writes `src/harness/**`, `src/games/{drop4,othello}/*-oracle.ts`, `tests/*.ts` and
two docs; Phases 4–5 write `crates/checkers-core/**` and `Cargo.toml`/`Cargo.lock`.
On files alone they are disjoint, and rejoining at Phase 6 (which depends on 4)
would work.

They are **still sequential**, because the isolation leaks through ambient build
state, not through the write-sets: Part A's every test run goes through `preunit`
→ `npm run build:wasm` → `cargo build -p <game>-wasm`, which **reads the workspace
`Cargo.toml` and writes `Cargo.lock`** — the exact two files Phase 4 mutates when it
registers `crates/checkers-core` as a member. A half-written member manifest breaks
workspace resolution and therefore breaks *Part A's* test command, in a way that
looks like a Part A failure. Cargo also takes an exclusive file lock on `target/`,
so concurrent `cargo` invocations serialize anyway and the wall-clock win is
smaller than it looks. Recorded rather than left for a future reader to re-derive
and re-reject. (This is the "files-only isolation leaks through ambient state" case
the concurrency rule warns about, and it is worth having a concrete instance of it
written down.)

**Shared-state note applying to every phase:** all phases run in the main worktree
on one feature branch. None invokes `git checkout`/`stash`/`rebase`, none binds a
port except Phases 13/16 (the Playwright/e2e server, which is started and stopped
within the phase), and none writes outside the repo except `target/` and `dist/`
(both git-ignored build outputs). No phase is dispatched to a subagent, so no
re-entry verification is required.

---

## Phases

> **Execution note.** Commit at every green phase (`fun/CLAUDE.md`). The co-author
> trailer in that file names a stale model; use the model actually doing the work.

### Phase 0: Discovery

**Goal:** Resolve the four unknowns that would cause multiplicative rework if wrong
— the move encoding's bit budget, the exact-endgame threshold, the `GameOracle`
surface, and the draw rule's shape.

**Discovery tasks:**

- [x] **D1: Does a `GameOracle` over `number` cover Drop 4 *and* Othello with no
      method left behind?** — **RESOLVED 2026-08-04. Answer: yes.** The table below
      is the deliverable; it lifts verbatim into Phase 1's `GameOracle` doc comment.

  | # | called by the rig | Drop 4 | Othello | verdict |
  |---|---|---|---|---|
  | 1 | `newGame(seed: bigint)` | ✓ | ✓ | identical |
  | 2 | `board() → {toMove, result}` | ✓ | ✓ | identical (the port needs only these two fields of `BoardView`) |
  | 3 | `play(code) → MoveStatus` | ✓ `play(col)` | ✓ `play(idx)` | **differs** — adapter routes `play(64)` → `pass()` |
  | 4 | `pass() → MoveStatus` | ✗ absent | ✓ present | **differs** — Othello-only; absorbed into `play` by the adapter, **not** on the port |
  | 5 | `currentHash() → string` | ✓ | ✓ | identical |
  | 6 | `legalMoves() → number[]` | ✓ | ✓ | identical (Othello returns placements only, so a forced-pass position yields `[]`) |
  | 7 | `liveMove(level)` | `number \| null`; `Level = …\|"Perfect"` | `number \| "pass" \| null`; `Level = …\|"Expert"` | **differs twice** — return sentinel *and* level union; port takes `0..3`, adapter maps both |
  | 8 | `assess(code) → MoveAssessment \| null` | ✓ | ✓ **superset** (adds `takesCorner`) | identical for the port's needs |
  | 9 | `tutor() → {moves, bestCol, exact}` | ✓ | ✓ | identical |
  | 10 | `renderText() → string` | ✓ | ✓ | identical |

  **No row reads "missing, needs a new wasm export"** — D1's success criterion is
  met. Two further findings:
  - `oracleBest`, `oracleMoveValues`, `markAssistance` and `outcome` exist on both
    wrappers but **the rig never calls them**, so they stay off the port. Keeping
    `GameOracle` to the ten rows above is what makes a third adapter cheap.
  - **`GreedyPlayer` works over Othello unchanged.** It reads
    `assess().immediateWin` / `.blocksOpponentWin` (`match-runner.ts:96-100`), and
    Othello's `MoveAssessment` (`othello-wasm.ts:41-51`) is a structural superset of
    Drop 4's (`drop4-wasm.ts:37-52`) carrying both. Only its `CENTRE_OUT` tie-break
    is Drop-4-shaped, which is exactly what Phase 2a makes injectable.
  - *Original probe, for the record:* tabulate every method `match-runner.ts`,
    `scorer.ts` and `tournament.ts` call on their game object, then check each
    against both wrappers.
  - **Success criteria:** A written method-by-method table where every row is
    either "identical on both" or "differs, adapter normalizes it — here is how".
    No row reading "missing, needs a new wasm export".
  - **Two rows are pre-filled by Pass 3** (found while spot-checking; the probe
    confirms the rest): `liveMove` — Drop 4 returns `number | null`, Othello
    `number | "pass" | null`; **and its `Level` argument is a different string
    union per game** (`…| "Perfect"` vs `…| "Expert"`, `drop4-wasm.ts:69` /
    `othello-wasm.ts:68`). The port therefore takes a **numeric level code**
    `0..3` = Easy/Medium/Hard/Top, and each adapter maps it to its own union.
    D1 must decide and record what the port *calls* the top level, because
    "Expert" is Othello's word, "Perfect" is Drop 4's, and Phases 3/15 both say
    "Expert-vs-Expert" meaning *each game's top level*.
  - **Disposition:** `keep-as-fixture` — the table becomes the doc comment on
    `GameOracle` and the basis for `docs/HARNESS.md`'s rewrite.

- [ ] **D2: How many bits does the jump-chain `variant` field actually need?**
  - **Probe:** A throwaway Rust spike (a `#[test]` in a scratch module, or a
    `examples/` binary) that generates English-draughts positions by random legal
    play over ≥10k games, and for every position records (a) the maximum number of
    landing squares in any legal chain, and (b) the maximum number of **distinct
    legal chains sharing the same `(from, to)` pair**. Include king-heavy endgames
    explicitly — random play from the opening under-samples them, so also seed
    positions with 2–4 kings per side.
  - **Success criteria:** Concrete maxima, e.g. "max chain 9 landings; max chains
    per `(from,to)` = 3 → 2 bits suffice, 4 allocated". If the observed variant
    count exceeds 15, the encoding changes (widen to `u32`, or fall back to option
    (B)) and Phase 4 is re-planned before it starts.
  - **Disposition:** `throwaway` — the numbers go into Verified Assumptions; the
    spike is deleted. The *generator* may be promoted to a Phase 4 test helper if
    it proves useful (record the decision if so).

- [ ] **D3: At what piece count does an exact endgame solve fit a tap budget in
      wasm?**
  - **Probe:** Measure the alpha-beta full-solve wall clock at N total pieces for
    N = 4, 6, 8, 10, first natively (`cargo test --release`) and then **in the
    browser** through a scratch wasm export — the Othello D2 lesson is that native
    timings mislead. Use a real phone-class budget as the bar.
  - **Success criteria:** A chosen `TRACTABLE_PIECES` constant with the measured
    in-wasm ms at that threshold recorded, set **below** the native breakpoint.
  - **Disposition:** `throwaway` (the scratch export is removed; the constant and
    its measurement land in `checkers-solver`).

- [ ] **D4: Build the draw-rule fixture.** *(The rule itself is decided — 40 moves
      per side with no capture and no man advanced, counter in the hash. This task
      is confirmation, not a choice.)*
  - **Probe:** Construct a concrete position and move sequence that reaches the
    no-progress threshold (a king shuffle in a locked endgame is the natural
    shape), and one that resets the counter just short of it. Confirm the counter
    genuinely changes the legal future — i.e. that two boards identical except for
    the counter are not interchangeable — which is the justification for putting it
    in `state_hash`.
  - **Success criteria:** A fixture that reaches `Draw` at exactly the threshold
    and not before, plus a reset case, both expressible as a move list.
  - **Disposition:** `keep-as-fixture` — both become Phase 5 tests.

- [x] **D5: Documentation-reference sweep.** — **RESOLVED DURING PASS 3, not
      deferred to execution.** Both greps were re-run against the working tree
      (output recorded verbatim under Documentation Impact § Grep evidence) and the
      section amended: `docs/AI-PLAYERS.md:282` was under-scoped (a harness claim
      that goes stale at Phase 3, not a Drop 4 example) and
      `docs/BUILDING-GAMES.md:544`'s fix moved from Phase 6 to Phase 8.
      **Disposition:** `throwaway` — nothing left to run. *Re-run the two greps at
      Phase 17 only as the closing gate, which that phase already specifies.*

**Outputs fed back into the plan:** Verified Assumptions updated with D2/D3/D4
findings; Phase 4's encoding confirmed or re-planned; Review Log entry describing
any change.

**Recording discipline (Pass 3):** D2 and D3 produce *constants that later phases
depend on* (`variant` bit width; `TRACTABLE_PIECES`). Write each into Verified
Assumptions **with its measurement and the machine/browser it was measured on** —
not just the chosen value. Phase 11 explicitly anticipates contradicting D3's number
in wasm; diagnosing that contradiction against a recorded measurement is a minute's
work, against a remembered one it is a re-run of the whole probe.

**Done when:** D2, D3 and D4 have recorded findings (**D1 and D5 are closed** —
resolved during planning, see their entries), and the `variant` bit width is
confirmed by measurement rather than assumption.

**Remaining work is the three probes that need code to run:** D2 (a throwaway
draughts move generator to count chain variants), D3 (in-wasm endgame timing), D4
(the draw-rule fixture). D1 and D5 needed only reading and grepping, which is why
they were closable without execution.

**Read-set:** `src/harness/*.ts`, `src/games/{drop4,othello}/*-wasm.ts`,
`crates/othello-solver/src/search.rs`, `docs/`, `TODO/`.
**Write-set:** this plan file only (plus throwaway spikes under `target/`/scratch,
deleted at phase end).
**Shared-state contract:** No shared mutable state beyond the plan file. The wasm
probe in D3 writes only `target/` (git-ignored) and a scratch export that is
reverted before the phase ends — verify with `git status` clean apart from the plan.
**Risks:** D2's random play may under-sample king endgames and under-report the
variant count — explicitly mitigated by seeding king-heavy positions.
**Validation:** Discovery Exemption applies (no TDD, no wiring test). Findings must
be concrete values, not "it seems fine".

---

### Part A — Generalize the harness (independent of checkers)

### Phase 1: The `GameOracle` port + the Drop 4 adapter

**Goal:** A game-agnostic port the rig can drive, proven against the shipped Drop 4
wrapper.

**Changes:**
- [ ] `src/harness/game-oracle.ts` (new) — `GameOracle`, `OracleBoard`,
      `OracleAssessment`, and the shared `SideCode` / `MoveQuality` / `MoveStatus`
      types, moved here from the Drop 4 wrapper's export surface. Doc comment
      records D1's method table and states **two** contracts: (i) the move-code
      contract — *a move is the game's compact numeric wire code* (Drop 4 column;
      Othello `0..63` place / `64` pass; checkers packed `(from,to,variant)`); and
      (ii) the **level contract** — `liveMove(level: number)` takes `0..3`
      (Easy/Medium/Hard/Top), because the two games' `Level` unions differ in their
      top member (`"Perfect"` vs `"Expert"`, see Verified Assumptions). The port
      owns the numeric scale; the adapter owns the game's word for it.
- [ ] `src/games/drop4/drop4-oracle.ts` (new) — `drop4Oracle(d: Drop4): GameOracle`.
      Near-identity **except** the level mapping (`3 → "Perfect"`); exists so the
      coupling lives in the game's directory, per the game-isolation rule.
- [ ] `tests/game-oracle.test.ts` (new) — RED first, naming these behaviors:
      over the **real** `drop4.wasm`, the adapter plays a legal move; reports
      `toMove`/`result`; `assess` returns `{quality, exact}`; `liveMove` returns a
      legal code mid-game and `null` at a terminal position; and **each of the four
      level codes `0,1,2,3` returns a legal move, with `3` mapping to Drop 4's
      `"Perfect"`** — the boundary cases that a mutation collapsing the level map to
      a single constant would otherwise survive.

**Call chain:** `tests/game-oracle.test.ts` → `drop4Oracle(await Drop4.load())` →
`GameOracle` methods → the real `drop4_wasm` exports.
**Wiring test:** `tests/game-oracle.test.ts` — the adapter drives a real wasm game
to a terminal result through the port surface **only** (no direct `Drop4` calls
after construction). RED at phase start (the file and port do not exist).
**Depends on:** Phase 0 (D1).
**Read-set:** `src/games/drop4/drop4-wasm.ts`, `src/harness/match-runner.ts`.
**Write-set:** `src/harness/game-oracle.ts`, `src/games/drop4/drop4-oracle.ts`,
`tests/game-oracle.test.ts`.
**Shared-state contract:** No shared mutable state beyond the file write-set. The
test loads wasm via the existing `globalThis.fetch` shim and restores it in a
`finally` (the established pattern, `tests/match-runner.test.ts:26-34`) — so it
does not leak a stubbed `fetch` into sibling tests.
**Risks:** The port over-fits Drop 4 because Drop 4 is its only consumer here.
Mitigated by writing the doc comment from D1's **two-wrapper** table, and by
Phase 3 being the real proof. The level scale is the concrete instance: designed
here against a game whose top level is *actually perfect play*, consumed in Phase 3
by one where it is not.
**Done when:**
1. **Behavioral:** A `GameOracle` built from the shipped Drop 4 wrapper can play a
   complete game and report per-move oracle verdicts, without any caller naming the
   `Drop4` type.
2. **Verification:** `npm run unit -- tests/game-oracle.test.ts` green, and
   `npm run typecheck` green.
**Validation:** Narrow. Wiring test + unit tests are sufficient — no behaviour
changes for any user; the shipped rig is untouched this phase.

---

> **Pass 3 ruling — the 4-file exception is rejected; Phase 2 splits into 2a/2b.**
> Pass 2 claimed the migration was atomic because "`tournament.ts` imports
> `scorer.ts`'s types which import `match-runner.ts`'s — splitting it leaves
> `npm run typecheck` **red** between phases." Pass 3 checked the import graph
> (`tournament.ts:12-14`, `scorer.ts:13-14`, `match-runner.ts:14-15`) and the
> justification **does not hold**: Phase 1 already builds `drop4Oracle(...)`, which
> is precisely the seam that keeps each half green. `tournament.ts` can wrap its
> `Drop4` at the two `runMatch` call sites while `scorer.ts` still takes a `Drop4`,
> because `gradeSide` is passed a separate verifier instance.
>
> (What *is* true, and is why the split needed checking rather than assuming: the
> two games' `Level` unions differ, so `Drop4` is **not** structurally assignable to
> a `GameOracle` with a numeric `liveMove` level. Without the Phase 1 adapter as an
> explicit seam, the big-bang migration really would have been forced.)
>
> Counting convention this plan uses, made explicit here: **the 4-file rule counts
> production files; a phase's own test files travel with the code they test.** TDD
> makes deferring them impossible, and Phase 1 already relies on this reading.
> Under it, 2a and 2b are 2 production files each.

### Phase 2a: `match-runner` speaks `GameOracle`

**Goal:** The match driver and the players stop naming `Drop4`.

**Changes:**
- [ ] `src/harness/match-runner.ts` — `Player.chooseMove(game: GameOracle)`;
      `EnginePlayer` calls `game.liveMove(levelCode)` (the numeric scale Phase 1
      pinned); `GreedyPlayer` takes an optional `preference?: readonly number[]`
      tie-break (Drop 4's `CENTRE_OUT` becomes a caller-supplied argument, not a
      constant in shared code); `HybridPromptBuilder` is typed over `GameOracle`.
- [ ] `src/harness/tournament.ts` — **seam only**: wrap with `drop4Oracle(...)` at
      the `runMatch` call site (`:58`). Its own signature is unchanged this phase.
- [ ] `tests/match-runner.test.ts` — construct through `drop4Oracle(...)`.

**RED first — `GreedyPlayer`'s `preference` is a new behavior, not a type change.**
This is the one genuinely behavioral edit in the migration and Pass 2 filed it under
"type-level only". It gets its own failing test before implementation, naming both
branches and the fallthrough: **with no `preference`, the player picks in
legal-move order; with a `preference`, it picks the first preferred column that is
legal; when no preferred column is legal, it falls back to legal-move order.**
A single "centre-out still works" assertion would survive a mutation that ignores
`preference` entirely, because `CENTRE_OUT[0]` is often legal anyway.

**Call chain:** `tests/match-runner.test.ts` → `runMatch(drop4Oracle(await
Drop4.load()), …)` → `Player.chooseMove(GameOracle)` → the real `drop4_wasm`.
**Wiring test:** the **existing** `tests/match-runner.test.ts` real-wasm match must
stay green while now running entirely through the port — plus the new `preference`
cases above.
**Depends on:** Phase 1.
**Read-set:** `src/harness/game-oracle.ts`, `src/games/drop4/drop4-oracle.ts`.
**Write-set:** `src/harness/{match-runner,tournament}.ts`,
`tests/match-runner.test.ts`.
**Shared-state contract:** No shared mutable state beyond the file write-set; same
`fetch`-shim restore-in-`finally` discipline as Phase 1.
**Risks:** A silent behaviour change smuggled in with a type change — concentrated
entirely in `GreedyPlayer`'s tie-break, which is why it is the one thing given an
explicit RED test rather than left to the regression net.
**Done when:**
1. **Behavioral:** A match runs end to end with no `Drop4` type named in
   `match-runner.ts`, and `GreedyPlayer`'s tie-break is caller-supplied.
2. **Verification:** `npm run unit -- tests/match-runner.test.ts` green,
   `npm run typecheck` green, `npm run lint` green.
**Validation:** Narrow. Wiring test + unit tests are sufficient — no user-visible
behaviour changes and the seam keeps the rest of the rig on its old types.

---

### Phase 2b: `scorer` + `tournament` speak `GameOracle`

**Goal:** The rig no longer knows what game it is grading; the 2a seam is removed.

**Changes:**
- [ ] `src/harness/scorer.ts` — `gradeSide(record, verifier: GameOracle, side)`;
      `MoveQuality`/`SideCode` sourced from `game-oracle.ts` instead of
      `drop4-wasm.ts`.
- [ ] `src/harness/tournament.ts` — `gameFactory: () => Promise<GameOracle>`; the
      2a `drop4Oracle(...)` wrap moves out to the callers.
- [ ] `tests/{scorer,tournament}.test.ts` — construct through `drop4Oracle(...)`;
      assertions unchanged (they are the regression net).

**Call chain:** `tests/tournament.test.ts` → `runTournament(() =>
drop4Oracle(await Drop4.load()), …)` → `runMatch` → `gradeSide(record, GameOracle,
side)`.
**Wiring test:** the **existing** `tests/tournament.test.ts` "engine-vs-engine
aggregates a consistent Report with a zero-blunder class floor" — it must stay green
through the migration while now running entirely through the port. Its
`blunders === 0` assertion is the load-bearing invariant, and `scoredMoves > 0`
must be asserted alongside it so the invariant cannot pass vacuously.
**Depends on:** Phase 2a.
**Read-set:** `src/harness/{game-oracle,match-runner}.ts`,
`src/games/drop4/drop4-oracle.ts`.
**Write-set:** `src/harness/{scorer,tournament}.ts`,
`tests/{scorer,tournament}.test.ts`.
**Shared-state contract:** No shared mutable state beyond the file write-set; same
`fetch`-shim discipline.
**Risks:** `scorer.ts` is the **pure** half of the hexagonal split; sourcing its
types from the port must not drag any imperative concern (wasm loading, match
lifecycle) into it. If a change here needs an `await`, the split has been violated.
**Done when:**
1. **Behavioral:** The whole rig runs against a `GameOracle`; `grep -rn "drop4"
   src/harness/` returns nothing but the trial entry point (Phase 3 handles that).
2. **Verification:** `npm run unit` green (all three harness suites), `npm run
   typecheck` green, `npm run lint` green.
**Validation:** Moderate. Tests + the grep gate above + a manual `npm run
harness:trial` smoke run to confirm the real Drop 4 trial still produces a sane
Report (a type migration that passes CI can still break the standalone driver,
which CI does not exercise).

---

### Phase 2c: Abort observability

**Goal:** A tournament that grades nothing says so. **Added in Pass 3.**

**Why this phase exists.** `runMatch` collapses two distinct failures into one
boolean (`match-runner.ts:169-176`: `chooseMove` returned `null` vs `play` was
rejected), and `Report` (`tournament.ts:32-37`) carries **no abort count at all**.
A tournament in which every match aborted on move one renders a perfectly
well-formed report — `W-D-L 0-0-0`, `graded moves 0` — with nothing distinguishing
it from a legitimately short run. That is tolerable while the rig grades one game
whose only abort mode is a bug; it is not tolerable from Phase 3 on, where Othello's
forced pass introduces a *second, expected-shaped* way to abort and checkers will
add a third (a packed move code that fails to round-trip). This is the same honesty
argument that already put `scoredMoves`/`skippedEarly` next to `blunders` in
`renderReport` — applied one level up, to the games denominator.

**Changes:**
- [ ] `src/harness/match-runner.ts` — `MatchRecord.abortReason:
      "none" | "nullMove" | "rejectedMove"`, set at the two `break` sites.
      `aborted` stays (it is `abortReason !== "none"`) so no caller breaks.
- [ ] `src/harness/tournament.ts` — `Report.abortedGames: number` counted from the
      records `runTournament` already holds (`:58-64`), and one `renderReport` line
      **adjacent to the games count**, in the established format.
- [ ] `tests/tournament.test.ts` — RED first.

**Deliberately not in `scorer.ts`.** An abort is a match-lifecycle fact, not a
per-move grading fact. Threading it through the pure `Scorecard` fold would grow the
pure half with a concern it does not need, and would also make this a 3-production-
file phase for no gain.

**Test specification (RED first, naming the edges):** a player that returns `null`
on its first turn produces `abortReason === "nullMove"` and `abortedGames === 1`;
a player that returns a *legal-looking but rejected* code produces
`"rejectedMove"`; a clean engine-vs-engine tournament produces
`abortReason === "none"` on every record and `abortedGames === 0`; and
`renderReport` output **contains the abort count even when it is zero** (a line that
only appears on failure is a line nobody trusts is there).

**Call chain:** `tests/tournament.test.ts` → `runTournament` → `runMatch` →
`MatchRecord.abortReason` → `Report.abortedGames` → `renderReport`.
**Wiring test:** the `renderReport`-contains-the-count case above, driven from
`runTournament` over the real wasm — it proves the field survives the whole path
from the `break` site to the text a human reads, which is the only place it matters.
**Depends on:** Phase 2b.
**Read-set:** `src/harness/scorer.ts` (the `renderReport` format to match).
**Write-set:** `src/harness/{match-runner,tournament}.ts`,
`tests/tournament.test.ts`.
**Shared-state contract:** Additive only — no existing field changes type or
meaning, so no existing caller or test needs editing. If any existing assertion has
to change, that is a signal the change was not additive and should be re-scoped.
**Risks:** Scope creep into a general "match diagnostics" feature. The guard: three
string literals and one integer, nothing more. In particular, **do not** plumb
`HybridDecision.source` through here — it is a real gap (see Verified Assumptions
and the ADVISORY open question) but it belongs to the hybrid, not the runner, and
Phase 14 is where it would bite.
**Done when:**
1. **Behavioral:** Every `Report` states how many of its games finished, and every
   abort records which of the two causes it was.
2. **Verification:** `npm run unit` green, `npm run typecheck` green, `npm run
   lint` green.
**Validation:** Narrow. Tests are sufficient — the change is additive, and its own
wiring test exercises the full path to the rendered text.

---

### Phase 3: Othello plugs in — the harness's generality proof

**Goal:** The rig grades a **second** game, closing `TODO/harness.md`'s top thread.

**Changes:**
- [ ] `src/games/othello/othello-oracle.ts` (new) — normalizes `liveMove`'s
      `"pass"` → `PASS_CODE` (64) and routes `play(64)` → `pass()`, reusing the
      constant already exported by `othello-outcome.ts`.
- [ ] `tests/othello-harness.test.ts` (new) — RED first: an Othello top-level
      (`liveMove(3)` → Othello's `"Expert"`) self-play tournament over the real
      `othello.wasm` produces a consistent Report with **three** assertions, each
      guarding a different way this can pass vacuously: `blunders === 0` (the class
      floor holds for a second game), `scoredMoves > 0` (the exact endgame is
      actually reached, so the floor is not vacuous), and `abortedGames === 0`
      (Phase 2c's counter — the games actually finished).
- [ ] `src/harness/harness-trial-entry.ts` + `tools/harness-trial.mjs` — a game
      parameter (`HARNESS_TRIAL_GAME=drop4|othello`), defaulting to `drop4` so the
      existing invocation is unchanged.
- [ ] `docs/HARNESS.md` + `TODO/harness.md` — rewritten from Drop-4-specific to the
      `GameOracle` port; the open thread moves to Done.
- [ ] `docs/BUILDING-GAMES.md:532-534` — strike "today it grades via `drop4-wasm`;
      generalizing it … is the tracked follow-on"; `docs/AI-PLAYERS.md:280-283` —
      strike "mirrors the rig over the browser substrate — the shipped `drop4-wasm`
      + the TS players". *Both scheduled here by Documentation Impact but missing
      from this phase's list until Pass 3; they are the two claims this phase makes
      false, so they are fixed in the phase that breaks them.*

**Call chain:** `tests/othello-harness.test.ts` → `runTournament(() =>
othelloOracle(await Othello.load()), EnginePlayer, EnginePlayer)` → the shared rig
→ `othello_wasm` exports.
**Wiring test:** `tests/othello-harness.test.ts` — a game the rig has **never**
graded before, graded end-to-end with no change to `match-runner`/`scorer`/
`tournament`. This is the phase's whole point: if it needs a rig edit, the port is
wrong.
**Depends on:** Phase 2c.
**Read-set:** `src/games/othello/{othello-wasm,othello-outcome}.ts`,
`src/harness/*.ts`.
**Write-set:** `src/games/othello/othello-oracle.ts`, `tests/othello-harness.test.ts`,
`src/harness/harness-trial-entry.ts`, `tools/harness-trial.mjs`, `docs/HARNESS.md`,
`TODO/harness.md`, `docs/BUILDING-GAMES.md`, `docs/AI-PLAYERS.md`.
**Shared-state contract:** No shared mutable state beyond the write-set. The new
test loads `othello.wasm`, already in `tools/build-wasm.sh`'s `-p` list, so
`preunit` provides it — no build-script change needed (verified:
`tools/build-wasm.sh` includes `-p othello-wasm`).
**Risks:** Othello's forced pass could surface as a `null` move and **abort** the
match (`match-runner.ts:169-172`) instead of playing on. This is the single most
likely failure and the adapter's main job — the test must assert that a match
containing a forced pass reaches a terminal result with `aborted === false`, **and**
that the tournament's `abortedGames === 0` (Phase 2c). The per-match assertion alone
is not enough: forced passes are position-dependent, so a single seeded match may
never hit one while a later game in the same tournament does. The aggregate counter
is what makes the assertion hold across every game played.
**Done when:**
1. **Behavioral:** `HARNESS_TRIAL_GAME=othello npm run harness:trial` produces a
   real Othello Report, and CI grades an Othello tournament.
2. **Verification:** `npm run unit -- tests/othello-harness.test.ts` green, plus
   the full `npm run unit` to confirm Drop 4 did not regress.
**Validation:** Broad. Tests + both trial invocations run for real + read the
emitted Reports and sanity-check the numbers (a Report can be well-formed and
still nonsense — e.g. `scoredMoves === 0` would mean nothing was actually graded,
and `abortedGames === games` would mean nothing was actually played). **Record the
Othello Report verbatim in `docs/HARNESS.md`** alongside the existing Drop 4 run —
Phase 7's validation compares against a recorded Report, so there has to be one.

---

### Part B — Checkers core, and the extraction

### Phase 4: `checkers-core` — board, move encoding, `Adversary`

**Goal:** The rules as code, with the jump-chain move encoding pinned by tests.

**Changes:**
- [ ] `crates/checkers-core/` (new: `Cargo.toml`, `src/lib.rs`, `src/board.rs`,
      `src/hash.rs`) — 32-square representation, `Piece {Man, King} × Side`, the
      standard 1–32 numbering (Black 1–12, White 21–32), `state_hash`.
- [ ] `crates/checkers-core/src/game.rs` — `Move {from, to, variant}` with the
      custom `Serialize`/`Deserialize` to one packed integer (out-of-range codes
      rejected at deserialize, per the Othello precedent); `legal_moves` with
      **mandatory capture**, full multi-jump chain generation, **crowning
      terminates the move**, non-flying kings; `apply`; `result` (all captured / no
      legal move); the `Adversary` impl including `render_text` / `move_to_text`
      (`11-15`, `11x18`) / `parse_move`.
- [ ] `Cargo.toml` — add `crates/checkers-core` to `members` and
      `[workspace.dependencies]`.

**Test fixtures (RED first, from D1/D2 and the verified rules).** Each rule gets
**both** its positive and its negative case — every one of these is a branch, and a
single-sided assertion would survive the obvious one-line mutation (Pass 3):

- the opening position has exactly 7 legal moves for Black;
- **mandatory capture:** a position with a capture available offers **only**
  capture moves — *and* a position with no capture available offers its simple
  moves (without this, "always return only captures" passes);
- a double-jump is generated as one `Move` whose chain has two landings;
- **crowning terminates the move:** a man jumping *into* the king row is crowned and
  the chain **stops** even though a further jump is geometrically available — *and*
  a man jumping into a non-king row **continues** the chain (without this, "always
  terminate after the first jump" passes, and multi-jump generation is exactly
  where that bug lives);
- a king jumps backwards — *and* a man may not (the direction constraint is a
  branch too);
- two distinct chains sharing `(from, to)` get distinct `variant`s and both are
  legal;
- `serde_json` round-trips a `Move` to a single number, and rejects an out-of-range
  code — with the boundary pair `max_valid_code` accepted / `max_valid_code + 1`
  rejected, not an arbitrary large number.

**Call chain:** `Adversary::legal_moves` → `apply` → `result` → `state_hash`,
exercised by the crate's own tests. (This phase has no browser entry point; Phase
13 is where the chain reaches the user.)
**Wiring test:** `crates/checkers-core/src/game.rs`'s
`a_full_game_plays_to_a_terminal_result` — a deterministic first-legal-move game
runs to `result().is_some()` within a bounded move count, proving `legal_moves` /
`apply` / `result` compose into a terminating game. (The termination bound is what
Phase 5's draw rule makes true in general; here it is asserted for the fixture.)
**Depends on:** Phase 0 (D2 confirms the `variant` width; D4 names the draw rule
that Phase 5 implements).
**Read-set:** `crates/othello-core/src/{game,board,hash}.rs` (the pattern),
`crates/adversary-core/src/lib.rs` (the trait).
**Write-set:** `crates/checkers-core/**`, `Cargo.toml`, `Cargo.lock`.
**Shared-state contract:** Writes `Cargo.lock` (workspace-wide) and `target/`. No
other crate's sources are touched, so a `cargo test --workspace` regression here
can only come from the lock file — check `git diff Cargo.lock` is additive.
**Risks:** Multi-jump generation is the classic source of checkers bugs
(specifically: forgetting that a captured piece stays on the board until the chain
completes, so it cannot be jumped twice). Mitigated by an explicit fixture for a
chain that would re-capture the same piece if the bug existed.
**Done when:**
1. **Behavioral:** `checkers_core` generates the legal moves of any English-draughts
   position, including mandatory multi-jump chains, and a move round-trips through
   a single JSON number.
2. **Verification:** `cargo test -p checkers-core` **+ `cargo clippy -p
   checkers-core --all-targets` + `cargo fmt --check`**. *(Pass 3: CI runs no Rust
   gate at all — see Verified Assumptions — so these commands are the only
   enforcement of `fun/CLAUDE.md`'s clippy/fmt discipline. They are named in every
   Rust phase from here on for the same reason.)* The new crate carries the
   `#![warn(missing_docs)]` + prose `//!` header shape of `othello-core/src/lib.rs`.
**Validation:** Moderate. Tests + hand-check the opening move list and one
published multi-jump position against the rules sources in Verified Assumptions —
a rules engine that passes its own tests can still encode the wrong game.

---

### Phase 5: `checkers-core` — the draw rule + `pond_outcome::Game`

**Goal:** Games terminate, and a match is verifiable by replay.

**Changes:**
- [ ] `crates/checkers-core/src/board.rs` + `src/hash.rs` — add the no-progress
      counter to the position **and to the hash** (D4's finding: two identical
      boards with different counters have different legal futures, so they are
      different states).
- [ ] `crates/checkers-core/src/game.rs` — `result()` returns `Draw` at the
      no-progress threshold; the counter resets on a capture or a man advance.
- [ ] `crates/checkers-core/src/game.rs` — `impl pond_outcome::Game` (`replay`
      skipping illegal moves so a tampered list diverges the hash, per the Othello
      precedent).

**Test fixtures (RED first).** The draw rule is a **threshold**, so the fixtures
name the edges rather than a single point (Pass 3) — and they state the unit
explicitly, because "40 moves by each side" and "80 plies" are the same rule counted
two ways and the off-by-one lives exactly there:

- the D4 fixture is **not** a draw at ply 79, **is** a draw at ply 80, and stays a
  draw at 81 (the counter does not wrap or reset itself);
- a capture at ply 79 resets the counter, and the position is still live at ply 80;
- a man advance at ply 79 likewise resets it;
- a **king shuffle** does not reset it — the case the rule exists for;
- an honest full game `attest`/`verify` round-trips;
- a tampered move list fails `verify`;
- two positions identical except for the counter hash **differently** — the
  assertion that justifies putting the counter in `state_hash` at all.

**Call chain:** `pond_outcome::attest::<Checkers>(seed, moves, …)` → `replay` →
`legal_moves`/`apply` → `state_hash`.
**Wiring test:** `a_full_game_replays_to_a_verifiable_hash` — mirrors
`othello-core/src/game.rs:434-465`, including the tamper case. RED at phase start.
**Depends on:** Phase 4.
**Read-set:** `crates/pond-outcome/src/lib.rs`, `crates/othello-core/src/game.rs`.
**Write-set:** `crates/checkers-core/src/{board,hash,game}.rs`.
**Shared-state contract:** No shared mutable state beyond the write-set.
**Risks:** Adding the counter to the hash **after** Phase 4 wrote hash tests means
those fixtures' expected hashes change. That is correct and expected — but it must
be a deliberate update, not a "fix the test to match the code" reflex. The phase
must state, in the commit, why each changed hash changed.
**Done when:**
1. **Behavioral:** Every checkers game terminates (win, loss, or the no-progress
   draw), and `(seed, moves)` replays to a verifiable hash that a tampered list
   cannot reproduce.
2. **Verification:** `cargo test -p checkers-core` + `cargo clippy -p checkers-core
   --all-targets` + `cargo fmt --check`.
**Validation:** Moderate. Tests + a random-play soak asserting every game
terminates — the termination guarantee is exactly the kind of property a handful of
fixtures cannot establish. **Split it in two (Pass 3), because `cargo test -p
checkers-core` is this phase's gate and a 10k-game soak does not belong on a gate
that runs every phase from here to 11:** a **1k-game seeded soak as a normal
`#[test]`** (fast enough to stay in the default run, and it is the one that would
actually catch a regression later), plus a **10k-game `#[ignore]`d soak** run by
hand once in this phase and recorded in the Review Log. Both must use *seeded*
RNG so a failure is reproducible from the seed alone.

---

### Phase 6: Extract `crates/adversary-solver`

**Goal:** One class-preserving band selector, generic over the move type.

**Changes:**
- [ ] `crates/adversary-solver/` (new: `Cargo.toml`, `src/lib.rs`) — `LiveBand`
      and `select_in_band<M: Copy>(values: &[(M, i32)], class_of, preserve_class,
      sloppiness_pct, rng) -> Option<M>`, moved verbatim (the two copies are
      already identical apart from `M`). Ships with the union of both existing
      test suites' band tests, generic over a stand-in move type.
- [ ] `Cargo.toml` — add to `members` and `[workspace.dependencies]`.

**Explicitly not extracted** (verified per-game, see Verified Assumptions):
`capped_class` (Drop 4 classifies a horizon class; Othello returns a constant `0`)
and `live_band(level)` (per-game difficulty tuning).

**Call chain:** none yet — this phase creates the crate; Phases 7/8/10 wire it.
This is the one phase whose output is deliberately unreferenced at its own end,
which is normally the dead-code smell. It is acceptable **only** because Phase 7
immediately consumes it and the two are on the same branch; if Phase 7 slips, this
phase must not be committed alone.
**Wiring test:** deferred to Phase 7 by the above. **Pass 3 ruling — this is the
plan's one accepted wiring-test exception, and it is made binding rather than
advisory.** A pure extraction has no entry point of its own to wire to; the only
honest fix is to guarantee the consumer follows, so Phase 6's Done-when now
*includes* Phase 7 landing (below). That converts what would be a plan defect
("a phase whose output nothing calls") into a two-phase unit with a real wiring
test at its end. The gate at *this* phase is that `adversary-solver`'s own tests
reproduce both games' band behaviour against a synthetic move type, with the
boundary cases named: the class floor never admits a class-dropping move **at
`sloppiness_pct = 100`** (the edge where it would if the floor were dropped);
`sloppiness_pct = 0` is deterministic across repeated calls with the same seed;
and with **no** floor, full sloppiness *does* eventually admit the class drop
(without this last one, "the floor works" is indistinguishable from "the selector
never picks anything but the best move").
**Depends on:** Phase 4 (`checkers_core::Move` exists, so the generic signature is
designed against three real move types — the rule-of-three point).
**Read-set:** `crates/drop4-solver/src/live.rs`, `crates/othello-solver/src/live.rs`.
**Write-set:** `crates/adversary-solver/**`, `Cargo.toml`, `Cargo.lock`.
**Shared-state contract:** Writes `Cargo.lock`. No existing crate's sources change
this phase, so the workspace build is unaffected apart from a new member.
**Risks:** Over-generalizing — pulling `live_band` or `capped_class` in because
they sit next to the selector. Guarded by the explicit "not extracted" list above.
**Done when:**
1. **Behavioral:** A single generic `select_in_band` exists that both shipped games'
   band semantics can be expressed through.
2. **Verification:** `cargo test -p adversary-solver` + `cargo test --workspace`
   (unchanged, proving nothing broke) + `cargo clippy -p adversary-solver
   --all-targets` + `cargo fmt --check`.
3. **Wiring (Pass 3, binding):** Phase 7 is green. This phase is **not complete
   and not committed on its own** — the confirmed ADVISORY open question says do not
   commit 6 alone, and the wiring-test exception above is granted only on that
   condition. Either continue straight to 7 or squash the two.
**Validation:** Narrow. Tests are sufficient; no shipped behaviour changes yet.

---

### Phase 7: Migrate `drop4-solver` onto `adversary-solver`

**Goal:** Delete the first duplicate; prove the extraction against a shipped game.

**Changes:**
- [ ] `crates/drop4-solver/src/live.rs` — delete the local `LiveBand` +
      `select_in_band`; import from `adversary_solver`. `capped_class` and
      `live_band` stay.
- [ ] `crates/drop4-solver/Cargo.toml` — add the dependency.
- [ ] `TODO/drop4.md` — mark the shared-selector thread Done.

**Call chain:** `drop4_wasm::live_move` → `drop4_solver::live::choose_capped` →
`adversary_solver::select_in_band`.
**Wiring test:** the **existing** `drop4-solver` band tests (notably
`select_in_band_preserve_class_never_drops_class`, `live.rs:382`) plus
`tests/tournament.test.ts`'s `blunders === 0` — the class floor must survive the
extraction, measured through the shipped browser player. If the extraction broke
the floor, the browser rig catches it.
**Depends on:** Phase 6.
**Read-set:** `crates/adversary-solver/src/lib.rs`.
**Write-set:** `crates/drop4-solver/src/live.rs`, `crates/drop4-solver/Cargo.toml`,
`Cargo.lock`, `TODO/drop4.md`.
**Shared-state contract:** Writes `Cargo.lock` — this is why Phases 7 and 8 are
sequential (see Concurrency Map).
**Risks:** A subtle RNG-consumption change (the selector draws from the rng twice
in the sloppy path) would shift every seeded Drop 4 game and break golden hashes.
Mitigated by moving the function **verbatim** and by the existing seeded tests.
**Done when:**
1. **Behavioral:** Drop 4 plays identically to before, with no local band selector.
2. **Verification:** `cargo test --workspace` + `cargo clippy --workspace
   --all-targets` + `cargo fmt --check` + `npm run unit` (the browser rig's
   zero-blunder invariant) all green.
**Validation:** Moderate. Tests + `npm run harness:trial` for Drop 4 and compare
the Report against the recorded run in `docs/HARNESS.md` — a same-shaped Report is
the evidence that difficulty behaviour is unchanged. **Compare the numbers, not the
shape:** this phase moves code the seeded RNG runs through, so `W-D-L`,
`graded moves` and `blunders` should be *identical*, not merely plausible. A
difference here is the Risk above having happened.

---

### Phase 8: Migrate `othello-solver` onto `adversary-solver`

**Goal:** Delete the second duplicate; close `TODO/othello.md`'s extraction thread.

**Changes:**
- [ ] `crates/othello-solver/src/live.rs` — delete the local `LiveBand` +
      `select_in_band`; import from `adversary_solver`.
- [ ] `crates/othello-solver/Cargo.toml` — add the dependency.
- [ ] `TODO/othello.md` — mark the extraction thread Done.
- [ ] `docs/BUILDING-GAMES.md:544` — strike "Duplicate the ~30-line band selector
      into your solver until a **third** game exists (rule of three), then extract a
      shared `adversary-solver`" and replace it with "use
      `crates/adversary-solver`". *Moved here from Phase 6/17 by Pass 3: Phase 6
      creates the crate while **both duplicates still exist**, so the instruction is
      still true there. It becomes false exactly here — which is also where this
      phase's `grep "fn select_in_band" → 1 hit` gate proves it.*

**Call chain:** `othello_wasm::live_move` → `othello_solver::live::choose` →
`adversary_solver::select_in_band`.
**Wiring test:** the existing `othello-solver` band tests plus Phase 3's
`tests/othello-harness.test.ts` zero-blunder assertion — now doing real work, since
it grades the migrated player.
**Depends on:** Phase 7 (`Cargo.lock` serialization).
**Read-set:** `crates/adversary-solver/src/lib.rs`.
**Write-set:** `crates/othello-solver/src/live.rs`,
`crates/othello-solver/Cargo.toml`, `Cargo.lock`, `TODO/othello.md`,
`docs/BUILDING-GAMES.md`.
**Shared-state contract:** Writes `Cargo.lock`.
**Risks:** As Phase 7.
**Done when:**
1. **Behavioral:** Both shipped adversarial games share one band selector; `grep -rn
   "fn select_in_band" crates/` returns exactly one hit.
2. **Verification:** `cargo test --workspace` + `cargo clippy --workspace
   --all-targets` + `cargo fmt --check` + `npm run unit` green, and the grep above
   returns one result.
**Validation:** Moderate. Tests + the grep gate + an Othello `harness:trial` run,
compared against the Report Phase 3 recorded in `docs/HARNESS.md` — same numbers,
per Phase 7's reasoning.

---

### Phase 9: `checkers-solver` — evaluation and search

**Goal:** An Oracle that is heuristic early and **provably exact** in the endgame.

**Changes:**
- [ ] `crates/checkers-solver/` (new: `Cargo.toml`, `src/lib.rs`, `src/eval.rs`) —
      material + king weighting + mobility + back-rank, integers only (no floats on
      the hashed path).
- [ ] `crates/checkers-solver/src/search.rs` — negamax + alpha-beta, `Level`
      (Easy/Medium/Hard/Expert) → depth, `TRACTABLE_PIECES` (D3's measured value)
      switching to a full exact solve, `move_values`, `best_move`.
- [ ] `Cargo.toml` — add to `members`.

**Test fixtures (RED first).** Pass 3 put numbers on the two that were qualitative —
"convincingly" and "a time bound" are not assertions:

- the exact endgame agrees with an **independent plain minimax** (the Othello
  cross-check shape, `othello-solver/src/search.rs:141-152`);
- a depth-3 heuristic player beats a seeded-random player **in at least 18 of 20
  seeded games** (a fixed seed list, so a failure is reproducible and a flake is
  not mistaken for a regression);
- a top-level opening move returns **within a stated wall-clock bound on the debug
  profile**, with the bound written into the test as a named constant, not a magic
  number;
- a forced-capture position values the mandated captures **only** — *and* a
  position with no capture available values its simple moves (the same
  both-branches rule as Phase 4: a search that only ever sees captures passes the
  one-sided version);
- **`TRACTABLE_PIECES` is a threshold, so test both sides of it:** a position at
  exactly `TRACTABLE_PIECES` reports `exact == true`, and one at
  `TRACTABLE_PIECES + 1` reports `exact == false`. Without the second, the constant
  can be mutated to any value and every test still passes — and the constant is
  precisely what the honesty flag rests on.

**Call chain:** `checkers_solver::best_move` → `negamax` → `checkers_core::
{legal_moves, apply, result}`.
**Wiring test:** `exact_endgame_agrees_with_an_independent_minimax` — the test that
makes `exact` an honest claim. Without it, "exact" is an assertion about our own
code by our own code.
**Depends on:** Phase 5 (a terminating game — an exact solve of a non-terminating
game does not halt), Phase 0 (D3).
**Read-set:** `crates/othello-solver/src/{search,eval}.rs`, `crates/checkers-core/**`.
**Write-set:** `crates/checkers-solver/**`, `Cargo.toml`, `Cargo.lock`.
**Shared-state contract:** Writes `Cargo.lock`, `target/`.
**Risks:** The exact solve is slower than D3 predicted once real alpha-beta move
ordering is in play, in either direction. If the measured in-wasm time at Phase 11
contradicts D3, `TRACTABLE_PIECES` is **lowered** — the honesty flag depends on the
exact solve actually fitting a tap budget in the browser, not natively.
**Done when:**
1. **Behavioral:** The solver returns a strong move from any position and a provably
   exact value in the endgame.
2. **Verification:** `cargo test -p checkers-solver` + `cargo clippy -p
   checkers-solver --all-targets` + `cargo fmt --check`.
**Validation:** Moderate. Tests + play a full engine-vs-engine game natively and
eyeball the move list for obvious nonsense (e.g. declining a free multi-capture).

---

### Phase 10: `checkers-solver` — the difficulty band + the tutor

**Goal:** The shipped opponent's difficulty knobs, and engine-grounded coaching
whose wording is bound to `exact`.

**Changes:**
- [ ] `crates/checkers-solver/src/live.rs` — `capped_class` (returns a constant `0`:
      checkers is unsolved early, so a heuristic proves no class — the Othello
      shape, not Drop 4's), `live_band(level)`, `choose(...)` delegating to
      `adversary_solver::select_in_band`.
- [ ] `crates/checkers-solver/src/tutor.rs` — `MoveClass`, `TutorMove`,
      `TutorReport {moves, best_col, exact}`, `assess(pos)`. Carries a checkers
      one-ply fact — **recommended: `captures` (the number of pieces the move
      takes)**, which is the natural analogue of Othello's `takes_corner` and is
      what a learner actually needs to see. `crowns` is a second candidate; pick
      one in this phase and record why.
- [ ] `crates/checkers-solver/Cargo.toml` — depend on `adversary-solver`.

**Test fixtures (RED first):** the opening is capped (`exact == false`) and **never
grades a Blunder** (the honesty invariant — a heuristic proves no class); an exact
endgame grades an optimal move `Optimal` and a class-dropping move `Blunder`; the
class floor never admits a class-dropping move even at full sloppiness; Expert is
deterministic; a multi-capture move carries the right `captures` count.

**Call chain:** `checkers_wasm::live_move` (Phase 11) → `live::choose` →
`adversary_solver::select_in_band`; `tutor::assess` → `search::move_values`.
**Wiring test:** `opening_is_capped_and_never_grades_a_blunder` — the invariant the
UI's hedged wording rests on, and the third game's proof that the exact/heuristic
honesty flag generalizes.
**Depends on:** Phases 6 and 9.
**Read-set:** `crates/othello-solver/src/{live,tutor}.rs`,
`crates/adversary-solver/src/lib.rs`.
**Write-set:** `crates/checkers-solver/src/{live,tutor}.rs`,
`crates/checkers-solver/Cargo.toml`, `Cargo.lock`.
**Shared-state contract:** Writes `Cargo.lock`.
**Risks:** Choosing a one-ply fact that the band cannot use. `buildBand`'s `ideaFor`
degrades to quality-based ideas for any game without Drop 4's two booleans
(`hybrid-player.ts:39-43`), which is already Othello's accepted state — so
`captures` is carried for the tutor panel and the LLM prompt, not for `buildBand`.
Do not "fix" `buildBand` in this phase; it is a tracked cross-game follow-on.
**Done when:**
1. **Behavioral:** Four difficulty levels play distinguishably, and the tutor reports
   per-move quality with an honest `exact` flag.
2. **Verification:** `cargo test -p checkers-solver` + `cargo clippy -p
   checkers-solver --all-targets` + `cargo fmt --check`.
**Validation:** Moderate. Tests + a native Easy-vs-Expert series confirming Expert
wins convincingly (a difficulty band that does not actually differentiate is a
silent failure the unit tests will not catch).

---

### Part C — Ship it

### Phase 11: `checkers-wasm` — the C-ABI binding

**Goal:** The browser-facing binding, which never panics.

**Changes:**
- [ ] `crates/checkers-wasm/` (new: `Cargo.toml`, `src/lib.rs`) — the Othello
      export set (`new_game`, `board_json`, `legal_moves_json`, `current_hash`,
      `result_code`, `render_text`, `play`, `live_move`, `oracle_best`,
      `oracle_move_values_json`, `assess_json`, `tutor_json`, `mark_assistance`,
      `outcome_json`, `out_len`). **No `pass` export** — checkers has no pass; no
      legal move is a loss.
- [ ] `legal_moves_json` returns **richer** entries than Othello's bare index array:
      `[{code, from, to, path, captures}]`, so the front-end can drive a
      step-through jump chain **without re-implementing rules** (it filters the
      core's chains by the prefix the player has tapped). `GameOracle.legalMoves()`
      maps this to `code`s.
- [ ] `Cargo.toml` + `tools/build-wasm.sh` — add `checkers-wasm` to `members` and
      the `-p` list (required before any vitest test can load it: `preunit` runs
      `build:wasm`).

**Call chain:** browser `WebAssembly.instantiate` → `checkers_wasm` exports →
`checkers_solver` / `checkers_core`.
**Wiring test:** `crates/checkers-wasm/src/lib.rs`'s `cabi_rules_tutor_and_outcome`
(the Othello shape, `othello-wasm/src/lib.rs:431-504`): a fresh game exposes the
opening moves, an illegal move returns `1` **not a panic**, a legal move applies,
`live_move` returns a legal code, `tutor_json` carries the shared `TutorFactMove`
superset fields, and `outcome_json` is a verifiable envelope of kind `"checkers"`.
**Depends on:** Phase 10.
**Read-set:** `crates/othello-wasm/src/lib.rs`.
**Write-set:** `crates/checkers-wasm/**`, `Cargo.toml`, `Cargo.lock`,
`tools/build-wasm.sh`.
**Shared-state contract:** Writes `Cargo.lock` and `tools/build-wasm.sh` (shared
build script — a syntax error here breaks **every** game's test run, so verify with
a full `npm run unit` not just the checkers suite).
**Risks:** (a) A panic path reaching wasm aborts the module — every fallible path
must map to a status code (the `#![warn(missing_docs)]` + no-`unwrap` discipline
applies hardest here). (b) D3's `TRACTABLE_PIECES` measured natively may be too
slow in wasm — **measure it here for real** and lower the constant if needed.
**Done when:**
1. **Behavioral:** `checkers.wasm` builds and a host can play a complete game
   through the C-ABI, including a multi-jump, with an exact endgame that returns
   within a tap budget in the browser.
2. **Verification:** `cargo test -p checkers-wasm` + `cargo clippy -p checkers-wasm
   --all-targets` + `cargo fmt --check` + `npm run build:wasm` produces
   `target/wasm32-unknown-unknown/release/checkers_wasm.wasm`, **and a full `npm run
   unit`** (this phase writes the shared `tools/build-wasm.sh`).
**Validation:** Broad. Tests + the in-wasm timing measurement (Risk b) + confirm the
built artifact size is in line with the other games'. **Record the measured in-wasm
ms next to D3's native number in Verified Assumptions**, whether or not it forces
`TRACTABLE_PIECES` down — Risk (b) is a predicted contradiction, and a prediction
that is checked and recorded is worth more than one that is checked and forgotten.

---

### Phase 12: The typed `Checkers` wrapper + the verifiable outcome

**Goal:** The TS surface the UI and the harness both speak.

**Changes:**
- [ ] `src/games/checkers/checkers-wasm.ts` (new) — the typed wrapper (the Othello
      shape), including `legalMoveDetails(): LegalMove[]` for the chain-aware UI
      and `legalMoves(): number[]` for the port.
- [ ] `src/games/checkers/checkers-outcome.ts` (new) — `encodeRecord` /
      `decodeRecord` / `verifyRecord` replaying packed move codes.
- [ ] `tests/checkers-unit.test.ts` (new) — RED first: over the real
      `checkers.wasm`, a played game's record re-verifies, and a **tampered** record
      fails.

**Call chain:** `verifyRecord(new Checkers(...), env)` → `play(code)` →
`checkers_wasm::play` → core replay → `currentHash`.
**Wiring test:** `tests/checkers-unit.test.ts`'s round-trip + tamper case, over the
real wasm — the verifiable-outcome property proven through the shipped binding, not
just in Rust.
**Depends on:** Phase 11.
**Read-set:** `src/games/othello/{othello-wasm,othello-outcome}.ts`.
**Write-set:** `src/games/checkers/{checkers-wasm,checkers-outcome}.ts`,
`tests/checkers-unit.test.ts`.
**Shared-state contract:** No shared mutable state beyond the write-set; the usual
`fetch`-shim restore discipline.
**Risks:** The packed move code is a large integer where every other game's is
small; a silent `u8` assumption anywhere in the share path would truncate it. The
tamper test must use a code **above 255** to catch exactly that.
**Done when:**
1. **Behavioral:** A checkers match produces a `?r=`-shareable record that
   re-verifies by replay and rejects tampering.
2. **Verification:** `npm run unit -- tests/checkers-unit.test.ts` + `npm run
   typecheck`.
**Validation:** Moderate. Tests + manually decode one real share payload and
confirm the move array is plain numbers (the cross-game wire contract).

---

### Phase 13: Playable `/checkers/` — wired

**Goal:** The game is reachable and playable from its URL. **This is the phase the
"no stubs; built means wired" rule is about.**

**Changes:**
- [ ] `src/games/checkers/checkers.ts` (new) — the `GameModule`: board render,
      tap-piece → glow legal destinations → tap-destination, **step-through jump
      chains** (the UI filters the core's legal chains by the tapped prefix and
      commits only a complete chain — it never invents a chain), turn bar naming
      both sides, the opponent's move made visible, difficulty picker, side picker,
      result screen + `?r=` share.
- [ ] `src/registry.ts` — the `checkers` entry, `status: "playable"`.
- [ ] `build.mjs` — `GAME_PAGES` += `checkers`; the `checkers.wasm` copy block.
- [ ] `tests/checkers.spec.ts` (new, Playwright) — RED first.

**Call chain:** `/checkers/index.html` → `app.js` → `chrome.ts` mount →
`REGISTRY.find("checkers").load()` → `checkersModule.mount()` → `Checkers.load()` →
`checkers.wasm`.
**Wiring test:** `tests/checkers.spec.ts` — navigate to `/checkers/`, tap a piece,
tap a legal destination, assert the board changed and the engine replied. It goes
**through the entry point**, not through the module in isolation. RED at phase
start (the route 404s).
**Depends on:** Phase 12.
**Read-set:** `src/games/othello/othello.ts` (the pattern), `src/contract.ts`,
`src/chrome.ts`.
**Write-set:** `src/games/checkers/checkers.ts`, `src/registry.ts`, `build.mjs`,
`tests/checkers.spec.ts`.
**Shared-state contract:** `build.mjs` and `src/registry.ts` are **shared** files
every game's build and drawer depend on — an error in either breaks the whole
shelf, so the gate is the full `npm run e2e`, not just the checkers spec. The
Playwright run binds a local port for the duration of the phase's test run only.
**Risks:** The step-through chain UI is the novel interaction on the shelf and the
most likely place to accidentally re-implement rules in TypeScript. The guard: the
UI may only ever *filter* `legalMoveDetails()`; if it ever computes a jump itself,
that is a defect regardless of whether it works.
**Done when:**
1. **Behavioral:** A player can open `/checkers/`, play a full game against the
   engine including a multi-jump, and get a verified result screen with a share
   link.
2. **Verification:** `npm run e2e -- tests/checkers.spec.ts`, then full `npm run
   e2e` (shared-file blast radius).
**Validation:** Broad. Tests + play it by hand in a real browser on both a desktop
and a phone viewport (the tap-first + centred-play-surface standards,
`docs/BUILDING-GAMES.md` §4) + axe clean in both themes.

---

### Phase 14: The tutor panel + the experimental hybrid opponent

**Goal:** §10's AI-opponent checklist, reusing `hybrid-player.ts` / `ai-runtime.ts`
**unchanged**.

**Changes:**
- [ ] `src/games/checkers/checkers.ts` — the opt-in tutor panel (off by default),
      wording **bound to `exact`** ("that threw the game" only when exact, "looks
      risky" otherwise), and the WebGPU-gated experimental opponent toggle with the
      up-front download disclosure. A persona in the Chip/Rowan line.
- [ ] `tests/checkers-tutor.test.ts` (new) — RED first, naming both sides of the
      honesty branch (Pass 3): a capped fact (`exact === false`) **never** produces
      "threw the game" and instead hedges, **and** an exact fact of the same quality
      **does** produce the definite wording. A one-sided test passes trivially
      against a tutor that hedges unconditionally, which would be a different bug in
      the same place. Plus a `MockRuntime` hybrid proof (CI has no GPU), asserting
      on `HybridDecision.source`: a garbage reply yields `source === "fallback"` and
      a valid in-band reply yields `source === "llm"` — not just that the returned
      move happened to be legal, which is true in both cases and therefore proves
      nothing about which path ran.

**Call chain:** toggle → `WebLLMRuntime` (lazy, same-origin `/vendor/webllm.js`) →
`HybridPlayer.pick(buildBand(game.tutor().moves), …)` → a band move → `play(code)`.
**Wiring test:** `tests/checkers-tutor.test.ts`'s `MockRuntime` hybrid case — a
garbage model reply falls back to the engine's top-of-band, and an in-band pick is
legal. This is the "a broken model degrades to the engine, never to a blunder"
guarantee, proven for the third game.
**Depends on:** Phase 13.
**Read-set:** `src/harness/{hybrid-player,ai-runtime}.ts`,
`src/games/othello/othello.ts` (the panel + toggle pattern).
**Write-set:** `src/games/checkers/checkers.ts`, `tests/checkers-tutor.test.ts`.
**Shared-state contract:** No shared mutable state; `hybrid-player.ts` and
`ai-runtime.ts` are **read-only** this phase — if either needs an edit, the reuse
claim is false and that is a finding to record, not a quiet patch.
**Risks:** `buildBand` consuming the checkers tutor view requires that view to be a
structural superset of `TutorFactMove` (`col`, `value`, `quality`, `immediateWin`,
`blocksOpponentWin`). Phase 11 must have carried the two Drop-4 booleans as `false`
— verify here, since this is where it bites.
**Done when:**
1. **Behavioral:** The tutor explains moves honestly, and a WebGPU-capable browser
   can play the experimental opponent, which never plays an illegal or
   class-dropping move.
2. **Verification:** `npm run unit -- tests/checkers-tutor.test.ts` + an
   `ai:trial`-style manual run (not CI — no GPU on the gate).
**Validation:** Broad. Tests + a real WebGPU run + read the banter for honesty (a
persona that claims certainty the `exact` flag does not support is a defect).
**During the WebGPU run, count how often the hybrid actually falls back.**
`HybridAiPlayer.chooseMove` discards `decision.source` (`match-runner.ts:140-148`),
so a model that falls back on *every* move is currently indistinguishable from one
that never does — including in the Report. Observe it by hand here; whether to plumb
it through the rig is a tracked ADVISORY question, deliberately not decided in this
phase.

---

### Phase 15: Checkers meets the harness

**Goal:** The third game grades through the rig — the payoff for Part A.

**Changes:**
- [ ] `src/games/checkers/checkers-oracle.ts` (new) — the `GameOracle` adapter.
- [ ] `tests/checkers-harness.test.ts` (new) — RED first: a top-level self-play
      checkers tournament over the real wasm, with the same three non-vacuity
      assertions Phase 3 established — `blunders === 0`, `scoredMoves > 0`,
      `abortedGames === 0`. The third one carries the most weight here: checkers is
      the first game whose move codes exceed a `u8`, so a truncated code would
      surface as a rejected `play` and abort, which without Phase 2c's counter
      would render as a clean-looking zero-blunder Report.
- [ ] `src/harness/harness-trial-entry.ts` + `tools/harness-trial.mjs` —
      `HARNESS_TRIAL_GAME=checkers`.

**Call chain:** `runTournament(() => checkersOracle(await Checkers.load()), …)` →
the **unmodified** shared rig → `checkers_wasm`.
**Wiring test:** `tests/checkers-harness.test.ts` — the generality claim's final
proof. If grading a jump-chain game needs **any** edit to `match-runner`/`scorer`/
`tournament`, the port designed in Phase 1 was wrong, and that is the finding.
**Depends on:** Phases 3 and 12.
**Read-set:** `src/harness/*.ts`, `src/games/checkers/checkers-wasm.ts`.
**Write-set:** `src/games/checkers/checkers-oracle.ts`,
`tests/checkers-harness.test.ts`, `src/harness/harness-trial-entry.ts`,
`tools/harness-trial.mjs`.
**Shared-state contract:** The trial entry/driver are shared with Drop 4 and
Othello — the default (`drop4`) must stay unchanged, verified by running the
no-argument trial.
**Risks:** `scoredMoves === 0` (the exact endgame never reached within the games
played), which would make a `blunders === 0` headline vacuous. The test must assert
the denominator, exactly as `docs/HARNESS.md` insists for the report.
**Done when:**
1. **Behavioral:** `HARNESS_TRIAL_GAME=checkers npm run harness:trial` emits a real
   checkers Report, and CI grades a checkers tournament — with no change to the rig.
2. **Verification:** `npm run unit` green; `git diff --stat src/harness/{match-runner,
   scorer,tournament}.ts` shows **no change** in this phase.
**Validation:** Broad. Tests + all three trial games run for real + read all three
Reports side by side and sanity-check that the numbers differ in the ways the games
differ.

---

### Phase 16: "How to play" + guide shots

**Goal:** The user-guide standard (`docs/BUILDING-GAMES.md` §7).

**Changes:**
- [ ] `src/games/checkers/checkers-howto.ts` (new) — the guide as pure data,
      covering the two things a player will get wrong: **capture is mandatory** and
      **crowning ends the move**.
- [ ] `src/how-to-registry.ts` — register `checkers`.
- [ ] `tools/guide-shots.mjs` — the checkers `SHOTS` entries.
- [ ] `assets/guide/checkers-*.jpg` — generated by `npm run guide:shots`.

**Call chain:** `/how-to/?game=checkers` → `how-to.js` → `findGuide("checkers")` →
`CHECKERS_GUIDE` → `<img src="/assets/guide/checkers-*.jpg">`.
**Wiring test:** the existing `tests/how-to.test.ts` (a unit test fails on a
referenced-but-missing shot) and `tests/how-to.spec.ts` (an e2e fails on a 404) —
both already exist and start failing the moment the guide is registered without its
shots. RED by construction.
**Depends on:** Phase 14 (the shots must show the **final** UI, tutor panel
included — `fun/CLAUDE.md` requires regenerating shots whenever the UI changes, so
shooting before the UI settles guarantees a redo).
**Read-set:** `src/games/othello/othello-howto.ts`, `tools/guide-shots.mjs`.
**Write-set:** `src/games/checkers/checkers-howto.ts`, `src/how-to-registry.ts`,
`tools/guide-shots.mjs`, `assets/guide/checkers-*.jpg`.
**Shared-state contract:** **`npm run guide:shots` rebuilds every game's shots.**
Per `fun/CLAUDE.md`, `git add` only `assets/guide/checkers-*.jpg` and
`git checkout --` the rest — other games' JPEGs re-encode differently run to run and
would otherwise land as unrelated churn. Binds a local port for the shot run.
**Risks:** The unrelated-churn trap above. Verify with `git status` before commit
that only checkers shots are staged.
**Done when:**
1. **Behavioral:** `/how-to/?game=checkers` renders the guide with live screenshots
   of the shipped UI.
2. **Verification:** `npm run build:wasm && npm run build && npm run guide:shots`,
   then `npm run unit` + `npm run e2e -- tests/how-to.spec.ts`.
**Validation:** Moderate. Tests + open the guide and read it as a new player would,
checking the shots match the current UI.

---

### Phase 17: Docs — record what landed

**Goal:** No stale cross-references (the "docs are getting crusty" failure mode).

**Changes:**
- [ ] `docs/BUILDING-GAMES.md` §10 (`:433-435`) — checkers as the **third**
      reference implementation; add a jump-chain note to the move-encoding guidance
      (a move need not be a destination). *The band-selector instruction at `:544`
      is **not** here — Pass 3 moved it to Phase 8, the phase that makes it false.*
- [ ] `docs/AI-PLAYERS.md` — the generality section becomes three games; note that
      the honest-Oracle shape now has two unsolved-game precedents. *The harness
      claim at `:280-283` is **not** here — Pass 3 moved it to Phase 3.*
- [ ] `README.md`, `fun/CLAUDE.md` — the shelf inventory and adversarial roster.
- [ ] `TODO/checkers.md` — rewritten from a scoping note into the running worklist;
      `TODO/README.md` — checkers moves to Shipped, the closed cross-game threads
      struck.

**Call chain:** n/a (documentation).
**Wiring test:** n/a. The gate is a cross-reference grep: no doc still claims the
harness is Drop-4-only, that the band selector is duplicated, or that checkers is
unstarted.
**Depends on:** Phase 16.
**Read-set:** all files in Documentation Impact.
**Write-set:** `docs/{BUILDING-GAMES,AI-PLAYERS}.md`, `README.md`, `CLAUDE.md`,
`TODO/{checkers,README}.md`.
**Shared-state contract:** No shared mutable state beyond the write-set.
**Risks:** Rubber-stamping. Each Documentation Impact line must be individually
checked off against the actual file, not assumed.
**Done when:**
1. **Behavioral:** A reader arriving at `docs/BUILDING-GAMES.md` or `TODO/README.md`
   gets the post-checkers truth, with no instruction that contradicts the code.
2. **Verification:** `grep -rn "rule of three\|drop4-wasm\|third adversarial" docs/
   TODO/ | grep -v "adversary-solver"` returns only historical/intentional hits,
   each reviewed; **`cargo test --workspace && cargo clippy --workspace
   --all-targets && cargo fmt --check && npm run test`** green. *(Pass 3: `npm run
   test` is `typecheck && lint && unit && build` — it contains **no Rust gate at
   all**, so calling it "the full gate" was wrong. The Rust half has to be named
   explicitly, here and in CI's absence everywhere else.)*
**Validation:** Narrow. The grep gate + a read-through of the two checklists in
`docs/BUILDING-GAMES.md`, confirming checkers satisfies every line — each
Documentation Impact entry ticked against the actual file, per this phase's Risk.

---

## Open Questions

- `[CONFIRMED: BLOCKING — RESOLVED 2026-08-04]` **Which draw rule does the core
  adopt?** English draughts as codified has none that a deterministic core can use
  ("by agreement" / "neither side can force a win"), yet without one a game can fail
  to terminate — which hangs `runMatch` and breaks the verifiable-outcome property.
  **Decision: the standard tournament no-progress rule — a draw after 40 moves by
  each side (80 plies) with no capture and no man advanced.** The counter increments
  each move and resets on a capture or a man advance, and it **joins `state_hash`**
  (two identical boards with different counters have different legal futures, so
  they are different states). Rejected: a hard ply cap (not a real rule; truncates
  legitimate long games into draws they did not earn) and repetition + no-progress
  (closest to real adjudication, but needs position history in the state — a heavier
  hash and a bigger core, for a case the no-progress counter already catches).
  *Phase 0 D4 is now a confirmation task — build the fixture that reaches the draw —
  rather than an open choice. Phases 4, 5 and 9 build on this.*

- `[CONFIRMED: PHASE-GATED (Phase 4)]` **Is the 14-bit `(from, to, variant)`
  packing sufficient?** Phase 0 D2 measures the real maximum number of distinct
  chains sharing a `(from, to)` pair; if it exceeds 15, the encoding must widen or
  change shape. *Measurable before Phase 4 starts, so it gates that phase rather
  than blocking the plan. If D2 comes back over budget, Phase 4 is re-planned before
  a line is written.*

- `[CONFIRMED: PHASE-GATED (Phase 10)]` **Which checkers one-ply tutor fact —
  `captures` or `crowns`?** Othello carries `takes_corner`; checkers needs its
  analogue for the tutor panel and the LLM prompt. Recommended: `captures` (the
  count of pieces taken), as the fact a learner most needs surfaced. *Only affects
  the tutor view's shape, decided inside Phase 10; does not ripple backwards.*

- `[CONFIRMED: ADVISORY]` **Rename the shared `TutorFactMove.col` to something
  game-neutral?** It is a Drop 4 legacy that Othello already reuses for a cell
  index and checkers will reuse for a packed move code. **Keep `col`** and document
  it precisely at the port — the name is also the wasm JSON wire field in three
  crates, so a rename touches 3 Rust crates and 3 front-ends for no behavioural
  gain. *Surfaced because Phase 1 is the one moment the rename would be cheap-ish;
  declined deliberately, not by omission.*

- `[CONFIRMED: ADVISORY]` **Should Phase 6 be committed if Phase 7 slips?**
  Phase 6 creates `adversary-solver` with no consumer, which is normally the
  dead-code smell. Do not commit 6 alone — either continue to 7 in the same session
  or squash them. *A workflow preference, not a design decision; the "commit at
  every stable point" rule arguably favours committing it, so the executor should
  make the call knowingly.* **Pass 3 made this binding** rather than advisory, as
  the condition on Phase 6's wiring-test exception (see Phase 6 § Done when).

- `[CONFIRMED: ADVISORY — 2026-08-04]` **Should the hybrid's
  `llm` vs `fallback` split be surfaced in the harness Report?**
  `HybridDecision.source` (`hybrid-player.ts:33-35`) already records which path each
  move took, but `HybridAiPlayer.chooseMove` (`match-runner.ts:140-148`) returns
  `decision.move` and drops it. A hybrid that falls back on 100% of moves therefore
  scores **identically** to one that never falls back — which matters because the
  fallback is what guarantees "never a blunder", so a 0%-blunder headline may be
  measuring the engine, not the model. **Recommendation: leave it out of this
  plan and track it in `TODO/harness.md`.** *Rationale: it is a pre-existing gap,
  not one this plan creates; the fix belongs to the hybrid player rather than the
  game or the port; and adding a second observability change on top of Phase 2c
  widens Part A's scope past what "generalize the rig" needs. Phase 14 observes it
  by hand in the meantime.*

---

## Review Log

### Pass 1: Plan development — 2026-08-04
**Produced:** Problem statement grounded in the three converging tracked threads;
reasoning covering the game choice, the phase ordering (harness-first for
de-risking, extraction mid-plan for a real rule-of-three), and the four move-encoding
options with (D) chosen; Verified Assumptions from firsthand reads of 20+ code
locations and four rules sources; 18 phases; Concurrency Map; five open questions.

**Key findings during development:**
- The `Adversary` trait's `Move: Copy` bound (`adversary-core/src/lib.rs:87`)
  eliminates any `Vec`-based jump-chain design before it was proposed — the
  encoding must be a fixed-size value.
- The band selector duplication is **exactly** `select_in_band` + `LiveBand`;
  `capped_class` and `live_band` genuinely differ per game and must not be dragged
  into the extraction. This narrows the extraction from "the band logic" to ~40
  lines.
- Every shelf game already encodes its move as a compact **numeric** wire code, so
  the generalized harness needs a `GameOracle` over `number` — not a generic move
  parameter. This is what keeps the Part A diff small.
- **English draughts has no codified terminating draw rule.** Not flagged in
  `TODO/checkers.md`. Promoted to the plan's only BLOCKING question, because
  `runMatch` loops until a terminal result.
- Crowning terminating the move (verified, not assumed) materially simplifies chain
  generation and bounds chain length.

### Pass 2: Gap analysis — 2026-08-04
**Found:**
- Phase 3 originally lacked a **forced-pass** risk. Othello's `liveMove` can return
  `"pass"`, which a naive adapter maps to `null` — and `match-runner.ts:169-172`
  treats `null` as an **abort**. A "passing" Othello match would have silently
  recorded `aborted: true` and graded nothing, while the test still went green on a
  well-formed Report. Added as the phase's named risk with a specific assertion.
- Phase 5 originally did not say what happens to Phase 4's hash fixtures when the
  no-progress counter enters the hash. Added explicitly, with the instruction that
  each changed hash be justified in the commit rather than reflexively updated.
- Phase 11's `legal_moves_json` needed to be **richer** than Othello's bare index
  array, or the Phase 13 step-through UI would have no way to drive a partial chain
  without re-implementing rules. Added `{code, from, to, path, captures}` and the
  explicit constraint that the UI may only filter, never compute.
- Phase 12 gained a specific tamper-test requirement (a code **above 255**) — every
  other game's move codes fit in a `u8`, so a latent `u8` assumption in the share
  path would only ever surface for checkers.
- Phase 15 gained a `git diff --stat` verification on the three rig files: the
  generality claim is only proven if the rig is provably unmodified.
- Phase 16's dependency was moved from Phase 13 to **Phase 14**: guide shots must
  show the final UI including the tutor panel, and `fun/CLAUDE.md` requires
  regenerating them on any UI change — shooting at 13 guaranteed a redo.
- Phase 11's write-set includes `tools/build-wasm.sh`, which **every** game's test
  run depends on (`preunit`); the phase gate was widened from the checkers suite to
  a full `npm run unit`.

**Concurrency:**
- Map confirmed all-sequential, but the reasoning was sharpened. Phases 7 and 8
  looked parallel-safe on file write-sets alone; both write **`Cargo.lock`**, which
  is a shared write-set entry and forces sequential under the hard rule. Recorded
  as a named near-miss so it is not re-derived later.
- Added the cross-phase shared-state note (single worktree, no git-state mutation,
  ports bound only during Phases 13/16 test runs, no subagent dispatch → no
  re-entry verification needed).

**Changed:**
- Documentation Impact gained `docs/AI-PLAYERS.md`, `fun/CLAUDE.md`, and the six
  registration points, with grep evidence recorded for both sweeps.
- Phase 2 gained an explicit, reasoned exception to the 4-file split rule (the TS
  type migration is atomic; splitting leaves `typecheck` red, violating the
  higher-priority working-state rule). Flagged for Pass 3 to confirm rather than
  silently taken.
- Phase 6 gained an explicit acknowledgement that it ends with no consumer, plus
  the constraint not to commit it alone — and a new ADVISORY question so the
  executor decides knowingly.
- Phase 10 gained a "do not fix `buildBand` here" guard: its idea-degradation for
  non-Drop-4 games is already Othello's accepted state and a tracked cross-game
  follow-on, so improving it mid-phase would be scope creep into shared code.
- Validation strategies calibrated per phase rather than defaulting to "tests are
  sufficient": Narrow for 1, 6, 17; Moderate for 2, 4, 5, 7, 8, 9, 10, 12, 16;
  Broad for 3, 11, 13, 14, 15.

**Confirmed:**
- The `Adversary` trait, `pond_outcome::Game`, `hybrid-player.ts`, and
  `ai-runtime.ts` all reuse **unchanged** — checked method by method against the
  Othello implementation rather than assumed from the recipe in
  `docs/BUILDING-GAMES.md` §10.
- The CI wasm-loading shim generalizes to a second and third wasm by parameterizing
  the path (`tests/match-runner.test.ts:22-35`); no new test infrastructure needed.
- `tools/build-wasm.sh` already builds `othello-wasm`, so Phase 3 needs no build
  change — only Phase 11 does.

### Open-question walk-through — 2026-08-04
**Confirmed by the owner:** all five, one BLOCKING resolved and four accepted as
recommended (2 phase-gated to Phase 4, 3 phase-gated to Phase 10, 4 and 5 advisory).

**Resolved — the draw rule (the plan's only blocker):** the **40-move no-progress
rule** (80 plies, reset on capture or man advance), with the counter in
`state_hash`. A hard ply cap was rejected as an invented rule that turns long games
into unearned draws; repetition + no-progress was rejected as a heavier core for a
case the counter already terminates.

**Changed in consequence:**
- Reasoning § "The draw rule" rewritten from a recommendation to a decision, with
  both rejected alternatives and why.
- Phase 0 **D4 narrowed** from "choose a rule and decide on hash inclusion" to
  "build the fixture that proves it" — the decision is made, so the probe is now a
  confirmation task with a `keep-as-fixture` disposition into Phase 5.
- Open Questions re-prefixed `[CONFIRMED: …]` per the walk-through convention.

**No phase reordering.** The decision lands inside Phases 4/5/9 exactly where the
plan already scheduled it; nothing moved.

**Plan is ready for Pass 3** (quality gates: TDD ordering, observability, validation
calibration, documentation-impact coverage) — to be run in a fresh context.

### Pass 3: Quality Gates — 2026-08-04

**TDD ordering:**
- **Phase 2's "type-level only; no logic edits" claim was false.** `GreedyPlayer`
  gains a `preference?` parameter — a new behavior with a default branch, filed
  under a type migration and therefore covered by no test. It now gets its own RED
  test in Phase 2a naming all three branches (no preference / preference hits /
  preference misses), because a single "centre-out still works" assertion survives
  a mutation that ignores `preference` entirely.
- **Mutation resistance — six phases specified single-point assertions on
  branching code.** Each now names both sides: Phase 4 (mandatory capture *and* the
  no-capture case; crowning terminates *and* a non-crowning jump continues; kings
  jump backwards *and* men may not; the serde boundary pair `max` / `max + 1`);
  Phase 5 (the draw threshold as 79/80/81 plies, with the counting unit stated,
  since "40 moves per side" and "80 plies" are where the off-by-one lives);
  Phase 6 (`sloppiness_pct` at 0 and 100, plus the no-floor case that distinguishes
  "the floor works" from "the selector never picks anything but the best move");
  Phase 9 (`TRACTABLE_PIECES` at N and N+1 — without it the constant the honesty
  flag rests on can be mutated freely); Phase 10/14 (the honesty branch tested in
  both directions, so an unconditionally-hedging tutor fails); Phase 1 (all four
  level codes, since the Level unions differ per game).
- **Two qualitative "assertions" got numbers.** Phase 9's "beats a seeded-random
  player convincingly" → ≥18 of 20 seeded games; "returns within a debug time
  bound" → a named constant in the test.
- **Wiring tests:** every phase has one except Phase 6, which cannot (a pure
  extraction has no entry point). Rather than accept a dangling exception, Phase 6's
  Done-when now *includes Phase 7 being green* — converting the defect into a
  two-phase unit that ends in a real wiring test, and making the previously
  ADVISORY "do not commit 6 alone" binding.

**Observability:**
- **Added Phase 2c (abort observability).** `runMatch` collapses two distinct
  failures into one boolean (`match-runner.ts:169-176`) and `Report`
  (`tournament.ts:32-37`) carries **no abort count at all** — so a tournament in
  which every match aborted on move one renders a clean `W-D-L 0-0-0 / graded
  moves 0` report indistinguishable from a legitimately short run. Tolerable for one
  game whose only abort mode is a bug; not tolerable from Phase 3 on, where Othello
  adds an *expected-shaped* abort (forced pass) and checkers adds a third (a packed
  code above `u8` failing to round-trip). `MatchRecord.abortReason` +
  `Report.abortedGames`, rendered adjacent to the games count — the same honesty
  argument that already put `scoredMoves`/`skippedEarly` next to `blunders`.
  Deliberately kept out of `scorer.ts`: an abort is a match-lifecycle fact, not a
  per-move grading fact, and the pure half should not grow one.
- **`abortedGames === 0` added as a third assertion** to Phases 3 and 15, next to
  `blunders === 0` and `scoredMoves > 0`. Each guards a different way the headline
  can pass vacuously.
- **Recording discipline for measured constants.** D2/D3 produce values later phases
  depend on; Phase 0 now requires the *measurement and the machine* be written down,
  not just the chosen number — Phase 11 explicitly predicts contradicting D3 in
  wasm, and diagnosing that against a recorded measurement is a minute's work
  versus re-running the probe.
- **Flagged, not fixed:** `HybridDecision.source` is computed and discarded
  (`match-runner.ts:140-148`), so an always-falling-back hybrid scores identically
  to a working one. Recorded in Verified Assumptions, observed by hand in Phase 14,
  and raised as a new ADVISORY question rather than silently absorbed into Part A.

**Debugging readiness:**
- Phase 7/8 validation sharpened from "a same-shaped Report" to **the same numbers**
  — these phases move code the seeded RNG runs through, so any difference *is* the
  named RNG-consumption risk having happened.
- Phase 3 must **record its Othello Report in `docs/HARNESS.md`**; Phase 7 and 8
  validate by comparing against a recorded Report, and there was none.
- Phase 5's soak split into a 1k-game `#[test]` (stays on the gate that runs for
  every later phase) and a 10k-game `#[ignore]`d run done once — both seeded, so a
  failure reproduces from the seed alone.

**Validation calibration:**
- Reviewed all 20 phases against scope (Phase 0 carries the Discovery Exemption;
  the other 19 declare a strategy). Two adjustments: Phase 2a is **Narrow**
  (the seam keeps the blast radius to one module) where the old monolithic Phase 2
  was Moderate; Phase 2c is **Narrow** (additive, with a wiring test covering the
  full path to rendered text). Phase 11's verification widened to a full `npm run
  unit` — it writes the shared `tools/build-wasm.sh`, which every game's test run
  depends on.
- Final calibration: **Narrow** 1, 2a, 2c, 6, 17 · **Moderate** 2b, 4, 5, 7, 8, 9,
  10, 12, 16 · **Broad** 3, 11, 13, 14, 15.
- **Project convention gap — CI runs no Rust gate whatsoever.**
  `.github/workflows/deploy.yml` runs `build:wasm`/`typecheck`/`lint`/`unit`/`build`
  and `npm run test` is `typecheck && lint && unit && build`: no `cargo test`, no
  `cargo clippy`, no `cargo fmt --check` anywhere. `fun/CLAUDE.md` mandates
  `clippy::pedantic` and `cargo fmt --check` clean, so **the per-phase commands in
  this plan are the only enforcement that exists.** Every Rust phase (4, 5, 6, 7, 8,
  9, 10, 11) now names clippy and fmt explicitly, new crates carry the
  `#![warn(missing_docs)]` + prose `//!` header shape of `othello-core/src/lib.rs`,
  and Phase 17's "the full gate" was corrected — `npm run test` alone does not
  verify a single line of Rust.
  - **CLOSED 2026-08-04 by `plans/2026-08-04-rust-ci-gate.md`.** CI now has a
    `rust` job (`fmt --all --check` · `test --workspace --release` · `clippy
    --workspace --all-targets -D warnings`) that `deploy` depends on, and
    `npm run test` now runs it. The per-phase `cargo` commands in this plan
    **stay** — they are the right local practice and now *match* CI instead of
    substituting for it. New crates (including the three checkers crates) opt into
    the pedantic tier with `[lints] workspace = true`; add that line to each new
    `Cargo.toml` in Phases 4, 6, 9 and 11.

**Concurrency honesty:**
- Map re-checked against the post-Pass-3 write-sets and still **all sequential**;
  the spine updated for the 2a/2b/2c split. No parallel sets exist, so
  write-set-disjointness and re-entry verification remain N/A — stated explicitly
  rather than left silent.
- Shared-state contracts re-read as **invariants, not mechanisms**: they name what
  each phase will and will not do (writes `Cargo.lock`; restores the `fetch` shim in
  a `finally`; binds a port only for the duration of a test run; no
  `git checkout`/`stash`/`rebase`). Phase 2c's is additive-only, with the useful
  property that *if an existing assertion has to change, the change was not
  additive* — a checkable statement rather than a promise.
- **Second named near-miss recorded.** Part A (1–3) alongside Phases 4–5 is the
  plan's most tempting parallel split and is disjoint on files — but Part A's every
  test run goes `preunit` → `build:wasm` → `cargo build`, which **reads the
  workspace `Cargo.toml` and writes `Cargo.lock`**, the exact files Phase 4 mutates.
  A concrete instance of files-only isolation leaking through ambient build state,
  written down so it is not re-derived and re-rejected later.

**Discovery:**
- **D5 resolved during planning, not deferred.** Both greps re-run against the
  working tree, output recorded verbatim, and the sweep found two real misses:
  `docs/AI-PLAYERS.md:282` is a *harness* claim (stale at Phase 3), not a Drop 4
  example, and had been scheduled for Phase 17; `TODO/drop4.md:21,23,107` are
  historical done-item records that stay true and are deliberately not touched.
- **D1 gained two pre-filled rows** from a Pass 3 spot-check: `liveMove`'s return
  type differs *and* its `Level` argument is a different string union per game
  (`"Perfect"` vs `"Expert"`). So the port takes a numeric level code and each
  adapter maps it — and "Expert-vs-Expert" in Phases 3/15 means *each game's top
  level*, which for Drop 4 is `Perfect`. This is also what made the Phase 2 ruling
  non-obvious: without the Phase 1 adapter, `Drop4` genuinely is not structurally
  assignable to `GameOracle`.
- All dispositions declared: D1 `keep-as-fixture`, D2 `throwaway`, D3 `throwaway`,
  D4 `keep-as-fixture`, D5 `throwaway` (closed). No `promote`, so no follow-up TDD
  phase is owed.

**Coherence:**
- **Phase 2's 4-file exception is rejected.** Pass 2's justification — that
  splitting leaves `typecheck` red — does not survive contact with the import graph
  (`tournament.ts:12-14`, `scorer.ts:13-14`, `match-runner.ts:14-15`): Phase 1's
  `drop4Oracle(...)` is exactly the seam that keeps each half green, because
  `tournament.ts` can wrap at the `runMatch` call site while `scorer.ts` still takes
  a `Drop4`. Split into 2a (match-runner + the seam) and 2b (scorer + tournament),
  2 production files each. The plan's file-counting convention is now stated
  explicitly — **the rule counts production files; a phase's own tests travel with
  the code they test** — since TDD makes deferring them impossible and Phase 1
  already relied on that reading.
- Scope held: the only additions are Phase 2c (~15 lines of production code,
  justified by three games flowing through code that reports one bit) and test
  specificity. No phase reordering; downstream numbering (3–17) unchanged
  deliberately, since the plan cross-references phase numbers throughout.
- Problem statement still solved: all three converging threads close, in the same
  order, for the same reasons.

**Documentation impact:**
- **Two entries were scheduled in the section but missing from the phase.**
  `docs/BUILDING-GAMES.md:532-534` and `docs/AI-PLAYERS.md:280-283` are now in
  Phase 3's Changes and write-set.
- **One entry was scheduled in the wrong phase.** `docs/BUILDING-GAMES.md:544`
  ("duplicate the band selector until a third game exists") moved from Phase 6 to
  **Phase 8** — Phase 6 creates the crate while *both duplicates still exist*, so
  the instruction is still true there. It becomes false exactly at Phase 8, which is
  also where the `grep "fn select_in_band" → 1 hit` gate proves it. Removed from
  Phase 17's list so it is not written twice.
- Every remaining Documentation Impact file re-checked against its phase's write-set;
  all six registration points confirmed present (registry 13, how-to-registry 16,
  `build.mjs` 13, `build-wasm.sh` 11, `guide-shots.mjs` 16, `Cargo.toml` 4/6/9/11).
- Phase 17 survives the "trailing docs phase" check: what remains there is only the
  *record-what-landed* content that cannot be written before it lands (the third
  reference implementation, the shelf inventory, the shipped/backlog status). Every
  doc claim this plan makes **false** is fixed in the phase that breaks it.

**Confirmed ready:** yes, pending one new unreviewed ADVISORY question (the hybrid
`llm`/`fallback` telemetry) and the two previously-confirmed PHASE-GATED items.

### Phase 0 progress — 2026-08-04

**D1 closed (answer: yes, the port covers both games).** The ten-row method table is
recorded in the D1 entry and lifts verbatim into Phase 1's `GameOracle` doc comment.
No row required a new wasm export. Two findings beyond the pass/fail:
- Four methods present on both wrappers (`oracleBest`, `oracleMoveValues`,
  `markAssistance`, `outcome`) are **never called by the rig**, so they stay off the
  port. Keeping `GameOracle` to ten members is what makes the checkers adapter cheap.
- **`GreedyPlayer` needs no per-game work beyond its tie-break.** It reads
  `assess().immediateWin`/`.blocksOpponentWin`, and Othello's `MoveAssessment` is
  already a structural superset of Drop 4's carrying both — so the only Drop-4-shaped
  thing in it really is `CENTRE_OUT`, which Phase 2a makes injectable. This
  retroactively confirms Phase 2a's scope was drawn correctly.

**D5 closed** during Pass 3 (see its entry and the Documentation Impact grep record).

**Open:** D2, D3, D4 — the three probes that require code to run.

**Related plan created:** `plans/2026-08-04-rust-ci-gate.md`, from this plan's Pass 3
finding that CI runs no Rust gate. It recommends holding **checkers Phase 4** (the
first new Rust crate) until that plan's Phase 3 is green; Part A and this Phase 0 are
unaffected and can proceed in parallel.
