//! P7 Phase 6 — the tutor's honesty invariant (the Pass 3 gate), pinned as a
//! pure unit so it is deterministic. Othello is unsolved from the opening, so the
//! tutor may claim a move "threw the game" ONLY when the facts are provably
//! `exact` (the deep endgame); a heuristic verdict can never claim a class drop
//! and must hedge ("looks risky"). It also never coaches when there is nothing
//! honest to say.

import { describe, expect, it } from "vitest";

import { coachFor, ideaFor } from "../src/games/othello/othello.js";
import type { MoveAssessment } from "../src/games/othello/othello-wasm.js";

function move(over: Partial<MoveAssessment>): MoveAssessment {
  return {
    col: 19,
    value: 0,
    bestValue: 0,
    regret: 0,
    quality: "optimal",
    immediateWin: false,
    blocksOpponentWin: false,
    takesCorner: false,
    exact: false,
    ...over,
  };
}

describe("coachFor — honest certainty (exact vs heuristic)", () => {
  it("only claims a move THREW the game when the facts are exact", () => {
    const msg = coachFor(move({ quality: "blunder", value: -8, bestValue: 8 }), 26, true);
    expect(msg).toMatch(/threw the game/i);
    expect(msg).toMatch(/row 4, column 3/); // cell 26 = (3,2) 0-based -> 1-based
  });

  it("hedges to 'looks risky' for a clearly-weak heuristic move — never claims certainty", () => {
    const msg = coachFor(move({ quality: "resultPreserving", value: -5, bestValue: 12 }), 19, false);
    expect(msg).toMatch(/looks risky/i);
    expect(msg).not.toMatch(/threw the game/i);
  });

  it("stays silent when there is nothing honest to flag", () => {
    // Exact but not a blunder — no coaching.
    expect(coachFor(move({ quality: "optimal", exact: true }), 19, true)).toBeNull();
    // Heuristic and not clearly weak (value not negative-while-best-positive).
    expect(coachFor(move({ value: 3, bestValue: 10 }), 19, false)).toBeNull();
    // No verdict / no best cell.
    expect(coachFor(null, 19, true)).toBeNull();
    expect(coachFor(move({ quality: "blunder" }), null, true)).toBeNull();
  });
});

describe("ideaFor — engine-grounded move idea", () => {
  it("names the corner, the strongest line, or a safe move", () => {
    expect(ideaFor(move({ takesCorner: true }))).toBe("takes a corner");
    expect(ideaFor(move({ quality: "optimal" }))).toBe("your strongest line");
    expect(ideaFor(move({ quality: "resultPreserving" }))).toBe("stays safe");
  });
});
