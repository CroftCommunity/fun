//! P8 Phase 14 — the checkers tutor's honesty invariant, and the hybrid
//! opponent's fallback, both pinned as deterministic units.
//!
//! Checkers is not solved from the opening, so the tutor may claim a move "threw
//! the game" ONLY when that move's facts are provably `exact` (its line reached a
//! real terminal). A horizon judgement can never claim a class drop and must
//! hedge. **Both** sides are asserted: a one-sided test passes trivially against a
//! tutor that hedges unconditionally, which would be a different bug in the same
//! place.
//!
//! The hybrid case asserts `HybridDecision.source`, not merely that the returned
//! move was legal — legality holds on both paths, so it proves nothing about
//! which one ran.

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { MockRuntime } from "../src/harness/ai-runtime.js";
import { buildBand, HybridPlayer } from "../src/harness/hybrid-player.js";
import { coachFor, ideaFor } from "../src/games/checkers/checkers.js";
import { Checkers, type MoveAssessment } from "../src/games/checkers/checkers-wasm.js";

function move(over: Partial<MoveAssessment>): MoveAssessment {
  return {
    col: 8 | (12 << 5), // 8 -> 12, a quiet opening advance
    value: 0,
    bestValue: 0,
    regret: 0,
    quality: "optimal",
    immediateWin: false,
    blocksOpponentWin: false,
    captures: 0,
    exact: false,
    ...over,
  };
}

const BEST = 9 | (13 << 5); // square 10 -> square 14

describe("coachFor — honest certainty (proven vs horizon)", () => {
  it("only claims a move THREW the game when that move's value was proven", () => {
    const msg = coachFor(move({ quality: "blunder", value: -900, bestValue: 900 }), BEST, true);
    expect(msg).toMatch(/threw the game/i);
    // Square 9 is (row 2, col 3) 0-based, square 13 is (row 3, col 2) — the label
    // names both ends, because a checkers move is a path, not a destination.
    expect(msg).toMatch(/row 3, column 4 to row 4, column 3/);
  });

  it("hedges for a clearly-weak horizon judgement — never claims certainty", () => {
    const msg = coachFor(move({ quality: "blunder", value: -40, bestValue: 30 }), BEST, false);
    expect(msg).toMatch(/looks risky/i);
    expect(msg).not.toMatch(/threw the game/i);
  });

  it("stays silent when there is nothing honest to flag", () => {
    expect(coachFor(move({ quality: "optimal", exact: true }), BEST, true)).toBeNull();
    expect(coachFor(move({ value: 3, bestValue: 10 }), BEST, false)).toBeNull();
    expect(coachFor(null, BEST, true)).toBeNull();
    expect(coachFor(move({ quality: "blunder" }), null, true)).toBeNull();
  });
});

describe("ideaFor — engine-grounded move idea (captures is checkers' one-ply fact)", () => {
  it("names the capture, the strongest line, or a safe move", () => {
    expect(ideaFor(move({ captures: 2 }))).toMatch(/takes 2/i);
    expect(ideaFor(move({ captures: 1 }))).toMatch(/takes a piece/i);
    expect(ideaFor(move({ quality: "optimal" }))).toBe("your strongest line");
    expect(ideaFor(move({ quality: "resultPreserving" }))).toBe("stays safe");
  });
});

const WASM = "target/wasm32-unknown-unknown/release/checkers_wasm.wasm";

async function loadReal(): Promise<Checkers> {
  const bytes = await readFile(WASM);
  const orig = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(bytes, { headers: { "content-type": "application/wasm" } })) as typeof fetch;
  try {
    return await Checkers.load();
  } finally {
    globalThis.fetch = orig;
  }
}

describe("the hybrid opponent over real checkers facts", () => {
  it("the wasm tutor view is a structural superset of TutorFactMove, so buildBand reuses unchanged", async () => {
    const g = await loadReal();
    g.newGame(7n);
    const facts = g.tutor().moves;
    // The two Drop-4 booleans must be carried (as false) or the band would be
    // reading undefined — this is the Phase 11 claim, checked where it bites.
    expect(facts.every((m) => m.immediateWin === false && m.blocksOpponentWin === false)).toBe(true);
    const band = buildBand(facts);
    expect(band.length).toBeGreaterThan(0);
    expect(band.every((m) => facts.some((f) => f.col === m.col && f.quality !== "blunder"))).toBe(
      true,
    );
    // Band moves are real, playable move codes — the packed path code round-trips.
    expect(g.play(band[0]!.col)).toBe("applied");
  }, 60_000);

  it("a garbage model reply falls back to the engine's top-of-band (source=fallback)", async () => {
    const g = await loadReal();
    g.newGame(7n);
    const band = buildBand(g.tutor().moves);
    const rt = new MockRuntime({ reply: () => "not json {{{" });
    const d = await new HybridPlayer(rt).pick(band, { prompt: "your move" });
    expect(d.source).toBe("fallback");
    expect(d.move).toBe(band[0]!.col); // highest value in the band
    expect(g.play(d.move)).toBe("applied");
  }, 60_000);

  it("a valid in-band reply is taken (source=llm)", async () => {
    const g = await loadReal();
    g.newGame(7n);
    const band = buildBand(g.tutor().moves);
    const pick = band[band.length - 1]!.col; // not the fallback, so the paths differ
    const rt = new MockRuntime({
      reply: () => JSON.stringify({ move: pick, reason: "sliding up the wing" }),
    });
    const d = await new HybridPlayer(rt).pick(band, { prompt: "your move" });
    expect(d).toMatchObject({ move: pick, source: "llm" });
    expect(g.play(d.move)).toBe("applied");
  }, 60_000);
});
