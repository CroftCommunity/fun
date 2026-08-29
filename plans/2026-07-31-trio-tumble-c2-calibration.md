# Match-3 parity — Track C / C2: par-ladder calibration note

**Status:** ✅ **LOCKED (2026-07-31)** — Track C complete; difficulty kept at the current
specials-beam 3★. Parent: `plans/2026-07-30-trio-tumble-parity-roadmap.md` (Track C / C2). This
is the **recorded rationale for the rung choices** the Track C DoD calls for — an analysis
output, **not shipped code**. Owner scope (2026-07-31): **both** methods (a data-driven
spread + an illustrative model panel), **all 365 daily seeds**, evaluating the **current
specials-beam 3★**. The verdict is a **locked design decision**, not a "pending real
play-data" hold — there is no telemetry (the shelf is static + account-less), and stars are
defined solver-relative, so there is nothing external to await (see "Verdict — LOCKED").

## Question

Do the shipped par rungs map to human weak / medium / strong, and does 3★ (the
specials-exploiting beam-8, B6) read as *strong-but-attainable* (D5) rather than trivial
or near-optimal? If it skews, recommend tuning the `special_potential` weights or the
beam width.

## Method

1. **Data-driven spread (deterministic).** Compute all three rungs — `random_score`
   (1★), `reference_score` greedy (2★), `reference_score_specials` beam-8 (3★) — over
   the 365 target-score daily seeds and summarize the gaps. Reproducer: the `#[ignore]`
   `calibration_rung_spread` test in `crates/trio-tumble-solver/tests/solver.rs` (run with
   `--release --ignored --nocapture`).
2. **Illustrative model panel.** Three "thinking"-model playtester personas (casual /
   careful / expert), each giving a *reasoned* difficulty read — **not measured play**
   (LLMs can't optimize spatial match-3, so this is a qualitative cross-check only, as
   the owner acknowledged). Same session model as the parent agent.

## Findings — the data (all 365 daily seeds)

```
1★ random  mean ~1162      →  2★ greedy mean ~2759      →  3★ specials-beam mean ~5765
        greedy / random  ×2.37              specials / greedy  ×2.09
combo headroom: specials > greedy on 365 / 365 seeds
specials uplift over greedy:  p10 +54%   median +111%   p90 +202%   max +493%
```

- **The rungs are well-separated and strictly ordered on every seed.** Each rung is
  roughly **2× the one below** (×2.37 then ×2.09), so 0–3 stars are distinct bands, not a
  crowded cluster.
- **3★ has genuine combo headroom on every board** (specials > greedy on 365/365). The
  top star is never merely "greedy played cleanly" — it always requires the
  specials/combo layer the specials-beam exploits. The median board asks for **~2.1× the
  competent (greedy) score** to earn 3★.
- **Not near-optimal.** The 3★ rung is a *width-8* beam that also carries greedy as a
  floor; deeper beams keep climbing (B6/roadmap measurement), so 3★ is the *floor of
  strong play*, not the ceiling — headroom remains above it by design.

## Findings — the illustrative model panel (qualitative)

| Persona | Self-estimated landing | Read on 3★ |
|---|---|---|
| Casual (swaps first match seen, ignores specials) | ~1600–2400 → **1★–2★** | "too hard for me", but a fair ceiling to chase; keep 2★ the satisfying "did well" tier |
| Careful (looks a move ahead, fires specials as they arrive, rarely sets up combos) | ~3000–3800 → **mid-high 2★** | "strong-but-attainable, leaning genuinely demanding"; gated on a real skill, reachable in 20 swaps |
| Expert (builds specials, hoards a colour bomb, plans a big combo) | reaches **3★** via one clean bomb+striped / bomb+bomb | "the floor of good play, not a ceiling"; the 2.09× gap is the right "did you actually build?" cliff |

The panel maps onto the ladder as intended: **casual ≈ 1★–2★, careful ≈ 2★, expert ≈
3★.** All three agree 3★ is gated on the *deliberate specials-combo* skill rather than
grinding or luck, and that it is demanding but reachable within the 20-swap budget. This
is exactly D5's "strong-but-attainable, not the majority-easy Candy-Crush 3★."

## Verdict — LOCKED (2026-07-31)

**Keep the current rungs and `special_potential` weights; Track C is done.** The shipped
ladder is healthy: monotone, ~2× separated, with combo headroom on every daily, and a 3★
that both the data (2.1× greedy, sub-optimal) and the panel (expert-reachable,
careful-short) read as strong-but-attainable.

### Why this is a *locked design decision*, not a provisional "await data"

An earlier draft of this note hedged that "the honest calibration is the day real
play-data arrives." **That day is not coming, and it does not need to.** The shelf is
static (GitHub Pages), account-less and server-less by design — outcomes are shared
voluntarily as `?r=` links, never collected — so there is **no telemetry pipeline** and
there never will be. Aggregate "what % of players hit 3★" data is simply not a thing this
project will have.

That is fine, because D5 defined the stars **solver-relative**, not by a human percentile:
a star means "you played as well as a {weak / competent / strong} deterministic solver."
Under that definition **the ladder *is* the bar** — there is nothing external to measure
against and nothing to wait for. The human-ish model panel above was only ever a loose
sanity check that the solver rungs are not absurdly placed, never a future data-driven
correction. So this calibration is **final by construction**, not pending.

### If we ever return to refine it (a deliberate design choice, not a measurement)

Refinement here is a judgment call about *desired difficulty*, made by an owner, not a fit
to observed data. The knobs, recorded so a future session can move 3★ cheaply:
- *Make 3★ easier* → reduce the beam width (8 → 4), or trim the `special_potential`
  combo-adjacency bonus so the strong player builds fewer combos.
- *Make 3★ harder* → widen the beam, or raise the combo bonus.
- Either re-bakes `par-pack.json` in place via the generator + the byte-identical regen
  drill. `TrioTumble::VERSION` stays 1 while there are no users; it becomes a `VERSION` bump
  only if shared records ever need their old par preserved.
- The reproducer (`calibration_rung_spread`, `#[ignore]`) reprints the spread to re-judge.

## C3 status

Track C's C3 ("re-par with specials") is **already satisfied**: B6 baked the
specials-exploiting player into the 3★ rung and regenerated the committed par table. This
note evaluated that result, found no further re-par needed, and locked it — so **Track C
is complete** (star tiers are the deterministic player ladder; the par table is baked +
verifiable; the rung rationale is recorded here).
