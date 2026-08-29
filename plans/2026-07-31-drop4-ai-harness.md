# Drop 4, checkers, chess — adversarial games + a reusable AI-player harness

> Status: Pass 1 + Pass 2 complete (combined), Pass 3 pending. Governs the
> shelf's first **two-player adversarial games** and the **AI-player harness**
> that lets a computer opponent play them and lets us **run test games and
> score how well an AI plays**.

## Problem Statement

The shelf (`fun.croft.ing`) has five games — solitaire, match-3, bubble, wyrdle,
2048 — and every one is **single-player**. The owner's stated next direction
(`plans/2026-07-31-2048.md`, lines 303-306) is:

> "**Drop 4** (Four-in-a-Row) and **checkers** with an **in-browser AI
> opponent** — which makes them single-device, no-iroh Tier-1 builds
> (verifiable by move replay). Cribbage stays gated until iroh."

Chess is the "completeness/credibility" third game
(`discovery/alpha/thinking/app/ponds/p2p-games-pond-launch-set.md`).

Three things do not exist yet and are required for this:

1. **A two-player adversarial game abstraction.** The current cores are
   single-player. An adversarial game has two sides, alternating turns, and a
   win/draw/loss result. Nothing in the repo models this.
2. **A runtime AI opponent.** The only "AI" today is *build-time solvers* that
   generate winnable daily packs. Playing a live opponent — and letting the
   player **pick which opponent / difficulty** — is new.
3. **A way to run test games and score AI play.** The one existing "harness" is
   the Tier-2 *containment* harness for wrapped games. There is no
   match-runner, no oracle-based scoring, no tournament rig. This is the piece
   the owner flagged to scrutinize: the **local in-browser AI** and whether/how
   well it can play, measured objectively.

**Goal of this plan:** stand up a **reusable harness** (a shared adversarial
trait + a match-runner + an oracle-based scorer + a tournament driver + a
pluggable AI-runtime port) and prove it end-to-end on **Drop 4 first**, then
extend to **checkers** and **chess**. Each game ships as a real shelf citizen
you can play against a **selectable computer opponent**, and each is scored
offline so we can compare a classic engine, a local LLM, and (optionally)
Chrome's built-in model on identical footing.

**Non-goals:** networked/multi-device play (gated on iroh — cribbage waits);
training or fine-tuning any model; beating Stockfish. The LLM bar is "can a
small local model play a legal, non-terrible game," measured — not "is it
strong."

## Reasoning

### Why a shared abstraction, and what it is

Drop 4, checkers, and chess are all **perfect-information, deterministic,
turn-based, zero-sum** games. That is exactly the shape a single trait captures.
Building the harness against a trait (not against Drop 4 directly) is what makes
it *reusable* — the owner asked for "a harness to reuse," and the payoff is that
checkers and chess plug in by implementing the trait, not by re-writing the
runner or the scorer.

