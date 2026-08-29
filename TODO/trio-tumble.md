# TODO — Trio Tumble: Jewel Drop

Status: **playable** at `/trio-tumble/` (v1: Candy-Crush target-score-in-moves with
star thresholds). Plan: `plans/2026-07-30-trio-tumble-playable.md`. Standards:
`docs/BUILDING-GAMES.md`.

Named on 2026-08-28 (`plans/2026-08-28-2-plan-trio-tumble-rename.md`). It shipped as
"Match-3" — its genre — until then. Where this file says *match-3* below it means the
genre; the game is Trio Tumble.

## Follow-ups from the rename

- [ ] **This game is missing from the home page's "Today" strip.** `src/shelf.ts:137`
  hardcodes `DAILY = new Set(["solitaire", "wyrdle", "2048", "bubble", "align",
  "blockdoku", "color-sort"])` — seven ids, and this game has never been one of them.
  **Pre-existing, not caused by the rename** (verified: the set reads identically at
  `b5c0399`, the commit before it, and named no `match3` either). It looks wrong: this
  game ships a date-seeded daily board and six objectives each with a winnable-daily
  pack, which is more daily surface than anything in that set. Two things to decide
  together — whether the omission was deliberate, and whether a hardcoded id list is
  the right source at all when `contract.ts` could carry a `daily?: boolean` the way
  `shelf.ts:154` already reads one if present.

- [ ] **The front-end is loose files, not a game directory.** `src/games/trio-tumble.ts`
  plus eight `trio-tumble-*.ts` siblings, where `docs/BUILDING-GAMES.md` § "Game
  isolation" and `CLAUDE.md` both specify `src/games/<game>/`. Solitaire has the same
  shape — they are the two oldest games and predate the convention. The rename moved
  the files but deliberately did not restructure them, because consolidating is a
  separate change with its own import churn and no behavioural test to anchor it.

## Shipped (v1)
- [x] `trio-tumble-core` deal generator (seeded, no initial matches, ≥1 legal swap).
- [x] `trio-tumble-wasm` binding + TS wrapper; `pond-outcome` score/stars extension.
- [x] Board UI: tap-a-gem → tap an adjacent gem to swap (core decides legality;
      legal swaps glow), score/swaps-left/stars/targets HUD, cascade re-render,
      verifiable result screen (stars + score + re-verify + `?r=` share).
- [x] Shared settings (hints / declare-assistance) + a "How to play" guide.
- [x] Daily board (date-seed) + free-play (`?seed=`); registry `playable`.
- [x] Tests: unit (share, verify vs real wasm, result screen) + e2e (mechanics,
      target-score run, share round-trip, axe both themes, 360px fit).

## Follow-ups
- [x] **Per-deal star targets** — thresholds now scale to a deterministic greedy
      reference score for the seed (30/60/90% — the shipped `targets_for`
      fractions), re-derived at verify time so shared score/stars are trustless.
      No shipped par table needed.
- [x] **Drag-to-swap** — drop on an adjacent gem swaps via the same core-decided
      resolution as tap; tap stays the accessible floor.
- [x] **Win cascade + score-gain flash** — a gem cascade on a ≥1★ result
      (reduced-motion-aware) and a score bump when a swap scores.

Round-2 follow-ups (plan: `plans/2026-07-30-trio-tumble-followups.md`):
- [x] **Full step-by-step cascade animation** — additive `Game::play_move_traced`
      emits a board snapshot per phase (same RNG → byte-identical final
      `state_hash`, golden vectors untouched); `play_swap_traced` exposes the
      frames as JSON; the UI steps through clear→fall→refill (reduced-motion skips
      to settled; input gated during the animation).
- [x] **Reshuffle on a mid-run deadlock** — `reshuffle_if_dead` in the core: after
      a move settles into a board with no legal swap, deterministically permute the
      gems (rng draws, blockers fixed) to a live, match-free board; folds into
      `state_hash` so `TrioTumble::replay` reshuffles identically. A live board is
      untouched (no draws), so no golden vector's final board deadlocked → no
      locked hash changed. Unit-tested in `tests/reshuffle.rs`; RULES.md updated.

- [x] **Variant objective — clear-the-blockers** (owner-picked 2026-07-30). A
      second objective sharing the 8×8 engine: deal 6 single-layer blockers, win
      by clearing them all, graded on swaps-to-clear. New `trio-tumble-solver` crate
      (budgeted blocker-damage-first DFS) generates a byte-identically
      regenerable winnable-daily pack (`games/trio-tumble/blockers-pack.json`, 365
      seeds + fixture). Binding is mode-aware (`new_blockers_game`,
      `TrioTumbleBlockers` outcome kind `trio-tumble-blockers`); UI adds an objective
      toggle, blocker tiles, a blockers-left HUD, and a verifiable clear result;
      how-to documents it. `?mode=blockers` opens it directly.

## Candy-Crush parity program (roadmap: `plans/2026-07-30-trio-tumble-parity-roadmap.md`)

