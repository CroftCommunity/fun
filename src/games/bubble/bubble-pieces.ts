//! Bubble's pieces: six fruit, one per colour index of the core's board.
//!
//! The owner chose the fruit set (2026-09-05, mock F Q7). A fruit carries its own
//! colour and its own shape, so the colour-blind pairing the old glyphs gave
//! (a red circle, a blue triangle) survives in the piece itself: an apple and a
//! lemon differ however you see colour. The index order follows the palette's
//! `--gem-0` … `--gem-5` (red, blue, green, purple, amber, teal), so the CSS chips
//! and the canvas agree on which fruit is which.

/** A piece: what is drawn, and what a screen reader says. */
export interface Piece {
  readonly glyph: string;
  readonly name: string;
}

/** The set, in colour order. Data, tested as data (`tests/bubble-pieces.test.ts`). */
export const BUBBLE_PIECES: readonly Piece[] = [
  { glyph: "🍎", name: "apple" },
  { glyph: "🫐", name: "blueberries" },
  { glyph: "🥝", name: "kiwi" },
  { glyph: "🍇", name: "grapes" },
  { glyph: "🍊", name: "orange" },
  { glyph: "🍋", name: "lemon" },
];

/** A colour the table does not know is drawn as a plain bubble, never thrown on. */
const FALLBACK: Piece = { glyph: "●", name: "bubble" };

/** The piece for a colour index. Pure. */
export function pieceFor(color: number): Piece {
  return BUBBLE_PIECES[color] ?? FALLBACK;
}

/** The font stack that renders colour emoji on a canvas across platforms. */
export const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", system-ui, sans-serif';
