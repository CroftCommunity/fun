# Drop 4 — the AI + tutor layer (deterministic tutor → WebLLM runtime → hybrid opponent)

> Detailed execution plan for the next chunk of the Drop 4 program: the
> **tutor** and the **in-browser LLM** layer (P3 `AIRuntime`, P4 `HybridPlayer`,
> P5 tutor from `plans/2026-08-03-drop4-playable-and-hybrid-buildout.md`).
> Re-ordered **deterministic-tutor-first** to de-risk the WebGPU dependency, with
> a **Phase 0** that re-confirms the browser environment before any LLM code is
> committed. Othello (P7) is a **named follow-on** with its own phase-plan.

## Problem Statement

Drop 4 ships and is live, but the "AI player" story is only half built: the
opponent is the **classic engine** (strong, deterministic), and the **LLM layer
does not exist yet**. Two capabilities remain, both promised by the governing
plans and `docs/AI-PLAYERS.md`:

1. A **tutor** — engine-grounded coaching ("that threw a win to a draw — col 4
   held it", "here are three reasonable moves and why"). This is the *strongest*
   LLM role because the facts come from the engine and can't be wrong; but the
   facts themselves are computable **without** any LLM.
2. An in-browser **LLM runtime** (`AIRuntime` + WebLLM) and a **hybrid
   opponent** (`HybridPlayer`): the engine builds a difficulty band, the LLM
   picks within it under a schema and narrates — a *characterful, tunable*
   experimental opponent (measured to add personality, not strength).

**Constraint that shapes everything:** the LLM parts need **WebGPU + a model
download**, which runs **only in system Chrome** (bundled Chromium exposes no
`navigator.gpu`) and **cannot run in CI** (node 20, no GPU). The tutor's *value*
does not depend on the LLM. So the plan builds the deterministic tutor first
(ships everywhere, gate-testable), then quarantines the GPU-dependent LLM work
behind an "Experimental: local AI" toggle that never gates the deploy.

## Reasoning

- **Deterministic-tutor-first is the de-risk.** The engine already computes
  every tutoring fact (`drop4-harness::hybrid::assess` → quality, regret,
  immediate-win, blocks-opponent-win; the difficulty band). Surfacing those as
  plain text is a real, shippable feature with **zero** WebGPU dependency and
  full CI coverage. The LLM only *narrates* those facts later — so if the WebGPU
  path is flaky in some environment, the tutor still shipped. This inverts the
  build-out plan's P4-before-P5 order deliberately, and the ordering change is
  the main reason this detailed plan exists.
- **The engine is strength; the LLM is voice** (measured: 0.5B–7B ≈
  random-in-band, `docs/AI-PLAYERS.md`). So the hybrid opponent is *explicitly*
  experimental and behind a toggle; the classic engine stays the default. We are
  not trying to make the LLM play better — only legal, in-band, and characterful.
- **Compute tutor facts wasm-side, not via the harness.** `drop4-wasm` depends on
  `drop4-solver` but not `drop4-harness` (verified). Rather than add a heavy dep
  or move the `MoveQuality`/`ClassFloor` enums, the wasm computes per-move
  assessments from solver primitives it already uses (`move_values` exact,
  `move_values_capped` fast) plus two one-ply core checks (immediate-win,
  blocks-threat) — the same three-line logic `hybrid.rs` uses. A small,
  self-contained duplication beats a cross-crate coupling here.
- **Exact-when-tractable, capped-otherwise — reused.** Assessments face the same
  full-solve speed wall as difficulty. The tutor reuses the `TRACTABLE_EMPTIES`
  switch already in `live_move`: exact facts in the endgame (provably right),
  capped facts earlier (horizon-approximate) — and the tutor **says so** when a
  fact is heuristic, so it is never dishonest.
- **Assess at decision time, not by replay.** "Was that a blunder" needs the
  position *before* the move. The module assesses the tapped column at the
  current position (human to move) **before** applying it, caches the verdict,
  and surfaces it after the engine replies — no replay, no pre-move board
  tracking in the core.
- **LLM code must be lazy so CI/build never touches GPU code.** WebLLM is
  imported dynamically only when the experimental toggle is used, as a separate
  esbuild chunk (or a runtime import). The shelf bundle and CI unit run must not
  pull in `@mlc-ai/web-llm`. `MockRuntime` (deterministic) is what CI exercises.
- **Trials are a standalone driver, not a main-config Playwright project.**
  Adding a `channel:"chrome"` project to `playwright.config.ts` would make the
  whole e2e suite try to run under system Chrome and would run in CI. Instead the
  LLM trial is a separate script (`tools/ai-trial.mjs`) that launches system
  Chrome, kept off the CI gate.

### Alternatives considered and rejected

- **P4 (hybrid opponent) before the tutor** (the build-out plan's order).
  Rejected: it front-loads the WebGPU dependency for a feature that adds no
  strength, while the highest-value, lowest-risk piece (the tutor) waits.
- **Add `drop4-harness` as a `drop4-wasm` dependency** to reuse `assess`.
  Rejected: harness's `band`/`assess` use only the *exact* oracle (slow from the
  opening) and pull the scorer/trial machinery into the wasm. The wasm needs the
  exact-or-capped switch, which lives in `drop4-solver`. Compute wasm-side.
- **Bundle WebLLM into the main `app.js`.** Rejected: it bloats every game's
  bundle with a multi-hundred-KB library only the experimental toggle uses.
  Lazy/separate-chunk load instead.
- **Ship the LLM opponent as a default.** Rejected (already, in the harness
  plan): slow, large download, no strength gain. Experimental toggle only.

## Verified Assumptions

- **`drop4-wasm` deps** (read `crates/drop4-wasm/Cargo.toml`): `adversary-core`,
  `drop4-core`, `drop4-solver`, `pond-outcome`, `serde`, `serde_json`,
  `rand_chacha`. **No `drop4-harness`.** → tutor facts computed wasm-side.
- **Engine tutoring primitives exist** (read `crates/drop4-harness/src/hybrid.rs`):
  `assess` → `MoveAssessment { col, quality, value, best_value, regret,
  immediate_win, blocks_opponent_win }`; `is_immediate_win`/`blocks_opponent_win`
  are one-ply, oracle-free (`winner(apply_move(...))`); `quality_of(value, best)`
  = Optimal if equal, ResultPreserving if same sign, else Blunder. `MoveQuality`
  + `ClassFloor` live in `drop4-harness`, **not** reachable from the wasm.
- **Solver primitives the wasm already uses** (read `crates/drop4-solver/src/{solver,live}.rs`):
  `Solver::move_values` (`solver.rs:200`, exact per-move value),
  `live::move_values_capped(depth)` (`live.rs:168`, fast), `live::select_in_band`
  (`live.rs:256`), `live::live_band(level)` (`live.rs:221`).
- **The exact|capped switch already lives in the Phase-1a write-set file**
  (read `crates/drop4-wasm/src/lib.rs`): `live_move` (`lib.rs:257`) switches exact
  ≤ `TRACTABLE_EMPTIES` (`lib.rs:240`, = 16) else capped. This is *not* in
  `drop4-solver` — it is in `drop4-wasm/src/lib.rs`, the exact file Phase 1a
  edits, so `assess_json`/`tutor_json` reuse the switch pattern in-place (Pass 3
  corrected the earlier mis-attribution to the solver crate).
- **No `@mlc-ai/web-llm`, no `zod`** in `package.json` (verified); **no
  `src/harness/` dir** — the TS harness + LLM runtime are greenfield.
- **Playwright projects** = `chromium` (bundled) + `mobile-webkit` only (read
  `playwright.config.ts`) — no system-Chrome project. Bundled Chromium has no
  `navigator.gpu`.
- **CI gate** (read `.github/workflows/deploy.yml`): node 20 →
  `build:wasm → typecheck → lint → unit → build.mjs → Pages`. **No e2e, no cargo
  test, no GPU.** So the LLM path is never on the CI gate; the tutor's unit +
  the MockRuntime unit are.
- **[Phase 0 D1, firsthand 2026-08-03 — CONFIRMED, runnable here]** Probed system
  Chrome (`channel:"chrome"`) via Playwright in this environment. **Egress works**
  (HTTP 200 from the Hugging Face model CDN — `mlc-chat-config.json` fetched).
  **WebGPU works** with a real **Apple `metal-3` adapter** — `navigator.gpu`
  present and `requestAdapter()` returns the Metal adapter — on a **real secure
  origin** (`https://fun.croft.ing/`, `/drop4/`), **both headless and headful**.
  Gotcha that produced an initial false negative: on an **opaque `about:blank`
  origin** `navigator.gpu` is absent even with the GPU present — the trial driver
  must navigate to a real origin (the served app / localhost / the live site),
  not a blank page. **Consequence: the entire LLM path — real inference, D3
  structured output, the `ai:trial` transcript (2b), the live hybrid (3b) — is
  runnable in this environment.** `fun.croft.ing` (or the localhost serve on
  4180) is the origin the driver points system Chrome at.
- **[Phase 0 D3 + D2, firsthand 2026-08-03 — CONFIRMED]** Ran a real WebLLM
  inference in this environment (system Chrome, `https://fun.croft.ing/drop4/`,
  `Qwen2.5-0.5B-Instruct-q4f16_1-MLC`): model loaded on WebGPU in ~7.4 s, one
  generation in ~1.6 s. **D3 structured output works** via
  `engine.chat.completions.create({ response_format: { type: "json_object",
  schema: JSON.stringify(<JSON Schema>) } })` — returned `{"move": 3, "reason":
  "…"}` with `move` inside the supplied legal-column `enum`, `temperature: 0`.
  This is the exact `WebLLMRuntime` API. (The CDN import path was *proven* here
  but is **not** how we ship — see D2.)
- **[Phase 0 D2 decision, revised 2026-08-03 — EMBED, no third-party CDN for code]**
  The maintainer's constraint: this is an **offline-capable PWA** and a
  third-party CDN for executable code is both an availability and a **code-injection**
  risk. So `@mlc-ai/web-llm` is a **`package.json` dependency, embedded** — bundled
  by a **separate esbuild entry** to a same-origin lazy chunk (`dist/vendor/webllm.js`),
  which `WebLLMRuntime` dynamically imports **from our own origin** only when the
  experimental toggle fires. app.js stays byte-unchanged for non-AI games (a
  distinct output, not global esbuild `splitting`). No `zod` (hand-written JSON
  Schema). **Honest caveat, flagged to the user:** embedding the *library* closes
  the CDN/injection vector for runtime code, but WebLLM still fetches the model
  **weights + per-model `model_lib` WASM** from the MLC/HF CDN on first load (then
  caches in-browser) — full self-hosting (offline + closing the `model_lib`
  code-fetch vector) is a **named follow-on** (hosting ~1 GB is not viable on
  GitHub Pages; needs a different host). The up-front size disclosure stays.
- **[web research / prior spike, superseded by the D1 probe above]** The
  2026-08-03 harness Phase-0 spike loaded WebLLM (`Qwen2.5-0.5B/1.5B`) headless
  via **system Chrome** (`channel:"chrome"`), confirmed `navigator.gpu`, model-CDN
  egress (`huggingface.co → 200`), ~35 ms–1 s/move, and structured output
  (`response_format` json_object+schema **and** grammar) on 0.5B. That was a
  throwaway spike; Phase 0 re-confirms it reproducibly in the *current*
  environment before any LLM code is committed.

## Documentation Impact

- `docs/AI-PLAYERS.md` — the tutor section becomes real (**1c**); the
  `AIRuntime`/structured-output sections confirmed against the shipped code
  (**2b**); the `HybridPlayer` section + measured findings (**3b**).
- `docs/BUILDING-GAMES.md` §10 (`docs/BUILDING-GAMES.md:418`) — fill in the ports
  as they land: `Player`/`Oracle` + the tutor (**1c**), `AIRuntime` (**2b**),
  `HybridPlayer` (**3b**).
- `README.md` — note the tutor (**1c**) and the experimental local-AI opponent
  (**3b**).
- `TODO/drop4.md` — check off P5 (**1c**), P3 (**2b**), P4 (**3b**) as each lands.
- `plans/2026-08-03-drop4-playable-and-hybrid-buildout.md` — add a pointer to
  this detailed plan and record the tutor-first re-ordering (**1a**, Phase 1 start).
- `src/games/drop4/drop4-howto.ts` + `tools/guide-shots.mjs` + `assets/guide/` —
  a tutor how-to entry + a `drop4-tutor` shot (**1c**, per the guide-shots
  discipline). Stage only drop4 shots.
- `package.json` — `@mlc-ai/web-llm` (+ `zod` for schema authoring) as deps
  (**2a**), loaded lazily.
- `tools/ai-trial.mjs` + `package.json` script `ai:trial` — the system-Chrome
  LLM trial driver (**2b**). **Not** added to `playwright.config.ts`.
- Grepped for `src/harness` references: none (dir does not exist yet).
- **No trailing docs phase:** every doc rides the sub-phase that makes it stale
  (1c after 1b; 2b docs with the trial; 3b docs with the picker). Verified
  present: AI-PLAYERS.md (1c/2b/3b), BUILDING-GAMES §10 (1c/2b/3b), README (1c/3b),
  TODO/drop4.md (1c/2b/3b), build-out-plan pointer (1a) — each mapped to a phase
  Change item above.

## Concurrency Map

```
Sequential spine: Phase 0 → Phase 1 (tutor) → Phase 2 (AIRuntime) → Phase 3 (hybrid)
```

**Parallel candidate {Phase 1, Phase 2} — kept sequential by default** for
localhost-review focus (the shelf's review-between-steps cadence, as in the
build-out plan):
- **Code/test/asset write-sets are disjoint:** Phase 1 writes `crates/drop4-*`,
  `src/games/drop4/*`, `styles.css`, `tests/drop4.spec.ts`, `assets/guide/drop4-tutor.jpg`,
  `tools/guide-shots.mjs`; Phase 2 writes `src/harness/*`, `package.json`,
  `tools/ai-trial.mjs`, `tests/ai-runtime.test.ts`. No overlap there.
- **But the doc write-sets now overlap (Pass 3):** the Pass-3 documentation-coverage
  fix assigned `docs/AI-PLAYERS.md`, `docs/BUILDING-GAMES.md` §10, and `TODO/drop4.md`
  to **both** Phase 1c (tutor sections / P5) **and** Phase 2b (`AIRuntime` sections /
  P3). Different sections of the same files — a merge-conflict hazard, *not* a
  correctness hazard — but it means {Phase 1 ‖ Phase 2} is **no longer cleanly
  parallelizable** without serializing those three doc files. This *reinforces*
  the sequential default rather than weakening it.
- Shared-state contract: both build under `target/` (cargo lock serializes, not
  a correctness hazard) and, for their tests, bind the serve port 4180 — so if
  ever run in parallel they must use **disjoint ports**, not both hold the cargo
  lock, **and serialize the three shared doc files**. Neither invokes
  `git checkout`/`stash`/`rebase` in the parent worktree.
- Re-entry verification (only if parallelized): parent HEAD == pre-dispatch SHA;
  no serve process left on 4180 (`lsof -i :4180` empty); the three shared doc
  files have no conflict markers; `git status` clean.
Because they share the cargo `target/`, the serve port, **and now three doc
files**, and the value is review focus over wall-clock, **default sequential**.
Phase 3 depends on both.

## Phases

> **TDD ordering (all phases, Pass 3):** every phase's named wiring/unit test is
> written **RED first** and watched fail before any GREEN production code — the
> `[ ]` production bullets below are the GREEN target, not the starting point.
> This is repo law (project `CLAUDE.md` → "TDD, always"; `tdd-guardian`), stated
> here so a reader executing phase-by-phase writes the test first. Phase 0 is the
> sole exception (Discovery Exemption — probes produce knowledge, not shipped code).

### Phase 0: Discovery (WebGPU / model-download / delivery)

**Goal:** Re-confirm the LLM browser environment reproducibly and resolve the
delivery unknowns **before** any LLM code is committed. Discovery Exemption
applies (no TDD; probes produce knowledge).

- [ ] **D1: Does a real WebLLM inference run in *this* environment?**
  - **Probe:** A throwaway Playwright script (system Chrome, `channel:"chrome"`,
    headless) that loads WebLLM, asserts `navigator.gpu` is present, loads
    `Qwen2.5-1.5B-Instruct-q4f16_1-MLC`, and completes one inference on a
    rendered Drop 4 prompt. Record: GPU adapter, model-CDN egress status
    (`GET huggingface.co/... → 2xx`), load time, ms/move.
  - **Success criteria:** one real inference completes headless via system
    Chrome; egress to the model CDN returns 2xx.
  - **Disposition:** `keep-as-fixture` — the launch config becomes
    `tools/ai-trial.mjs`'s Chrome-launch options (Phase 2).
- [ ] **D2: WebLLM delivery — bundle vs lazy chunk vs runtime CDN import.**
  - **Probe:** Try `npm i @mlc-ai/web-llm`; confirm esbuild can `import()` it as a
    **separate lazy chunk** loaded only on the experimental toggle (not folded
    into `app.js`); measure the chunk size and confirm weights still stream from
    the CDN at runtime. Compare against a plain runtime CDN `import()`.
  - **Success criteria:** a decision — lazy separate chunk vs CDN import — plus a
    confirmed load path in our *built* app (not just a throwaway HTML page), and
    the shelf's main `app.js` size **unchanged** for non-AI games.
  - **Disposition:** `throwaway` (findings recorded) → informs Phase 2.
- [ ] **D3: Structured output on the pinned model, via our schema author.**
  - **Probe:** With the model from D1, confirm `response_format:
    {type:"json_object", schema}` returns a typed `{move∈enum, reason}` and/or a
    grammar over the legal digits forces one legal column — authored via
    `zod`→JSON-Schema (confirm `zod` is the tool we want, or hand-write the
    schema).
  - **Success criteria:** a schema-valid `{move, reason}` object with `move`
    inside the supplied legal-column enum, reproducibly.
  - **Disposition:** `keep-as-fixture` — the schema becomes `hybrid-player.ts`'s.

**Depends on:** nothing (uses the shipped `drop4.wasm` + a throwaway page).
**Read/Write-set:** reads none of the repo's source; writes only scratchpad
spike files (thrown away) + records findings into this plan's Verified
Assumptions + `docs/AI-PLAYERS.md` measured notes.
**Shared-state contract:** launches system Chrome (a process) + binds a local
static port for the probe page; network egress to the model CDN. No repo state
mutated.
**Done when:** D1–D3 resolved with firsthand evidence recorded here; the
delivery decision (D2) is made. If D1 fails (no WebGPU/egress here), Phases 2–3
proceed **mock-only** and the real trial is documented as "run in a credentialed
GPU environment" — the tutor (Phase 1) is unaffected.
**Validation:** Discovery — evidence recorded, no tests.

### Phase 1: Deterministic tutor (engine-grounded, no GPU)

**Goal:** Engine-grounded coaching in `/drop4/` with **no** LLM: explain the
options, flag a blunder, and a *why*-hint — all from exact/capped engine facts,
shipping everywhere and covered by the CI gate.

#### Phase 1a — tutor facts at the wasm boundary
**Changes:**
- [ ] `crates/drop4-wasm/src/lib.rs` — `assess_json(col)` (quality string /
  regret / immediate-win / blocks-threat / value for a candidate move at the
  **current** position) and `tutor_json()` (the current position's per-move
  assessments + the best move + whether facts are `exact` or `capped`). Reuses
  `Solver::move_values` (≤ `TRACTABLE_EMPTIES`) / `live::move_values_capped`
  otherwise; quality computed inline (sign compare); one-ply facts via
  `winner`/`apply_move`. Never panics.
- [ ] `src/games/drop4/drop4-wasm.ts` — typed `assess(col)` + `tutor()`.
- [ ] `plans/2026-08-03-drop4-playable-and-hybrid-buildout.md` — **green sub-step
  (docs, Phase 1 start):** add the pointer to this detailed plan and record the
  tutor-first re-ordering (per Documentation Impact).
**Call chain:** `drop4.ts` tutor panel → `Drop4.tutor()`/`assess(col)` → wasm →
`drop4_solver`.
**Wiring test:** a cabi unit in `drop4-wasm/src/lib.rs` using **reachable-from-
empty** positions (the C-ABI can only reach positions by playing from `new_game`;
the 16-empty BLUNDER_FIXTURE is *not* reachable by a known sequence — Pass 2):
after `play [0,1,0,1,0,1]` (A has three in col 0, to move), `assess_json(0)`
reports an immediate win / optimal; after `play [0,3,1,3,2,3]` (B threatens col
3, A to move), `assess_json(3)` reports `blocks_opponent_win`, and a non-blocking
column reports a class-dropping blunder (capped detects it within the horizon).
`tutor_json()` includes the `exact|capped` flag (here `capped`, since these are
early positions). Fold into the single stateful cabi test.
**Mutation resistance (Pass 3):** `quality_of` has **three** branches (Optimal =
equal, ResultPreserving = same sign but not equal, Blunder = opposite sign). The
cases above pin Optimal (the win) and Blunder (the non-blocking drop) but *not*
the middle branch — add a **ResultPreserving** case (a legal non-optimal move
that keeps the result sign) so all three branches are pinned and a `==`→`>=`
mutation on the sign compare is caught. **The
provably-`exact` assessment is covered by the solver-level unit
`exact_band_preserve_class_never_throws` + a new solver unit for the
`exact|capped` flag by empty-count — not at the wasm boundary, where a ≤16-empty
position isn't hand-reachable.** That solver unit must **name the threshold
edge**: a 16-empty position reports `exact`, a 17-empty position reports `capped`
(TRACTABLE_EMPTIES = 16), so a `<=`→`<` mutation on the switch is caught — not a
single-point assertion.
**Depends on:** Phase 0 (none of its code, but confirms the direction).
**Read-set:** `crates/drop4-solver/src/{solver,live}.rs`, `crates/drop4-core`.
**Write-set:** `crates/drop4-wasm/src/lib.rs`, `src/games/drop4/drop4-wasm.ts`,
`plans/2026-08-03-drop4-playable-and-hybrid-buildout.md`.
**Shared-state contract:** no shared mutable state beyond the file write-set.
**Risks:** capped assessments in the opening are horizon-approximate — the
`exact|capped` flag must be surfaced so the UI is honest. The tutor asserts
"blunder" confidently only when `exact`; when `capped` it softens to "looks
risky" (Pass 2 honesty refinement, applied in Phase 1b).
**Done when:**
1. **Behavioral:** JS can ask the wasm for a move's quality/threat facts and for
   the whole position's assessment, exact in the endgame and capped earlier.
2. **Verification:** `cargo test -p drop4-wasm` (the cabi wiring test) **+ `cargo
   test -p drop4-solver`** (the new `exact|capped`-by-empty-count boundary unit
   lives in the solver crate, so it must run in the phase that introduces it) +
   `npx tsc --noEmit`.
**Validation:** Moderate — unit at the C-ABI boundary + the solver boundary unit
+ typecheck.

#### Phase 1b — tutor panel UI
**Changes:**
- [ ] `src/games/drop4/drop4.ts` — a tutor panel: **"Explain my options"**
  (lists the band moves + the idea behind each, from `tutor()`), **blunder
  flagging** (assess the tapped column *before* applying; if it drops the class,
  surface "that threw a win to a draw" after the engine replies), and upgrade the
  existing **hint** to say *why* (a class-preserving band move + the fact). Tutor
  on by default; honest `exact|capped` wording.
- [ ] `styles.css` — tutor panel styles (append-only, semantic tokens).
- [ ] `tests/drop4.spec.ts` — e2e: after a deliberate blunder the tutor reports
  the class drop with an explanation; "explain my options" lists ≥2 band moves;
  the why-hint names a column and a reason. Axe clean. **Observability assertion
  (Pass 3):** the blunder driven through the early-game UI is a *capped*
  position, so the e2e asserts the softened **"looks risky"** wording (not the
  confident "threw a win to a draw") — this proves the `exact|capped` honesty
  flag actually reaches the DOM, not just that a blunder message appears. The
  confident *exact* wording is pinned at the unit level in 1a (a ≤16-empty
  position isn't hand-reachable through the UI in a short move sequence).
**Call chain:** drawer → `drop4Module.mount` → tutor panel → `Drop4.tutor()`.
**Wiring test:** `tests/drop4.spec.ts` "the tutor flags a blunder end-to-end" —
drives a blunder through the `/drop4/` UI and asserts the coaching text.
**Depends on:** Phase 1a.
**Read-set:** `src/games/drop4/drop4-wasm.ts`, `src/settings.ts`.
**Write-set:** `src/games/drop4/drop4.ts`, `styles.css`, `tests/drop4.spec.ts`.
**Shared-state contract:** e2e binds serve port 4180; no other ambient state.
**Risks:** blunder-at-tap assessment must not slow the tap (capped is fast; exact
only in endgame — fine).
**Done when:**
1. **Behavioral:** playing `/drop4/`, the tutor explains options, flags a
   blunder with the engine's class-drop truth, and hints with a reason — no model
   download, works in both themes.
2. **Verification:** `npm run test` + `npm run e2e` (incl. the tutor e2e + axe).
**Validation:** Broad — full gate + manual play; this ships to everyone via CI.

#### Phase 1c — tutor how-to, guide shot, and tutor-doc updates
*(Split from 1b per Pass 2 — the docs/shots made stale **by 1b**, run
immediately after; not a trailing docs phase.)*
**Changes:**
- [ ] `src/games/drop4/drop4-howto.ts` — add the tutor how-to block.
- [ ] `tools/guide-shots.mjs` + `assets/guide/drop4-tutor.jpg` — regenerate the
  `drop4-tutor` guide shot (`npm run build:wasm && npm run build && npm run
  guide:shots`). **Stage only drop4 shots** (`git checkout --` the rest — guide:shots
  rebuilds every game's JPEGs, per project CLAUDE.md).
- [ ] `docs/AI-PLAYERS.md` — the tutor section becomes real (reconcile against
  the shipped 1a/1b behavior).
- [ ] `docs/BUILDING-GAMES.md` §10 — fill in the tutor + the `Player`/`Oracle`
  port entries now that the tutor has landed.
- [ ] `README.md` — note the tutor.
- [ ] `TODO/drop4.md` — check off **P5 (tutor)**.
- [ ] `plans/2026-08-03-drop4-playable-and-hybrid-buildout.md` — *(if not already
  done in 1a)* confirm the pointer to this detailed plan + the tutor-first
  re-ordering is recorded.
**Wiring test:** a unit fails on a missing referenced guide shot; an e2e fails on
a 404 for `assets/guide/drop4-tutor.jpg` — both already in the gate (project
CLAUDE.md guide-shot discipline). No new wiring test; 1c is doc/asset reconciliation
whose gate is the existing shot-reference checks.
**Depends on:** Phase 1b.
**Read-set:** `src/games/drop4/drop4.ts` (for the how-to copy + shot).
**Write-set:** `src/games/drop4/drop4-howto.ts`, `tools/guide-shots.mjs`,
`assets/guide/drop4-tutor.jpg`, `docs/AI-PLAYERS.md`, `docs/BUILDING-GAMES.md`,
`README.md`, `TODO/drop4.md`. *(Committed in green sub-steps: how-to+shot; docs —
the proven cadence from the P1 build.)*
**Shared-state contract:** `guide:shots` rebuilds all games' shots; stage only drop4.
No other ambient state.
**Done when:**
1. **Behavioral:** the how-to shows a current tutor screenshot; the tutor doc,
   §10, and README describe the shipped tutor.
2. **Verification:** `npm run test` (shot-reference unit) + `npm run e2e` (shot 404
   check).
**Validation:** Moderate — doc/asset reconciliation gated by the existing
shot-reference checks; no new behavior.

### Phase 2: `AIRuntime` port + WebLLM adapter (P3)

**Goal:** a browser LLM runtime behind one interface, deterministic for CI
(`MockRuntime`) and real on localhost (`WebLLMRuntime`, system Chrome), with a
standalone trial driver. No game wiring yet.

**Sub-phases (per Pass 2):** **2a** = the port + mock + dep (first three bullets
below); **2b** = the `ai:trial` driver + the recorded real-model transcript.
**Changes:**
- [ ] *(2a)* `src/harness/ai-runtime.ts` — `AIRuntime` port (`generate(prompt,
  {schema?|grammar?, greedy, maxTokens}) -> Promise<string>`, `fingerprint()`),
  `MockRuntime` (deterministic, scripted). **`WebLLMRuntime` is dynamically
  imported** (lazy chunk / CDN per D2) so CI/build never pull `@mlc-ai/web-llm`.
- [ ] *(2a)* `tests/ai-runtime.test.ts` — vitest over `MockRuntime` (deterministic,
  schema-shaped output) **and the lazy-import guard** (asserts the module loads
  with `@mlc-ai/web-llm` absent), on the CI gate.
- [ ] *(2a)* `package.json` — `@mlc-ai/web-llm` (+ `zod` if D3 chose it), lazy-loaded.
- [ ] *(2b)* `tools/ai-trial.mjs` + `package.json` script `ai:trial` — launches
  **system Chrome** (the D1 config), loads `WebLLMRuntime` with the pinned model,
  runs a structured prompt, prints a schema-valid object. Not a Playwright
  project; not on CI. **Observability (Pass 3):** the driver emits a **staged
  diagnostic line per checkpoint** — `gpu-adapter`, `model-load`, `generate`,
  `schema-validate` — each `pass|fail` with timing, and on a schema failure it
  prints the **raw model output** it rejected. So a failing trial is diagnosable
  from the transcript alone (which stage broke, and why) without attaching a
  debugger.
- [ ] *(2b, green sub-step — docs)* `docs/AI-PLAYERS.md` — reconcile the
  `AIRuntime`/structured-output sections against the **shipped** port + the
  recorded `ai:trial` transcript; `docs/BUILDING-GAMES.md` §10 — fill in the
  `AIRuntime` port entry; `TODO/drop4.md` — check off **P3 (`AIRuntime`)**.
**Call chain:** `tools/ai-trial.mjs` → `WebLLMRuntime.generate(...)` → WebLLM.
**Wiring test:** `tests/ai-runtime.test.ts` — `MockRuntime.generate` under a
schema returns the scripted schema-valid object (CI). Real path proven by
`npm run ai:trial` producing a schema-valid `{...}` on localhost (recorded, not
CI).
**Depends on:** Phase 0 (D1 env, D2 delivery, D3 schema).
**Read-set:** none of the game code; `docs/AI-PLAYERS.md` for the model id.
**Write-set:** *(2a)* `src/harness/ai-runtime.ts`, `tests/ai-runtime.test.ts`,
`package.json`; *(2b)* `tools/ai-trial.mjs`, `package.json` (script) + green-substep
docs `docs/AI-PLAYERS.md`, `docs/BUILDING-GAMES.md`, `TODO/drop4.md`. *(The 2a/2b
split keeps each commit a single-context unit; the docs ride 2b, the phase that
makes them stale.)*
**Shared-state contract:** `ai:trial` launches system Chrome + binds a local
port + egress to the model CDN + writes to the browser's model cache. CI unit
touches none of this (Mock only). No repo state mutated beyond the write-set.
**Risks:** accidentally importing `WebLLMRuntime` eagerly would pull GPU code
into CI/build — keep it behind a dynamic `import()`; a unit test asserts the
module loads without `@mlc-ai/web-llm` present.
**Done when:**
1. **Behavioral:** `MockRuntime` is used deterministically in a test; `npm run
   ai:trial` returns a schema-valid object from the real pinned model on
   localhost.
2. **Verification:** `npx vitest run tests/ai-runtime.test.ts` (gate) + a recorded
   `ai:trial` transcript (localhost).
**Validation:** Broad — mock on the gate; real runtime validated by the trial
transcript against D1/D3.

### Phase 3: `HybridPlayer` opponent + LLM tutor voice (P4 + P5 narration)

**Goal:** the shippable *experimental* opponent — engine band + LLM in-band pick
+ spoken reason — behind an "Experimental: local AI" toggle; and the LLM
**narrates** the Phase-1 tutor facts (still engine-grounded, so correct by
construction).

**Sub-phases (per Pass 2):** **3a** = `hybrid-player.ts` + its MockRuntime test
(band→pick→move + fallback); **3b** = picker wiring + LLM narration + the
availability probe + docs + the localhost hybrid `ai:trial`.
**Changes:**
- [ ] *(3a)* `src/harness/hybrid-player.ts` — build the band from `Drop4.tutor()` /
  `oracleMoveValues` (+ the class-floor/sloppiness knobs), prompt the `AIRuntime`
  for `{pick∈band, reason}` under the D3 schema, return `{ move, reason }`,
  **fallback to the engine top-of-band** on any failure. `MockRuntime` unit for
  the band→prompt→pick→move path.
- [ ] *(3a)* `tests/hybrid-player.test.ts` — vitest with `MockRuntime`, on the CI
  gate. **Mutation resistance (Pass 3):** pin **three** distinct paths, not just
  happy + one failure — (1) a valid in-band pick returns that move; (2) **malformed
  LLM output** (unparseable / schema-invalid) falls back to the engine top-of-band;
  (3) a **schema-valid but out-of-band pick** (well-formed JSON, `move ∉ band`)
  *also* falls back. (2) and (3) are different failure modes — (2) exercises the
  parse/schema guard, (3) exercises the band-membership guard — so pinning both
  stops a mutation that drops the band check while keeping JSON validation.
- [ ] *(3b)* `src/games/drop4/drop4.ts` — an **"Experimental: local AI"** entry in
  the opponent picker (offered only after the runtime `navigator.gpu` +
  `requestAdapter()` + WebLLM-availability probe passes; otherwise classic levels
  only); show the LLM's reason/banter beside its move; a first-use
  **download-size disclosure**; the tutor's "Explain my options"/blunder text is
  narrated by the LLM when the toggle is on (deterministic text otherwise). All
  lazy — no GPU code unless toggled.
- [ ] *(3b, green sub-step — docs)* `docs/AI-PLAYERS.md` — the `HybridPlayer`
  section + measured findings; `docs/BUILDING-GAMES.md` §10 — the `HybridPlayer`
  entry; `README.md` — the experimental local-AI opponent; `TODO/drop4.md` —
  check off **P4 (`HybridPlayer`)**.
**Call chain:** picker → `HybridPlayer(WebLLMRuntime)` → band + `AIRuntime` →
move + reason → board; tutor panel → LLM narration of `Drop4.tutor()` facts.
**Wiring test:** `tools/ai-trial.mjs` extended (or a sibling) — the hybrid plays
legal in-band moves to a result and surfaces a reason on localhost/system Chrome;
`tests/hybrid-player.test.ts` (MockRuntime) proves band→pick→move on CI.
**Depends on:** Phase 1 (tutor facts/band) + Phase 2 (`AIRuntime`).
**Read-set:** `src/harness/ai-runtime.ts`, `src/games/drop4/drop4-wasm.ts`,
`src/games/drop4/drop4.ts`.
**Write-set:** *(3a)* `src/harness/hybrid-player.ts`, `tests/hybrid-player.test.ts`;
*(3b)* `src/games/drop4/drop4.ts` (+ `docs/AI-PLAYERS.md`, `docs/BUILDING-GAMES.md`,
`README.md`, `TODO/drop4.md` as green sub-steps).
**Shared-state contract:** the experimental toggle triggers a model download to
the browser cache + CDN egress at runtime — only on user opt-in; no repo state.
**Risks:** the picker must degrade cleanly when WebGPU/model is unavailable
(offer the toggle only when `navigator.gpu` + availability check pass);
first-move latency (show a "thinking/loading model" state, keep classic default).
**Done when:**
1. **Behavioral:** with the experimental toggle on (system Chrome), a full game
   plays vs the hybrid — legal in-band moves + a spoken reason — and the tutor
   narration reads naturally; with the toggle off / no GPU, the classic engine +
   deterministic tutor are unchanged.
2. **Verification:** `npx vitest run tests/hybrid-player.test.ts` (gate) +
   `npm run test`/`npm run e2e` (classic path unaffected) + a recorded hybrid
   `ai:trial` (localhost).
**Validation:** Broad — mock on the gate; hybrid validated by the localhost
trial + manual play.

### Phase 4 (named follow-on): P6 browser scoring harness

`src/harness/{match-runner,scorer,tournament}.ts` + `tools/harness-trial.mjs` +
`docs/HARNESS.md` — the objective measurement rig (legality, W/D/L,
optimal/blunder vs the exact oracle, cost). Referenced here, planned when the
tutor + hybrid land; it consumes the `AIRuntime`/`HybridPlayer` from Phases 2–3.

### Phase 5 (named follow-on, own phase-plan): P7 Othello

A new `Adversary` + heuristic `Oracle` that reuse the band, difficulty, **tutor**,
hybrid, and UI shell unchanged — the generality proof. Gets its own three-pass
phase-plan (it is a full game build); this entry is the pointer.

## Open Questions

- [CONFIRMED: PHASE-GATED (Phase 2)] Can a real WebLLM inference run
  reproducibly in *this* environment (system Chrome, WebGPU, model-CDN egress)?
  *The 2026-08-03 spike said yes, but it was throwaway; Phase 0 D1 re-confirms.
  If no, Phases 2–3 ship mock-only and the real trial is documented as
  "credentialed GPU env" — the tutor is unaffected, so this does not block
  Phase 1.*
- [CONFIRMED: PHASE-GATED (Phase 2)] Bundle `@mlc-ai/web-llm` as a lazy esbuild
  chunk vs a runtime CDN `import()`? *Recommend: lazy separate chunk so the shelf
  `app.js` is unchanged for non-AI games; weights stream from the CDN with an
  up-front size disclosure (like HexGL's ~17 MB). Phase 0 D2 decides.*
- [CONFIRMED: ADVISORY] Pinned model id. *Recommend `Qwen2.5-1.5B-Instruct-
  q4f16_1-MLC` — the harness Phase-0 baseline; ~1 GB, ~1 s/move, structured
  output confirmed.*
- [CONFIRMED: ADVISORY] Deterministic tutor on by default (no toggle), LLM
  narration behind the experimental toggle? *Recommend yes — the tutor is
  engine-grounded and ships everywhere; the LLM only changes the voice.*

*(All four confirmed as recommended by the user, 2026-08-03. Net: no BLOCKING
items — Phase 0 + Phase 1 may start immediately; D1/D2 resolve the two
PHASE-GATED items before Phase 2.)*

## Review Log

### Pass 1 — 2026-08-03
Detailed execution plan for the Drop 4 AI + tutor layer, re-ordered
deterministic-tutor-first with a Phase 0 WebGPU/delivery discovery gate.
Grounded in firsthand reads of `drop4-wasm/Cargo.toml` (no harness dep),
`drop4-harness/hybrid.rs` (assess primitives), `drop4-solver` (exact + capped),
`package.json` (no web-llm/zod), `playwright.config.ts` (no system-Chrome
project), and `deploy.yml` (CI = node 20, no e2e/GPU). Phases: 0 discovery →
1 deterministic tutor (1a wasm facts, 1b UI) → 2 `AIRuntime`/WebLLM → 3
`HybridPlayer` + LLM tutor voice. P6 scorer + P7 Othello named as follow-ons.

### Pass 2: Gap Analysis — 2026-08-03
**Found:**
- **Wiring-test defect (Phase 1a):** the test referenced the 16-empty
  BLUNDER_FIXTURE, but the C-ABI can only reach positions by playing from
  `new_game` — that fixture isn't hand-reachable (the same limitation hit during
  the difficulty work). Rewrote the wiring test to use reachable positions
  (`[0,1,0,1,0,1]` win, `[0,3,1,3,2,3]` block), and moved the provably-`exact`
  assertion to a **solver-level** unit (where a tractable position is
  constructible directly) rather than the wasm boundary.
- **Capped-blunder honesty (Phase 1b):** in the opening (capped values) the tutor
  can't *prove* a class drop, only a horizon-visible one. Added: assert "blunder"
  only when `exact`, soften to "looks risky" when `capped`. The `exact|capped`
  flag from `tutor_json()` drives the wording.
- **4-file rule (skill hard rule):** three phases exceeded 3 files. Formalized
  splits (below) — each sub-phase is a single-context, commit-at-green unit.
- **Lazy-import guard (Phase 2):** added a unit that asserts `ai-runtime.ts`
  imports/loads **without** `@mlc-ai/web-llm` present, so CI/`build.mjs` never
  pull GPU code (the eager-import regression is the main risk).
- **Toggle availability (Phase 3):** the "Experimental: local AI" entry is
  offered only after a runtime `navigator.gpu` + `requestAdapter()` +
  WebLLM-availability probe passes; otherwise the picker shows classic levels
  only. Named as part of 3b.
**Concurrency:**
- Confirmed the {Phase 1, Phase 2} disjointness (drop4 crates/game/styles/spec vs
  `src/harness/`+`package.json`+`tools/ai-trial.mjs`+its test) — no write-set
  overlap. Kept sequential by default for review focus; the only shared ambient
  state is the cargo `target/` lock and serve port 4180, both noted. Map
  otherwise unchanged.
**Changed (phase splits — extend, not rewrite):**
- **Phase 1b → 1b + 1c.** 1b = tutor UI + styles + e2e (`drop4.ts`,
  `styles.css`, `tests/drop4.spec.ts`). 1c = tutor how-to + guide shot + doc
  updates (`drop4-howto.ts`, `tools/guide-shots.mjs`, `assets/guide/drop4-tutor.jpg`,
  `docs/AI-PLAYERS.md`, `README.md`) — the docs/shots made stale *by 1b*, run
  immediately after (not a trailing docs phase).
- **Phase 2 → 2a + 2b.** 2a = `ai-runtime.ts` (`AIRuntime` + `MockRuntime`,
  lazy `WebLLMRuntime`) + `tests/ai-runtime.test.ts` + `package.json` dep. 2b =
  `tools/ai-trial.mjs` + the `ai:trial` script + the recorded real-model
  transcript (localhost, system Chrome).
- **Phase 3 → 3a + 3b.** 3a = `hybrid-player.ts` + `tests/hybrid-player.test.ts`
  (MockRuntime: band→pick→move + fallback). 3b = picker wiring in `drop4.ts` +
  LLM tutor narration + the availability probe + docs; hybrid `ai:trial` on
  localhost.
**Confirmed:**
- `drop4-wasm` has no `drop4-harness` dep → wasm-side assess is the right call.
- `Drop4.oracleMoveValues()` exists in the wrapper (Phase 3 band source); `tutor()`
  is added by Phase 1a → Phase 3's dependency on Phase 1 is real and ordered.
- WebLLM/`zod` API behavior is correctly deferred to Phase 0 D1/D3 (can't verify
  without running) — not assumed anywhere in the phases.
- The tutor path (Phase 1) has zero WebGPU dependency and is fully on the CI gate;
  the LLM path (Phases 2–3) is mock-on-CI, real-on-localhost, never gating deploy.

### Pass 3: Quality Gates — 2026-08-03
Read the plan end to end with fresh eyes and spot-checked every touch point
against the current tree (all confirmed present / greenfield): `drop4-wasm`
has **no** `drop4-harness` dep; `hybrid.rs` `assess`/`is_immediate_win`/
`blocks_opponent_win`/`quality_of`/`MoveQuality`/`ClassFloor` exist;
`Solver::move_values` (`solver.rs:200`), `live::move_values_capped` (`live.rs:168`),
`select_in_band` (`live.rs:256`), `live_band` (`live.rs:221`); the C-ABI is
`#[no_mangle] pub extern "C" … *_json` (`oracle_move_values_json` at `lib.rs:297`)
so `assess_json`/`tutor_json` fit in place; CI gate =
`build:wasm→typecheck→lint→unit→build→Pages` (no e2e / no cargo / no GPU);
`npm run test` = typecheck+lint+unit+build (e2e is separate — the plan invokes it
separately, correct); Playwright projects = `chromium`+`mobile-webkit` only;
`assess_json`/`tutor_json`/`src/harness`/`@mlc-ai/web-llm`/`zod` all absent
(greenfield); §10 present at `docs/BUILDING-GAMES.md:418`.

**TDD ordering:**
- Confirmed every phase has a wiring test that runs through the **real entry
  point**, none leaning on isolated unit tests alone: 1a = cabi stateful test
  through the C-ABI (`cargo test -p drop4-wasm`); 1b = e2e through the `/drop4/`
  URL; 2a = `MockRuntime.generate` (the runtime CI exercises) + the lazy-import
  guard; 2b = `npm run ai:trial` real path; 3a = `MockRuntime` band→pick→move;
  3b = hybrid `ai:trial` on localhost. Added a **blanket RED-first note** at the
  top of `## Phases` (per-phase RED-first was implied by repo law but unstated).
- Added `cargo test -p drop4-solver` to Phase 1a's Verification — the new
  `exact|capped`-by-empty-count boundary unit lives in the solver crate, so it
  must actually run in the phase that introduces it (was only `-p drop4-wasm`).

**Mutation resistance:**
- Phase 1a: the wiring test pinned Optimal + Blunder but not `quality_of`'s middle
  branch — added a **ResultPreserving** case so all three sign-compare branches
  are pinned (catches `==`→`>=`). Required the `exact|capped` solver unit to
  **name the threshold edge** (16-empty → exact, 17-empty → capped) so a
  `<=`→`<` mutation on `TRACTABLE_EMPTIES` is caught, not a single-point assertion.
- Phase 3a: split the fallback into **two** distinct failure modes — malformed
  LLM output (parse/schema guard) **and** schema-valid-but-out-of-band pick
  (band-membership guard) — so a mutation dropping the band check while keeping
  JSON validation is caught. Was "fallback on malformed output" only.

**Observability:**
- Phase 1b e2e now asserts the **specific `capped` wording** ("looks risky") it
  actually drives, proving the `exact|capped` honesty flag reaches the DOM — not
  merely that some blunder message appears. (The confident *exact* wording stays
  pinned at the 1a unit level, since a ≤16-empty position isn't UI-reachable in a
  short sequence.)
- Phase 2b `ai:trial` now emits a **staged diagnostic line per checkpoint**
  (`gpu-adapter` / `model-load` / `generate` / `schema-validate`, each `pass|fail`
  + timing, raw model output printed on a schema failure) so a failing trial is
  diagnosable from the transcript alone — the LLM-path observability artifact.

**Debugging readiness:**
- The sequential spine gives natural checkpoints (each phase commits green); a
  mid-execution break is localizable to a sub-phase (1a/1b/1c/2a/2b/3a/3b). The
  `ai:trial` staged diagnostic is the checkpoint for the un-CI'd LLM path.

**Validation calibration:**
- Confirmed each phase's strategy matches scope: Phase 0 Discovery (evidence, no
  tests); 1a **Moderate** (C-ABI unit + solver boundary unit + typecheck — wasm
  boundary, surfaced to users only in 1b); 1b **Broad** (full gate + manual play,
  ships to everyone via CI); 1c **Moderate** (doc/asset reconciliation gated by
  existing shot-reference checks); 2/3 **Broad** (mock-on-CI + real-on-localhost).
  No over- or under-calibration found.

**Concurrency honesty:**
- The Pass-3 documentation-coverage fix (below) assigned three doc files
  (`AI-PLAYERS.md`, `BUILDING-GAMES.md` §10, `TODO/drop4.md`) to **both** Phase 1c
  and Phase 2b. This makes the {Phase 1 ‖ Phase 2} write-sets **no longer cleanly
  disjoint** — different sections of the same files, a merge-conflict (not
  correctness) hazard. Updated the Concurrency Map to state this honestly; it
  **reinforces** the existing sequential default. Rewrote the shared-state contract
  and re-entry verification as invariants mapped one-to-one (parent HEAD ==
  pre-dispatch SHA; `lsof -i :4180` empty; the three doc files carry no conflict
  markers; no `git checkout`/`stash`/`rebase` in the parent). Sequential spine
  Phase 0→1→2→3 otherwise confirmed; Phase 3 depends on both.

**Documentation impact:**
- Found four Documentation-Impact items with **no corresponding phase Change/
  Write-set item** (declared but unassigned): the build-out-plan pointer,
  `TODO/drop4.md` check-offs, `BUILDING-GAMES.md` §10, and `AI-PLAYERS.md`'s
  Phase-2 AIRuntime section. Assigned each to its triggering sub-phase — build-out
  pointer → **1a** (Phase 1 start); tutor §10 + P5 + AI-PLAYERS tutor → **1c**;
  AIRuntime §10 + P3 + AI-PLAYERS AIRuntime → **2b**; HybridPlayer §10 + P4 +
  AI-PLAYERS/README → **3b** — and added them to the sub-phase Write-sets. Confirmed
  **no trailing docs phase**: every doc rides the sub-phase that makes it stale.
- Reconciled the **Phases section with the Pass-2 split decision** — 1c, 2a/2b,
  3a/3b existed only in the Pass-2 Review Log prose; labeled the sub-phases in the
  phase bodies so a phase-by-phase reader sees the split (applying Pass 2's
  recorded decision, not new structure).
- Corrected a **mis-attribution in Verified Assumptions**: `live_move` /
  `TRACTABLE_EMPTIES` are in `drop4-wasm/src/lib.rs` (`:257`/`:240`), **not**
  `drop4-solver` — which strengthens Phase 1a (the exact/capped switch is already
  in the exact file 1a edits).

**Coherence:**
- The plan still solves the stated problem (ship the tutor everywhere first, then
  quarantine the GPU LLM path behind a toggle that never gates deploy). No scope
  creep — P6 scorer and P7 Othello remain named follow-ons, not folded in. Plan is
  explainable from memory: 0 discover → 1 tutor (facts → UI → docs) → 2 runtime
  (port+mock → trial) → 3 hybrid + LLM narration.

**Confirmed ready:** yes — all four open questions previously confirmed by the
user (2026-08-03), no BLOCKING items. Phase 0 + Phase 1 may start immediately;
the two PHASE-GATED items (D1 env, D2 delivery) resolve before Phase 2.
