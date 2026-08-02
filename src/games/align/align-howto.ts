//! Align's "How to play" guide (pure data — see src/how-to.ts). Leads with the
//! interaction model — do I tap or use keys? — then the goal and the mechanics.

import type { Guide } from "../../how-to.js";

export const ALIGN_GUIDE: Guide = {
  title: "How to play Align",
  lede: "Pieces fall from the top; slide and rotate them to pack complete rows across the board. A full row clears. Clear four rows at once for an Align. Play with the keyboard or the on-screen buttons — and every finished run is a record anyone can re-verify.",
  entries: [
    {
      testid: "howto-controls",
      title: "Moving pieces: keys or buttons",
      toc: "Controls",
      blocks: [
        {
          kind: "prose",
          text: "You steer the falling piece — the same actions whether you use a keyboard or the on-screen pad beneath the board.",
        },
        {
          kind: "steps",
          items: [
            "Left / Right arrow — move the piece sideways.",
            "Up (or X) — rotate clockwise; Z — rotate counter-clockwise.",
            "Down — soft drop (fall faster); Space — hard drop (slam it down and lock).",
            "C or Shift — hold a piece for later; P or Esc — pause.",
            "On a phone, use the pad under the board: a wide left and right to move, the two arrows below them to rotate each way, then soft-drop, hard-drop, and hold.",
          ],
        },
        {
          kind: "shot",
          name: "align-board",
          alt: "A tall dark board with a stack of coloured blocks at the bottom, a falling piece with a translucent landing outline, a Hold box and score on the left, and the next five pieces on the right.",
          caption: "The board with its hold box, score, and next-five queue. The outline shows where the piece will land.",
        },
      ],
    },
    {
      testid: "howto-goal",
      title: "The goal: complete rows",
      toc: "The goal",
      blocks: [
        {
          kind: "prose",
          text: "Fill an entire row across all ten columns and it clears, and everything above drops down. Clearing more rows at once is worth much more: a single is fine, but four rows cleared together is an Align — the big score. A rotating piece that a wall or the stack blocks will nudge sideways to fit if it can (a wall kick), so tuck pieces into tight gaps.",
        },
        {
          kind: "note",
          text: "The next five pieces are always shown, and Hold lets you set one piece aside and swap it back in when it fits better. A move the rules don't allow — sliding into a wall, an impossible rotation — simply does nothing.",
        },
      ],
    },
    {
      testid: "howto-scoring",
      title: "Scoring, combos, and spins",
      toc: "Scoring",
      blocks: [
        {
          kind: "prose",
          text: "Clears score more as they get harder — and stringing them together pays off. Clearing rows on back-to-back placements builds a combo, and consecutive hard clears (an Align, or a row cleared by spinning a T-piece into a gap) earn a back-to-back bonus. Marathon speeds up as you clear lines; Sprint asks you to clear forty rows as fast as you can.",
        },
      ],
    },
    {
      testid: "howto-result",
      title: "Hints, settings, and the verifiable result",
      toc: "Hints & result",
      blocks: [
        {
          kind: "prose",
          text: "Hints are on by default and outline a strong spot for the current piece; using one counts as assistance, noted honestly on your result. Turn hints off and the button becomes \"End run\", which finishes whenever you like.",
        },
        {
          kind: "prose",
          text: "When a run ends you get a result you can re-verify: it replays your whole run — every move, tick by tick — against the game's core and re-derives your score, so nothing is taken on trust. Share it and the link checks itself before it shows.",
        },
        {
          kind: "shot",
          name: "align-result",
          alt: "A result panel with a green Verified check and a record listing the result, score, lines, pieces, seed, and final hash.",
          caption: "The verifiable result: re-checked by replaying the whole run, with a self-verifying share link.",
        },
      ],
    },
  ],
};
