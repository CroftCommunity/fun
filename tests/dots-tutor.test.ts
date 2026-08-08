//! Phase 8 — the coach's honesty invariant, pinned as pure units so it is
//! deterministic. The sentence itself comes from Rust (`coach_line`, bound to
//! `exact` there), so what these tests hold is the TypeScript half: that the UI
//! never adds certainty the engine did not claim, that it stays quiet when there
//! is nothing honest to say, and that a hint names a findable edge and says out
//! loud that it counts as assistance.

import { describe, expect, it } from "vitest";

import { coachFor, hintLine } from "../src/games/dots/dots.js";
import type { EdgeVerdict, TutorReport } from "../src/games/dots/dots-wasm.js";

function verdict(over: Partial<EdgeVerdict>): EdgeVerdict {
  return {
    quality: "optimal",
    exact: false,
    immediateWin: false,
    blocksOpponentWin: false,
    line: "That is the best edge available.",
    idea: "safe: leaves no box on three sides",
    ...over,
  };
}

describe("coachFor (what the coach is allowed to say)", () => {
  it("says nothing about a move that was the best available", () => {
    expect(coachFor(verdict({}), 5, 3, 3)).toBeNull();
  });

  it("says nothing when there is no verdict to report", () => {
    expect(coachFor(null, 5, 3, 3)).toBeNull();
  });

  it("carries the engine's own sentence rather than rewording it", () => {
    const proven = coachFor(
      verdict({ quality: "blunder", exact: true, line: "That threw the game." }),
      13,
      3,
      3,
    );
    expect(proven).toContain("That threw the game.");
  });

  it("never claims a proof the engine did not have", () => {
    const hedged = coachFor(
      verdict({ quality: "blunder", exact: false, line: "That looks risky." }),
      13,
      3,
      3,
    );
    expect(hedged).toContain("That looks risky.");
    expect(hedged).not.toContain("threw");
    // The pointer hedges too: a heuristic cannot know the other edge held it.
    expect(hedged).toMatch(/may be stronger/i);
    expect(hedged).not.toMatch(/held it/i);
  });

  it("locates the better edge on the board, not by its wire number", () => {
    const said = coachFor(
      verdict({ quality: "blunder", exact: true, line: "That threw the game." }),
      13,
      3,
      3,
    );
    // Edge 13 is V(0,1): the player can find it; "edge 13" would mean nothing.
    expect(said).toContain("vertical edge, row 1, column 2");
  });

  it("still speaks when no better edge is known, without inventing one", () => {
    const said = coachFor(
      verdict({ quality: "blunder", exact: true, line: "That threw the game." }),
      null,
      3,
      3,
    );
    expect(said).toBe("That threw the game.");
  });
});

describe("hintLine (a hint explains itself, and declares its cost)", () => {
  const report = (over: Partial<TutorReport>): TutorReport => ({
    moves: [
      {
        col: 13,
        value: 2,
        bestValue: 2,
        regret: 0,
        quality: "optimal",
        immediateWin: false,
        blocksOpponentWin: false,
        idea: "closes a box, and you move again",
      },
    ],
    bestCol: 13,
    exact: true,
    ...over,
  });

  it("names the edge, gives the engine's reason, and declares the cost", () => {
    const said = hintLine(report({}), 3, 3);
    expect(said).toContain("vertical edge, row 1, column 2");
    expect(said).toContain("closes a box, and you move again");
    expect(said).toMatch(/assistance/i);
  });

  it("returns null when the engine has nothing to point at", () => {
    expect(hintLine(report({ bestCol: null, moves: [] }), 3, 3)).toBeNull();
  });
});
