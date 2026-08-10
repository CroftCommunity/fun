# AI Players — the guide (engine + LLM, how they combine)

How the shelf builds a computer opponent and an AI-scoring harness for two-player
games, and — hard-won from the Drop 4 exploration — **what each part is actually
for**. Read this before adding an AI opponent to a game or reaching for an LLM as
a player. The governing plan (with the full experiment log) is
`plans/2026-07-31-drop4-ai-harness.md`; this doc is the standing summary.

## The one principle

> In a deterministic, perfect-information game (Connect 4, chess, checkers,
> Othello), a strong move is a **computable fact**. The classic engine computes
> it. So the engine is the source of **strength and difficulty**; the LLM is the
> source of **experience** — legality, personality, explanation, tutoring. The
> LLM cannot out-play the engine in these games, and it isn't meant to.

```
engine (exact/near-exact Oracle)   LLM (in-browser, WebGPU)
  ─ knows every move's value          ─ legal by construction (grammar/schema)
  ─ sets the difficulty band          ─ personality / variety within the band
  ─ ground truth for tutoring         ─ verbalizes the engine's truth
  = STRENGTH + DIFFICULTY             = EXPERIENCE (UX), not strength
```

### Which opponent actually runs (the default is the engine, no model)

Do not conflate "the opponent" with "the model" — by default there is **no model**:

- **Default opponent = The Engine.** With nothing toggled, you play the classic
  engine (in Drop 4: `live_move` — the Rust solver compiled to wasm). **No LLM, no
  download, instant, deterministic**, with the difficulty knob (Easy…Expert). This
  is the shipped default for every player and the **strong** opponent.
- **The LLM is strictly opt-in** behind an **"Experimental: local AI opponent"**
  toggle that only appears when the browser has a real WebGPU adapter. Ticking it
  swaps in the `HybridPlayer` — the engine builds a never-throw band, the
  in-browser LLM picks a move *within* that band and speaks a reason. It downloads
  a model once, is **characterful but not stronger** (bounded by the engine's
  band), and **falls back to The Engine on any failure**.
- **The tutor is engine-grounded either way.** "Explain my options" / blunder flag
  / hint are on by default and computed from the solver — **no model**. When the
  LLM toggle is on it additionally *narrates* those same facts; it never sources
  them. So a player who never touches the toggle still gets full tutoring, and the
  model never influences strength, legality, or the tutor's facts.

One-line mental model: **the engine plays and coaches; the LLM (opt-in) only
changes the voice.**

### Why the LLM can't beat the engine here (and where it could)

The game value of every position is fixed; deviating from an optimal move can
only preserve-or-lower it. There is no "above optimal," so the LLM can match the
engine (pick an optimal move) or fall short — never exceed it. Two sharpenings:

- **"Optimal" is usually a set.** Multiple moves are often equally best (our
  Δ=0 band averaged ~2). Choosing among *those* costs nothing — that's the free
  room for personality.
- **The one real exception: practical play vs a fallible opponent.** The engine's
  "best" is best-against-perfect-play. Against a weak opponent, the *trappy*
  move that maximizes their chance to err can be practically better — and the
  solver does **not** optimize this (it assumes optimal opposition). Capturing it
  needs opponent-modeling, which is harder than tactics; nothing we measured
  shows a small LLM doing it. Real exception, not yet realized in practice.

**Corollary for game choice:** an LLM adversary adds *strategic* value only where
there is no computable best-in-a-vacuum — **imperfect information, stochastic, or
open-ended** games (poker, social-deduction, negotiation). For solved/solvable
perfect-info board games, the LLM is a narrator, not a player. If you want to
test where an LLM earns its keep as a *player*, vary the *kind* of game, not the
flavor of solved board game.

## The pieces (ports)

| Port | Role | Per-game? |
|---|---|---|
| `Adversary` | rules: initial / legal / apply / result / state_hash + text bridge | **yes** (rules as code) |
| `Oracle` | per-move judgment (exact value, or centipawns, or heuristic) | **yes** (an evaluator) |
| `Player` | chooses a move given a position | no (shared) |
| `AIRuntime` | runs an in-browser LLM (`generate` / structured output) | no (shared) |

A **new game provides**: the `Adversary` trait (rules) + an `Oracle` (evaluator).
Optionally a `GamePackage` (below), needed only for the pure-LLM research player.
Everything else — runner, scorer, band, tutoring, difficulty — is shared.

## The players

- **`ClassicPlayer(Level)`** — the shipped opponent. Difficulty is a knob on the
  engine (see Difficulty). Fast, strong, deterministic, tiny.
- **`LLMPlayer`** — a *pure* LLM player, used to **measure a model** (not to
  ship). Prompt = `GamePackage` + `SessionContext`; legality via a grammar
  constraint; retry/forfeit as backstop.
