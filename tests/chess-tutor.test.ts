//! Chess Phase 10 — the tutor's honesty invariant and the ideas it names, both
//! pinned as deterministic units, plus the canned banter's fitness to speak.
//!
//! Chess is not solved, so the tutor may claim a move "threw the game" ONLY
//! when that move's facts are provably `exact` (its line reached a real
//! terminal). A horizon judgement can never claim a class drop and must hedge.
//! **All three** branches are asserted: threw / hedge / silent — a one-sided
//! test passes trivially against a tutor that hedges unconditionally.

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { acceptBanter } from "../src/harness/banter.js";
import { buildBand } from "../src/harness/hybrid-player.js";
import { coachFor, FALLBACK_LINE, ideaFor } from "../src/games/chess/chess.js";
import { Chess, type MoveAssessment } from "../src/games/chess/chess-wasm.js";

const MATE = 1_000_000;

function move(over: Partial<MoveAssessment>): MoveAssessment {
  return {
    col: 12 | (28 << 6), // e2e4
    san: "e4",
    value: 0,
    bestValue: 0,
    regret: 0,
    quality: "optimal",
    immediateWin: false,
    blocksOpponentWin: false,
    givesCheck: false,
    captures: 0,
    promotes: 0,
    castles: false,
    exact: false,
    ...over,
  };
}

describe("coachFor — honest certainty (proven vs horizon)", () => {
  it("only claims a move THREW the game when that move's value was proven", () => {
    const msg = coachFor(move({ quality: "blunder", value: -MATE, bestValue: 0 }), "Kb1", true);
    expect(msg).toMatch(/threw the game/i);
    expect(msg).toMatch(/Kb1/);
  });

  it("hedges for a clearly-weak horizon judgement — never claims certainty", () => {
    const msg = coachFor(move({ quality: "resultPreserving", regret: 450 }), "Nf3", false);
    expect(msg).toMatch(/looks risky/i);
    expect(msg).toMatch(/Nf3/);
    expect(msg).not.toMatch(/threw the game/i);
  });

  it("stays silent when there is nothing honest to flag", () => {
    expect(coachFor(move({ quality: "optimal", exact: true }), "Nf3", true)).toBeNull();
    expect(coachFor(move({ regret: 40 }), "Nf3", false)).toBeNull();
    expect(coachFor(null, "Nf3", true)).toBeNull();
    expect(coachFor(move({ quality: "blunder" }), null, true)).toBeNull();
    // An unproven blunder-shaped drop with small regret is silent too: no
    // proof, no throw; small regret, no hedge.
    expect(coachFor(move({ quality: "resultPreserving", regret: 120 }), "Nf3", false)).toBeNull();
  });
});

describe("ideaFor — one idea per fact, and 'mate in N' only when exact", () => {
  it("names the piece a capture takes", () => {
    expect(ideaFor(move({ captures: 2 }), 4)).toBe("takes the knight");
    expect(ideaFor(move({ captures: 5 }), 4)).toBe("takes the queen");
  });
  it("says check, promotes, castles", () => {
    expect(ideaFor(move({ givesCheck: true }), 4)).toBe("gives check");
    expect(ideaFor(move({ promotes: 4 }), 4)).toBe("promotes");
    expect(ideaFor(move({ castles: true }), 4)).toBe("castles");
  });
  it("counts a proven mate from the depth reached, and never when unproven", () => {
    // Root depth 4, mate at remaining depth 1: three plies → mate in 2.
    expect(ideaFor(move({ exact: true, value: MATE + 1 }), 4)).toBe("mate in 2");
    expect(ideaFor(move({ immediateWin: true, exact: true, value: MATE + 3 }), 4)).toBe("mate in 1");
    // The same huge value WITHOUT exact is a horizon judgement: no mate claim.
    expect(ideaFor(move({ value: MATE + 1, quality: "optimal" }), 4)).toBe("your strongest line");
  });
  it("falls back to the quiet labels", () => {
    expect(ideaFor(move({ quality: "optimal" }), 4)).toBe("your strongest line");
    expect(ideaFor(move({ quality: "resultPreserving" }), 4)).toBe("stays safe");
  });
});

describe("the canned banter survives the shared filter", () => {
  it("every line is fit to speak (no digits, no board nouns, not an essay)", () => {
    for (const [situation, line] of Object.entries(FALLBACK_LINE)) {
      expect(acceptBanter(line), `${situation}: "${line}"`).toBe(line);
    }
  });
});

const WASM = "target/wasm32-unknown-unknown/release/chess_wasm.wasm";

async function loadReal(): Promise<Chess> {
  const bytes = await readFile(WASM);
  const orig = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(bytes, { headers: { "content-type": "application/wasm" } })) as typeof fetch;
  try {
    return await Chess.load();
  } finally {
    globalThis.fetch = orig;
  }
}

describe("the tutor view over real chess facts", () => {
  it("is a structural superset of TutorFactMove, so buildBand reuses unchanged", async () => {
    const g = await loadReal();
    g.newGame(7n);
    const report = g.tutor();
    const facts = report.moves;
    expect(facts.every((m) => typeof m.immediateWin === "boolean" && m.blocksOpponentWin === false)).toBe(true);
    expect(report.depth).toBeGreaterThanOrEqual(1);
    const band = buildBand(facts.map((m) => ({ ...m, idea: ideaFor(m, report.depth) })));
    expect(band.length).toBeGreaterThan(0);
    expect(band.every((m) => facts.some((f) => f.col === m.col && f.quality !== "blunder"))).toBe(true);
    expect(g.play(band[0]!.col)).toBe("applied");
  }, 60_000);
});
