//! Shared game settings resolution (standard across games). The pure resolver:
//! an explicit stored on/off wins; anything else falls back to the default.

import { describe, expect, it } from "vitest";

import {
  moveSpeedToMs,
  resolveBool,
  resolveDisc,
  resolveLevel,
  resolveMark,
  resolveNumber,
  resolveOthelloLevel,
} from "../src/settings.js";

describe("resolveLevel (Drop 4 difficulty)", () => {
  it("honours a stored valid level", () => {
    expect(resolveLevel("Easy", "Medium")).toBe("Easy");
    expect(resolveLevel("Perfect", "Medium")).toBe("Perfect");
  });
  it("falls back to the default for null or a garbage value", () => {
    expect(resolveLevel(null, "Medium")).toBe("Medium");
    expect(resolveLevel("banana", "Hard")).toBe("Hard");
  });
});

describe("resolveMark (Drop 4 player disc)", () => {
  it("honours a stored valid mark", () => {
    expect(resolveMark("x", "x")).toBe("x");
    expect(resolveMark("o", "x")).toBe("o");
  });
  it("falls back to the default for null or a garbage value", () => {
    expect(resolveMark(null, "x")).toBe("x");
    expect(resolveMark("triangle", "x")).toBe("x");
  });
});

describe("resolveOthelloLevel (Othello difficulty)", () => {
  it("honours a stored valid level (note: Expert, not Perfect)", () => {
    expect(resolveOthelloLevel("Easy", "Medium")).toBe("Easy");
    expect(resolveOthelloLevel("Expert", "Medium")).toBe("Expert");
  });
  it("falls back to the default for null or a garbage value", () => {
    expect(resolveOthelloLevel(null, "Medium")).toBe("Medium");
    expect(resolveOthelloLevel("Perfect", "Hard")).toBe("Hard"); // Perfect is not an Othello level
  });
});

describe("resolveDisc (Othello player colour)", () => {
  it("honours a stored valid disc", () => {
    expect(resolveDisc("black", "black")).toBe("black");
    expect(resolveDisc("white", "black")).toBe("white");
  });
  it("falls back to the default for null or a garbage value", () => {
    expect(resolveDisc(null, "black")).toBe("black");
    expect(resolveDisc("green", "black")).toBe("black");
  });
});

describe("resolveBool", () => {
  it("honours an explicit stored on/off", () => {
    expect(resolveBool("on", false)).toBe(true);
    expect(resolveBool("off", true)).toBe(false);
  });

  it("falls back to the default for null or a garbage value", () => {
    expect(resolveBool(null, true)).toBe(true);
    expect(resolveBool(null, false)).toBe(false);
    expect(resolveBool("yes", true)).toBe(true);
    expect(resolveBool("", false)).toBe(false);
  });

  // The aim-guide setting (bubble) is `read(KEY, true)` over this resolver — its
  // on-by-default + persistence is covered end-to-end by the bubble e2e (the
  // vitest env's localStorage shim is non-standard, so storage-backed accessors
  // are tested in a real browser, not here).
  it("defaults an aim-guide-style setting to on when unset", () => {
    expect(resolveBool(null, true)).toBe(true);
  });
});

describe("resolveNumber", () => {
  const opts = { min: 1, max: 5, fallback: 1 };

  it("parses a stored numeric string and clamps it into range", () => {
    expect(resolveNumber("3", opts)).toBe(3);
    expect(resolveNumber("9", opts)).toBe(5); // above max clamps down
    expect(resolveNumber("0", opts)).toBe(1); // below min clamps up
  });

  it("falls back for null or a non-numeric value", () => {
    expect(resolveNumber(null, opts)).toBe(1);
    expect(resolveNumber("", opts)).toBe(1);
    expect(resolveNumber("abc", opts)).toBe(1);
    expect(resolveNumber("NaN", opts)).toBe(1);
  });

  it("rounds to a whole number by default and honours a fractional fallback", () => {
    expect(resolveNumber("2.7", opts)).toBe(3);
    expect(resolveNumber(null, { min: 0, max: 400, fallback: 150 })).toBe(150);
  });
});

describe("moveSpeedToMs (Align left/right sensitivity)", () => {
  it("maps the slowest speed to the longest hold-repeat and the fastest to the shortest", () => {
    expect(moveSpeedToMs(1)).toBe(250); // slow
    expect(moveSpeedToMs(10)).toBe(50); // fast
    expect(moveSpeedToMs(5)).toBe(161); // the default sits in the calm middle
  });

  it("is monotonic — higher speed is never a longer interval", () => {
    for (let s = 2; s <= 10; s++) expect(moveSpeedToMs(s)).toBeLessThan(moveSpeedToMs(s - 1));
  });

  it("clamps and rounds out-of-range or fractional speeds", () => {
    expect(moveSpeedToMs(0)).toBe(moveSpeedToMs(1));
    expect(moveSpeedToMs(99)).toBe(moveSpeedToMs(10));
    expect(moveSpeedToMs(5.4)).toBe(moveSpeedToMs(5));
  });
});