- **`HybridPlayer`** — the shippable *experimental* opponent. The engine builds a
  difficulty band; the LLM selects within it under a schema and narrates. Quality
  is floored by the band; the LLM adds the human feel.

## Prompt architecture — two halves

- **`GamePackage` (static, authored once per game):** name, rules, goal +
  decision criteria, few-shot example games (in the move notation), encoding
  spec. This is what makes an LLM a *player*. It is the pedagogical twin of the
  `Adversary` text bridge. **It is a stable prompt prefix → KV/prompt-cache
  friendly**, so the big rules+examples cost is paid once per session.
- **`SessionContext` (dynamic, per turn):** move history (transcript), derived
  board + legal moves, whose turn. History matters — feeding the transcript is
  how LLMs play best (it took a 1.5B from 0/7 to 2/7 on a tactics probe).

## Structured output — legality by construction

The in-browser runtime (WebLLM via **XGrammar**) enforces output shape even on a
0.5B model. Two confirmed modes:

- **Grammar (EBNF):** `response_format: { type: "grammar", grammar: 'root ::=
  "0"|"1"|...' }` — forces exactly one legal column.
- **JSON schema:** `response_format: { type: "json_object", schema:
  JSON.stringify(<schema with move enum>) }` — a typed `{ move∈band, reason }`.
  Author the schema with **Zod → JSON Schema** (the browser's Pydantic).

Use this so the LLM's move is legal / in-band by construction — no parsing, no
illegal-move forfeits. It guarantees *shape*, not *quality*.

## Difficulty — two knobs on the engine

Difficulty is band width, applied to the engine's per-move values — **not** the
LLM. Two independent knobs:

1. **Class floor** — `PreserveBestClass` keeps only moves that don't drop the
   win/draw/loss class → the opponent **never throws the game**. `Any` allows
   class-dropping moves (easier).
2. **Within-class regret** — band width Δ: how far below the best value moves may
   fall. Δ=0 is perfect; wider Δ is sloppier.

Measured curve (Drop 4, exact oracle): regret climbs smoothly with Δ (0 → 4.3)
and blunder rate dials 0% → ~38% (perfect → ≈random). Bounded: small Δ means
"sloppy," not "suicidal." The LLM then picks *within* the band.

### How Drop 4 ships it (the live realization)

The shipped `/drop4/` opponent applies these knobs live via `Level`, over
per-move values that are **exact where tractable and depth-capped otherwise** —
because a full solve from the opening is minutes (`drop4-solver::live` +
`drop4-wasm::live_move`):

- **Value source, auto-switched.** ≤ 16 empties → the exact oracle's
  `move_values` (so the class floor is **provably** exact — never throws). More
  empties → the fast depth-capped search, where the class is bounded to the
  search horizon (never throws a *horizon-visible* loss). An immediate win is
  always taken.
- **The two knobs, per level.** (The internal top level is `Perfect`; the picker
  labels it **"Expert"** — it is only provably perfect once tractable, so the
  label doesn't overclaim.) Class floor: Easy/Medium = `Any` (may throw —
  beatable); **Hard/Perfect = `PreserveBestClass` (never throws)**. Within-class
  sloppiness is a *probability* of a random in-class move rather than the
  tightest one — the live realization of the Δ dial (Perfect = 0%). The old
  scheme (ε-random over **all** legal moves) is gone: a weaker level is now
  sloppy *within its class floor*, so Hard/Perfect never hand you the game.
- **Honest bound.** "Never throws" is *provable* once the game is within the
  solver's exact reach (the endgame, where thrown wins actually happen) and
  *horizon-bounded* earlier. A provably-perfect-from-move-1 level would need an
  opening book or a full solve (a follow-up, not shipped).

## Search cost — bounding a move without lying about it

Difficulty decides how *good* the opponent is. This decides how *long* it takes,
and the two are separate problems with separate mistakes available. Everything
below is measured across all three adversarial games (P9,
`plans/2026-08-07-midgame-latency-floor.md` and `-othello-midgame.md`); the
numbers are in the plans' Review Logs and beside each constant.

### Bound work in **nodes**, never in milliseconds

`adversary_solver::NodeBudget` counts search nodes. It is not a stopwatch, and it
must not become one, for three reasons that are all load-bearing here:

1. `tests/baselines.test.ts` re-runs the engines and asserts **exact** Reports. A
   wall-clock bound puts machine speed into `wins`/`optimal`/`blunders` — the
   fields the regression anchor exists to pin.
2. A level with no sloppiness must play the same game from the same seed.
   `select_in_band` refuses to *draw* an unused random number for this reason; a
   clock breaks it far more coarsely.
3. The wasm modules are freestanding `extern "C"` with **no host imports**. A
   clock means asking the host the time, and `native == wasm` stops being a claim
   a test can check.

The honest cost: a node budget bounds *work*, not latency. Slow hardware is still
slow — predictably rather than pathologically. Nodes are a proxy for time, so
**calibrate the proxy by measurement per game** and record the table beside the
constant. `bubble-solver`, `color-sort-solver` and `match3-solver` already took
`node_budget` for the same reason; the adversarial games were the outliers.

### Measure the distribution before choosing a mechanism

The shape of the problem decides the fix, and all three games looked different:

```
  checkers   ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▂▃   0% over 400ms  → a tail. Nothing to fix.
  drop 4     ▁▁▁▁▁▁▁▂▄▆███     20% over 400ms  → a tail, in the OPENING.
  othello    ▃▄▅▆▇███████▇▆    38% over 400ms  → a plateau. Median already 262ms.
  dots       ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▂   0% over 400ms  → one spike, at a known position.
  furrow     ▁▁▁▁▁▁▁▁▁▁▁▁▁▂▃▄   0% over 400ms  → a small tail, in the OPENING.
```

Dots and Boxes (measured 2026-08-07, wasm/Node, 5 seeds × 4 levels) is the
easiest shape there is, and it is worth knowing why: its worst move is the
**same move at every level** — the first exact solve, at exactly
`TRACTABLE_EDGES` free edges, where the memo table is cold — at 66-68 ms against
a median of 0.0-0.3 ms. The exact path ignores level, so Easy costs what Perfect
costs. A per-level table was still taken, because "we measured the top level and
it was fine" is exactly how Othello's stall survived.

Furrow (measured 2026-08-10, wasm/Node, 6 seeds × 4 levels, 220–299 moves each)
is the mirror image of dots and worth the contrast:

| level | median | p95 | worst | over 400 ms | where the worst sits |
|---|---|---|---|---|---|
| Easy | 0.0 ms | 5.3 ms | 61.2 ms | 0% | 16 seeds in play — the first exact solve |
| Medium | 0.2 ms | 0.6 ms | 15.1 ms | 0% | 14 seeds |
| Hard | 1.1 ms | 6.6 ms | 11.7 ms | 0% | 14 seeds |
| **Expert** | 7.8 ms | 51.6 ms | **89.2 ms** | 0% | **47 seeds — the opening** |

Two things only the per-level table shows. The **cheap** levels' worst move is the
first exact solve with a cold table, exactly as in dots — the exact path ignores
level, so Easy pays what Expert pays for it. But **Expert's** worst is somewhere
else entirely: the *opening*, where its depth-10 capped search is at its most
expensive and nothing has left the board yet. Reading only the top level would
have found the second and missed the first; reading only the worst number would
have found neither.

A worst-case number alone would have hidden all of this. Record median, p95,
worst, **and the fraction over your target**, per level — and take the numbers at
*every* level, not just the top one. Othello's endgame stall was invisible for
months because every previous measurement had been taken at Expert, where a
bigger cost sat on top of it.

### When iterative deepening pays, and when it is a tax

`adversary_solver::deepen` searches `1..=max_depth` and keeps the last iteration
that **finished**. It is not free, and whether it pays is a property of the game:

| | checkers | Othello | dots | furrow |
|---|---|---|---|---|
| deepening vs direct search | **+14% nodes (tax)** | **−41% nodes (win)** | **not applicable** | **not applicable** |
| existing move ordering | capture length — and capture is *mandatory*, so it is already near-optimal | a static corner/edge weight table — a weak guess | captures first, and no capture is possible where the capped path runs | extra-turn moves first, then by pit descending |
| budget bite rate | 0% of moves | 28–38% of moves | 0% of moves | **0 of 960 plies** |
| outcome | **reverted, ships nothing** | shipped, free speed | **rejected — every iteration returns the same values** | **rejected — the budget never truncates a search** |

Dots is the third answer, and a different kind of one. Its capped search only ever
runs in the first four plies, where no box can reach three sides — so measured at
depths 1, 2, 4, 6 and 8, at every position it can reach, the set of distinct move
values is `{0}`: one value. Depth 8 spends 200-340 ms to return what depth 1
returns in 0.0 ms. Deepening keeps the best *complete* iteration when a budget
truncates a search; when every iteration is identical there is no better one to
keep. **Check that the search has something to find before asking how to search
it better.**

Furrow is the fourth answer and the one the plan expected to go the other way.
Its prior was explicit: a small branching factor (**4.11**, measured) and a deep
midgame are deepening's natural home, and Phase 0 suggested a budget that might
bite. **It does not.** Over 960 plies of real play at the top level, the capped
search's allowance truncated a move list **zero times** — directly observable,
because `move_values` breaks out of its loop on exhaustion and the report then
holds fewer moves than there are legal ones.

The reason is arithmetic rather than deep: branching 4.11 at depth 10 costs a
measured 79,347 nodes from the opening, against a 600,000-node allowance. Nothing
is ever cut short, so there is no incomplete iteration for `deepen` to rescue and
it could only add the cost of searching depths 1 through 9 first — roughly a third
again, for nothing.

**The prior was about the shape of the game and the answer was about the size of
the budget.** Two of four games now reject deepening for two entirely different
reasons, which is the case for measuring it per game rather than reasoning by
analogy from the one where it won.

> **The rule: deepening pays where the budget actually bites often, or where the
> static move ordering is poor. Where neither holds it is a tax on every move for
> a guardrail that never fires.**

Both halves matter, and they are separable. Re-searching the shallow depths costs
something; it is repaid by (a) the deep search you *skip* when the budget bites,
and (b) the better move ordering each pass hands the next. A game whose moves are
forced or already well-ordered — mandatory captures, a strong static heuristic —
gets little of (b).

Corollary worth stating because it cost a revert to learn: **best-move ordering in
the transposition table is worth almost nothing on its own** (measured: 0.4%), and
is what makes deepening viable (measured: the difference between +41% and −41%).
It belongs with the driver, never before it.

### Rules that hold regardless

- **Never return a partial iteration.** A budget that simply stops a fixed-depth
  search leaves some moves valued deep and the rest not at all — and the
  difficulty band compares values *across* moves, so it would then be choosing by
  whichever move the search happened to reach. Discard the incomplete iteration
  whole; every value returned must come from one depth.
- **Never store a truncated search in the transposition table.** Its value is not
  a bound on anything, and it will outlive the search that produced it. Latch
  exhaustion and refuse every store from that moment on — that covers each
  truncated node *and every ancestor of one*. (Subtrees that finished *before* the
  overrun are genuine and may stay: the property is soundness, not emptiness.)
- **The honesty flag follows the search, not the position.** Othello derived
  `exact` from the empty count, which was sound only while a position in the exact
  region was guaranteed a completed solve. Under a budget it becomes a lie: a
  class floor built on `i32::signum` would claim a *known* win/draw/loss from
  heuristic numbers. See `Valued` in `othello-solver::search`.
- **Do not budget the analysis oracle or the tutor.** A panel opening can afford
  what a tap cannot, and budgeting the grader re-opens the P8 defect where
  "optimal" became true by construction. The oracle must outrank the player it
  grades.
- **A named level depth is a ceiling, not a promise.** Once deepening is in, say
  so where a reader tunes levels — and report the depth actually reached.

### Measuring the strength cost — the protocol

If a budget bites, it changes how the opponent plays, and that has to be measured
rather than assumed. Every clause below exists because its absence produced a
wrong number in P9 Phase 3:

1. **Randomise the openings.** Both `Drop4::initial(seed)` and
   `Othello::initial(seed)` return the *same* board for every seed, and at zero
   sloppiness neither player draws from the RNG — so without random opening plies
   every game with the same first player is bit-identical, and "8 games" is two.
   This produced a confident, entirely false report of a 0W-4D-4L collapse.
2. **Include a never-bites control row** — a budget so large it cannot fire, i.e.
   the unbudgeted engine playing *itself*. Whatever it scores is your noise floor,
   and it will **not** be an even split, because random openings are not
   symmetric between seats. Drop 4's control was 14W-5D-11L. Without this row the
   table cannot be read.
3. **Alternate seats** across seeds.
4. **State the sample size next to the claim.** "No measurable cost at 30 games"
   is honest. "No cost" is not.
5. **Do not use the harness baseline for this.** It grades only the tractable
   endgame and skips the early game, so it cannot see a change that bites in the
   opening or midgame. It is a regression detector, not a strength instrument.

The reusable rigs are `crates/drop4-solver/tests/budget_sweep.rs` and
`crates/othello-solver/tests/budget_sweep.rs`, both `#[ignore]`d.

## Tutoring / explanation — correct by construction

The strongest LLM role. The engine supplies the ground truth; the LLM only
verbalizes it, so it **cannot be wrong about the facts**:

- "Column 4 wins — here's why."
- "That was a blunder: it threw a win to a draw" (the oracle knows the class drop).
- "Here are three reasonable moves and the idea behind each" (coach over the band).

The engine-side data for this is `assess(board, move)` → quality, regret,
immediate-win, blocks-opponent-win (see `drop4-harness::hybrid`). The LLM narrates
it.

### Shipped: the deterministic tutor (no LLM, no GPU)

The tutor ships **now**, everywhere, on the CI gate — because the facts are
computable without any LLM. The value does not depend on the model:

- **Wasm-side facts.** `drop4-solver::tutor::assess(board, solver) -> TutorReport`
  computes, for every legal move, its quality (`Optimal` / `ResultPreserving` /
  `Blunder`), value, regret, and the one-ply `immediate_win` / `blocks_opponent_win`
  facts, plus the best column. Exposed over the wasm C-ABI as `assess_json(col)` /
  `tutor_json()` and typed in the wrapper as `Drop4.assess(col)` / `Drop4.tutor()`.
  `drop4-wasm` gains **no** `drop4-harness` dependency — the facts are computed
  from `drop4-solver` primitives it already uses.
- **Exact-or-capped, and honest about which.** The facts are the exact oracle's
  in the endgame (≤ `TRACTABLE_EMPTIES` empties → provably right) and the fast
  depth-capped search's earlier (horizon-approximate). `TutorReport.exact` says
  which, and the UI is honest: a blunder is called a blunder ("that threw the
  game") only when the facts are `exact`; when capped it softens to "looks risky".
- **In `/drop4/`.** The on-by-default tutor panel: "Explain my options" lists the
  class-preserving band with an idea each; a blunder flag assessed **before** the
  tap and surfaced **after** the engine replies (so it does not spoil the reply);
  and a why-hint that names a column and the reason.

The LLM's later role here is purely to **narrate** these same facts in a warmer
voice (Phase 3) — it changes the wording, never the facts, so it stays correct
by construction.

### Shipped: the `AIRuntime` port + embedded WebLLM runtime

- **One small port.** `src/harness/ai-runtime.ts` defines `AIRuntime`
  (`generate(prompt, {schema?, greedy, maxTokens, system}) -> Promise<string>`,
  `fingerprint()`). `MockRuntime` is the deterministic CI double; `WebLLMRuntime`
  is the real in-browser model.
- **The library is embedded, not CDN-loaded.** `@mlc-ai/web-llm` is a
  dependency, bundled by `build.mjs` to a **same-origin** `/vendor/webllm.js`
  that `WebLLMRuntime` dynamic-imports **only** on first `generate()`. No
  third-party CDN serves executable code (offline-capable PWA + no code-injection
  vector), and `app.js` is unchanged for non-AI games (the vendor bundle is a
  separate, lazily-loaded output). Structured output uses
  `response_format: { type: "json_object", schema: JSON.stringify(<JSON Schema>) }`
  — a hand-written schema, no `zod`.
- **Weights, honestly.** The model **weights + per-model `model_lib` WASM** still
  stream from the MLC/HF CDN on first load, then cache in-browser. Fully
  self-hosting those (offline + closing the `model_lib` code-fetch vector) is a
  **named follow-on** — ~1 GB is not viable on GitHub Pages.
- **Validated by the trial, not CI.** `npm run ai:trial` (a standalone driver,
  **not** a Playwright project) launches system Chrome against a real same-origin
  page, imports the embedded runtime, and runs a structured generation with a
  staged diagnostic (`gpu-adapter` / `model-load` / `generate` / `schema-validate`).
  Firsthand 2026-08-03 (embedded bundle, Apple `metal-3`): 0.5B loaded in ~7.6 s,
  a schema-valid `{move∈enum, reason}` in ~0.4 s. CI exercises only `MockRuntime`.

### Shipped: the experimental `HybridPlayer` opponent

- **Engine band + LLM in-band pick + spoken reason.** `src/harness/hybrid-player.ts`:
  `buildBand()` keeps only class-preserving moves (the never-throw floor);
  `HybridPlayer.pick()` prompts the runtime for a schema-constrained `{move, reason}`
  within the band and returns it only if the move is genuinely in-band, else falls
  back to the engine's top-of-band. A `source: "llm" | "fallback"` flag records
  which path ran. The engine is strength; the LLM is voice.
- **Gated + honest in `/drop4/`.** A separate **"Experimental: local AI opponent"**
  toggle appears only when a real (non-`isFallbackAdapter`) WebGPU adapter is
  present; the classic engine + difficulty picker stay the default. Enabling it
  shows an up-front one-time-download disclosure; the opponent's spoken reason
  renders beside its move; when on, the tutor's "Explain my options" is narrated
  by the LLM (deterministic facts, LLM wording — best-effort, model-ready only).
- **Validated by the trial.** `AI_TRIAL_MODE=hybrid npm run ai:trial` drives the
  real `/drop4/` UI on system Chrome. Firsthand 2026-08-03 (0.5B, Apple `metal-3`):
  toggle offered → hybrid replied with a **legal** move + a spoken reason
  ("To move: O. Your opening is strong."). CI exercises `HybridPlayer` via
  `MockRuntime` (in-band pick + malformed-output + out-of-band-pick fallbacks).

## What we measured (Drop 4, WebLLM/WebGPU via system Chrome)

| Finding | Result |
|---|---|
| Runtime viability | 0.5B loads ~10s, ~35ms/move; egress + WebGPU + structured output all work |
| Pure-LLM tactics, by size | 0.5B→7B **flat at ~2/7** take-the-win; bigger ≠ better, just slower |
| Prompt content | history + full context: 0/7 → 2/7; few-shot: no further gain |
| Difficulty band | smooth, bounded, tunable (regret 0→4.3, blunder 0%→38%) |
| Hybrid selection (1.5B) | 100% in-band (schema works); regret ≈ random-in-band → **no skill added**, richer context didn't help |

**Conclusion:** the engine is the player; the LLM is the face. Ship the classic
engine; use the LLM for legality + personality + explanation + tutoring.

## In-browser runtime facts

- Drive tests/trials with **system Chrome** (`channel: "chrome"`), headless —
  Playwright's bundled Chromium exposes no `navigator.gpu` here; system Chrome
  gives a real Metal adapter with no special flags.
- Pin a model for reproducible scoring (WebLLM, e.g. `Qwen2.5-1.5B-Instruct-
  q4f16_1-MLC`); Gemini Nano / transformers.js are alternate `AIRuntime`
  adapters, not the scoring baseline.
- **Speed caveat:** the exact solver is endgame-fast but slow from the opening
  (a full empty-board solve is minutes). Live play needs an **opening book or a
  depth cap** — until then, call the oracle from book/endgame positions and seed
  trials from opening lines.

## Scoring harness

`drop4-harness` runs matches between any two `Player`s to a verifiable-by-replay
record and grades each move against the exact oracle: **Optimal /
ResultPreserving / Blunder** (a blunder provably drops the win/draw/loss class),
plus legality and cost. `examples/trial.rs` and `examples/difficulty.rs` are the
reproducible experiments.

### Measuring players in the browser (P6)

The Rust harness grades Rust `Player`s; it cannot exercise the *browser*
`WebLLMRuntime` / `HybridPlayer` (WebGPU only runs in a page). `src/harness/`
mirrors the rig over the browser substrate — **any** shipped game's wasm, reached
through the `GameOracle` port, with the TS players — with the pure scorer +
wasm-driving runner on the CI gate (deterministic players + `MockRuntime`) and the
real WebGPU Hybrid-vs-Engine trial behind a standalone system-Chrome driver
(`npm run harness:trial [HARNESS_TRIAL_GAME=drop4|othello|checkers]`, off CI). It
grades a move **iff the wasm reports it `exact`** — the same honesty gate the
tutor uses, and each game decides what earns the flag (Drop 4: ≤16 empties, a
strict still-provably-exact superset of the Rust rig's ≤12; Othello: the exact
endgame; checkers: a proven terminal).
The full guide is **`docs/HARNESS.md`**.

First browser-rig numbers (`Qwen2.5-0.5B` hybrid vs the Perfect engine, 2 games,
real WebGPU / apple metal-3):

| Finding | Result |
|---|---|
| Strength | Hybrid **0-0-2** vs Perfect — the LLM adds no strength |
| In-band adherence | **0 blunders over 7 graded moves** (6 optimal · 1 preserving) — never drops the class |
| Cost | **~1130 ms/graded move** — the LLM is slow, not strong |

This is the same conclusion the Rust rig reached, now measured on the *actual
shipped browser hybrid*: legality + class-preservation by construction, no skill
added, slower than the engine.

## Generality: a fourth game (Dots and Boxes)

Checkers spent the rule-of-three trigger, so dots was built to *use* the
abstraction rather than to prove it. Two things about the game were candidates for
a seam, and neither turned out to be one:

- **A move need not pass the turn.** Closing a box grants the mover another move.
  `Adversary::side_to_move` already took the position, `runMatch` already picked
  the player from the live board on every iteration, and `gradeSide` already
  re-derived whose move it was during replay. Nothing shared changed. What *was*
  wrong was the **prose** — three places said a match record is an "alternating"
  move list, which stopped being true the moment this game existed.
- **The value is a box margin, not a class.** `class_of` is `value.signum()`, and
  `select_in_band` never looks at what a value means. A margin drops straight in.

What that leaves is a measured statement about the shared code: the fourth game's
`GameOracle` adapter is the **thinnest on the shelf** (an edge index is already a
wire code), and `buildBand` / `HybridPlayer` / `WebLLMRuntime` / `speak` were
reused with no edit at all.

One thing was *simpler* than in the three games before it. Every other game
phrases its band's `idea` in TypeScript — "takes a corner", "takes 2 pieces". This
game's reason is computed in Rust and carried through both the tutor and the
oracle, so the UI opponent and the harness hybrid say the same sentence because it
**is** the same sentence, not because two files agree. That is the better default
for the next game.

**The honesty flag's third shape: mostly true.** Drop 4 is exact-when-tractable,
Othello exact-only-in-the-endgame, checkers exact-only-where-a-terminal-is-proven.
3×3 dots is *solved* from four plies in, so `exact` holds nearly everywhere and the
rig grades **83% of a side's moves** against checkers' 9 of 163. The number to
report is the same either way — a class floor over an empty denominator asserts
nothing, and a full denominator is not a strength claim.

**Furrow lands between them, and shows what the middle costs.** Its `exact` means
the position is inside a measured 16-seeds-in-play threshold, and roughly 70% of a
game sits above it — so the rig grades **27% of a side's moves** (78 of 288 over 12
games), between checkers' 5% and dots' 83%.

| game | what `exact` means | graded |
|---|---|---|
| dots | the board is solved from here | 83% |
| **furrow** | **≤ 16 seeds still in play** | **27%** |
| checkers | a terminal was proven | 5% |

The middle is where the *reporting* rule stops being pedantry. At 83% a blunder
count means something; at 5% nobody is tempted to read it as strength. At 27% it
looks like a real measurement and is not — which furrow demonstrated the hard way:
its weakest level loses **0-0-12** to its strongest and records **zero blunders**
in both directions. See `docs/HARNESS.md` → "Furrow's demonstration" for why, and
report the graded fraction next to the count every single time.

### The fallback rate is a decoder problem, not a model problem

The live trials also measured how often the model's reply is unusable and the
engine has to step in. A fallback is always *safe* — the engine's own top-of-band
move is played — so this is a UX number: it is how often the persona goes quiet.
Dots measured **1.2%** and Furrow **10.9%** on the same model and the same rig,
which is a 9× difference nobody could explain from the aggregate alone.

**Counting the three fallback paths separately settled it in one run.** Every
single furrow fallback was `malformed` — zero runtime errors, zero out-of-band.
Capturing the replies verbatim showed what "malformed" actually meant:

```text
"{   \n\n\n\n\n\n\n\n  \n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n ..."
```

The model emits an opening brace and then **hundreds of newlines** until the token
budget is gone. That is not a bad answer, a long answer, or a truncated one — it is
**grammar-constrained decoding wandering**. JSON permits arbitrary whitespace after
`{`, so the grammar always allows another newline, and a small model sampling at
non-zero temperature can get stuck emitting them. Raising `maxTokens` would only
buy more newlines.

It is a *sampling accident*, independent per call, so `HybridPlayer` now
**resamples once** before falling back. Measured immediately after, same rig, same
8 games:

| | before | after |
|---|---|---|
| furrow fallback rate | 10.9% | **2.7%** (10 of 13 rescued) |
| dots fallback rate | 1.2% | 1.1% |

Three things worth carrying forward. **A retry is only correct for the path that
is a sampling accident** — a runtime throw is not retried, and an out-of-band pick
is not retried, because neither gets better by asking again. **The aggregate rate
was not actionable**; the three-way split and one verbatim sample were. And the
defect was in *shared* code, so it had been costing every game on the shelf since
the first hybrid shipped — it simply took a game with a high enough rate to make
anyone look.

### The band's guarantee is only as strong as the exact fraction

Every hybrid opponent on this shelf is sold the same way: the engine builds a band
of moves it rates as sound, the model picks inside it, so the model cannot lose
the game. **That claim is not uniformly true, and the live trials measured how
far it varies.**

Eight games each against Expert, same model, same rig (2026-08-10):

| | dots | furrow |
|---|---|---|
| W-D-L for the hybrid | **4-0-4 (50%)** | **1-0-7 (13%)** |
| graded / skipped | 69 / 16 (**81% exact**) | 23 / 87 (**21% exact**) |
| fallback rate | 1.2% | 10.9% |
| ms per graded move | 389 | 1,483 |
| blunders | 0 | 0 |

Dots' hybrid is *indistinguishable from the engine*. Furrow's loses seven of
eight. Both record **zero blunders**.

The mechanism is the one already documented above, seen from a new angle.
`buildBand` filters on `quality !== "blunder"`, and `quality` compares a value's
class against the best available. Where the search is **exact**, that class is a
proof and the band really is a set of non-losing moves. Where it is **capped**,
the class is the heuristic's opinion — so the band is the engine's *judgement*,
and a model picking badly inside it can and does lose. Dots is solved from four
plies in; furrow is proven for about a fifth of its moves.

**So the guarantee scales with the exact fraction, and the UI copy has to scale
with it too.** Furrow shipped with dots' sentence — "it never plays a losing move
(the engine's band decides)" — copied across, where it was simply false for 70% of
a game. Nothing on CI could catch that: legality *is* guaranteed by construction,
the mock-runtime tests pass, and the blunder count is 0 in both columns because it
is blind to a player that loses outside the graded region.

**Only running the model found it.** Before promising a band guarantee in
player-facing copy, check the game's exact fraction — and if it is not most of the
game, say what the band actually is.

## Generality: a second game (Othello), then a third (checkers)

Othello (`/othello/`, `crates/othello-*`) is the proof that the adversarial +
AI machinery generalizes beyond the game it was built with. What reused, and
what was new, *is* the finding:

- **Reused unchanged (shared code):** the game-agnostic harness —
  `src/harness/hybrid-player.ts` (`buildBand` / `HybridPlayer`) and
  `ai-runtime.ts` (`AIRuntime` / `WebLLMRuntime`). Othello builds its band from
  `othello.tutor().moves` exactly as Drop 4 does; the wasm tutor view is a
  structural superset of `TutorFactMove` (`immediateWin`/`blocksOpponentWin`
  carried as `false`), so `buildBand` needed no change. Othello's one-ply fact is
  `takesCorner` instead.
- **Reused as a pattern (copied per-game TS):** the tutor panel, the
  WebGPU-availability probe + experimental toggle, the result screen, the how-to.
- **New (game-specific):** the Rust `othello-{core,solver,wasm}` and the
  front-end wrapper — implementing the shared `Adversary` trait +
  `pond_outcome::Game`.

**The honesty flag generalizes with a twist.** Drop 4 is solvable, so its oracle
is exact-when-tractable / capped-otherwise. Othello is **not solved from the
opening**, so its oracle is a *heuristic* alpha-beta with an **exact full solve
only in the deep endgame** — the same shape, renamed **exact / heuristic**.
Because a heuristic proves no win/draw/loss class, Othello's tutor **never** grades
a move a blunder outside the exact endgame: it says "that threw the game" only
when `exact`, and hedges to "looks risky" otherwise. An exact-worded verdict on a
heuristic judgment would be a false claim of perfect knowledge, so the wording is
bound to the `exact` flag (pinned by the `coachFor` unit test).

The seam a new game plugs into: the `Adversary` trait + `pond_outcome::Game` (the
core), the TS harness (the opponent), and the tutor's `{quality, exact}` interface
(the coaching) — not shared game logic.

**The persona is constrained too, not just the move.** `HybridPlayer` keeps the
model inside the class-preserving band, so it cannot play a losing move; nothing
kept it from *saying* a losing thing. Measured on a 0.5B model: "capturing the
opponent's king with a move to 8", with no king on the board. The move was safe
and the sentence was false, which is the cosmetic cousin of an over-claimed
`exact` — the player is being told something untrue about their own game by
something that sounds authoritative. `src/harness/banter.ts` is the shared filter
(all three games use it): a line is rejected if it is empty, an essay, or makes a
**checkable positional claim** — any digit, or a board noun like row / column /
square / position / diagonal. Verbs are deliberately allowed, because "I'll be
king soon" is character and banning it leaves a persona nothing to say.

It is a filter, not a fact-checker: verifying a claim would mean parsing the
sentence against the board, per game, which is far more machinery than a quip is
worth. Measured after the change on `/checkers/` over 8 replies, 2 lines were the
model's own and 6 fell back to the canned line — and two of the two that passed
were vague ("Capture on move to win the game"). The filter removes the class of
line that asserts a false board fact; it does not make a small model articulate.
That is the honest boundary of what this buys.

**Checkers (`/checkers/`, `crates/checkers-*`, landed 2026-08-06) is the third,
and it is the one that tested the abstractions rather than repeating them.** Drop
4's move is a column and Othello's is a cell: both a single `u8` naming a
destination. Checkers' move is a **jump chain** — a piece plus an ordered list of
landings, packed as `(from, to, variant)` into a 14-bit code — and legality is
global rather than local, because capture is mandatory. Every shared piece carried
without modification: `buildBand`/`HybridPlayer`, `ai-runtime.ts`, the
`adversary-solver` band selector, the `?r=` replay property, and the scoring rig
(`git diff --stat` on `match-runner`/`scorer`/`tournament` was empty for the phase
that added it). The `GameOracle` adapter is a pure pass-through — **smaller** than
Othello's, which has to normalize a pass — because the port only ever asked that a
move be a compact number, and a packed path is one.

**Two things checkers changed rather than confirmed:**

- **`exact` was redefined from "how much was searched" to "what was proven."**
  Drop 4 and Othello can both exhaust a position, because a move fills a square,
  so depth is bounded by the empties. Checkers positions *cycle* — kings shuffle —
  so the tree is bounded by the 80-ply no-progress draw, not by material; a
  four-piece endgame is ~3.8M nodes. So a fact is `exact` when its value came from
  a **real terminal reached within the search** rather than from a heuristic at
  the horizon. That is the same guarantee the flag always licensed (a provable
  win/draw/loss class), and it keeps the game gradeable — a never-exact game
  reports `scoredMoves == 0` forever and the harness measures nothing.
- **The honest Oracle shape now has two unsolved-game precedents**, not one. When
  a future game (chess is the obvious one) needs an Oracle that cannot solve from
  the opening, Othello shows the endgame-solve variant and checkers shows the
  proof-of-terminal variant; both bind the tutor's wording to the flag, and both
  are pinned by a `coachFor` unit test that asserts *both* branches.
