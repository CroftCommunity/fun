//! Shared game settings resolution (standard across games). The pure resolver:
//! an explicit stored on/off wins; anything else falls back to the default.

import { describe, expect, it } from "vitest";

import { resolveBool, resolveNumber } from "../src/settings.js";

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
