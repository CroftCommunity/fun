# Match-3 → Candy-Crush parity — phased roadmap

**Status:** planning (2026-07-30). Builds on `plans/2026-07-30-match3-followups.md`
(round 1: cascade animation, deadlock reshuffle, clear-the-blockers, held beam
reference) and the owner walk-through of 2026-07-30. Standards:
`docs/BUILDING-GAMES.md`; core rules: `crates/match3-core/RULES.md`.

This is a multi-session **program**, not a slice. It is authored for phased,
TDD-first execution: each phase ships green + deployed on its own commit(s).

## Positioning — a generic of the match-3 mechanic set

This game is a **generic implementation** of the match-3 / Candy-Crush mechanic
set — acetaminophen to Candy Crush's Tylenol. The **mechanics mirror the
reference exactly**; only the branding differs (no Candy Crush names, art, or
trademarks). This is precisely *why* the standing steer is "do whatever Candy
Crush does": for any ambiguous **game-behaviour** question, the reference
mechanics are the spec — match them, don't re-invent. Genuine **engineering**
forks (representation, phasing, determinism trade-offs) are still surfaced and
decided on their merits, since the reference does not prescribe an internal
implementation. Example (B2, 2026-07-31): the wrapped candy's canon double 3×3
is fixed by the reference; its deterministic realization was an engineering fork
— we chose "survive + pin in place, re-blast next step" because it mirrors the
reference's visible behaviour (the wrapped stays on the board between its two
explosions, candies fall in around it, then it fires again and is consumed).

## Problem statement

match-3 today has two objectives (target-score, clear-the-blockers) and a rough,
myopic par. The goal is **Candy-Crush-Saga parity**: more objectives (jelly
next), the full **specials** system (striped / wrapped / colour-bomb / fish and
the combo matrix), and **honest difficulty** — while never breaking the games
shelf's non-negotiables. Each addition must stay deterministic, produce a result
anyone can re-verify, keep tap-first accessibility, guarantee a winnable daily,
and leave the existing modes green.

## Decisions locked (owner walk-through, 2026-07-30)

Continuing the decision register from round 1 (D1 clear-the-blockers, D2 par
build-tool/hold-switch):

- **D3 — third objective = jelly.** A jelly overlay under gems; clear all jelly
  to win, graded on swaps-to-clear. Chosen over ingredients (the other candidate;
  ingredients + order/mixed become later parity objectives, confirm before build).
- **D4 — specials = full parity.** Not a scoped rung: striped (4-in-row → line
  blast), wrapped (L/T → 3×3 double blast), colour bomb (5-in-row → clear a
  colour), the 2×2 **fish** (hunts targets, incl. jelly), **and the combo matrix**
  (special + special).
- **D5 — par = retune now, as a ladder of deterministic players.** No users exist,
  so par may change in place (no version bump today; keep the versioning rule for
  the future — see D2). Star tiers become rungs on a ladder of players of
  increasing strength (weak/medium/strong), computed **offline** and baked into a
  committed par table (the winnable-daily-pack pattern), so nothing runs a model
  in the browser on the verify path. **LLM/"thinking" subagents are used offline
  only, to *calibrate* which search depths map to weak/medium/strong** — the
  shipped rungs are deterministic searches, never model inference.
  - **3★ target level (2026-07-30):** **strong-but-attainable**, not near-optimal.
    Rationale: in Candy Crush 3★ is "played well" (a majority on easy levels, rare
    on hard), boosted by leftover-move bonuses we don't have — so pinning 3★ to a
    near-optimal search would feel far harder than the reference. Keep the deep
    near-optimal search as the "100% reference"; set 3★ at a strong-but-human-
    reachable rung below it. A free knob (no users), to refine with data.
  - **Measurement (2026-07-30):** across 24 sampled target-score boards the greedy
    par averaged 1993, the beam ~2827 (+41%), a wider beam ~3248 (+62%); under the
    *current* 30/60/90%-of-greedy tiers a greedy- and a beam-level player both
    earned 3★ on 24/24 — i.e. today's 3★ is trivial, which is what the ladder fixes.
