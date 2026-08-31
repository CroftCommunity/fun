//! Chess Phase 9 — the board's one geometry function. The core's squares never
//! move; `viewSquare` maps a view position to the board square shown there, so
//! a human playing Black sees their pieces at the bottom (a 180° turn) with no
//! second geometry anywhere else.

import { describe, expect, it } from "vitest";

import { squareName, viewSquare } from "../src/games/chess/chess.js";

describe("viewSquare (the board flip)", () => {
  it("unflipped is the identity", () => {
    expect(viewSquare(0, false)).toBe(0);
    expect(viewSquare(63, false)).toBe(63);
    for (let sq = 0; sq < 64; sq++) expect(viewSquare(sq, false)).toBe(sq);
  });
  it("flipped turns the board 180°: 0 ↔ 63 and 7 ↔ 56", () => {
    expect(viewSquare(0, true)).toBe(63);
    expect(viewSquare(63, true)).toBe(0);
    expect(viewSquare(7, true)).toBe(56);
    expect(viewSquare(56, true)).toBe(7);
  });
  it("flipping twice is the identity for every square", () => {
    for (let sq = 0; sq < 64; sq++) {
      expect(viewSquare(viewSquare(sq, true), true)).toBe(sq);
    }
  });
});

describe("squareName", () => {
  it("names the corners and the centre", () => {
    expect(squareName(0)).toBe("a1");
    expect(squareName(7)).toBe("h1");
    expect(squareName(56)).toBe("a8");
    expect(squareName(63)).toBe("h8");
    expect(squareName(28)).toBe("e4");
  });
});
