//! The game catalog the drawer lists. Every entry with a `load` is playable;
//! `soon` entries have no module yet.
//!
//! Two halves. `SHIPPED` is the site: `build.mjs` reads THAT array as text
//! (`tools/registry-titles.mjs`) for the page list and each page's title, so the
//! parser's anchor is its name. `DEV_ONLY` holds the placeholder — the frame's own
//! exercise, which the unit and e2e suites mount through the real chrome — and it
//! rides along only when `FUN_DEV_GAMES=1` (vitest.config.ts, playwright.config.ts).
//! The deploy build never sets it, so `/placeholder/` is not a page and not a
//! drawer item on fun.croft.ing.

import type { GameEntry } from "./contract.js";
import { placeholderModule } from "./games/placeholder.js";
import { solitaireModule, solitaireSetup } from "./games/solitaire.js";
import { trioTumbleModule, trioTumbleSetup } from "./games/trio-tumble.js";
import { bubbleModule, bubbleSetup } from "./games/bubble/bubble.js";
import { wyrdleModule, wyrdleSetup } from "./games/wyrdle/wyrdle.js";
import { twenty48Module, twenty48Setup } from "./games/2048/2048.js";
import { drop4Module, drop4Setup } from "./games/drop4/drop4.js";
import { othelloModule, othelloSetup } from "./games/othello/othello.js";
import { checkersModule, checkersSetup } from "./games/checkers/checkers.js";
import { dotsModule, dotsSetup } from "./games/dots/dots.js";
import { furrowModule, furrowSetup } from "./games/furrow/furrow.js";
import { alignModule, alignSetup } from "./games/align/align.js";
import { blockdokuModule, blockdokuSetup } from "./games/blockdoku/blockdoku.js";
import { looseendsModule, looseendsSetup } from "./games/looseends/looseends.js";
import { mahjongModule, mahjongSetup } from "./games/mahjong/mahjong.js";
import { colorSortChip, colorSortModule, colorSortSetup } from "./games/color-sort/color-sort.js";
import { orchardDropModule, orchardSetup } from "./games/orchard-drop/orchard-drop.js";
import { cribbageModule, cribbageSetup } from "./games/cribbage/cribbage.js";
import { chessModule, chessSetup } from "./games/chess/chess.js";

