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
});
