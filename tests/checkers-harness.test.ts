//! P8 Phase 15 — the harness's generality proof, third game and hardest case.
//!
//! Drop 4's move is a column and Othello's is a cell: both a single `u8` naming a
//! destination. Checkers' move is a **path**, packed into a 14-bit code, so it is
//! the first move the rig has ever graded that does not fit in a byte and does not
//! name a square. The claim under test is not "checkers scores well" — it is
//! **"the rig needed no edit"**; the phase's `git diff --stat` gate on
//! `match-runner` / `scorer` / `tournament` is the other half of it.
//!
//! `abortedGames === 0` carries the most weight here. A truncated move code would
//! surface as a rejected `play` and abort the match, which without Phase 2c's
//! counter would render as a clean-looking zero-blunder Report.
//!
//! On `blunders === 0`: Phase 11 measured that a proven *pair* (both the played
//! move's value and the best move's) is rare in checkers, so a zero-blunder
//! assertion over a tournament asserts very little on its own. The load-bearing
//! assertions here are the denominator (`scoredMoves > 0`) and the class floor
//! together — that is recorded in the plan's Phase 15 execution entry.

import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";

import { checkersOracle } from "../src/games/checkers/checkers-oracle.js";
import { Checkers } from "../src/games/checkers/checkers-wasm.js";
import type { GameOracle } from "../src/harness/game-oracle.js";
import { EnginePlayer } from "../src/harness/match-runner.js";
import { renderReport, runTournament } from "../src/harness/tournament.js";

const WASM = "target/wasm32-unknown-unknown/release/checkers_wasm.wasm";

async function loadReal(): Promise<GameOracle> {
  const bytes = await readFile(WASM);
  const orig = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(bytes, { headers: { "content-type": "application/wasm" } })) as typeof fetch;
  try {
    return checkersOracle(await Checkers.load());
  } finally {
    globalThis.fetch = orig;
  }
}

describe("checkers meets the harness (the generality proof, third game)", () => {
  beforeAll(async () => {
    const bytes = await readFile(WASM); // fail fast if preunit didn't build it
    expect(bytes.length).toBeGreaterThan(0);
  });

  it("the adapter passes packed path codes through the port untruncated", async () => {
    const oracle = await loadReal();
    oracle.newGame(7n);
    const codes = oracle.legalMoves();
    // Every opening move's code exceeds a u8 — the property no other shelf game
    // exercises. If any layer narrowed it, `play` would reject the move.
    expect(codes.every((c) => c > 255)).toBe(true);
    expect(oracle.play(codes[0]!)).toBe("applied");
    // There is no pass in checkers, and no pass sentinel to normalize: the
    // adapter is a pure pass-through where Othello's had to translate.
    const live = oracle.liveMove(3);
    expect(typeof live).toBe("number");
    expect(oracle.play(live!)).toBe("applied");
    const a = oracle.assess(oracle.legalMoves()[0]!);
    expect(a).not.toBeNull();
    expect(a!.immediateWin).toBe(false);
    expect(a!.blocksOpponentWin).toBe(false);
  }, 120_000);

  it("liveMove returns null only at a terminal position, so no match aborts", async () => {
    const oracle = await loadReal();
    oracle.newGame(5n);
    let plies = 0;
    while (oracle.board().result === -1) {
      const code = oracle.liveMove(0);
      expect(code, `liveMove returned null at a live position (ply ${plies})`).not.toBeNull();
      expect(oracle.play(code!)).toBe("applied");
      plies += 1;
    }
    expect(oracle.liveMove(0)).toBeNull();
    expect(plies).toBeGreaterThan(10);
  }, 120_000);

  it(
    "grades a self-play tournament with no rig edit",
    async () => {
      const report = await runTournament(loadReal, new EnginePlayer(1), new EnginePlayer(1), {
        games: 2,
        baseSeed: 0n,
      });

      // The class floor holds for a third game...
      expect(report.card.blunders).toBe(0);
      // ...it is not vacuous — moves were actually graded (proven values found)...
      expect(report.card.scoredMoves).toBeGreaterThan(0);
      // ...and the games finished. A truncated packed code would abort here.
      expect(report.abortedGames).toBe(0);

      expect(report.card.games).toBe(2);
      expect(renderReport(report)).toContain("aborted");
    },
    900_000,
  );
});