Owner walk-through 2026-07-30 turned the deferred backlog into a committed parity
program. Decisions (register continues from the round-1 plan's D1/D2):

- **D3 — third objective = jelly** (ingredients/order/timed become later parity
  objectives, confirm before build).
- **D4 — specials = full parity**: striped, wrapped, colour bomb, the 2×2 fish,
  **and the combo matrix**.
- **D5 — par retuned now** (no users): star tiers = a ladder of deterministic
  players (greedy/beam/deeper) baked into a committed par table; LLM subagents used
  offline only to calibrate the rungs, never on the verify path.
- **D6 — in-browser AI hint/coach** = backlog (advisory feature, later).

Order: jelly → specials (phased) → par ladder (trails specials), with a cheap
beam-based par table landing early. Full phasing, DoD, and risks in the roadmap.

- [x] **Track A — jelly objective** — shipped (A1 core → A2 solver+pack → A3
      binding → A4 UI+how-to). Playable at `/trio-tumble/`, winnable-daily, verifiable.
- [x] **Mobile hardening** — a `mobile-webkit` e2e project (iOS engine + touch),
      drag scoped to desktop, bigger phone tap targets. Both boards pass on mobile.
- [x] **Track P-now / C1 — baked par table** — star tiers are the player ladder
      (1★ random floor, 2★ greedy, 3★ beam-8), baked offline into
      `games/trio-tumble/par-pack.json` and embedded in the binding; target-score daily
      draws table seeds, free-play falls back to live greedy tiers. 3★ is no longer
      trivial. Tunable knobs; no version bump (no users).
- [ ] **Track B — specials** (plan: `plans/2026-07-30-trio-tumble-b0-specials.md`):
  - [x] **B0 foundation — special-gem model + shape detection.** A special is a
        `Gem(color)` + a parallel `special` overlay marker (kept the match/legality
        core byte-identical; hash appends a special section only when present, so
        pre-specials vectors did not re-lock). `find_runs` + `creations_for`
        classify a match's shape (line-4 → striped H/V, L/T → wrapped, line-5 →
        colour bomb; priority bomb > wrapped > striped) and create the special at a
        deterministic placement (the swapped candy on step 0, else junction/median).
        Golden vectors 04–07; the specials-creation rules shifted scoring, so the
        three committed packs were regenerated (all 365 seeds stayed winnable,
        byte-identical). Rendered with a power badge + a11y label. **No activation
        yet** (the blast is B1+). The **2×2 fish is deferred to B4** (it needs a new
        *match* definition, not a sub-classification of line matches).
  - [x] **B1 striped activation** (plan: `plans/2026-07-30-trio-tumble-b1-striped.md`).
        A striped candy fires its line blast: `StripedH`→row, `StripedV`→column,
        chaining through other specials (deterministic set-union), cascading.
        Triggered by matching it (B1.1) or **swapping** it with any neighbour —
        legal with no line match (B1.2). Golden vectors 08/09; the swap now
        carries the special marker, and a latent `reshuffle_if_dead` desync (it
        permuted gems without their markers, shipped since B0) is fixed —
        vectors 04/05/06 re-locked to corrected hashes. UI renders the blast via
        the existing cascade animation; how-to updated. Packs re-locked.
  - [x] **B2 wrapped activation** (plan: `plans/2026-07-30-trio-tumble-b2-wrapped.md`).
        L/T → wrapped; activation = the canon **double 3×3**. First blast clears the
        3×3 minus the wrapped's own centre (it survives), the wrapped is **pinned**
        through that step's gravity (candies fall in around it), then it re-blasts
        the full 3×3 (consumed) next step — mirroring the reference (owner-chosen
        realization; the game is a generic of the mechanic set). Chains (a chained
        wrapped does its own double); triggered by matching it (B2.1) or swapping it,
        legal with no line match (B2.2). Golden vectors 10/11/12; par pack re-locked
        (blockers/jelly byte-identical); the re-blast carry is transient (not in
        `state_hash`); how-to updated.
  - [x] **B3 colour-bomb activation** (plan: `plans/2026-07-30-trio-tumble-b3-colorbomb.md`).
        5-in-a-row → colour bomb; **swap it with a gem to clear all of that gem's
        colour** (bomb consumed), chaining any striped/wrapped of that colour.
        Swap-only (colourless → never match-fired): `fires_on_swap` += `ColorBomb`,
        `activate` gains a colour-predicate `bombs` branch. Golden vector 13; vector
        06 re-locked (its created colour bomb is now a legal swap → no reshuffle);
        par pack re-locked; how-to updated. Combos (bomb+bomb/bomb+special, and a
        colour bomb set off by another blast) are B5.
  - [x] **B4 fish (2×2 square)** (plan: `plans/2026-07-30-trio-tumble-b4-fish.md`).
        A 2×2 is a first-class match (Option A, folded into `find_matches`): legal
        swap, clears, deal/reshuffle avoid it. A pure 2×2 makes a `Fish` (tag 0x05);
        a fired fish (matched/swapped) swims to eat one seeded target (jelly first,
        else any gem) via `DetRng` — the first RNG-in-activation, drawn before
        refill so it folds into the fingerprint. Deal changed → jelly+par packs +
        JS jelly fixture + colour-bomb e2e seed re-derived; vector 14. Direct
        blocker-eating + fish combos are B5/follow-up.
  - [x] **B5 combo matrix** (plan: `plans/2026-07-30-trio-tumble-b5-combos.md`).
        Swapping two non-fish specials combines them (RULES.md T1d) via a `combo()`
        classifier feeding `activate` (a new `ComboEffect` input; no-combo path
        byte-identical). B5.1 striped+striped (cross), striped+wrapped (thick cross),
        wrapped+wrapped (5×5); B5.2 bomb+striped / bomb+wrapped (partner colour's
        rows+cols / 3×3s, direct clear-set) and bomb+bomb (clear the board). Golden
        vectors 15–20; par pack re-locked (blockers/jelly unchanged); how-to + a combo
        e2e added.
  - [x] **B5.4 fish combos** (plan: `plans/2026-07-31-trio-tumble-b5.4-fish-combos.md`). A fish
        swapped with any special now combines: fish+fish/striped/wrapped spawn N=3 fish
        that draw distinct seeded targets (RNG-in-combo) and apply the partner's blast;
        fish+bomb = colour-clear of the fish's colour. Vectors 21–23; par re-locked; how-to
        + e2e added. N=3 is a canon-derived tunable knob.
  - [x] **B6 specials-aware solver/par** (plan: `plans/2026-07-30-trio-tumble-b6-specials-par.md`).
        Discovery: the winnability solvers + all par players already play the real engine,
        so specials/combos already participate (winnability never a lie). Owner-chosen
        work: a strong rung that *deliberately* exploits specials —
        `reference_score_specials`, a beam ranking its frontier by actual-score +
        special/combo potential (floored by beam-8), now **3★**. Par re-baked in place
        (D5): 3★ rose on 284/365 seeds (mean +17.7%). Weights are Track C knobs.
  - [ ] **Track C par calibration. Next up: C2/C3.**
