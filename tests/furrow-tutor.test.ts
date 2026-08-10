//! The coach's wording, over the honesty flag.
//!
//! The sentence itself is the **engine's** — `coach_line` in `furrow-solver`,
//! bound to `exact` in Rust so a depth-capped verdict cannot be worded as a
//! proof. What is tested here is the only thing TypeScript adds: the pointer to a
//! better pit, and whether that pointer is hedged the same way the sentence is.
//!
//! This matters more for Furrow than for any shelf game so far. Phase 0 measured
//! roughly **70% of a game** sitting above the exact threshold, so the unproven
//! column is the common case, not a rare corner — where dots' tutor could prove
//! nearly everything and this one hedges until the endgame.

import { describe, expect, it } from "vitest";

import { coachFor, hintLine, ownerOfCell, pitLabel, turnLine } from "../src/games/furrow/furrow.js";
import type { BoardView, PitVerdict, TutorReport } from "../src/games/furrow/furrow-wasm.js";

const PITS = 6;

const verdict = (over: Partial<PitVerdict> = {}): PitVerdict => ({
  quality: "blunder",
  exact: true,
  immediateWin: false,
  blocksOpponentWin: false,
  line: "That threw the game.",
  idea: "leaves 5 seeds open to a capture",
  ...over,
});

const report = (over: Partial<TutorReport> = {}): TutorReport => ({
  moves: [
    {
      col: 2,
      value: 6,
      bestValue: 6,
      regret: 0,
      quality: "optimal",
      immediateWin: false,
      blocksOpponentWin: false,
      idea: "lands in your store — you go again",
    },
  ],
  bestCol: 2,
  exact: true,
  ...over,
});

describe("the coach's pointer is hedged exactly as the engine's sentence is", () => {
  it("says a better pit held it only when the search proved it", () => {
    const said = coachFor(verdict({ exact: true }), 2, PITS);
    expect(said).toBe("That threw the game. Your pit 3 held it.");
  });

  it("hedges the pointer when nothing was proven", () => {
    const said = coachFor(verdict({ exact: false, line: "That looks risky." }), 2, PITS);
    expect(said).toBe("That looks risky. Your pit 3 may be stronger.");
    expect(said).not.toContain("held it");
  });

  it("never claims a proof from an unproven verdict, whatever the quality", () => {
    // The property, not just the two rows above: nothing the capped path can
    // produce may be worded as a proof, and the capped path is ~70% of a game.
    for (const quality of ["resultPreserving", "blunder"] as const) {
      const said = coachFor(verdict({ quality, exact: false, line: "That looks risky." }), 4, PITS);
      expect(said).not.toContain("held it");
      expect(said).not.toContain("threw");
    }
  });

  it("says nothing at all about an optimal move", () => {
    expect(coachFor(verdict({ quality: "optimal" }), 2, PITS)).toBeNull();
  });

  it("falls back to the engine's bare sentence when there is no better pit to name", () => {
    expect(coachFor(verdict(), null, PITS)).toBe("That threw the game.");
  });

  it("says nothing when there is no verdict", () => {
    expect(coachFor(null, 2, PITS)).toBeNull();
  });
});

describe("a hint names a pit, explains it, and declares its cost", () => {
  it("carries the engine's own reason, not a generic one", () => {
    const said = hintLine(report(), PITS);
    expect(said).toBe(
      "Hint: your pit 3 — lands in your store — you go again. (A hint counts as assistance.)",
    );
  });

  it("always declares that it counts as assistance", () => {
    // A hint that did not say what it costs would quietly weaken the record.
    expect(hintLine(report({ exact: false }), PITS)).toContain("counts as assistance");
  });

  it("still names the pit when the engine offers no reason for it", () => {
    const said = hintLine(report({ bestCol: 5, moves: [] }), PITS);
    expect(said).toBe("Hint: your pit 6. (A hint counts as assistance.)");
  });

  it("says nothing at a terminal position", () => {
    expect(hintLine(report({ bestCol: null, moves: [] }), PITS)).toBeNull();
  });
});

describe("the board's own labels", () => {
  it("names a pit by whose row it is, not by its wire code", () => {
    // The record carries absolute cell indices, but "cell 9" means nothing to a
    // player.
    expect(pitLabel(0, PITS)).toBe("your pit 1");
    expect(pitLabel(5, PITS)).toBe("your pit 6");
    expect(pitLabel(7, PITS)).toBe("their pit 1");
    expect(pitLabel(12, PITS)).toBe("their pit 6");
  });

  it("knows which side owns a cell, and that a store belongs to neither row", () => {
    expect(ownerOfCell(0, PITS)).toBe(1);
    expect(ownerOfCell(5, PITS)).toBe(1);
    expect(ownerOfCell(PITS, PITS)).toBeNull();
    expect(ownerOfCell(7, PITS)).toBe(2);
    expect(ownerOfCell(2 * PITS + 1, PITS)).toBeNull();
  });
});

describe("the turn line says why the turn did not pass", () => {
  const board = (over: Partial<BoardView> = {}): BoardView =>
    ({ result: -1, keptTurn: false, ...over }) as BoardView;

  it("states the extra turn rather than leaving a player to infer it", () => {
    // The rule a player is most likely to read as a bug: the board did not
    // change hands, and nothing said why.
    expect(turnLine(board({ keptTurn: true }), true)).toContain("go again");
    expect(turnLine(board({ keptTurn: true }), false)).toContain("goes again");
  });

  it("is plain about an ordinary turn", () => {
    expect(turnLine(board(), true)).toBe("Your move.");
    expect(turnLine(board(), false)).toContain("thinking");
  });

  it("stops narrating turns once the game is over", () => {
    expect(turnLine(board({ result: 1, keptTurn: true }), true)).toBe("The game is over.");
  });
});
