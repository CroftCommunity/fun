//! Chess phase 10b (mock F, Q8): the piece pack is a preference. Classic (the
//! outlined glyphs the board always had) and Bold (the same glyphs, heavier,
//! flat, with a shadow) shipped 2026-09-08; Emoji — a court of emoji on a token
//! coloured by side — was "later" and ships the same way. The resolver is pure
//! so an unknown or absent value lands on Classic and never on undefined; the
//! glyph table is data, so it is tested as data.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { CHESS_PACKS, resolveChessPack, type ChessPack } from "../src/settings.js";
import { IMAGE_PACKS, PACK_GLYPHS, packSheet, pieceGlyph } from "../src/games/chess/chess-pieces.js";

const GLYPH_PACKS: readonly ChessPack[] = ["classic", "bold", "emoji"];
/** The six sets cut from painted boards (2026-09-10), in the order Settings lists them. */
const SHEET_PACKS: readonly ChessPack[] = ["garden", "arcade", "ancients", "frontier", "tides", "diner"];

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
  it("keeps every painted set, by the name Settings stores", () => {
    for (const p of SHEET_PACKS) expect(resolveChessPack(p)).toBe(p);
    expect(resolveChessPack("Garden")).toBe("classic");
  });
  it("the pack list is the nine that ship, Classic first, each with a label and a hint", () => {
    expect(CHESS_PACKS.map((p) => p.value)).toEqual([...GLYPH_PACKS, ...SHEET_PACKS]);
    for (const p of CHESS_PACKS) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.hint.length).toBeGreaterThan(0);
    }
    expect(new Set(CHESS_PACKS.map((p) => p.label)).size).toBe(CHESS_PACKS.length);
  });
});

/** Width and height from a PNG's IHDR — the first chunk, at a fixed offset. */
function pngSize(path: string): { width: number; height: number } {
  const buf = readFileSync(path);
  expect(buf.subarray(1, 4).toString("ascii"), `${path} is a PNG`).toBe("PNG");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe("the painted sets are sprite sheets, and the sheets exist", () => {
  const packsDir = join(process.cwd(), "src", "games", "chess", "assets", "packs");
  const boardsDir = join(process.cwd(), "tools", "chess-packs", "boards");

  it("the image packs are exactly the painted sets, and a glyph pack has no sheet", () => {
    expect([...IMAGE_PACKS]).toEqual(SHEET_PACKS);
    for (const p of GLYPH_PACKS) expect(packSheet(p)).toBeNull();
  });

  it("a sheet is served from the game's own assets, six kinds wide and two sides tall", () => {
    for (const p of SHEET_PACKS) {
      expect(packSheet(p)).toBe(`/chess/assets/packs/${p}.png`);
      const file = join(packsDir, `${p}.png`);
      expect(existsSync(file), `${p} has no sheet at ${file}`).toBe(true);
      const { width, height } = pngSize(file);
      // Six square cells across, two down: the CSS places a piece by kind and side in fifths and halves.
      expect(width, `${p}: ${width}×${height}`).toBe(3 * height);
      expect(width % 6).toBe(0);
    }
  });

  it("every sheet on disk is a pack, and every pack's board is kept so the cut can be redone", () => {
    const onDisk = readdirSync(packsDir).filter((f) => f.endsWith(".png")).map((f) => f.replace(/\.png$/, ""));
    expect([...onDisk].sort()).toEqual([...SHEET_PACKS].sort());
    for (const p of SHEET_PACKS) expect(existsSync(join(boardsDir, `${p}.jpg`)), `${p} has no source board`).toBe(true);
  });

  it("an image pack draws no glyph — the sheet is the piece", () => {
    for (const p of SHEET_PACKS) for (const k of [1, 2, 3, 4, 5, 6]) expect(pieceGlyph(p, k)).toBe("");
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
