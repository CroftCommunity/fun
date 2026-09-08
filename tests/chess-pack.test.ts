//! Chess phase 10b (mock F, Q8): the piece pack is a preference. Two packs ship
//! first — Classic (the outlined glyphs the board always had) and Bold (the same
//! glyphs, heavier, flat, with a shadow). The resolver is pure so an unknown or
//! absent value lands on Classic and never on undefined.

import { describe, expect, it } from "vitest";

import { CHESS_PACKS, resolveChessPack } from "../src/settings.js";

describe("resolveChessPack", () => {
  it("lands on Classic when nothing is stored", () => {
    expect(resolveChessPack(null)).toBe("classic");
    expect(resolveChessPack("")).toBe("classic");
  });
  it("keeps a stored pack that exists", () => {
    expect(resolveChessPack("bold")).toBe("bold");
    expect(resolveChessPack("classic")).toBe("classic");
  });
  it("refuses a pack that does not ship (Emoji is later, not a value)", () => {
    expect(resolveChessPack("emoji")).toBe("classic");
    expect(resolveChessPack("BOLD")).toBe("classic");
  });
  it("the pack list is the two that ship, Classic first, each with a label", () => {
    expect(CHESS_PACKS.map((p) => p.value)).toEqual(["classic", "bold"]);
    for (const p of CHESS_PACKS) expect(p.label.length).toBeGreaterThan(0);
  });
});
