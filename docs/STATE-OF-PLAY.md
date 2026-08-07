# State of play — 2026-08-06

A **dated snapshot**, not a living document. It exists so someone returning after
a gap can recover the thread in one read: what is true today, what was learned the
hard way, and what is worth doing next.

It deliberately does not restate the living sources, which win wherever they
disagree with this file:

| Question | Source of truth |
|---|---|
| How to build a game here | `docs/BUILDING-GAMES.md` |
| How the AI opponents work | `docs/AI-PLAYERS.md` |
| How the scoring rig works, and how to plug a game in | `docs/HARNESS.md` |
| What is left to do | `TODO/README.md` + `TODO/<game>.md` |
| Why a phase was built the way it was | `plans/<date>-<slug>.md` → Review Log |

---

## 1. What the shelf is

A determinism-first, local-first game shelf at **fun.croft.ing**. Two tiers:

- **Tier 1 — Croft-native.** Rules live in a Rust core compiled to wasm. The core
  decides legality; the screen never does. A finished game produces a
  **verifiable outcome**: replay `(seed, moves)` through the core, re-derive the
  hash, and the result checks itself — so a `?r=` share link proves its own claim
  rather than asking to be trusted.
- **Tier 2 — opportunistic wraps.** Already-packaged ethical games taken as-is,
  behind a containment harness, honestly labelled as having **no** verifiable
  outcome.

Twelve Tier-1 games, four Tier-2 wraps.

## 2. The adversarial family (the part with an AI in it)

Three games where you play a computer opponent, all built on one set of shared
parts:

| | Drop 4 | Othello | Checkers |
|---|---|---|---|
| Move is | a column | a cell (or a pass) | **a jump chain** |
| Solved from the opening? | yes | no | no |
| What `exact` means | tractable endgame | exact endgame solve | **a proven terminal** |
| Wire code | `0..6` | `0..64` | packed `(from, to, variant)`, 14 bits |
| Shipped | 2026-07 | 2026-08-03 | **2026-08-06** |

**The split that matters:** the **engine is strength, the model is personality.**
The Rust solver picks a class-preserving *band* of moves that cannot throw the
game; an optional in-browser LLM picks *within* that band and adds banter. A
broken, slow, or adversarial model therefore degrades to the engine — never to an
illegal or losing move. Anything the model *says* is filtered too
(`src/harness/banter.ts`): it may trash-talk, it may not make claims about the
board, because a small model does and gets them wrong.

