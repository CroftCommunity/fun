//! The engine-vs-engine regression anchors, as an assertion rather than a claim.
//!
//! `docs/HARNESS.md` says any change touching a solver, a band, or the rig should
//! reproduce these numbers **exactly** — they are seeded and deterministic, so a
//! diff is a finding, not noise. That instruction had no command behind it:
//! `harness:trial` runs Hybrid-vs-Engine, and `tournament.test.ts` computes these
//! numbers without printing or asserting them. Phases 7 and 8 of the checkers plan
//! each needed a hand-written throwaway probe to do the comparison the plan
//! mandates, which is a documented instruction nobody can follow.
//!
//! **Opt-in, not part of `npm run unit`.** The Othello run alone is ~110s, because
//! the exact endgame is genuinely expensive; that does not belong on a gate that
//! runs on every commit. Run it with `npm run baselines` when a change touches a
//! solver, a band, or the rig.
//!
//! Wall-clock is deliberately **not** asserted. It is the one number in a Report
//! that is not deterministic, and pinning it would make this test fail on a busy
//! laptop — which is how a regression anchor gets muted.

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { drop4Oracle } from "../src/games/drop4/drop4-oracle.js";
import { Drop4 } from "../src/games/drop4/drop4-wasm.js";
import { checkersOracle } from "../src/games/checkers/checkers-oracle.js";
import { Checkers } from "../src/games/checkers/checkers-wasm.js";
import { othelloOracle } from "../src/games/othello/othello-oracle.js";
import { Othello } from "../src/games/othello/othello-wasm.js";
import type { GameOracle } from "../src/harness/game-oracle.js";
import { EnginePlayer } from "../src/harness/match-runner.js";
import { renderReport, runTournament } from "../src/harness/tournament.js";

/** One game's anchor: how to load it, and the Report it must reproduce. */
type Anchor = {
  game: string;
  load: () => Promise<GameOracle>;
  recorded: Baseline;
};

/** The deterministic half of a Report — everything except wall-clock. */
type Baseline = {
  games: number;
  wins: number;
  draws: number;
  losses: number;
  scoredMoves: number;
  optimal: number;
  preserving: number;
  blunders: number;
  skippedEarly: number;
  abortedGames: number;
  /** Provenance — 0/0 for engine self-play, which has one path to a move. */
  llmMoves: number;
  fallbackMoves: number;
};

/** Load a wasm module through the CI shim (a `fetch` stub over the built file). */
async function loadWasm<T>(path: string, load: () => Promise<T>): Promise<T> {
  const bytes = await readFile(path);
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(bytes, { headers: { "content-type": "application/wasm" } })) as typeof fetch;
  try {
    return await load();
  } finally {
    globalThis.fetch = original;
  }
}

/**
 * Recorded 2026-08-05 on CI-equivalent wasm, top level, 2 games, seed 0.
 * Reproduced unchanged across the `adversary-solver` extraction (Phases 7 and 8).
 *
 * If one of these numbers moves, do not update it to match. Find out why first:
 * these are the seeded output of a deterministic engine, so a change means the
 * engine changed.
 */
