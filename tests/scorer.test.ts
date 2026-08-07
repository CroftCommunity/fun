//! P6 Phase 2 — the pure scorer. Two layers, both mutation-resistant:
//!  (1) `foldVerdict` / `blunderRate` are pure folds over `{quality, exact}` —
//!      unit-pinned on every boundary (each quality bucket, the exact gate, the
//!      0-scored rate);
//!  (2) `gradeSide` drives the REAL wasm oracle over a played-out record — a full
//!      Perfect-vs-Perfect game reaches the exact endgame, so perfect play grades
//!      >=1 move with `blunders === 0` (the class floor), and injecting one
//!      oracle-identified bad move into the exact region flips a bucket to
//!      `blunder`. This proves the wasm-grading path, not just the fold.

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { Drop4 } from "../src/games/drop4/drop4-wasm.js";
import { drop4Oracle } from "../src/games/drop4/drop4-oracle.js";
import type { GameOracle } from "../src/harness/game-oracle.js";
import { EnginePlayer, runMatch, type MatchRecord } from "../src/harness/match-runner.js";
import {
  blunderRate,
  emptyScorecard,
  foldVerdict,
  gradeSide,
} from "../src/harness/scorer.js";

const WASM = "target/wasm32-unknown-unknown/release/drop4_wasm.wasm";

async function loadReal(): Promise<GameOracle> {
  const bytes = await readFile(WASM);
  const orig = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(bytes, { headers: { "content-type": "application/wasm" } })) as typeof fetch;
  try {
    return drop4Oracle(await Drop4.load());
  } finally {
    globalThis.fetch = orig;
  }
}

describe("scorer: pure folds", () => {
  it("foldVerdict routes each quality to its bucket and gates on exact", () => {
    let c = emptyScorecard();
    c = foldVerdict(c, { quality: "optimal", exact: true });
    c = foldVerdict(c, { quality: "resultPreserving", exact: true });
    c = foldVerdict(c, { quality: "blunder", exact: true });
    c = foldVerdict(c, { quality: "optimal", exact: false }); // not exact -> skipped, not scored
    expect(c.optimal).toBe(1);
    expect(c.preserving).toBe(1);
    expect(c.blunders).toBe(1);
    expect(c.skippedEarly).toBe(1);
    expect(c.scoredMoves).toBe(3); // only the exact ones
  });

  it("foldVerdict is pure (does not mutate its input)", () => {
    const base = emptyScorecard();
    foldVerdict(base, { quality: "blunder", exact: true });
    expect(base.scoredMoves).toBe(0);
    expect(base.blunders).toBe(0);
  });

  it("blunderRate is 0 with no graded moves and the ratio otherwise", () => {
    expect(blunderRate(emptyScorecard())).toBe(0);
    expect(blunderRate({ ...emptyScorecard(), scoredMoves: 12, blunders: 3 })).toBeCloseTo(0.25);
    expect(blunderRate({ ...emptyScorecard(), scoredMoves: 10, blunders: 0 })).toBe(0);
  });
});

describe("scorer: gradeSide over the real wasm oracle", () => {
  it(
    "grades a perfect endgame with a class floor of zero blunders, skipping early moves",
    async () => {
      const game = await loadReal();
      const rec = await runMatch(game, new EnginePlayer(3), new EnginePlayer(3), 0n);
      expect(rec.aborted).toBeFalsy();

      const verifier = await loadReal();
      const cardA = gradeSide(rec, verifier, 1);

      expect(cardA.games).toBe(1);
      // The game reaches *a* result, not a specific one. It asserted a draw
      // until 2026-08-07, which was an observed property of the old Drop 4
      // engine rather than a designed guarantee — Drop 4's "Perfect" is a
      // depth-capped heuristic, not the exact solver, so nothing made a draw
      // inevitable. Iterative deepening under a node budget (P9 Phase 3) made
      // the same matchup decisive. What this test is actually for is the two
      // assertions below it: the grader reaches the exact region, and a
      // class-floored engine never blunders there.
      expect(cardA.wins + cardA.draws + cardA.losses).toBe(cardA.games);
      expect(cardA.scoredMoves).toBeGreaterThan(0); // reached the exact endgame region
      expect(cardA.skippedEarly).toBeGreaterThan(0); // early moves honestly skipped
      expect(cardA.optimal + cardA.preserving + cardA.blunders).toBe(cardA.scoredMoves);
      expect(cardA.blunders).toBe(0); // perfect play never drops the class
    },
    30_000,
  );

  it(
    "counts an oracle-identified bad move in the exact region as a blunder",
    async () => {
      const game = await loadReal();
      const rec = await runMatch(game, new EnginePlayer(3), new EnginePlayer(3), 0n);

      // Replay to the first exact-region A-turn position that offers a blunder,
      // then build a record whose last A move is that oracle-identified blunder.
      const probe = await loadReal();
      probe.newGame(rec.seed);
      const prefix: number[] = [];
      let blunderCol: number | null = null;
      for (const col of rec.moves) {
        const b = probe.board();
        if (b.result === -1 && b.toMove === 1) {
          const report = probe.tutor();
          if (report.exact) {
            const bad = report.moves.find((m) => m.quality === "blunder");
            if (bad) {
              blunderCol = bad.col;
              break;
            }
          }
        }
        expect(probe.play(col)).toBe("applied");
        prefix.push(col);
      }
      expect(blunderCol, "a drawn perfect endgame offers a losing alternative").not.toBeNull();

      const injected: MatchRecord = {
        seed: rec.seed,
        moves: [...prefix, blunderCol!],
        result: -1,
        hash: "",
        aborted: true,
        abortReason: "rejectedMove",
        timings: [],
        sources: [],
      };
      const verifier = await loadReal();
      const card = gradeSide(injected, verifier, 1);
      expect(card.blunders).toBeGreaterThanOrEqual(1);
    },
    30_000,
  );
});
