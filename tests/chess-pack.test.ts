//! Chess phase 10b (mock F, Q8): the piece pack is a preference. Classic (the
//! outlined glyphs the board always had) and Bold (the same glyphs, heavier,
//! flat, with a shadow) shipped 2026-09-08; Emoji — a court of emoji on a token
//! coloured by side — was "later" and ships the same way. The resolver is pure
//! so an unknown or absent value lands on Classic and never on undefined; the
//! glyph table is data, so it is tested as data.

import { describe, expect, it } from "vitest";

import { CHESS_PACKS, resolveChessPack } from "../src/settings.js";
import { PACK_GLYPHS, pieceGlyph } from "../src/games/chess/chess-pieces.js";

describe("resolveChessPack", () => {
  it("lands on Classic when nothing is stored", () => {
    expect(resolveChessPack(null)).toBe("classic");
    expect(resolveChessPack("")).toBe("classic");
  });
  it("keeps a stored pack that exists", () => {
    expect(resolveChessPack("bold")).toBe("bold");
    expect(resolveChessPack("classic")).toBe("classic");
  });
  it("keeps Emoji now that it ships, and still refuses a pack that does not", () => {
    expect(resolveChessPack("emoji")).toBe("emoji");
    expect(resolveChessPack("BOLD")).toBe("classic");
    expect(resolveChessPack("pixel")).toBe("classic");
  });
  it("the pack list is the three that ship, Classic first, each with a label and a hint", () => {
    expect(CHESS_PACKS.map((p) => p.value)).toEqual(["classic", "bold", "emoji"]);
    for (const p of CHESS_PACKS) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.hint.length).toBeGreaterThan(0);
    }
  });
});

describe("the piece glyphs per pack", () => {
  // Kinds 1..6: pawn, knight, bishop, rook, queen, king; 0 is an empty square.
  const KINDS = [1, 2, 3, 4, 5, 6] as const;

  it("Classic and Bold are the filled chess symbols, coloured by CSS for both sides", () => {
    expect(KINDS.map((k) => pieceGlyph("classic", k))).toEqual(["♟", "♞", "♝", "♜", "♛", "♚"]);
    expect(PACK_GLYPHS.bold).toEqual(PACK_GLYPHS.classic);
  });

  it("Emoji is a court — six distinct single-codepoint emoji, none of them a chess symbol", () => {
    const court = KINDS.map((k) => pieceGlyph("emoji", k));
    expect(court).toEqual(["💂", "🐴", "🧙", "🏰", "👸", "🤴"]);
    expect(new Set(court).size).toBe(6);
    for (const g of court) {
      // One code point each: a ZWJ sequence renders as tofu where the font lacks it (CI's Linux fonts).
      expect([...g].length, `${g} is one code point`).toBe(1);
      expect(g).not.toMatch(/[\u2654-\u265F]/);
    }
  });

  it("an empty square or an unknown kind is no glyph, whatever the pack", () => {
    expect(pieceGlyph("classic", 0)).toBe("");
    expect(pieceGlyph("emoji", 0)).toBe("");
    expect(pieceGlyph("emoji", 7)).toBe("");
    expect(pieceGlyph("bold", -1)).toBe("");
  });
});
