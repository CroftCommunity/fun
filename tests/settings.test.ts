//! Shared game settings resolution (standard across games). The pure resolver:
//! an explicit stored on/off wins; anything else falls back to the default.

import { describe, expect, it } from "vitest";

import { resolveBool } from "../src/settings.js";

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