The trait mirrors the existing `pond_outcome::Game` trait (verified below), so a
finished match is a **verifiable outcome** the same way every current game is:
replay `(seed, moves)` through the core, re-hash, compare. A two-player match
records **both** sides' moves in one list, so the replay reproduces the final
state regardless of who chose each move — the verifiable-outcome property (the
shelf's differentiator) carries over unchanged.

Proposed shared crate `adversary-core`:

```rust
pub enum Side { A, B }                 // A moves first
pub enum MatchResult { WinA, WinB, Draw }

pub trait Adversary {
    type Position: Clone;
    type Move: Copy + Serialize + DeserializeOwned + Eq;
    const KIND: &'static str;

    fn initial(seed: u64) -> Self::Position;      // seed picks start / side assignment
    fn side_to_move(pos: &Self::Position) -> Side;
    fn legal_moves(pos: &Self::Position) -> Vec<Self::Move>;
    fn apply(pos: &Self::Position, mv: Self::Move) -> Self::Position; // legal moves only
    fn result(pos: &Self::Position) -> Option<MatchResult>;          // Some => terminal
    fn state_hash(pos: &Self::Position) -> String;

    // text bridge for an LLM player
    fn render_text(pos: &Self::Position) -> String;
    fn move_to_text(mv: Self::Move) -> String;
    fn parse_move(pos: &Self::Position, s: &str) -> Option<Self::Move>; // strict + legality-checked
}
```

Each game core implements both `Adversary` and `pond_outcome::Game` (replaying
the alternating move list). No floats on the hashed path; `usize`→`u32` at
hash boundaries so `native == wasm` (the repo's determinism discipline).

### Why classic search is the *shipped* opponent, and the LLM is the *scored experiment*

This is the crux and it reconciles the owner's two answers ("both, pluggable"
AI-under-test; "both via one adapter" runtime) with discovery's own note that a
Four-in-a-Row/checkers opponent "would be classic search in the Rust core, not
an LLM" (`on-device-llm-feasibility.md`).

- A **classic engine** (perfect solver for Drop 4; alpha-beta for checkers;
  external Stockfish for chess) is *tiny, instant, strong, and deterministic*.
  It is the right default opponent to **ship** — and difficulty is just a
  search-depth / randomness knob, which directly serves the owner's
  "pick computer opponents" request.
- A **local LLM** (WebGPU) is the *uncertain, interesting* player. It is not a
  good default opponent (slow, large download, may play illegal/weak moves),
  but "can a small on-device model play these games, and how well" is a real
  question worth an objective answer. So the LLM is a **pluggable player the
  harness scores** — and, if it clears a bar, an optional "Experimental: local
  AI" opponent behind a toggle.

Both are `Player`s behind one port, so the harness scores them identically.
That is the "both, pluggable" the owner asked for, without shipping a bad
default.

### Why a pinned bundled model is the scoring baseline (not Gemini Nano)

You cannot score play against a **moving target**. Chrome's Prompt API
(Gemini Nano) is zero-download but Chrome-desktop-only, and its model version
drifts with the browser — scores taken a month apart aren't comparable, and it
is unavailable on Android/iOS/ChromeOS. So the **reproducible scoring baseline**
is a **pinned** model (fixed weights + fixed quantization + greedy decoding) via
**WebLLM** or **transformers.js**. Gemini Nano and transformers.js remain
**adapters behind one `AIRuntime` port** — a zero-download demo path and a
WASM-fallback path — but the number we report the AI's skill against is the
pinned model. (`ECOSYSTEM.md` already lists Transformers.js/WebLLM as a
sanctioned "sovereign AI local inference over WebGPU/WASM" build-on.)

### Why Drop 4 first

Drop 4 is the right first game for three reasons: (1) its rules are the
simplest of the three (drop a disc in a column; four-in-a-row wins), a clean
build-fresh Tier-1 core; (2) it is **perfectly solved** — Pascal Pons's
negamax-bitboard solver gives the *exact* game-theoretic value of any position
(win/draw/loss + distance-to-win), so the move-quality scorer is **unambiguous**
(a "blunder" is a move that provably worsens the theoretical result — no
heuristic judgment); (3) it is the owner's designated "anchor / banger,
kid-friendly" game. Getting the harness right where the oracle is *exact* means
chess (centipawn loss, heuristic) and checkers (depth-limited eval) reuse a
proven runner and scorer.

### Where the LLM forces a language split

Rust/WASM is the right home for game rules and classic engines (deterministic,
`native == wasm`, testable at build time). But **WebGPU LLM inference is a
browser/JS concern** — WebLLM and transformers.js are JS libraries. So the
harness is two layers:

- **Rust → WASM:** the `Adversary` cores, the classic engines/solvers (which
  double as **oracles**), and an `oracle_eval` export. Deterministic, golden-
  vectored, runs in Node or the browser.
- **TS (`src/harness/`):** the async `Player` port, the `AIRuntime` port +
  adapters (WebLLM / transformers.js / Gemini Nano), per-game prompt+parser, the
  `MatchRunner`, the `Oracle` port (wasm adapter for Drop 4/checkers; Stockfish-
  worker adapter for chess), the `Scorer`, the `Tournament`, and a Playwright
  batch driver that runs headless so we can play hundreds of scored games.

### Alternatives considered and rejected

- **Ship the LLM as the default opponent.** Rejected: slow, ~1-2 GB download,
  can play illegal/weak moves. It is the *experiment*, not the product default.
- **Build the harness directly against Drop 4 (no trait).** Rejected: the
  owner explicitly wants a *reusable* harness; checkers and chess would each
  re-implement the runner/scorer. The trait is the reuse.
- **Chess as a build-fresh Rust core.** Rejected for now (see Open Questions):
  chess rules (castling, en passant, promotion, threefold, 50-move, insufficient
  material) are *not* "simpler than an integration," which is the repo's own
  build-fresh test. Lean on a vetted move generator; flag as a deviation.
- **Score against wall-clock engine strength.** Rejected: wall-time is
  machine-dependent and non-reproducible. Classic opponents are pinned by
  **fixed node/depth budget**, not time.
- **One giant plan for all three games.** Rejected per the skill's "size phases
  to one context window / split at 4+ files" rule. This plan fully details
  Drop 4 + the harness; chess and checkers are named follow-on phases that each
  get their **own** phase-plan once the harness is proven.

## Verified Assumptions

- **`pond_outcome::Game` trait shape** — read `crates/pond-outcome/src/lib.rs:18-45`.
  It is `type Move: Serialize + DeserializeOwned + Clone`, `const KIND`,
  `const VERSION: u32`, `fn replay(seed, moves) -> Replayed { final_hash, won,
  score, stars }`, plus `attest`/`verify`/`clean_clear`/`to_doc`/`from_doc`.
  Game-agnostic; a two-player match's alternating move list replays cleanly.
- **Core → wasm C-ABI pattern** — read `crates/twenty48-wasm/src/lib.rs:1-60`
  and `src/games/2048/2048-wasm.ts:1-50`. Raw C-ABI + serde-JSON, no
  `wasm-bindgen`; wasm holds state; JSON read via `ptr` + `out_len()`; integer-
  arg move exports (`move_(dir)`), status codes (`0 applied / 1 illegal /
  2 over`); **never panics**; typed TS wrapper decodes the buffer. `#[no_mangle]
  extern "C"`. Embedded daily pack via `include_bytes!`.
- **Solver crate shape** — read `crates/trio-tumble-solver/src/lib.rs:1-60`.
  Build-time budgeted DFS with node budgets + state-hash memoization +
  move ordering; returns a line or `None`; `generate_pack` walks a deterministic
  seed stream. The classic engine/solver for Drop 4 follows this crate shape
  (but is *adversarial* negamax, not a single-player win-finder — new logic,
  same packaging).
- **Registry / GameModule contract** — read `src/contract.ts` and
  `src/registry.ts:1-60`. `GameModule { mount(container, services); unmount() }`;
  `GameEntry` is a Tier1/Tier2 union; a game becomes playable via a registry
  entry with `status: "playable"` + `load` factory and its own `/<id>/` URL.
- **Standards + gate** — read `docs/BUILDING-GAMES.md` in full: determinism-first
  core→wasm (§2), verifiable outcome / `pond-outcome` / `?r=` (§3), tap-first
  core-decides-legality (§4), centred layout + mobile (§4), identity/tokens WCAG
  AA both themes (§5), standard settings (§6), how-to guide + `guide:shots` (§7),
  TDD gate `npm run test` / `npm run e2e` / `cargo test --workspace` (§8),
  new-game checklist. Naming rule (discovery `games-pond-authoritative-list.md`
  line 17): "Use 'Four in a Row' not Connect Four." → title **Drop 4**, id
  `drop4`.
- **In-browser AI runtimes (web research, 2026-07-31; recorded, some to be
  re-confirmed firsthand in Phase 0):**
  - WebLLM (mlc-ai/web-llm): OpenAI-style API, WebGPU; runs Qwen2.5-0.5B/1.5B,
    Llama-3.2-1B at Q4 in ~1-2 GB GPU memory. WebGPU ships by default in
    Chrome/Edge/Firefox/Safari in 2026.
  - transformers.js (huggingface): ONNX Runtime, **WASM fallback** (works
    without WebGPU) or WebGPU; quant `q4`/`q8`/`fp16`.
  - Chrome Prompt API: `LanguageModel.availability()` → `available` /
    `downloadable` / `downloading` / `unavailable`; Gemini Nano; Chrome 148
    stable; **desktop-only** (Win/macOS/Linux; not Android/iOS/ChromeOS).
  - Stockfish WASM (nmrugg/stockfish.js, lichess niklasf/stockfish.js): SF 18;
    single-threaded ~7 MB build runs without cross-origin-isolation headers;
    multi-threaded needs COOP/COEP. UCI over a Web Worker. → chess **oracle**.
  - chess.js (jhlywa): TS, FEN/PGN, legal move gen, check/checkmate/draw. →
    candidate chess rules layer. Drop 4 perfect solver: Pascal Pons negamax
    bitboard (blog.gamesolver.org) — the reference to port to Rust.
  - LLM-chess scoring norms (maxim-saplin/llm_chess, arXiv 2512.01992): cap
    illegal-move retries (≈3) then forfeit; **centipawn loss** via Stockfish at
    fixed depth is the standard move-quality metric.

Anything above tagged "web research" is **recorded, not yet firsthand** — Phase
0 confirms the ones the plan depends on (model actually loads + plays; headless
WebGPU; Stockfish eval interface).

## Documentation Impact

- `README.md` — add Drop 4 (and later checkers/chess) to the shelf list + shelf
  order; add a short "Playing a computer opponent" note and a pointer to the
  harness doc. **Phase 6** (Drop 4 shelf game) and **Phase 5** (harness doc
  pointer).
- `docs/BUILDING-GAMES.md` — **new §10: adversarial two-player games + the
  AI-player/harness standard** (the `Adversary` trait, the `Player`/`AIRuntime`/
  `Oracle` ports, opponent-selection UX, the scoring rig, how an LLM game's
  record is replay-verifiable but the *player* is non-deterministic). This is a
  genuine new standard, like §9 (Tier-2) was. Authored incrementally: the trait
  in **Phase 1**, the harness/ports in **Phase 4**, the scorer + honesty note in
  **Phase 5**, opponent-selection UX in **Phase 6**.
- `docs/HARNESS.md` — **new** standalone doc: how to run trials
  (`npm run harness:trial`), the metrics, the report format, the pinned-model
  fingerprint. **Phase 5**.
- `CLAUDE.md` (repo) — one line under the shelf model noting adversarial games +
  the harness live under §10 of BUILDING-GAMES. **Phase 6**.
- `TODO/drop4.md` — **new** per-game backlog (follows `TODO/README.md`).
  **Phase 1**.
- `src/registry.ts`, `src/how-to-registry.ts`, `build.mjs`, `tokens.css` —
  wiring/append points for the Drop 4 shelf game. **Phase 6** (grepped: these
  are the standard per-game wiring points named in BUILDING-GAMES §"Game
  isolation"; no other references change).
- `.github/workflows/deploy.yml` — confirm the wasm build step covers the new
  crates; the harness trial is **not** on the deploy gate (it needs WebGPU /
  network for weights). **Phase 5** records why it's excluded.

## Concurrency Map

```
Sequential spine:
  Phase 0 (Discovery)
    → Phase 1 (drop4-core)
    → Phase 2 (drop4-solver / oracle)
    → Phase 3 (drop4-wasm + TS wrapper)
    → Phase 4 (TS harness: Player port + MatchRunner, classic + random players)
    → Phase 5 (AIRuntime port + WebLLM adapter + Scorer + Tournament + TRIALS)
    → Phase 6 (Drop 4 shelf game with selectable opponents)
    → Phase 7 (second AIRuntime adapter: Gemini Nano / transformers.js)  [optional]
    → [Phase 8 (checkers) || Phase 9 (chess)]   ← each spawns its OWN phase-plan
```

Phases 0-6 are **strictly sequential**: each reads what the prior wrote (the
solver needs the core; the wasm wraps both; the harness calls the wasm; the
scorer calls the harness; the shelf game reuses the harness players). No
parallelism within the spine.

**Parallel set {8, 9}** (checkers, chess) — *candidate only; each will be
planned separately, and the parallel decision is deferred to those plans:*
- Disjoint write-sets: 8 writes `crates/checkers-*`, `src/games/checkers/`,
  `docs/BUILDING-GAMES.md`(§10 examples); 9 writes `crates/chess-*` (or the
  vetted-lib adapter), `src/games/chess/`, the Stockfish oracle adapter. The
  **only** overlaps are the shared append points — `src/registry.ts`,
  `src/how-to-registry.ts`, `build.mjs`, `tokens.css`, `docs/BUILDING-GAMES.md`.
- Shared-state contract: both run in isolated git worktrees off the feature
  branch; neither invokes `git checkout`/`stash`/`rebase` in the parent
  worktree; both build wasm to their own `crates/<game>-wasm/pkg`; neither binds
  a port except an ephemeral Playwright/serve port (must use disjoint ports).
- Re-entry verification: parent-repo HEAD == pre-dispatch SHA; `git worktree
  list` shows only the two expected worktrees; the shared append points are
  merged by hand (append-only, so a 3-way merge is trivial) — **not** edited
  concurrently.
- **Because they share append points, 8 and 9 are treated as sequential unless
  their own plans isolate those edits.** Default sequential.

## Phases

### Phase 0: Discovery

**Goal:** resolve the technical unknowns that could invalidate multiple later
phases, empirically — this is also the first "trial" the owner asked to reach.

- [ ] **D1: Can a *pinned small* model actually play Drop 4 at all?**
  - **Probe:** stand up a throwaway HTML page that loads WebLLM with, in order,
    `Qwen2.5-0.5B-Instruct-q4f16`, `Llama-3.2-1B-Instruct-q4f16`,
    `Qwen2.5-1.5B-Instruct-q4f16`. Prompt each with a rendered Drop 4 board + the
    legal columns + "reply with only the column number." Record: does it load
    under WebGPU; VRAM/wall to first token; and over ~20 random midgame
    positions, the **legal-move rate** and **parse rate** of its raw output.
  - **Success criteria:** at least one pinned model loads and emits a
    parseable, ≥50%-legal column on ≥50% of positions. (Below that, the LLM
    player still ships as a *scored* player, but we lower expectations and lean
    on the retry/forfeit policy — it does not block the harness.)
  - **Disposition:** `throwaway` (findings + chosen model id recorded here).
- [ ] **D2: Headless WebGPU for batch scoring.**
  - **Probe:** launch Chromium via the repo's Playwright (`croft-pwa`/`fun`
    node_modules) with `--enable-unsafe-webgpu --enable-features=Vulkan`
    (and ANGLE/SwiftShader fallbacks); load the D1 page; confirm WebGPU is
    present (`navigator.gpu`) and one inference completes headless.
  - **Success criteria:** a headless run produces one real LLM move. If headless
    WebGPU is unavailable, fall back to **headed** Playwright or a manual
    browser run for the LLM trials, and record that trials are headed-only.
  - **Disposition:** `keep-as-fixture` (the launch flags become the harness
    Playwright config).
- [ ] **D3: Drop 4 perfect solver, in Rust.**
  - **Probe:** implement/port the Pons negamax-bitboard evaluation for the
    standard 7×6 board (bitboard win-detection, alpha-beta, center-first
    ordering, transposition table). Verify against known facts: the empty board
    is a **first-player win**; the exact score of a handful of positions from
    Pons's published test sets.
  - **Success criteria:** solver returns the exact game-theoretic value
    (win/draw/loss + distance) and agrees with the published test-set scores on
    a sampled subset within a fixed node budget.
  - **Disposition:** `promote` → becomes `crates/drop4-solver` in Phase 2 (TDD
    applies there; the probe is throwaway scaffolding).
- [ ] **D4: `Adversary` + `pond_outcome::Game` fit for a two-player match.**
  - **Probe:** sketch the `adversary-core` trait against a stub Drop 4 position
    and confirm a hand-built alternating move list replays to a stable
    `state_hash` and a `MatchResult`, and that `pond_outcome::attest`/`verify`
    round-trips it.
  - **Success criteria:** a two-player record verifies via the existing
    `pond-outcome` machinery with no changes to that crate.
  - **Disposition:** `keep-as-fixture` (the sketch becomes the first golden
    vector).
- [ ] **D5 (PHASE-GATED to Phase 9 / chess): Stockfish WASM eval interface + chess
  rules layer.**
  - **Probe:** load a single-threaded `stockfish.wasm` in a Worker, send UCI
    `position`/`go depth N`, parse `info ... score cp` / `bestmove`. Decide
    chess rules layer (chess.js vs a Rust move-gen). Deferred until chess.
  - **Success criteria:** deterministic centipawn eval at fixed depth for a FEN.
  - **Disposition:** `keep-as-fixture`.

**Done when:** D1-D4 resolved with firsthand evidence; the chosen pinned model
id, the headless-WebGPU verdict, and the solver's verified test-set agreement
are recorded in Verified Assumptions; D5 remains gated.

### Phase 1: `drop4-core` — the adversarial rules

**Goal:** a deterministic Drop 4 engine implementing `Adversary` +
`pond_outcome::Game`, with RULES.md + golden vectors, `native == wasm`.
**Changes:**
- [ ] `crates/adversary-core/` — the shared trait crate (`Side`, `MatchResult`,
  `Adversary`). Rules-doc comment; no game logic.
- [ ] `crates/drop4-core/src/` — board (7×6 bitboard or `[u8; 42]`), engine
  (drop, win-detection: 4-in-a-row horiz/vert/diag, full-board draw), `state_hash`,
  text bridge (`render_text`/`move_to_text`/`parse_move`), `RULES.md`, golden
  vectors under `vectors/`.
- [ ] `crates/drop4-core` impls `pond_outcome::Game` (replay alternating drops).
- [ ] `TODO/drop4.md`.
**Call chain:** `Adversary::apply` ← engine drop; `pond_outcome::verify` ←
`Game::replay` ← engine drop loop.
**Wiring test:** `drop4_core::tests` — a golden game (recorded column list)
replays through `pond_outcome::verify` to the expected `final_hash` +
`MatchResult`. RED before the engine exists.
**Depends on:** Phase 0 (D3 solver logic informs win-detection; D4 trait shape).
**Read-set:** `crates/pond-outcome/src/lib.rs`, D3/D4 probe notes.
**Write-set:** `crates/adversary-core/**`, `crates/drop4-core/**`,
`TODO/drop4.md`, `Cargo.toml` (workspace members).
**Shared-state contract:** no shared mutable state beyond the file write-set;
adds two workspace members to `Cargo.toml`.
**Risks:** win-detection off-by-one on diagonals — golden vectors must include a
diagonal win, a vertical win, a horizontal win, a draw, and a near-miss.
**Done when:**
1. **Behavioral:** `drop4-core` computes legal columns, applies drops, detects
   all win lines + draw, and a recorded game replays through `pond-outcome` to a
   stable hash + result.
2. **Verification:** `cargo test -p drop4-core` (incl. the replay wiring test)
   and the `xbuild` native==wasm check green.
**Validation:** Moderate — unit + golden vectors + native==wasm cross-build.

### Phase 2: `drop4-solver` — the classic engine / oracle

**Goal:** the perfect negamax-bitboard solver, doubling as opponent and exact
oracle, with depth/randomness knobs for difficulty.
**Changes:**
- [ ] `crates/drop4-solver/src/lib.rs` — `best_move(pos, budget) -> Move`,
  `evaluate(pos, budget) -> Eval { value, best_move, exact: true, dist }` (exact
  game value + distance-to-win), alpha-beta + transposition table + center-first
  ordering. Difficulty = a `Level` (Easy/Medium/Hard = capped depth + ε-random;
  Perfect = full solve).
- [ ] golden vectors: the empty-board first-player-win value + sampled Pons
  test-set positions (from D3).
**Call chain:** `Oracle`/opponent → `drop4_solver::best_move`/`evaluate` →
`drop4_core` legal_moves/apply.
**Wiring test:** `drop4_solver::tests::empty_board_is_first_player_win` and a
sampled test-set agreement test. RED first.
**Depends on:** Phase 1.
**Read-set:** `crates/drop4-core/**`.
**Write-set:** `crates/drop4-solver/**`, `Cargo.toml`.
**Shared-state contract:** none beyond files.
**Risks:** node-budget too low for "Perfect" on early positions → cap search or
use a small opening principal-variation table; keep budgets fixed (machine-
independent).
**Done when:**
1. **Behavioral:** the solver returns exact values agreeing with the published
   test set on the sampled subset, and `best_move` beats a random player 100%
   over N seeded games.
2. **Verification:** `cargo test -p drop4-solver`.
**Validation:** Moderate — golden test-set agreement is the calibration.

### Phase 3: `drop4-wasm` + typed TS wrapper

**Goal:** browser/Node binding exposing rules **and** oracle eval, so both the
harness and the shelf game call one artifact.
**Changes:**
- [ ] `crates/drop4-wasm/src/lib.rs` — C-ABI: `new_game(seed)`, `legal_moves_json()`,
  `play(col) -> status`, `board_json()`, `current_hash()`, `result_code()`,
  `render_text()`, `oracle_best(level) -> col`, `oracle_eval_json(level)`,
  `outcome_json()`. Never panics.
- [ ] `src/games/drop4/drop4-wasm.ts` — typed wrapper (`Drop4` class,
  `BoardView`, `legalMoves()`, `play()`, `oracleBest(level)`, `oracleEval()`).
- [ ] `build.mjs` — add `drop4` to the wasm build list.
**Call chain:** TS wrapper → wasm export → `drop4-solver` / `drop4-core`.
**Wiring test:** a Node test loads the built wasm and plays a full solver-vs-
solver game to a terminal result via the wrapper (proves the C-ABI boundary is
live, not just the Rust). RED first.
**Depends on:** Phase 2.
**Read-set:** `crates/drop4-core/**`, `crates/drop4-solver/**`, `build.mjs`.
**Write-set:** `crates/drop4-wasm/**`, `src/games/drop4/drop4-wasm.ts`,
`build.mjs`, `Cargo.toml`.
**Shared-state contract:** `build.mjs` append; no ports.
**Risks:** buffer/`out_len` decode bugs — mirror `twenty48-wasm` exactly.
**Done when:**
1. **Behavioral:** JS can start a game, read legal columns, play, ask the oracle
   for a move/eval, and reach a terminal result through the wasm.
2. **Verification:** `npm run build` (builds wasm) + the Node wiring test green.
**Validation:** Moderate — the Node round-trip is the wiring proof.

### Phase 4: TS harness core — `Player` port + `MatchRunner`

**Goal:** the reusable runner: any two `Player`s play a `GameAdapter` to a
recorded result. No LLM yet — proven with classic + random players so the runner
is deterministic and testable.
**Changes:**
- [ ] `src/harness/types.ts` — `GameAdapter` (wraps a wasm game: state, legal
  moves in text + native, apply, result, `renderText`), `Player`
  (`chooseMove(view) -> Promise<{ move; meta }>`), `MatchRecord` (moves,
  per-turn latency, illegal attempts, parse failures, forfeits, side results).
- [ ] `src/harness/players.ts` — `ClassicPlayer(level)` (calls `oracleBest`),
  `RandomPlayer(seed)`.
- [ ] `src/harness/match-runner.ts` — `runMatch(adapter, playerA, playerB)`:
  alternate turns, enforce legality via the core, cap illegal retries → forfeit,
  emit a `MatchRecord` + a `pond-outcome`-shaped record.
- **Observability:** the `MatchRecord` is the observability artifact — every
  turn records `{ side, move, legalFirstTry, retries, rawOutput?, latencyMs,
  tokens? }`. `runMatch` emits one structured summary line per game
  (side results, move count, forfeit reason if any) so a failing trial is
  traceable without a debugger. `rawOutput` (the player's pre-parse text) is
  captured **only** on an illegal/parse failure — it is the field you read to
  learn *why* a model move didn't parse.
- [ ] `src/harness/drop4-adapter.ts` — `GameAdapter` over `Drop4`.
- [ ] `docs/BUILDING-GAMES.md` §10 stub (ports overview).
**Call chain:** `runMatch` → `Player.chooseMove` → `GameAdapter.apply` →
`Drop4` wasm.
**Wiring test:** `tests/harness.test.ts` — `ClassicPlayer(Perfect)` vs
`RandomPlayer` over N seeds: classic wins every game; the record replays through
`Drop4` to the recorded final hash. RED first.
**Depends on:** Phase 3.
**Read-set:** `src/games/drop4/drop4-wasm.ts`.
**Write-set:** `src/harness/*.ts`, `tests/harness.test.ts`,
`docs/BUILDING-GAMES.md`.
**Shared-state contract:** none beyond files; tests run in Node (no browser).
**Risks:** async turn ordering / forfeit accounting — the record is the source
of truth; assert it, don't trust in-memory state.
**Done when:**
1. **Behavioral:** a full Drop 4 match runs between two pluggable players and
   emits a replay-verifiable record.
2. **Verification:** `npx vitest run tests/harness.test.ts`.
**Validation:** Moderate — deterministic (no LLM), so tests are sufficient here.

### Phase 5: `AIRuntime` port + WebLLM adapter + `Scorer` + trials

**Goal:** the pluggable AI player and the objective scoring — the owner's "run
test games and score the playing." **This is where trials happen.**
**Changes:**
- [ ] `src/harness/ai-runtime.ts` — `AIRuntime` port (`generate(prompt, {greedy,
  maxTokens}) -> Promise<string>`, `fingerprint()`), `MockRuntime` (deterministic,
  for tests), `WebLLMRuntime` (pinned model id from D1).
- [ ] `src/harness/llm-player.ts` — `LLMPlayer(runtime, adapter)`: render board →
  prompt → generate → `parse_move` (strict, legality-checked) → retry ≤3 →
  forfeit. Records tokens/latency/illegal/parse-fail per turn.
- [ ] `src/harness/oracle.ts` — `Oracle` port; `WasmOracle` (Drop 4 exact).
- [ ] `src/harness/scorer.ts` — from a `MatchRecord` + `Oracle`: legality
  (first-try-legal %, illegal/parse/forfeit counts), result (W/D/L, win-rate),
  decision quality (Drop 4 exact: **% optimal**, **% result-preserving**,
  **blunder rate**), cost (mean tokens/move, mean latency/move, model
  fingerprint). **Blunder classification is a three-way boundary the scorer test
  must pin at its edges:** given the oracle's exact value of the position and of
  the resulting position — (a) move keeps the *optimal* value → optimal; (b)
  move keeps the *same win/draw/loss class* but not optimal distance →
  result-preserving, **not** a blunder; (c) move drops the win/draw/loss class
  (win→draw, draw→loss, win→loss) → **blunder**. The test asserts one position of
  each class plus the win→draw and draw→loss boundaries, not a single happy-path
  point.
- [ ] `src/harness/tournament.ts` — run a matchup matrix (LLM vs Classic at each
  Level, LLM vs Random, LLM self-play) over N seeded games → aggregate → JSON +
  a small HTML report.
- [ ] `tools/harness-trial.mjs` + `npm run harness:trial` — Playwright driver
  (headless if D2 said yes, else headed) that runs a small trial tournament and
  writes `harness-report.{json,html}`.
- [ ] `docs/HARNESS.md`; `docs/BUILDING-GAMES.md` §10 — the honesty note: an
  LLM game's **record is replay-verifiable, but the player is non-deterministic**
  (GPU/sampling), so scores are reported as **distributions over N games**, not
  a single reproducible number; the pinned-model fingerprint is recorded with
  every report.
**Call chain:** `npm run harness:trial` → Playwright page → `Tournament` →
`runMatch(adapter, LLMPlayer(WebLLMRuntime), ClassicPlayer)` → `Scorer` →
report.
**Wiring test:** two tiers. (a) `tests/scorer.test.ts` — `LLMPlayer(MockRuntime)`
scripted to a known line vs `ClassicPlayer` produces the expected scorecard
(deterministic, on the Node gate). (b) `npm run harness:trial` — a real
WebLLM run of ≥5 games producing a populated report (**not** on the CI gate;
run locally / in the trial, since it needs WebGPU + weights).
**Depends on:** Phase 4; Phase 0 D1/D2.
**Read-set:** all of `src/harness/**`, `src/games/drop4/drop4-wasm.ts`.
**Write-set:** `src/harness/*.ts`, `tools/harness-trial.mjs`, `package.json`
(script), `tests/scorer.test.ts`, `docs/HARNESS.md`, `docs/BUILDING-GAMES.md`.
**Shared-state contract:** the trial binds a local static-serve port
(use a fixed, documented port) and downloads model weights to the browser cache;
network egress to the model CDN happens **only** during a trial, never on the
deploy gate.
**Risks:** WebGPU flakiness headless (D2 fallback = headed); model download time
(cache between runs); non-determinism (report distributions, fix seeds for the
*game*, accept variance for the *player*).
**Done when:**
1. **Behavioral:** `LLMPlayer(MockRuntime)` is scored deterministically on the
   gate; and `npm run harness:trial` runs real local-LLM Drop 4 games and emits
   a scorecard (legality, W/D/L, optimality/blunder vs the exact oracle, cost).
2. **Verification:** `npx vitest run tests/scorer.test.ts` (gate) + a recorded
   `npm run harness:trial` report artifact (trial).
**Validation:** Broad — mock-scored on the gate; real trial validated by
inspecting the report (legal-move rate, blunder rate, latency) against D1's
expectations.

### Phase 6: Drop 4 as a shelf game with selectable computer opponents

**Goal:** ship `/drop4/` — a real Tier-1 game you play against a **pickable**
computer opponent, meeting the full new-game checklist. Delivers the owner's
"pick computer opponents" request.
**Changes:**
- [ ] `src/games/drop4/drop4.ts` — `GameModule`; tap-a-column input, core-driven
  legal-column glow, illegal tap = no-op; centred board; verification-forward end
  screen + `?r=` share (reuses `pond-outcome`); standard settings (hints →
  "I'm stuck").
- [ ] **Opponent picker** — Easy / Medium / Hard / Perfect (solver `Level`) +,
  behind an "Experimental" toggle *iff* the LLM cleared D1's bar, "Local AI
  (LLM)". The opponent is a `Player` from the harness — the shelf game and the
  scorer share the exact same player code.
- [ ] `src/games/drop4/drop4-howto.ts` + register in `how-to-registry.ts`;
  `guide:shots`.
- [ ] `src/registry.ts` (Drop 4 entry, `status: "playable"`),
  `tokens.css` (append any new tokens), `build.mjs`, `README.md`,
  `CLAUDE.md` (one line).
**Call chain:** drawer registry → `drop4Module.mount` → `Drop4` wasm +
`ClassicPlayer`/`LLMPlayer` (harness) → end screen → `pond-outcome` `?r=`.
**Wiring test:** `tests/drop4.spec.ts` (Playwright) — navigate to `/drop4/`,
play a full game vs the Medium opponent to a win/loss, assert the verification-
forward end screen + a `?r=` link that re-verifies; axe clean both themes; board
centred; no overflow at 360px. RED first.
**Depends on:** Phase 4 (players); Phase 3 (wasm). LLM opponent depends on Phase 5.
**Read-set:** `src/harness/**`, `src/games/drop4/drop4-wasm.ts`, shared chrome.
**Write-set:** `src/games/drop4/**`, `src/registry.ts`, `src/how-to-registry.ts`,
`build.mjs`, `tokens.css`, `README.md`, `CLAUDE.md`, `assets/guide/drop4*.jpg`,
`tests/drop4.spec.ts`.
**Shared-state contract:** touches shared append points (registry, how-to
registry, tokens, build) — append-only, standard per-game wiring.
**Risks:** guide-shots churn (only `git add` drop4 shots per CLAUDE.md); the LLM
opponent's latency in the UI (show a "thinking" state; keep classic default).
**Done when:**
1. **Behavioral:** `/drop4/` is playable vs a selectable computer opponent,
   reachable from the drawer, with a verifiable end screen + share.
2. **Verification:** `npm run test` + `npm run e2e` (incl. `drop4.spec.ts` +
   axe) + `cargo test --workspace` all green.
**Validation:** Broad — full gate + manual play at phone and desktop width.

### Phase 7 (optional): second `AIRuntime` adapter

**Goal:** prove the port is real by adding `GeminiNanoRuntime`
(`LanguageModel` API) and/or `TransformersJsRuntime` (WASM fallback) behind the
same interface, and add them as columns in the trial report.
**Changes:** `src/harness/ai-runtime.ts` (+ adapters), trial report columns,
`docs/HARNESS.md`.
**Wiring test:** the trial runs the same Drop 4 matchup on each available runtime
and the report shows a per-runtime scorecard; `availability()` gating skips
absent runtimes cleanly.
**Depends on:** Phase 5. **Write-set:** `src/harness/ai-runtime.ts`,
`docs/HARNESS.md`, trial tool.
**Done when:** the report compares ≥2 runtimes on identical games; absent
runtimes are skipped, not errored.

### Phase 8 (checkers) and Phase 9 (chess) — each spawns its own phase-plan

These are **named here, not detailed** (each exceeds the 4-file / one-context
rule and warrants its own three-pass plan once the harness is proven):

- **Phase 8 — checkers:** `crates/checkers-core` (build-fresh: men/kings,
  forced-capture, multi-jump, draw rules), `crates/checkers-solver` (alpha-beta
  + heuristic eval = the **heuristic** oracle, depth-limited), `crates/checkers-wasm`,
  `src/games/checkers/`. Reuses the harness verbatim; scorer's decision-quality
  metric becomes eval-delta vs fixed-depth (heuristic, not exact).
- **Phase 9 — chess:** rules via a **vetted move generator** (chess.js or a Rust
  move-gen — see Open Questions), **Stockfish WASM** as the oracle (D5),
  centipawn-loss scoring, `src/games/chess/`. Flagged as a deliberate deviation
  from build-fresh because chess rules are not "simpler than an integration."

## Open Questions

- [RECOMMENDED: BLOCKING] **Ship the LLM as a selectable opponent, or classic-
  only with the LLM as a scored experiment?** *Recommendation: classic engine is
  the default/only shipped opponent (fast, strong, deterministic, tiny); the LLM
  is scored by the harness and exposed in the game only behind an "Experimental"
  toggle, and only if it clears D1's legal-move bar. This keeps the shipped game
  good while still answering "how well can a local AI play."* Owner said "pick
  computer opponents would be a great feature" → the picker (difficulty levels)
  ships regardless; the question is only whether the LLM is one of the choices.
- [RECOMMENDED: PHASE-GATED (Phase 9)] **Chess rules: vetted library vs build-
  fresh Rust core?** *Recommendation: vetted move-gen (chess.js or Rust
  shakmaty), recorded as a deviation from the build-fresh default, because chess
  rules fail the repo's own "simpler than an integration" test. Decide in the
  chess plan.*
- [RECOMMENDED: PHASE-GATED (Phase 5)] **Where are model weights hosted?**
  *Recommendation: load from the model CDN during trials (dev only), and if the
  LLM ships as an opponent, treat it as a Tier-2-style up-front size disclosure
  in the how-to (like HexGL's ~17 MB). Never bundle multi-GB weights into the
  deploy.*
- [RECOMMENDED: ADVISORY] **Which reference opponent strengths to score against
  and how many games per matchup?** *Recommendation: Random, Classic@{Easy,
  Medium, Hard, Perfect}, and self-play; ≥20 games/matchup for the first trial,
  scale later. Tune after the first report.*
- [RECOMMENDED: ADVISORY] **`state_hash` string vs bytes for a two-player board.**
  *Recommendation: match the existing cores' `String` hash for `pond-outcome`
  compatibility; revisit only if profiling says so.*

## Review Log

### Pass 1 — 2026-07-31
Base plan: Phase 0 discovery + Drop 4 core/solver/wasm + reusable TS harness
(Player/AIRuntime/Oracle ports, MatchRunner, Scorer, Tournament) + Drop 4 shelf
game with selectable opponents + optional second runtime; checkers/chess named
as follow-on plans. Grounded in firsthand reads of `pond-outcome`, `twenty48-wasm`,
`trio-tumble-solver`, `contract.ts`, `registry.ts`, `BUILDING-GAMES.md`. Web research
on WebLLM / Prompt API / transformers.js / Stockfish.wasm / chess.js / LLM-chess
scoring recorded in Verified Assumptions (firsthand confirmation deferred to
Phase 0).

### Pass 2: Gap Analysis — 2026-07-31
**Found:**
- Drop 4 is a trademark-safe rename of Connect Four ("Four in a Row" per the
  discovery naming rule) — corrected title/id to **Drop 4** / `drop4` throughout,
  not "Connect 4".
- The shelf has *no* adversarial game, so a shared trait crate (`adversary-core`)
  is needed before Drop 4, and BUILDING-GAMES needs a new §10 standard — added as
  Documentation Impact + Phase 1/4/5 work, not a trailing docs phase.
- The existing `-solver` crates are *single-player win-finders*; adversarial
  negamax is new logic (same crate packaging) — called out in Reasoning + Phase 2
  risks so it isn't mistaken for a copy of trio-tumble-solver.
- The LLM forces a Rust/TS split; made explicit (oracle has a wasm adapter for
  Drop 4/checkers and a Stockfish-worker adapter for chess).
- Non-determinism of LLM play would break a naive "verifiable outcome" claim —
  added the honesty note (record replays; player does not) to Phase 5 +
  BUILDING-GAMES §10.
- Headless WebGPU is not guaranteed — added D2 with a headed fallback so trials
  aren't blocked.
**Concurrency:**
- Spine confirmed strictly sequential (each phase consumes the prior's output).
- {8,9} flagged as a *candidate* parallel set but pulled to sequential-by-default
  because they share append points (registry/how-to/build/tokens/§10); the real
  decision is deferred to their own plans.
**Changed:**
- Added `adversary-core` to Phase 1; added D4 (trait fit) and D2 (headless WebGPU)
  to Phase 0; split the scorer's decision-quality metric per game (exact for
  Drop 4, heuristic for checkers, centipawn for chess); added the LLM-record
  honesty note.
**Confirmed:**
- `pond_outcome::Game` needs **no changes** to support two-player records (D4
  probes this).
- The C-ABI wasm pattern and the registry/GameModule wiring are reused verbatim
  from existing games — low risk on those boundaries.
- Drop 4-first is the right call: the exact oracle makes the scorer unambiguous,
  de-risking the harness before heuristic (checkers) and centipawn (chess) oracles.

### Pass 3: Quality Gates — 2026-07-31
**TDD ordering:**
- Confirmed every phase is test-first with a named wiring test that crosses its
  real boundary (Phase 1 replay via `pond-outcome`; Phase 3 through the C-ABI;
  Phase 4 through `runMatch`; Phase 5 mock-scored end-to-end; Phase 6 through the
  `/drop4/` URL). No phase relies on isolated unit tests alone.
- **Mutation resistance:** sharpened the Phase 5 scorer test to pin the
  three-way blunder boundary (optimal / result-preserving / class-dropping) at
  its win→draw and draw→loss edges rather than a single point. Phase 1 already
  names win-line edges (H/V/diag/draw/near-miss).
**Observability:**
- Added the `MatchRecord` per-turn structured fields + one summary line per game
  to Phase 4, and raw-model-output capture on parse/illegal failure to Phase 4/5
  — the field you read to learn why a model move failed. The trial report is the
  aggregate observability artifact; a failing trial is traceable without a
  debugger.
**Debugging readiness:**
- Natural checkpoints = commit at every green (repo standard), one per phase.
  Phase 0 discovery probes are the first health check; the mock-scored gate in
  Phase 5 isolates harness bugs from model bugs before any real trial runs.
**Validation calibration:**
- Confirmed each phase's Validation line matches scope (Moderate for Rust
  crates; Broad for Phase 5 trials and Phase 6 shelf game). Phase 0 tasks all
  carry a disposition; D3 (`promote`) is wired to Phase 2 where TDD applies to
  the promoted solver. No discovery task is resolvable during planning (all need
  WebGPU / a running solver).
**Concurrency honesty:**
- Map confirmed. Spine strictly sequential (each phase consumes the prior's
  output). {8,9} written with invariants (no `git checkout`/`stash`/`rebase` in
  the parent worktree; disjoint wasm output dirs; disjoint serve ports) and
  one-to-one re-entry checks, but held **sequential by default** because they
  share append points — the real call is deferred to their own plans.
**Coherence:**
- Plan still solves the stated problem (adversarial games + a reusable scoring
  harness, Drop 4 first). No scope creep: chess/checkers remain named follow-on
  plans, not detailed here.
**Documentation impact:**
- Every doc update is assigned to the phase that makes its reference stale
  (BUILDING-GAMES §10 authored across Phases 1/4/5; README/CLAUDE in Phase 6;
  HARNESS.md in Phase 5); no trailing docs phase.
**Confirmed ready:** yes — execution may start at Phase 0. The one BLOCKING open
question (ship the LLM as a selectable opponent) gates only Phase 6's
"Experimental" toggle, not Phases 0-5; proceeding on the recommended resolution
(classic default; LLM behind a toggle iff it clears D1's bar) per the owner's
"go ahead."

### Execution log — Phases 1/2/4 (2026-07-31)
Built Rust-first and committed: Phase 1 (`adversary-core` + `drop4-core`), Phase 2
(`drop4-solver` perfect negamax + exact oracle; empty-board `+1` proof confirmed
via `--ignored`, ~40 min), Phase 4 (`drop4-harness` — players, match-runner,
exact-oracle scorer, `run_trial`). First deterministic trial runs: Greedy 98% vs
Random; Random-v-Random ~33% endgame blunder rate. Phases 3/5/6 (browser + LLM +
shelf game) remain.

### Phase 0 execution — LLM feasibility spike (2026-08-03)
Throwaway spike (Playwright + **system Chrome**, headless), findings recorded here;
disposition honored (no committed spike code — it lives in the session scratchpad).

**D2 — headless WebGPU + browser egress: RESOLVED, both work here.**
- Playwright's bundled Chromium/headless-shell exposes **no** `navigator.gpu`
  (all flag combos, headed and headless). **System Chrome via `channel:"chrome"`
  works headless** — real Apple/Metal adapter, no special flags needed. This is
  the launch config the Phase 5 trial driver must use (not bundled Chromium).
- Browser egress to the model CDN works (`GET huggingface.co/... → 200`).

**D1 — can a small pinned model play? Runtime YES; zero-shot play quality NO.**
- WebLLM loaded `Qwen2.5-0.5B-Instruct-q4f16_1` (~266 MB) in ~9.6 s (cached),
  ~35 ms/move after a ~1.2 s warmup; **100 % parseable, 100 % legal** when the
  prompt supplies the legal-column set.
- But play is **board-agnostic**: over 7 positions with an immediate one-move win,
  0.5B took it **2/7 (29 %)** — and those were coincidences (it output `"0"` for
  5/7 regardless of the board). **Qwen2.5-1.5B** (~1 GB) was **worse: 1/7 (14 %)**,
  outputting `"6"` for all 7. Bigger model, different constant, same failure mode:
  it is not perceiving the ASCII board.

**Implications (feed forward):**
- Confirms the plan's core decision: **ship the classic engine**; the LLM is the
  **scored experiment**, not a viable opponent at 0.5–1.5B zero-shot.
- Phase 5's first question is therefore **not** "does it load" (yes) but "can any
  model + prompt + board-encoding play *legally well*" — a sweep the exact-oracle
  scorer is built to run. Untested levers: few-shot, explicit reasoning,
  coordinate/JSON board encodings (vs ASCII art), and larger models (3B+).
- The `LLMPlayer` retry/forfeit policy + our `parse_move` legality re-check remain
  necessary (the model will propose illegal/again-legal moves once the legal set
  isn't spoon-fed).
- Trial-driver note for Phase 5: launch **system Chrome**, not Playwright's
  bundled Chromium (the latter has no WebGPU here).

### Phase 0 refinement — prompt-design sweep + architecture (2026-08-03)
The initial "board-agnostic / bigger is worse" read was under-powered (single
answer token, no reasoning room, no history). A fuller sweep on the same 7
"take-the-immediate-win" positions (Qwen2.5-1.5B) shows prompt **content moves
behavior**, with a model-capability ceiling:

| Prompt | win-take |
|---|---|
| minimal ("pick a column", 6-token cap) | 1/7 (constant output) |
| + rules + goal + criteria + per-column board + reasoning room | 0/7 |
| + move history (transcript) | 2/7 |
| + few-shot example games (in the move notation) | 2/7 |

History flips it from 0 → 2/7 and produces genuine threat reasoning; few-shot
teaches the *frame* but the 1.5B model still misattributes stacks (reads its own
three as the opponent's). Bottleneck = board-state comprehension at ≤1.5B, not
knowledge of rules/goal. Untested levers: **larger models (3B/7B)**, cleaner
encodings, and how much the harness pre-computes for the model (there is a
spectrum from "let it read the board" to "hand it the threats" — the latter
tests the harness, not the model, so keep that knob explicit).

**Prompt architecture (adopted for Phase 5) — two halves:**
- **`GamePackage` (static, per-game, authored once):** name, rules/mechanics,
  goal + decision criteria, few-shot example games (in the move notation), and
  the encoding spec. This is what makes an LLM a *player* of the game at all. It
  is the **pedagogical** twin of the `Adversary` trait's text bridge (the
  *mechanical* twin) — two faces of one game's "rules and expectations." A new
  game therefore provides: trait (rules as code) + `GamePackage` (rules as
  teaching) + optional oracle.
- **`SessionContext` (dynamic, per-turn):** move history (transcript), the
  derived board + legal moves, whose turn.
- **Why the split matters beyond tidiness:** the `GamePackage` is a stable prompt
  **prefix** → KV/prompt-cache friendly, so the large rules+examples cost is paid
  once per session and each move appends only the cheap `SessionContext` delta
  (directly attacks in-browser latency/cost). It is also model-agnostic, so the
  harness sweeps two independent axes — **package variants × models** — each
  scored by the exact oracle.
- **Generality note:** this makes the earlier "adapts to any game / any model"
  claim concrete. Axis 1 (game) = trait + `GamePackage` (+ oracle); Axis 2
  (model) = `AIRuntime` adapter. Neither touches the shared runner/scorer.

### Phase 0 — model sweep + HybridPlayer architecture (2026-08-03)
**Model sweep (take-the-win, 7 positions, full-context prompt, WebLLM/WebGPU via
system Chrome):** the whole PWA-viable ladder is **flat**.

| model | win-take | ~latency/move |
|---|---|---|
| Qwen2.5-0.5B | 1/7 | 35 ms |
| Qwen2.5-1.5B | 2/7 | ~1 s |
| Llama-3.2-3B | 2/7 | ~5 s |
| Qwen2.5-3B | 2/7 | ~9 s |
| Qwen2.5-7B | 2/7 | ~12 s |

Scaling 0.5B→7B (14×) did not move board-tactics; it got ~300× slower. **A
bigger model is not the fix** in the browser-viable range — the deficit is
board-state comprehension, and the fix is to move the judgment into the engine.

**Structured output CONFIRMED (0.5B, WebLLM):** both `response_format:
{type:"json_object", schema: JSON.stringify(<JSONSchema>)}` (returned typed
`{move,reason}`) and `{type:"grammar", grammar:'root ::= "0"|..."6"'}` (returned
one legal digit) work. So legality can be **guaranteed by construction** (grammar
over the legal set) and the return is a **typed object** (author via Zod→JSON
Schema, the browser's Pydantic equivalent) — no parsing/retry/forfeit.

**Adopted architecture — `HybridPlayer` (engine generates the field, LLM
selects):** the recommended *shippable* opponent, distinct from the pure-LLM
*research* player.
```
per GAME:  Adversary trait (mechanics/legal/outcome) + Oracle (evaluate each move)
shared  :  Oracle→normalized weights → difficulty band (top Δ) → LLM selector
           (schema/grammar-constrained {pick∈band, reason}) → move + explanation
```
- The `Oracle` is a per-game **port**: exact solver (Drop 4), borrowed Stockfish
  (chess), heuristic alpha-beta (checkers). Quality floor tracks its strength.
- The **selection/personality/difficulty layer is game-agnostic** (consumes
  `{candidates, weights}`), written once and reused. Difficulty = band width Δ
  (Δ=0 perfect, wide Δ casual); personality = the LLM's choice + narration.
- Blunder rate is **bounded by Δ by construction**; still oracle-scorable.
- This offloads exactly what the sweep showed small models can't do (see the
  board / find tactics) to the engine, leaving the LLM a language task (choose
  among vetted options + explain) — likely to work well even at 0.5–1.5B.

**Refined "what a new game provides":** `Adversary` trait (rules as code) + an
`Oracle` (evaluator). The prose `GamePackage` is needed **only** for the
pure-LLM research player, not for the shippable `HybridPlayer`.

**Phase 5 revision:** build two players — (a) `LLMPlayer` (pure, grammar-
constrained legality, prompt = GamePackage + SessionContext) to *measure models*;
(b) `HybridPlayer` (engine band + game-agnostic schema-constrained selector) as
the *shippable experimental opponent*. Both scored by the exact oracle. Trial
driver launches **system Chrome** (bundled Chromium has no WebGPU here).

**Difficulty tunability — MEASURED (2026-08-03, `examples/difficulty.rs`).** The
engine band Δ is a smooth, bounded difficulty knob (46 solved positions, exact
oracle):

| Δ | avg band size | avg regret | blunder rate |
|---|---|---|---|
| 0 | 2.02 | 0.00 | 0.0% (perfect) |
| 1 | 2.78 | 0.21 | 3.1% |
| 3 | 2.87 | 0.25 | 3.8% |
| 8 | 3.24 | 0.61 | 8.7% |
| 40 | 4.76 | 4.31 | 37.9% (≈ random) |

Regret is monotonic in Δ; the endpoints anchor at perfect (Δ=0) and ~random
(Δ=40, matching the ~33% Random-v-Random blunder rate). Small Δ bounds mistakes
to low-single-digit blunder rates (vs the old best-or-uniform-random scheme,
where every mistake can throw the game). Caveat: this validates the difficulty
**mechanism** (the band); the LLM's within-band *selection* behavior is measured
below. Refinement: for a "never throws the game" level, band on **class**
first (keep all class-preserving moves → 0 blunders) then tune within-class
regret — a two-knob design (class floor × within-class sloppiness).

### Phase 0 — hybrid selection MEASURED (2026-08-03, `scratchpad/hybrid-select`)
Real loop: `drop4.wasm` oracle builds a band (Δ=8, value spread) over 14 late
positions; the 1.5B model picks within it under a JSON-schema `{move∈band,
reason}` constraint. Two context variants:

| context | in-band rate | mean regret | random-in-band baseline |
|---|---|---|---|
| bare candidates | 100% | 2.64 | 2.41 |
| rich board+history | 100% | 2.86 | 2.41 |

Findings: (1) **schema enum enforcement works** — 100% in-band, so candidate
membership / legality is guaranteed by construction in the hybrid loop; (2) at
1.5B the LLM's within-band pick is **no better than random-in-band** (regret ≈
or slightly above the uniform baseline), i.e. it adds no measurable *skill*
inside the band; (3) richer context did **not** help here. Caveats: n=14, one Δ,
one model; regret gaps are near noise — the safe claim is "not better than
random-in-band."

**Design consequence:** the hybrid's *quality* comes entirely from the engine
band; the LLM contributes **legality + personality + explanation (UX), not
strength**. So: strongest opponent = engine top-of-band (no LLM); characterful
tunable opponent = band sets difficulty (Δ), LLM adds human feel at
random-in-band quality. Whether a frontier-scale model picks *better* within the
band is untested (the size sweep suggests not until well beyond 7B).
