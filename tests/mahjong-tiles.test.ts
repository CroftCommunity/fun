//! Unit tests for the Mahjong tile faces: every face id in `0..42` (mirroring
//! `crates/mahjong-core/src/tiles.rs`) yields a distinct, token-coloured SVG in
//! both styles, the large-print style carries no CJK glyph, and the id bands map
//! to the right family.

import { describe, expect, it } from "vitest";

import {
  FACE_COUNT,
  faceKind,
  faceLabel,
  faceSvg,
  isBonus,
  type TileStyle,
} from "../src/games/mahjong/tiles.js";

const STYLES: readonly TileStyle[] = ["classic", "large"];
const FACES = Array.from({ length: FACE_COUNT }, (_, i) => i);

// CJK Unified Ideographs plus CJK Symbols and Punctuation.
const CJK = /[\u4e00-\u9fff\u3000-\u303f]/u;
const HEX_COLOUR = /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/;

describe("faceSvg", () => {
  it("has 42 faces", () => {
    expect(FACE_COUNT).toBe(42);
  });

  for (const style of STYLES) {
    it(`renders a non-empty <svg> for every face in the ${style} style`, () => {
      for (const face of FACES) {
        const svg = faceSvg(face, style);
        expect(svg.startsWith("<svg"), `face ${face}`).toBe(true);
        expect(svg.endsWith("</svg>"), `face ${face}`).toBe(true);
        expect(svg, `face ${face}`).toContain('aria-hidden="true"');
        expect(svg, `face ${face}`).toContain('viewBox="0 0 60 80"');
      }
    });

    it(`renders 42 distinct faces in the ${style} style`, () => {
      const all = new Set(FACES.map((f) => faceSvg(f, style)));
      expect(all.size).toBe(FACE_COUNT);
    });

    it(`uses colour tokens only, never hex literals, in the ${style} style`, () => {
      for (const face of FACES) {
        expect(faceSvg(face, style), `face ${face}`).not.toMatch(HEX_COLOUR);
      }
    });
  }

  it("the large-print style contains no CJK glyph", () => {
    for (const face of FACES) {
      expect(faceSvg(face, "large"), `face ${face}`).not.toMatch(CJK);
    }
  });

  it("the classic style draws the Chinese numerals on the characters suit", () => {
    expect(faceSvg(18, "classic")).toContain("一");
    expect(faceSvg(26, "classic")).toContain("九");
    expect(faceSvg(26, "classic")).toContain("萬");
  });

  it("throws on a face outside 0..42", () => {
    expect(() => faceSvg(-1, "classic")).toThrow();
    expect(() => faceSvg(42, "classic")).toThrow();
    expect(() => faceSvg(1.5, "classic")).toThrow();
  });
});

describe("faceLabel", () => {
  it("names every face distinctly", () => {
    const labels = FACES.map(faceLabel);
    expect(new Set(labels).size).toBe(FACE_COUNT);
    for (const l of labels) expect(l.length).toBeGreaterThan(0);
  });

  it("uses the traditional spoken names", () => {
    expect(faceLabel(0)).toBe("Dots 1");
    expect(faceLabel(4)).toBe("Dots 5");
    expect(faceLabel(9)).toBe("Bamboo 1");
    expect(faceLabel(26)).toBe("Characters 9");
    expect(faceLabel(27)).toBe("East wind");
    expect(faceLabel(30)).toBe("North wind");
    expect(faceLabel(31)).toBe("Red dragon");
    expect(faceLabel(33)).toBe("White dragon");
    expect(faceLabel(34)).toBe("Plum flower");
    expect(faceLabel(37)).toBe("Bamboo flower");
    expect(faceLabel(38)).toBe("Spring season");
    expect(faceLabel(41)).toBe("Winter season");
  });
});

describe("faceKind / isBonus", () => {
  it("maps the id bands to their family", () => {
    const expected = (f: number) =>
      f <= 8
        ? "dots"
        : f <= 17
          ? "bamboo"
          : f <= 26
            ? "characters"
            : f <= 30
              ? "wind"
              : f <= 33
                ? "dragon"
                : f <= 37
                  ? "flower"
                  : "season";
    for (const face of FACES) {
      expect(faceKind(face), `face ${face}`).toBe(expected(face));
    }
  });

  it("only flowers and seasons are bonus tiles", () => {
    for (const face of FACES) {
      expect(isBonus(face), `face ${face}`).toBe(face >= 34);
    }
  });
});
