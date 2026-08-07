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
import { MockRuntime } from "../src/harness/ai-runtime.js";
import { HybridPlayer } from "../src/harness/hybrid-player.js";
import { drop4Oracle } from "../src/games/drop4/drop4-oracle.js";
import type { GameOracle } from "../src/harness/game-oracle.js";
import { EnginePlayer, HybridAiPlayer, runMatch, type Player } from "../src/harness/match-runner.js";
import { renderReport, runTournament } from "../src/harness/tournament.js";

/** The first legal move the schema offers (a MockRuntime that always picks in-band). */
function firstEnumMove(schema: unknown): number {
  const s = schema as { properties?: { move?: { enum?: number[] } } };
  return s.properties?.move?.enum?.[0] ?? 0;
}

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

describe("tournament: full rig over the real wasm", () => {
  it(
    "engine-vs-engine aggregates a consistent Report with a zero-blunder class floor",
    async () => {
      const report = await runTournament(loadReal, new EnginePlayer(3), new EnginePlayer(3), {
        games: 2,
        baseSeed: 0n,
      });
      const c = report.card;

      expect(c.games).toBe(2);
      expect(c.wins + c.draws + c.losses).toBe(c.games); // consistent W/D/L
      // Asserted `draws === 2` until 2026-08-07. That was an observed property
      // of the old Drop 4 engine, not a designed one — "Perfect" is a
      // depth-capped heuristic rather than the exact solver, so two of them
      // drawing was a happenstance of the horizon they shared. P9 Phase 3's
      // budgeted deepening made the matchup decisive. The property this test
      // exists for is that every game *completes* and none is aborted, which
      // the line above and the one below pin without over-specifying the result.
      expect(c.games - report.abortedGames).toBe(c.games);
      expect(c.scoredMoves).toBeGreaterThan(0); // reached the exact endgame
      expect(c.skippedEarly).toBeGreaterThan(0); // early moves honestly skipped
      expect(c.optimal + c.preserving + c.blunders).toBe(c.scoredMoves);
      expect(c.blunders).toBe(0); // the class floor — perfect play never throws
    },
    90_000,
  );

  it("HybridAiPlayer plugs into the rig: an in-band pick is legal, garbage falls back to engine best", async () => {
    const game = await loadReal();
    game.newGame(0n);
    const bestCol = game.tutor().bestCol;

    // Mock that always picks the first (best) offered column -> an in-band pick.
    const inBand = new HybridAiPlayer(
      new HybridPlayer(new MockRuntime({ reply: (_p, o) => JSON.stringify({ move: firstEnumMove(o.schema), reason: "ok" }) })),
    );
    const legal = game.legalMoves();
    expect(legal).toContain(await inBand.chooseMove(game));

    // Mock that returns garbage -> HybridPlayer falls back to the engine's top-of-band.
    const garbage = new HybridAiPlayer(
      new HybridPlayer(new MockRuntime({ reply: () => "not json at all" })),
    );
    expect(await garbage.chooseMove(game)).toBe(bestCol);
  });

  it(
    "a MockRuntime HybridAiPlayer stays in-band in a full game: zero blunders over graded moves",
    async () => {
      const hybrid = new HybridAiPlayer(
        new HybridPlayer(new MockRuntime({ reply: (_p, o) => JSON.stringify({ move: firstEnumMove(o.schema), reason: "best" }) })),
      );
      const seenGames: number[] = [];
      const report = await runTournament(loadReal, hybrid, new EnginePlayer(3), {
        games: 2,
        baseSeed: 0n,
        onGame: (i) => seenGames.push(i), // the trial's per-game progress hook
      });
      const c = report.card;
      expect(seenGames).toEqual([0, 1]); // onGame fires once per game, in order
      expect(c.games).toBe(2);
      expect(c.scoredMoves).toBeGreaterThan(0); // reached the exact endgame
      expect(c.optimal + c.preserving + c.blunders).toBe(c.scoredMoves);
      expect(c.blunders).toBe(0); // the band is class-preserving — the hybrid never throws
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
        llmMoves: 0,
        fallbackMoves: 0,
      },
      abortedGames: 0,
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

// P8 Phase 2c — abort observability.
//
// `runMatch` collapsed two distinct failures into one boolean, and `Report`
// carried no abort count at all: a tournament where every match died on move one
// rendered a perfectly well-formed `W-D-L 0-0-0 / graded moves 0` report,
// indistinguishable from a legitimately short run. Tolerable while the rig graded
// one game whose only abort mode was a bug; not tolerable once Othello adds an
// expected-shaped abort (a forced pass) and checkers adds a third (a packed code
// that fails to round-trip). Same honesty argument that already put
// scoredMoves/skippedEarly next to blunders, one level up — at the games
// denominator.
describe("abort observability", () => {
  it("distinguishes a null move from a rejected move, and counts clean games as zero", async () => {
    const nullMover: Player = { label: "nullMover", chooseMove: async () => null };
    const rejected: Player = { label: "rejected", chooseMove: async () => 99 };

    const a = await runMatch(await loadReal(), nullMover, new EnginePlayer(0), 1n);
    expect(a.aborted).toBe(true);
    expect(a.abortReason).toBe("nullMove");

    const b = await runMatch(await loadReal(), rejected, new EnginePlayer(0), 1n);
    expect(b.aborted).toBe(true);
    expect(b.abortReason).toBe("rejectedMove");

    const clean = await runMatch(await loadReal(), new EnginePlayer(0), new EnginePlayer(0), 1n);
    expect(clean.aborted).toBeFalsy();
    expect(clean.abortReason).toBe("none");
  }, 60_000);

  it("reports abortedGames, and renders the count even when it is zero", async () => {
    const report = await runTournament(loadReal, new EnginePlayer(0), new EnginePlayer(0), {
      games: 2,
      baseSeed: 0n,
    });
    expect(report.abortedGames).toBe(0);
    // A line that only appears on failure is a line nobody trusts is there.
    expect(renderReport(report)).toMatch(/aborted/i);
  }, 120_000);

  it("counts a tournament of aborted games", async () => {
    const nullMover: Player = { label: "nullMover", chooseMove: async () => null };
    const report = await runTournament(loadReal, nullMover, nullMover, {
      games: 2,
      baseSeed: 0n,
    });
    expect(report.abortedGames).toBe(2);
  }, 60_000);
});

/**
 * P8 follow-up — **move provenance in the Report.**
 *
 * `HybridDecision.source` already says whether the LLM picked in-band or the
 * engine's top-of-band was used, and `HybridAiPlayer` was discarding it. So a
 * model that fell back on *every* move rendered a Report identical to one that
 * never fell back — the headline "the hybrid stays in-band, 0 blunders" was true
 * of both, and only one of them means anything. Checkers' fallback rate had to be
 * counted by hand off a WebGPU transcript for exactly this reason (P8 Phase 14).
 *
 * Both directions are asserted, because a counter wired to a constant would pass
 * a one-sided test.
 */
describe("the Report says where the hybrid's moves came from", () => {
  const hybridWith = (reply: (p: string, o: { schema?: object }) => string): HybridAiPlayer =>
    new HybridAiPlayer(new HybridPlayer(new MockRuntime({ reply })), { label: "Hybrid" });

  it(
    "counts every move as a fallback when the model never returns anything usable",
    async () => {
      const report = await runTournament(loadReal, hybridWith(() => "not json"), new EnginePlayer(3), {
        games: 2,
        baseSeed: 0n,
      });
      expect(report.card.fallbackMoves).toBeGreaterThan(0);
      expect(report.card.llmMoves).toBe(0);
      // The counts cover the side's whole game, not just its graded moves —
      // provenance is not gated on the oracle proving anything.
      expect(report.card.llmMoves + report.card.fallbackMoves).toBeGreaterThan(
        report.card.scoredMoves,
      );
      expect(renderReport(report)).toMatch(/fallback/i);
    },
    120_000,
  );

  it(
    "counts every move as the model's when it always picks in-band",
    async () => {
      const report = await runTournament(
        loadReal,
        hybridWith((_p, o) => JSON.stringify({ move: firstEnumMove(o.schema), reason: "ok" })),
        new EnginePlayer(3),
        { games: 2, baseSeed: 0n },
      );
      expect(report.card.llmMoves).toBeGreaterThan(0);
      expect(report.card.fallbackMoves).toBe(0);
    },
    120_000,
  );

  it(
    "attributes nothing to a plain engine matchup (no second path to report)",
    async () => {
      const report = await runTournament(loadReal, new EnginePlayer(3), new EnginePlayer(3), {
        games: 1,
        baseSeed: 0n,
      });
      expect(report.card.llmMoves).toBe(0);
      expect(report.card.fallbackMoves).toBe(0);
      expect(renderReport(report)).not.toMatch(/fallback/i);
    },
    120_000,
  );
});