- **D6 — in-browser AI hint/coach = backlog.** An advisory feature (a live model
  is fine because it never feeds a verified outcome). Not now.
- **Order (owner-confirmed):** jelly → specials (phased) → par ladder (trails
  specials, since "strong play" isn't defined until specials exist), with a cheap
  par improvement taken early.

## Approach (the spine)

1. **Reuse the proven mode template** for every new objective (this is exactly the
   clear-the-blockers slice, 3a–3d): core state + rules + golden vectors → a
   `match3-solver`-style solver + committed winnable-daily pack → a mode-aware
   binding (`Mode` variant + a distinct `pond-outcome` `kind`) → UI toggle entry +
   how-to. Do not invent a second pattern.
2. **Phase specials one at a time, end-to-end.** Each special is its own slice
   (detection → gem model → activation → vectors → balance) before the next. The
   combo matrix is its own phase after the individual specials exist.
3. **Fold every new state into the fingerprint.** Any new board state (jelly
   layers, special gems, fish, future obstacles) extends `state_hash` + the
   `RULES.md` spec, and re-locks affected golden vectors — called out in the
   commit.
4. **Make every "random" effect draw from the seeded RNG.** Fish targeting (and
   any future randomized effect) consumes `DetRng` draws so replay reproduces it
   and the outcome stays verifiable.
5. **Bake par offline.** Par comes from a committed table generated by a
   deterministic player ladder; the runtime/verifier read a number.

## Non-negotiable constraints (what makes this genuinely hard)

- **Determinism & the fingerprint.** `state_hash` is re-derived at verify time;
  every new state must be in it, identically on every device, forever.
- **Verifiable outcomes.** No effect may depend on wall-clock, unseeded random, or
  device-specific float. Randomized specials draw from `DetRng`.
- **Winnable dailies.** Each objective needs a solver + pack; once specials belong
  to a mode, the solver must understand specials or the winnability guarantee is
  a lie. This is the biggest scaling risk (see Risks).
- **Accessibility.** Tap-first, reduced-motion-safe, axe-clean in both themes;
  specials need accessible affordances (labels, not colour-only cues).
- **Existing modes stay green.** target-score, clear-the-blockers, and solitaire
  must never regress; `pond-outcome` changes stay additive with distinct `kind`s.

## Phases

Each phase: goal · key work · definition of done. Later phases are intentionally
lighter — firm them up when reached. "Vectors" = golden-vector corpus + re-lock.

### Phase 0 — mode plumbing generalization (enabler, do first if it pays off)
- **Goal:** make adding an objective data-driven, not copy-paste, before we add a
  third (jelly) and a fourth+ (ingredients/order).
- **Work:** assess the `Mode` enum + `Session` + `board_view` + UI toggle; if a
  small refactor (e.g. a per-mode descriptor: deal fn, win check, outcome kind,
  HUD spec) removes duplication, do it — behaviour-identical, existing tests green.
- **DoD:** no behaviour change; target-score + blockers still green; adding a mode
  is now one descriptor + UI entry. (Skip if the duplication is not yet painful.)

### Track A — Jelly objective (warm-up; reuses the blockers template)
- **A1 core:** a per-cell jelly layer (a parallel jelly grid or a `Cell` facet);
  extend `state_hash` + `RULES.md`; a jelly-aware clear (a match on a jellied cell
  removes one jelly layer); `deal_jelly`, `jelly_remaining`; re-lock vectors. TDD.
- **A2 solver + pack:** a `find_dejelly`-style budgeted search + a committed
  winnable-daily jelly pack (mirror `match3-solver`), regeneration drill.
- **A3 binding:** `Mode::Jelly`, `new_jelly_game`, a `Match3Jelly` outcome kind
  (`match3-jelly`), `board_view` jelly mask + jelly-remaining/total.
- **A4 UI + how-to:** objective-toggle entry, jelly rendering, jelly-left HUD,
  verifiable clear result, guide section, e2e (incl. axe) + guide shots.
- **DoD:** jelly is playable, verifiable, winnable-daily, accessible, deployed.

### Track P-now — a cheap par improvement early
- **Goal:** honour D5 ("set par better now") without over-building before specials
  reset the bar.
- **Design (decided 2026-07-30):**
  - **Ladder rungs → star tiers.** A beam-plateau measurement (avg over 16 seeds:
    greedy 1964; beam-4 +27%; beam-8 +44%; beam-16 +53%; beam-32 +64%; beam-64
    +71%) shows **no cheap near-optimal ceiling** — score keeps climbing with
    search. So 3★ is a **mid** rung, not the deepest search. Provisional ladder
    (tunable; validated later by the C2 calibration study): **1★ = a weak floor**
    (a deterministic random-legal-move player — a gentle "you cleared it" bar most
    players pass), **2★ = greedy** ("played competently"), **3★ = beam-8**
    ("played well" — strong-but-attainable). beam-16…64 stay as headroom / the
    "100% reference", never a star bar.
  - **Delivery = a baked par table embedded in the wasm.** The beam is too slow to
    run live at verify, so `par_tiers(seed)` is computed **offline** into a
    committed table and **`include_bytes!`-embedded in the binding** (not fetched),
    so `targets_for`/verify stay a pure, deterministic lookup on any device.
  - **Target-score daily → a bounded pack.** Daily currently uses the raw
    unbounded `dayIndexUTC` seed, which can't be pre-baked. Introduce a 365-seed
    target-score daily pack (like blockers/jelly) so its seeds' par is in the
    table; daily plays `pack[dayIndex % 365]`. **Free-play** (`?seed=`/random) is
    off-table → falls back to the cheap live greedy tiers (consistent per seed:
    the same seed always takes the same branch).
  - **No version bump** (D5, no users): change par in place; `Match3::VERSION`
    stays 1.
- **Build increments:** (1) `par_tiers` ladder in `match3-solver` + rung tests;
  (2) target-score daily pack + baked par table generator (committed, regen
  drill); (3) embed the table + switch `targets_for` to lookup-else-fallback;
  (4) UI target-score daily → pack seed; update target-score tests.
- **DoD:** daily par reflects the ladder (3★ meaningfully hard, not trivial);
  deterministic + byte-identically regenerable; verify is an embedded lookup;
  existing target-score tests updated; no re-grading surprises.

### Track B — Specials (the long pole), phased
Execution plan for B0: `plans/2026-07-30-match3-b0-specials.md`.
- **B0 foundation — DONE (2026-07-30).** Representation = a **parallel special
  overlay** (a special is a `Gem(color)` + a marker), chosen over a `Cell` variant
  so the match/legality core stays byte-identical (owner steer: "do whatever Candy
  Crush does" → a special is a coloured candy with a power). `find_runs` +
  `creations_for` classify **line-4 → striped, L/T → wrapped, line-5 → colour bomb**
  (priority bomb > wrapped > striped) with deterministic creation placement in
  `RULES.md`; `state_hash` appends a special section only when present (no vector
  re-lock); golden vectors 04–07. Creation shifted scoring, so the committed
  par/blockers/jelly packs were regenerated (365 winnable, byte-identical). No
  activation yet. **The 2×2 fish moved to B4** (it needs a new *match* definition,
  not a sub-classification of line matches).
- **B1 striped — DONE (2026-07-30)** (plan: `plans/2026-07-30-match3-b1-striped.md`).
  A striped candy fires its line blast (`StripedH`→row, `StripedV`→column),
  chaining through specials it hits (deterministic set-union) and cascading.
  Triggered by matching it (B1.1) or swapping it with any neighbour — legal with
  no line match (B1.2). The swap carries the special marker, and a latent
  `reshuffle_if_dead` marker-desync (shipped since B0) was fixed (vectors
  04/05/06 re-locked). Vectors 08/09; packs re-locked; how-to updated.
- **B2 wrapped — DONE (2026-07-31)** (plan: `plans/2026-07-30-match3-b2-wrapped.md`).
  L/T → wrapped gem; activation = the canon **double 3×3**: the wrapped clears the
  3×3 minus its own centre (it survives), is **pinned** through that step's gravity
  (candies fall in around it), then re-blasts the full 3×3 (consumed) next step —
  mirroring the reference's visible behaviour (owner-chosen realization; the game is
  a generic of the match-3 mechanic set). Chains (a chained wrapped does its own
  double); triggered by matching it (B2.1) or swapping it — legal with no line match
  (B2.2). Vectors 10/11/12; par pack re-locked (blockers/jelly byte-identical);
  how-to updated. The re-blast carry is transient within `resolve_move` (not in
  `state_hash`).
- **B3 colour bomb — DONE (2026-07-31)** (plan: `plans/2026-07-30-match3-b3-colorbomb.md`).
  5-in-a-row → colour bomb; **swapping it with a gem clears every gem of that gem's
  colour** (bomb consumed), sweeping up + firing any striped/wrapped of that colour.
  Swap-only (the colour bomb is colourless → never match-fired); `fires_on_swap` +=
  `ColorBomb`, `activate` gains a colour-predicate `bombs` branch. Vector 13; vector
  06 re-locked (its created colour bomb is now a legal swap → no reshuffle); par pack
  re-locked. Colour-bomb-in-a-blast and bomb+bomb/bomb+special combos are B5.
- **B4 fish (2×2 square) — DONE (2026-07-31)** (plan: `plans/2026-07-30-match3-b4-fish.md`).
  A 2×2 same-colour square is now a **first-class match** (Option A — folded into
  `find_matches`), so it makes a swap legal, clears, and is avoided by the deal +
  reshuffle, all from one authority; a **pure** 2×2 creates a `Fish` (new
  `SpecialKind`, tag `0x05`). An activated fish (matched/swapped) **swims to eat one
  target** chosen by a seeded, pinned rule (jelly cell first, else any gem) via
  `DetRng` — the first RNG-in-activation, drawn before refill so it folds into the
  fingerprint. The deal changed (fill now avoids 2×2s) → jelly + par packs
  regenerated, JS jelly fixture + colour-bomb e2e seed re-derived. Vectors 14
  (creation + cascade activation). Direct blocker-eating + the fish combos are
  revisable/B5 follow-ups.
- **B5 combos:** the special + special swap matrix (striped+striped, striped+
  wrapped, wrapped+wrapped, bomb+striped, bomb+wrapped, bomb+bomb = clear board).
  Its own phase — heavy rules + balance.
- **B6 solver + winnability + par for specials:** teach the mode solvers about
  specials so packs stay winnable; extend the par ladder's players to use specials
  (feeds Track C).
- **DoD per B-phase:** the special is created, activates, cascades, scores, and
  re-verifies deterministically; vectors re-locked-and-explained; a11y affordances;
  modes using it stay winnable-daily; deployed.

### Track C — Par ladder (the honest-difficulty overhaul; trails specials)
- **C1 player ladder + par table:** deterministic players of increasing strength
  (weak = greedy, medium = beam, strong = deeper search / MCTS); a committed par
  table mapping seed → per-rung scores → star tiers; regeneration drill.
- **C2 offline calibration study (LLM subagents):** run a spread of "thinking"
  models as playtesters on sample boards, offline, once, to check the search rungs
  correspond to human-ish weak/medium/strong; record findings; tune the rungs.
  Output is a calibration note, not shipped code.
- **C3 re-par with specials:** regenerate the par table once specials land so the
  strong rung uses specials and difficulty stays honest.
- **DoD:** star tiers are the player ladder; par table baked + verifiable; a
  recorded rationale for the rung choices.

### Track D — Parity completeness (confirm each item before building)
The rest of the Candy-Crush surface, surfaced honestly so "entirety" isn't a
pretence. Each is an owner decision like D3/D4 before it is built:
- **More objectives:** ingredients (drop-to-bottom), order/mixed (a checklist),
  timed.
- **More obstacle families:** licorice, spreading chocolate, meringue/icing,
  marmalade, locks, timed bombs (each new state → hash + vectors + solver support).
- **Meta (likely out of scope for the shelf):** boosters, lives, level maps,
  progression — flagged as probably-not-us; confirm.

### Backlog (not a phase yet)
- **D6 in-browser AI hint/coach** — an advisory "show me a strong line" / smarter
  hints feature. Live model acceptable (advisory only). Design after the core
  parity spine lands.

## Reasoning

- **Jelly first** because it reuses the just-proven blockers template end-to-end,
  ships a third mode quickly, and de-risks Phase 0's plumbing generalization on a
  small case before specials stress it.
- **Specials phased one-at-a-time** because each is a real core change (detection +
  a gem type + activation + cascades) and balancing; a big-bang specials drop would
  be unverifiable and unreviewable. Combos last because they presuppose the
  individual specials.
- **Par trails specials** because "strong play" is undefined until specials exist —
  tuning par first would just be redone. But a cheap beam-based par table lands
  early (D5, no users) so the current game is fairer meanwhile.
- **Deterministic players for shipped par, models only to calibrate** because par is
  re-derived at verify time and must be bit-identical everywhere; model inference
  drifts across devices and can't stamp a verifiable result. Baking offline removes
  both the drift risk and the browser runtime cost.
- **Seeded RNG for randomized specials** because verification replays moves; any
  unseeded randomness (fish targeting) would make honest results fail to verify.

## Risks & open design decisions

- **Solver scaling with specials (highest risk).** A specials-aware winnable-daily
  solver may be expensive or hard to keep byte-identically regenerable. Mitigation:
  keep specials *optional* in a mode's winnability requirement where possible; cap
  search; log any coverage cap (no silent truncation).
- **Golden-vector / hash churn.** Every state addition re-locks vectors. Mitigation:
  extend the hash spec deliberately, re-lock in a dedicated commit with the reason.
- **Combo-matrix balance.** Combos can trivialize boards. Mitigation: land specials
  individually first; treat combos as a balance phase with the par ladder in hand.
- **Par delivery (baked table vs pure live function).** Baked table is strong but
  daily-only (free-play needs a fallback); a pure live function must stay cheap.
  Recommendation: baked table + cheap live fallback for off-table seeds; settle in
  Track P-now.
- **Fish target determinism.** Must consume `DetRng` in a fixed order; pin the
  targeting rule in `RULES.md`.

## Guardrails (carried from round 1)

TDD-first through the real entry point; the board UI never decides legality/win;
determinism is the anchor (new state → hash → re-locked vectors, explained);
never panic in the binding; `pond-outcome` additive with distinct `kind`s; reuse
the winnable-daily solver+pack shape; commit + push per stable point (auto-deploy);
keep `TODO/match3.md`, plan headers, `RULES.md`, `docs/BUILDING-GAMES.md` in sync;
regenerate guide shots on any visual change.

## Definition of done (the program)

Jelly ships as a verifiable, winnable-daily, accessible mode; the full specials
system (striped, wrapped, colour bomb, fish, and the combo matrix) is playable,
deterministic, and verifiable, with modes staying winnable-daily; par is the
deterministic player ladder baked into a committed table, calibrated offline and
re-run after specials; Track D items are each owner-confirmed before build; the
hint/coach is on the backlog. Every commit leaves Rust + `npm run test` +
`npm run e2e` green and is deployed; docs reflect reality.
