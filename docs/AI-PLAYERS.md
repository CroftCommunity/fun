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
