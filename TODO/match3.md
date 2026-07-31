# TODO — match-3

Status: **playable** at `/match3/` (v1: Candy-Crush target-score-in-moves with
star thresholds). Plan: `plans/2026-07-30-match3-playable.md`. Standards:
`docs/BUILDING-GAMES.md`.

## Shipped (v1)
- [x] `match3-core` deal generator (seeded, no initial matches, ≥1 legal swap).
- [x] `match3-wasm` binding + TS wrapper; `pond-outcome` score/stars extension.
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

Round-2 follow-ups (plan: `plans/2026-07-30-match3-followups.md`):
- [x] **Full step-by-step cascade animation** — additive `Game::play_move_traced`
      emits a board snapshot per phase (same RNG → byte-identical final
      `state_hash`, golden vectors untouched); `play_swap_traced` exposes the
      frames as JSON; the UI steps through clear→fall→refill (reduced-motion skips
      to settled; input gated during the animation).
- [x] **Reshuffle on a mid-run deadlock** — `reshuffle_if_dead` in the core: after
      a move settles into a board with no legal swap, deterministically permute the
      gems (rng draws, blockers fixed) to a live, match-free board; folds into
      `state_hash` so `Match3::replay` reshuffles identically. A live board is
      untouched (no draws), so no golden vector's final board deadlocked → no
      locked hash changed. Unit-tested in `tests/reshuffle.rs`; RULES.md updated.

- [x] **Variant objective — clear-the-blockers** (owner-picked 2026-07-30). A
      second objective sharing the 8×8 engine: deal 6 single-layer blockers, win
      by clearing them all, graded on swaps-to-clear. New `match3-solver` crate
      (budgeted blocker-damage-first DFS) generates a byte-identically
      regenerable winnable-daily pack (`games/match3/blockers-pack.json`, 365
      seeds + fixture). Binding is mode-aware (`new_blockers_game`,
      `Match3Blockers` outcome kind `match3-blockers`); UI adds an objective
      toggle, blocker tiles, a blockers-left HUD, and a verifiable clear result;
      how-to documents it. `?mode=blockers` opens it directly.

## Candy-Crush parity program (roadmap: `plans/2026-07-30-match3-parity-roadmap.md`)

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
      binding → A4 UI+how-to). Playable at `/match3/`, winnable-daily, verifiable.
- [x] **Mobile hardening** — a `mobile-webkit` e2e project (iOS engine + touch),
      drag scoped to desktop, bigger phone tap targets. Both boards pass on mobile.
- [x] **Track P-now / C1 — baked par table** — star tiers are the player ladder
      (1★ random floor, 2★ greedy, 3★ beam-8), baked offline into
      `games/match3/par-pack.json` and embedded in the binding; target-score daily
      draws table seeds, free-play falls back to live greedy tiers. 3★ is no longer
      trivial. Tunable knobs; no version bump (no users).
- [ ] **Track B — specials** (plan: `plans/2026-07-30-match3-b0-specials.md`):
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
  - [x] **B1 striped activation** (plan: `plans/2026-07-30-match3-b1-striped.md`).
        A striped candy fires its line blast: `StripedH`→row, `StripedV`→column,
        chaining through other specials (deterministic set-union), cascading.
        Triggered by matching it (B1.1) or **swapping** it with any neighbour —
        legal with no line match (B1.2). Golden vectors 08/09; the swap now
        carries the special marker, and a latent `reshuffle_if_dead` desync (it
        permuted gems without their markers, shipped since B0) is fixed —
        vectors 04/05/06 re-locked to corrected hashes. UI renders the blast via
        the existing cascade animation; how-to updated. Packs re-locked.
  - [x] **B2 wrapped activation** (plan: `plans/2026-07-30-match3-b2-wrapped.md`).
        L/T → wrapped; activation = the canon **double 3×3**. First blast clears the
        3×3 minus the wrapped's own centre (it survives), the wrapped is **pinned**
        through that step's gravity (candies fall in around it), then it re-blasts
        the full 3×3 (consumed) next step — mirroring the reference (owner-chosen
        realization; the game is a generic of the mechanic set). Chains (a chained
        wrapped does its own double); triggered by matching it (B2.1) or swapping it,
        legal with no line match (B2.2). Golden vectors 10/11/12; par pack re-locked
        (blockers/jelly byte-identical); the re-blast carry is transient (not in
        `state_hash`); how-to updated.
  - [ ] B3 colour bomb → B4 fish (2×2 + seeded targeting) → B5 combo matrix → B6
        specials-aware solver/par. **Next up: B3.**
- [ ] **Track C (rest) — par calibration**: C2 offline LLM calibration study of the
      rung difficulty → C3 re-par after specials land.
- [ ] **Track D — parity completeness** (confirm each first): ingredients,
      order/mixed, timed objectives; more obstacle families (licorice, chocolate,
      meringue, locks, timed bombs).
- [ ] **Backlog — in-browser AI hint/coach** (D6): advisory "show a strong line" /
      smarter hints; design after the parity spine lands.