const ANCHORS: readonly Anchor[] = [
  {
    game: "drop4",
    load: async () =>
      drop4Oracle(
        await loadWasm("target/wasm32-unknown-unknown/release/drop4_wasm.wasm", () => Drop4.load()),
      ),
    // Re-recorded 2026-08-07 (was 0-2-0, 16 graded / 16 optimal) when the live
    // capped search became iterative deepening under a 250,000-node budget (P9
    // Phase 3). The engine changed, which is the one legitimate reason to move a
    // number here — Drop 4's capped path had never been measured and was costing
    // 914ms on its worst move, with 20% of moves over 400ms. It is now 158ms and
    // 0%.
    //
    // What did **not** change is the part that matters: every graded move is
    // still optimal and there are no blunders, so the shallower search never
    // dropped a class the oracle could see. W-D-L moved from two draws to one
    // win and one loss, which is a different result rather than a worse one —
    // both seats run the same engine.
    //
    // Read the grading scope honestly: the anchor grades only the tractable
    // endgame (26 moves skipped early) and this change bites in the *opening*,
    // so these counts are not where the strength question is settled. That is
    // done by `the_budgeted_opponent_is_not_materially_weaker_than_the_
    // unbudgeted_one` in `drop4-solver`, which plays budgeted against unbudgeted
    // over varied openings.
    recorded: {
      games: 2,
      wins: 1,
      draws: 0,
      losses: 1,
      scoredMoves: 15,
      optimal: 15,
      preserving: 0,
      blunders: 0,
      skippedEarly: 26,
      abortedGames: 0,
      llmMoves: 0,
      fallbackMoves: 0,
    },
  },
  {
    game: "othello",
    load: async () =>
      othelloOracle(
        await loadWasm("target/wasm32-unknown-unknown/release/othello_wasm.wasm", () =>
          Othello.load(),
        ),
      ),
    // Re-recorded 2026-08-06 (was 10 graded / 50 skipped) when Othello's search
    // stopped re-deciding exact-vs-capped at every node and `TRACTABLE_EMPTIES`
    // rose 10 → 12 on the back of it. Two more moves fall in the exact region, so
    // two more are graded; W-D-L is unchanged, which is the check that widening
    // the oracle did not change who wins. The run also got *faster* — the old
    // interior switch was turning a capped search's leaves into full solves.
    recorded: {
      games: 2,
      wins: 1,
      draws: 0,
      losses: 1,
      scoredMoves: 12,
      optimal: 12,
      preserving: 0,
      blunders: 0,
      skippedEarly: 48,
      abortedGames: 0,
      llmMoves: 0,
      fallbackMoves: 0,
    },
  },
  {
    game: "checkers",
    load: async () =>
      checkersOracle(
        await loadWasm("target/wasm32-unknown-unknown/release/checkers_wasm.wasm", () =>
          Checkers.load(),
        ),
      ),
    // Recorded 2026-08-06, when checkers shipped (P8 Phase 15 follow-up), and
    // **re-recorded the same day** when `assess_json` was moved from the tap-path
    // budget to the analysis budget: graded 4 → 9, skipped 159 → 154. That is the
    // grader itself changing, which is the one reason a number here may be
    // updated rather than investigated — a deeper oracle proves more, so it
    // grades more. It costs wall-clock, which this file deliberately does not
    // assert (it swings with machine load — measured between 8s and 32s for the
    // same deterministic result).
    //
    // Both games still draw: top-level self-play grinds to the 80-ply no-progress
    // rule, the honest terminal for a game neither side can force. The graded
    // fraction is still small — 9 of 163 plies — because checkers is `exact` only
    // where the search PROVES a terminal, so `skippedEarly` dominating is the
    // honesty gate working, not a defect. If `scoredMoves` ever reads 0 here, the
    // anchor has stopped measuring anything and that is the finding.
    recorded: {
      games: 2,
      wins: 0,
      draws: 2,
      losses: 0,
      scoredMoves: 9,
      optimal: 9,
      preserving: 0,
      blunders: 0,
      skippedEarly: 154,
      abortedGames: 0,
      llmMoves: 0,
      fallbackMoves: 0,
    },
  },
];

// Opt-in: `npm run baselines` sets this. Skipped silently in `npm run unit`.
const enabled = process.env.HARNESS_BASELINES === "1";

describe.skipIf(!enabled)("recorded engine-vs-engine baselines", () => {
  for (const { game, load, recorded } of ANCHORS) {
    it(
      `${game} reproduces its recorded Report exactly`,
      async () => {
        const report = await runTournament(load, new EnginePlayer(3), new EnginePlayer(3), {
          games: 2,
          baseSeed: 0n,
        });
        // Printed whether or not it passes: a failure is only actionable next to
        // the Report it came from.
        console.log(`\n=== ${game} ===\n${renderReport(report)}`);

        // Everything except wall-clock, which is the one non-deterministic field.
        const { moveMsTotal, ...deterministic } = report.card;
        expect(moveMsTotal).toBeGreaterThan(0);
        expect({ ...deterministic, abortedGames: report.abortedGames }).toEqual(recorded);
      },
      600_000,
    );
  }
});