**The honesty flag.** Every tutor fact carries `exact`. The tutor may say a move
*threw the game* only when the value is proven; otherwise it hedges ("looks
risky"). Each game earns the flag differently — see the table above — and the
wording is bound to it by a unit test in all three.

## 3. What changed on 2026-08-05/06

### Checkers shipped (an 18-phase plan, complete)

English draughts: mandatory capture, multi-jumps tapped one landing at a time,
crowning that ends the move, and the standard tournament no-progress draw (40
moves a side) — adopted because codified draughts has **no** terminating draw rule
a deterministic core can use, and without one a game can fail to terminate.

### The scoring rig became game-agnostic

It used to import Drop 4 by type. It now drives a ten-member `GameOracle` port and
names no game. Checkers — the awkward case — plugged in with an **empty diff** on
`match-runner`/`scorer`/`tournament`, and its adapter is the *smallest* of the
three, because the port only ever asked "can your move be written as a number?".

### The band selector was extracted

`crates/adversary-solver`, on the rule of three, once checkers became the third
consumer. Drop 4 and Othello migrated onto it and reproduced their recorded
baselines exactly across the migration.

### Then measuring things found six real defects in already-shipped code

Every one was invisible because nothing was watching:

1. **Othello had a 19-second move.** The search re-decided "estimate vs solve
   exactly" at *every node*, so a routine depth-7 search turned each of its leaves
   into a full solve. The spike sat exactly at `TRACTABLE_EMPTIES + depth`.
   Decided once at the root instead: **19,187ms → 2,112ms**, tutor 1,915ms →
   119ms, proof rate unchanged. Only then could the threshold be tuned (10 → 12,
   free).
2. **Othello silently abandoned games.** At a forced pass the shared players
   returned "no move", which the runner reads as an abort. 1 game in 2.
3. **The checkers grader was weaker than the player it graded** — which makes
   "optimal" true by construction.
4. **The AI opponent asserted false board facts** ("capturing the opponent's king"
   with no king on the board).
5. **The tutor searched shallower than the opponent**, so it rarely had anything
   proven to say.
6. **The rig discarded who chose each move**, so a model that fell back every time
   looked identical to one that never did.

**The theme is instrumentation, not cleverness.** Most of the fixes are a counter,
a recorded baseline, or an assertion. The bugs were old; what was new was
measuring.

### A measurement I reported wrongly, and corrected

I hand-counted the checkers AI as falling back to the engine ~50% of the time, by
reading the spoken banter. That was the wrong quantity: the canned line also
appears when an *LLM* pick's banter is rejected. With the real flag plumbed
through, the move-level fallback rate is **0%** — which is what schema-constrained
decoding predicts. The correction sits next to the original claim in
`plans/2026-08-04-checkers-game.md`. Read hand-counts here with suspicion; prefer
the Report.

## 4. Where the numbers live

- `npm run baselines` — asserts all three games' engine-vs-engine Reports exactly.
  **Opt-in** (~1 min). If a number moves, that is a finding: these are the seeded
  output of a deterministic engine. The one legitimate reason to update is that
  the engine or the grader itself changed, and then the reason gets written next
  to the number.
- `HARNESS_TRIAL_GAME=<game> npm run harness:trial` — the real WebGPU
  hybrid-vs-engine run, off CI, system Chrome.
- Latency numbers live in the constants' own doc comments
  (`TRACTABLE_EMPTIES`, `TUTOR_DEPTH`, `COACH_DEPTH`, `TRACTABLE_PIECES`), so they
  travel with the code they justify.

## 5. Toolchain

Both toolchains are **pinned by the repo**, and the machine reads the pin:

- Rust — `rust-toolchain.toml`, read by `tools/rust-gate.sh` and both CI jobs.
- Node — `.nvmrc` (22), via **fnm**. Set up with `brew install fnm`, `fnm install`,
  and `eval "$(fnm env --use-on-cd)"` in `~/.zshrc`.

This is not tidiness. Running Node 25 against a pin of 22 cost a day of "known,
pre-existing" test failures that were neither: Node 25 ships a placeholder
`localStorage` with no `clear`, which outranks the one jsdom installs.

## 6. Open items, most valuable first

1. ~~**The browser tests do not run in CI.**~~ **Closed 2026-08-07.** They run as
   a third parallel job and `deploy` needs it, so a broken board cannot publish.
   Verified non-vacuous: the job log reads "Running 418 tests using 2 workers →
   415 passed". Cost about a minute of wall clock (6.2m vs 5.3m) — a runner gives
   Playwright 2 workers where a laptop gives 7, so the suite takes 4.5 min there
   against ~55s here, and `e2e` is now the longest job. `npm run gate` runs the
   same set locally in 3m44s.
2. **The midgame is the latency floor** in both Othello (~2.1s) and checkers
   (~341ms) at the top level. No endgame constant reaches it; the levers are the
   per-level depths or time-bounded iterative deepening.
3. **Persona roster** — Chip, Rowan and Alder are inlined in three game modules.
   The tracked design is external prompt files with one place to add a persona.
4. **No job timeouts in CI** — a hung job can burn six hours, and we have already
   had a test hang a worker.
5. Per-game backlogs in `TODO/<game>.md`; next-game candidates (chess, digger,
   logic puzzles, cribbage) in `TODO/README.md`.

## 7. Verified after this snapshot was written

Everything above **was** unverified when written — GitHub Actions was in a major
outage, webhook deliveries were throttled, and pushes were not triggering runs. It
has since been gated and deployed: run `31128884288` on `7c734a1` went
`rust: success / build: success / deploy: success`, and a smoke test against the
live site plays checkers through the deployed wasm with no console errors.

Getting there found one more defect, in the workflow itself: the publishing steps
were guarded `if: github.event_name == 'push'` while the `deploy` job was guarded
only on the ref, so a **manual dispatch could never publish** — it skipped the
artifact upload and then failed looking for it. Manual dispatch is the fallback
for precisely the situation we were in, and it had never been exercised. Fixed.

The original text of this section is kept below, because "what I believed at the
time, and how it turned out" is the useful part.

### As written on 2026-08-06

GitHub Actions and Pages were in a **major outage** (incident opened 15:22 UTC).
Consequences, all pending a re-run rather than a fix:

- The last commits are on `main` but **were never checked by CI**.
- The site **has not redeployed**, so fun.croft.ing does not yet serve this work.
- Everything here was gated locally: `npm run test` (Rust + typecheck + lint +
  unit + build) exit 0, plus 415 Playwright tests green on Node 22.

The first thing to do on returning is re-run the workflow and confirm it, before
trusting anything above about what is deployed.