- [x] **Track C — par calibration** (DONE 2026-07-31; note:
      `plans/2026-07-31-trio-tumble-c2-calibration.md`). C2 studied the rung spread over all
      365 daily seeds (rungs ~2× separated; 3★ = specials-beam, +111% median over greedy,
      combo headroom on every board, sub-optimal) + an illustrative model panel
      (casual≈1★–2★, careful≈2★, expert≈3★). Verdict: keep the rungs/weights — 3★ reads
      strong-but-attainable. C3 (re-par with specials) already satisfied by B6.
- [x] **Track D — parity completeness — COMPLETE (2026-07-31)** (plan:
      `plans/2026-07-31-trio-tumble-d-checklist-obstacles.md`). An honest boundary: the objectives
      + obstacle families that fit the shelf are shipped; the rest is deliberately out of scope.
  - [x] **Ingredients (drop-to-bottom)** — plan `plans/2026-07-31-trio-tumble-d-ingredients.md`.
        `Cell::Ingredient` (falling non-gem, hash tag `0x03`) + the full mode template.
        Playable at `?mode=ingredients`, winnable-daily, verifiable.
  - [x] **Order/mixed CHECKLIST** — a fifth objective (clear N of a colour + make N striped +
        N wrapped): a **path-accumulated** win (a `ChecklistProgress` accumulator fed by two
        neutral off-hash `StepReport` signals, shared by binding/solver/replay); seed-template
        targets + solver-filtered pack; `Mode::Checklist` + `trio-tumble-checklist`; UI "Orders"
        toggle + goal-tally HUD + how-to + e2e. Playable at `?mode=checklist`, deployed +
        live-smoked.
  - [x] **Obstacle families — meringue + licorice** — distinct, mechanically-separate tiles via
        a blocker-flavour overlay (`o\x00` hash section, additive; `Obstacle {Licorice,Meringue}`,
        tags `0x01`/`0x02`). Meringue = durable multi-hit (first shipped layered-blocker daily);
        licorice = single-hit. New `Mode::Obstacles` + `trio-tumble-obstacles` + `find_obstacles`
        pack + UI toggle/tiles/HUD + how-to + e2e + golden vector 25. Playable at
        `?mode=obstacles`, deployed + live-smoked.
  - **Out of scope (deliberate, recorded with reasons):** *timed* (breaks the no-wall-clock
    verifiable model — a result must be a pure function of `(seed, moves)`); *spreading
    chocolate / marmalade / locks / timed bombs* (buildable later on the T7 overlay pattern;
    timed bombs also hit the wall-clock limit); *meta — boosters, lives, level maps,
    progression* (contradicts the single-daily-board, account-less, server-less shelf).
- [ ] **Backlog — in-browser AI hint/coach** (D6): advisory "show a strong line" /
      smarter hints; design after the parity spine lands.
