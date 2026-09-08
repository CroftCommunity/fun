//! Bubble's pieces are fruit (owner, 2026-09-05 — mock F Q7, plan phase 10). Six
//! colour indices, six fruit: each carries its own colour AND its own shape, so
//! the pairing the shapes used to provide (a red circle, a blue triangle) is kept
//! by the fruit themselves — an apple and a lemon differ however you see colour.
//! The table is data, so it is tested as data: the count matches the palette's
//! six gems, nothing repeats, and every name is a plain lowercase word a screen
//! reader can say.

import { describe, expect, it } from "vitest";
import { BUBBLE_PIECES, pieceFor } from "../src/games/bubble/bubble-pieces.js";

describe("Bubble's pieces", () => {
  it("are the six fruit the owner chose, in the palette's colour order", () => {
    expect(BUBBLE_PIECES.map((p) => p.glyph)).toEqual(["🍎", "🫐", "🥝", "🍇", "🍊", "🍋"]);
    expect(BUBBLE_PIECES.map((p) => p.name)).toEqual(["apple", "blueberries", "kiwi", "grapes", "orange", "lemon"]);
  });

  it("never repeat a glyph or a name, and every name is one lowercase word", () => {
    expect(new Set(BUBBLE_PIECES.map((p) => p.glyph)).size).toBe(BUBBLE_PIECES.length);
    expect(new Set(BUBBLE_PIECES.map((p) => p.name)).size).toBe(BUBBLE_PIECES.length);
    for (const p of BUBBLE_PIECES) expect(p.name).toMatch(/^[a-z]+$/);
  });

  it("pieceFor clamps an unknown colour to a named fallback rather than throwing", () => {
    expect(pieceFor(0)).toEqual({ glyph: "🍎", name: "apple" });
    expect(pieceFor(5).name).toBe("lemon");
    expect(pieceFor(99)).toEqual({ glyph: "●", name: "bubble" });
    expect(pieceFor(-1)).toEqual({ glyph: "●", name: "bubble" });
  });
});
