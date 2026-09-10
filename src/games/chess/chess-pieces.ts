//! The piece glyph per pack (phase 10b, mock F Q8). Classic and Bold are the
//! filled chess symbols, coloured by CSS for both sides — Bold differs in weight
//! and shadow, not in glyph. Emoji is a court — 💂 pawn, 🐴 knight, 🧙 bishop,
//! 🏰 rook, 👸 queen, 🤴 king — and since an emoji brings its own colours and
//! cannot take the side's, the CSS stands each on a round token painted with the
//! side's ink. One code point each: a ZWJ sequence renders as tofu wherever the
//! font lacks it (CI's Linux fonts). The table is data, tested as data.

import type { ChessPack } from "../../settings.js";

/** Kinds 1..6 are pawn, knight, bishop, rook, queen, king; index 0 is the empty square. */
const CLASSIC = ["", "♟", "♞", "♝", "♜", "♛", "♚"] as const;
const EMOJI = ["", "💂", "🐴", "🧙", "🏰", "👸", "🤴"] as const;

const NONE: readonly string[] = [];

/** The painted sets, in the order Settings lists them — each has a sheet on disk. */
export const IMAGE_PACKS = ["garden", "arcade", "ancients", "frontier", "tides", "diner"] as const;

/** The glyph table per pack, indexed by kind. A painted pack has no glyphs. */
export const PACK_GLYPHS: Readonly<Record<ChessPack, readonly string[]>> = {
  classic: CLASSIC,
  bold: CLASSIC,
  emoji: EMOJI,
  garden: NONE,
  arcade: NONE,
  ancients: NONE,
  frontier: NONE,
  tides: NONE,
  diner: NONE,
};

/** The sprite sheet a painted pack draws from, served beside the game's art; null for a glyph pack. */
export function packSheet(pack: ChessPack): string | null {
  return (IMAGE_PACKS as readonly string[]).includes(pack) ? `/chess/assets/packs/${pack}.png` : null;
}

/** The glyph a pack draws for a kind — the empty string for an empty square or an unknown kind. */
export function pieceGlyph(pack: ChessPack, kind: number): string {
  return PACK_GLYPHS[pack][kind] ?? "";
}
