//! P6 Phase 3 — the tournament: N games of a-vs-b (alternating who opens, to
//! remove first-move bias), grading the player-under-test whichever side it took,
//! aggregated into a `Report`. This is the full rig end-to-end on CI over the real
//! wasm with deterministic engine players: Perfect-vs-Perfect fills the board to a
//! draw every game, so `wins+draws+losses === games`, every move is legal (no
//! aborts), and — the security-load-bearing invariant — perfect play grades to
//! `blunders === 0` (the class floor). Also pins the Pass 3 render gate: the
//! one-block report surfaces the graded-move denominator, never a bare blunder
//! count.

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { Drop4 } from "../src/games/drop4/drop4-wasm.js";
import { EnginePlayer } from "../src/harness/match-runner.js";
import { renderReport, runTournament } from "../src/harness/tournament.js";

const WASM = "target/wasm32-unknown-unknown/release/drop4_wasm.wasm";

async function loadReal(): Promise<Drop4> {
  const bytes = await readFile(WASM);
  const orig = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(bytes, { headers: { "content-type": "application/wasm" } })) as typeof fetch;
  try {
    return await Drop4.load();
  } finally {
    globalThis.fetch = orig;
  }
}

describe("tournament: full rig over the real wasm", () => {
  it(
    "engine-vs-engine aggregates a consistent Report with a zero-blunder class floor",
    async () => {
      const report = await runTournament(loadReal, new EnginePlayer("Perfect"), new EnginePlayer("Perfect"), {
        games: 2,
        baseSeed: 0n,
      });
      const c = report.card;

      expect(c.games).toBe(2);
      expect(c.wins + c.draws + c.losses).toBe(c.games); // consistent W/D/L
      expect(c.draws).toBe(2); // Perfect-vs-Perfect draws both games (both completed)
      expect(c.scoredMoves).toBeGreaterThan(0); // reached the exact endgame
      expect(c.skippedEarly).toBeGreaterThan(0); // early moves honestly skipped
      expect(c.optimal + c.preserving + c.blunders).toBe(c.scoredMoves);
      expect(c.blunders).toBe(0); // the class floor — perfect play never throws
    },
    90_000,
  );

  it("renderReport surfaces the graded-move denominator adjacent to blunders", () => {
    const report = {
      matchup: "Engine(Perfect) vs Engine(Perfect)",
      card: {
        games: 2,
        wins: 0,
        draws: 2,
        losses: 0,
        scoredMoves: 7,
        optimal: 5,
        preserving: 2,
        blunders: 0,
        skippedEarly: 41,
        moveMsTotal: 1234,
      },
    };
    const text = renderReport(report);
    // The Pass 3 honesty gate: "0 blunders" is never shown without its denominator.
    expect(text).toContain("Engine(Perfect) vs Engine(Perfect)");
    expect(text).toContain("7"); // scoredMoves (the denominator)
    expect(text).toContain("41"); // skippedEarly
    expect(text).toMatch(/blunder/i);
    expect(text).toMatch(/graded|scored/i);
  });
});
