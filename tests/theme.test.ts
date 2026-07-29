//! Pure theme-resolution logic (Phase E). An explicit stored choice wins; with
//! none, follow the OS. Two states only (light/dark) — the same rule the
//! pre-paint inline script and the header toggle share.

import { describe, expect, it } from "vitest";

import { resolveTheme } from "../src/theme.js";

describe("resolveTheme", () => {
  it("honours an explicit stored choice over the OS preference", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("follows the OS when there is no stored choice", () => {
    expect(resolveTheme(null, true)).toBe("dark");
    expect(resolveTheme(null, false)).toBe("light");
  });

  it("ignores a garbage stored value and falls back to the OS", () => {
    expect(resolveTheme("felt", true)).toBe("dark");
    expect(resolveTheme("", false)).toBe("light");
  });
});