/** What fun.croft.ing ships, in drawer order. */
export const SHIPPED: readonly GameEntry[] = [
  {
    id: "solitaire",
    title: "Solitaire",
    emoji: "♠",
    status: "playable",
    icon: true,
    pitch: "Klondike, draw one. Today’s deal is winnable, and everyone gets the same one.",
    setup: solitaireSetup,
    load: solitaireModule,
  },
  {
    id: "trio-tumble",
    title: "Trio Tumble",
    subtitle: "Jewel Drop",
    emoji: "💎",
    status: "playable",
    icon: true,
    pitch: "Swipe a gem toward its neighbour to line up three. A campaign of curated levels, or six objectives on today’s board.",
    setup: trioTumbleSetup,
    load: trioTumbleModule,
  },
  {
    id: "bubble",
    title: "Bubble",
    emoji: "🫧",
    status: "playable",
    icon: true,
    pitch: "Aim, fire, match three. Levels push the stack down; Classic clears a fixed board within a budget.",
    setup: bubbleSetup,
    load: bubbleModule,
  },
  {
    id: "wyrdle",
    title: "Wyrdle",
    emoji: "🐉",
    status: "playable",
    icon: true,
    pitch: "Find the hidden five-letter word in six guesses. Today’s word is the same for everyone.",
    setup: wyrdleSetup,
    load: wyrdleModule,
  },
  {
    id: "2048",
    title: "2048",
    emoji: "🔢",
    status: "playable",
    icon: true,
    pitch: "Slide, merge, double. Reach the 2048 tile on today's board or a fresh one — every slide replays to a verifiable score.",
    setup: twenty48Setup,
    load: twenty48Module,
  },
  {
    id: "drop4",
    title: "Drop 4",
    emoji: "🔴",
    status: "playable",
    icon: true,
    group: "versus",
    pitch: "Drop a disc; line up four across, up or diagonally before the engine does — an engine that knows this game exactly.",
    setup: drop4Setup,
    load: drop4Module,
  },
  {
    id: "othello",
    title: "Othello",
    emoji: "⚫",
    status: "playable",
    icon: true,
    group: "versus",
    pitch: "Flank a line of discs to flip it. Most discs when neither side can move wins.",
    setup: othelloSetup,
    load: othelloModule,
  },
  {
    id: "checkers",
    title: "Checkers",
    emoji: "⛃",
    status: "playable",
    icon: true,
    group: "versus",
    pitch: "Tap a man, then where it goes. Capture is mandatory; reach the far row to be crowned.",
    setup: checkersSetup,
    load: checkersModule,
  },
  {
    id: "dots",
    title: "Dots and Boxes",
    emoji: "▦",
    status: "playable",
    icon: true,
    group: "versus",
    pitch: "Draw an edge; the fourth side of a box claims it — and you go again. Most boxes wins.",
    setup: dotsSetup,
    load: dotsModule,
  },
  {
    id: "furrow",
    title: "Furrow",
    emoji: "🌾",
    status: "playable",
    icon: true,
    group: "versus",
    pitch: "Sow a pit. Land your last seed in your store to go again; land in an empty pit of yours to capture. Most seeds wins.",
    setup: furrowSetup,
    load: furrowModule,
  },
  {
    id: "align",
    title: "Align",
    emoji: "🟪",
    status: "playable",
    icon: true,
    pitch: "Falling pieces, thumb-first. Marathon speeds up as you clear; Sprint races to forty lines — every run replays to a verifiable score.",
    setup: alignSetup,
    load: alignModule,
  },
  {
    id: "blockdoku",
    title: "Blockdoku",
    emoji: "🟦",
    status: "playable",
    icon: true,
    pitch: "Place the three pieces; fill a row, column or 3×3 box to clear it. It ends when nothing fits.",
    setup: blockdokuSetup,
    load: blockdokuModule,
  },
  {
    id: "looseends",
    title: "Loose Ends",
    emoji: "🎯",
    status: "playable",
    icon: true,
    pitch: "Untangle the arrows: tap a free one to slip it off the board. A hundred levels in bands, and a daily with a streak.",
    setup: looseendsSetup,
    load: looseendsModule,
  },
  {
    id: "mahjong",
    title: "Mahjong",
    emoji: "🀄",
    status: "playable",
    icon: true,
    pitch: "Tap a free tile, then its match, to lift the pair. Every deal can be cleared; levels climb from a 36-tile pond to the 144-tile turtle, and the daily turtle is the same for everyone.",
    setup: mahjongSetup,
    load: mahjongModule,
  },
  {
    id: "color-sort",
    title: "Color Sort",
    emoji: "🧪",
    status: "playable",
    icon: true,
    pitch: "Pour until every tube holds one colour. Tap a tube, tap where it goes — endless levels, and a daily with a par once you have five solves.",
    setup: colorSortSetup,
    chip: colorSortChip,
    load: colorSortModule,
  },
  {
    id: "orchard-drop",
    title: "Orchard Drop",
    emoji: "🍉",
    status: "playable",
    icon: true,
    // Tier-1 as of the rebuild: a deterministic fixed-point core, a verifiable
    // record, a re-checkable `?r=` share. No `tier` key — Tier-1 is the default
    // — and no `attribution`, which `Tier1GameEntry` does not have a field for.
    // The Suika-lineage credit lives in the how-to guide instead.
    pitch: "Drop fruit into the crate; two of a kind merge into the next one up. A daily crate to compare, or free play — every run replays to a verifiable score.",
    setup: orchardSetup,
    load: orchardDropModule,
  },
  {
    id: "cribbage",
    title: "Cribbage",
    emoji: "🎴",
    status: "playable",
    icon: true,
    group: "versus",
    pitch: "Throw two to the crib, play to 31, count your hand. The engine never sees your cards — a rig proves it.",
    setup: cribbageSetup,
    load: cribbageModule,
  },
  {
    id: "chess",
    title: "Chess",
    emoji: "♞",
    status: "playable",
    icon: true,
    group: "versus",
    pitch: "Tap a piece, then where it goes — only legal moves light up. Castle, take en passant, promote. The Engine plays back; every finished game is a record anyone can re-verify.",
    setup: chessSetup,
    load: chessModule,
  },
];

/** Dev fixtures: mounted by the test runs, never on the site. */
const DEV_ONLY: readonly GameEntry[] = [
  {
    id: "placeholder",
    title: "Placeholder",
    emoji: "🎲",
    status: "playable",
    icon: true,
    pitch: "Nothing to play; everything to prove.",
    load: placeholderModule,
  },
];

/** The catalog for a build: the shipped games, plus the dev fixtures after them when asked. */
export function catalog({ devGames }: { devGames: boolean }): readonly GameEntry[] {
  return devGames ? [...SHIPPED, ...DEV_ONLY] : SHIPPED;
}

// `process.env.FUN_DEV_GAMES` is substituted at bundle time (build.mjs `define`), so
// the browser never evaluates `process`; under vitest and playwright it is the real
// env. Written as a literal ternary so a production bundle folds the dev branch away
// and tree-shakes the placeholder module with it (tests/registry.test.ts pins this).
export const REGISTRY: readonly GameEntry[] = process.env.FUN_DEV_GAMES === "1" ? catalog({ devGames: true }) : SHIPPED;

/** Look up a catalog entry by id. */
export function findGame(id: string): GameEntry | undefined {
  return REGISTRY.find((g) => g.id === id);
}
