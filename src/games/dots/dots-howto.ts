//! Dots and Boxes' "How to play" guide (pure data — see src/how-to.ts). Leads
//! with the interaction ("tap an edge"), then the one rule that makes the game
//! its own thing — **closing a box gives you another move** — then the idea that
//! makes it deep, which is that most of the game is about who has to give first.

import type { Guide } from "../../how-to.js";

export const DOTS_GUIDE: Guide = {
  title: "How to play Dots and Boxes",
  lede: "The folk game, on a 4×4 grid of dots against The Engine, the shelf's computer opponent. You take turns drawing one line between two neighbouring dots. Draw the fourth side of a box and you claim it — and you go again. When every line is drawn, whoever holds more of the nine boxes wins. Nine cannot split evenly, so there is no such thing as a draw. Every finished game is a record anyone can re-verify.",
  entries: [
    {
      testid: "howto-goal",
      title: "The goal",
      toc: "The goal",
      blocks: [
        {
          kind: "prose",
          text: "The board is sixteen dots, which leaves twenty-four lines to draw and nine boxes to win. You and The Engine alternate, drawing one line each turn. There are exactly nine boxes and no way to split them evenly, so somebody always wins.",
        },
        {
          kind: "prose",
          text: 'The New game card — on the start screen, or from the button under the board — has two choices. "You play" chooses your seat — Second by default, and that default is not an accident: on this size of board the second player can always win with perfect play, so opening against a perfect opponent is a losing position before anyone has moved. "Difficulty" sets how hard The Engine tries, from Easy up to Perfect. Both are remembered for next time.',
        },
        {
          kind: "shot",
          name: "dots-board",
          alt: "A Dots and Boxes game inside the game frame: two seats above the board showing both players' box counts, and a paper-coloured 4×4 lattice of dots with faint tan lines marking the edges that can still be drawn.",
          caption: "The two seats and the lattice — faint tan lines mark every edge you can still draw.",
        },
      ],
    },
    {
      testid: "howto-play",
      title: "Playing a move: tap a line",
      toc: "Playing",
      blocks: [
        {
          kind: "prose",
          text: "One tap is one move. The gaps between neighbouring dots are the targets, and they are deliberately generous — you are aiming at a whole gap, not at a hairline.",
        },
        {
          kind: "steps",
          items: [
            "Tap any faint line between two dots. It is drawn in your colour and stays there.",
            "The Engine replies. Its line is ringed, so you can always see what it just did.",
            "Play continues until all twenty-four lines are drawn.",
          ],
        },
        {
          kind: "note",
          text: "The game's core decides what is legal, not the screen — a line that is already drawn is not a target, and no tap will make it one.",
        },
      ],
    },
    {
      testid: "howto-extra-turn",
      title: "Close a box and you go again",
      toc: "The extra turn",
      blocks: [
        {
          kind: "prose",
          text: "This is the rule that makes the game. Draw the **fourth** side of a box and that box is yours — it fills with your colour and your mark — and then **you move again**. Close two boxes with one line (the line they share) and you take both, and still move again. Your turn only passes when you draw a line that closes nothing.",
        },
        {
          kind: "prose",
          text: "The board says so out loud rather than leaving you wondering why the turn did not change: it will tell you that you closed a box and it is your turn again, and it says the same when The Engine does it.",
        },
        {
          kind: "shot",
          name: "dots-capture",
          alt: "A Dots and Boxes board with one box filled in and marked, several lines drawn in two colours, and a message below reading that closing a box means another turn.",
          caption: "A claimed box, its mark, and the message: closing a box keeps the turn.",
        },
      ],
    },
    {
      testid: "howto-chains",
      title: "The real game: who has to give first",
      toc: "Chains",
      blocks: [
        {
          kind: "prose",
          text: "Early on, nearly every line is safe. The game turns when the safe lines run out and somebody has to draw a line that leaves a box on three sides — because whoever moves next simply takes it. And having taken it, they move again, which often lets them take the next one, and the next: a whole chain falls in one turn.",
        },
        {
          kind: "prose",
          text: "So the skill is not really about taking boxes. It is about running out of safe moves **second**. Strong players count the safe lines left, and late in the game will sometimes decline the last two boxes of a chain on purpose — handing them over to force the opponent to open the next, bigger chain. If The Engine on Perfect does something that looks like a mistake, that is usually what you are watching.",
        },
        {
          kind: "note",
          text: 'Turn on Settings → Tutor and tap "Explain my options" to see the reasonable lines, each with the engine\'s own one-line reason — "safe: leaves no box on three sides", "hands over one box", or "closes a box, and you move again".',
        },
        {
          kind: "shot",
          name: "dots-tutor",
          alt: "A Dots and Boxes board with the tutor panel open below it, listing reasonable edges with reasons such as \"safe: leaves no box on three sides\" and \"hands over one box\".",
          caption: "The tutor lists the reasonable lines and why — the engine's own read, no download.",
        },
      ],
    },
    {
      testid: "howto-opponent",
      title: "The Engine, hints, and honesty",
      toc: "The opponent",
      blocks: [
        {
          kind: "prose",
          text: "This board is small enough to be solved outright, so the top difficulty really is called Perfect: from most positions the engine is not guessing, it knows. Easy and Medium play loosely on purpose, and Hard never throws a game it can prove but will not always win by as much as it could.",
        },
        {
          kind: "prose",
          text: 'The Hint button points at a line the engine likes and tells you why. A hint counts as assistance, and the button says so — the finished record carries that fact rather than quietly claiming an unassisted win. Turn hints off in Settings and the button becomes "I\'m done", which ends the game and reports how many lines were still undrawn.',
        },
        {
          kind: "prose",
          text: 'The tutor is careful about certainty. When it has actually proven how the game ends it will tell you a move threw it; when it is only reading ahead it softens to "looks risky" and says "not yet certain" above its list. It never dresses a guess up as a proof.',
        },
      ],
    },
    {
      testid: "howto-result",
      title: "The verifiable result",
      toc: "The result",
      blocks: [
        {
          kind: "prose",
          text: "When the last line is drawn you get a result you can re-verify. It shows the final board and replays every line — yours and The Engine's — against the game's core to re-derive the outcome, so nothing is taken on trust. Share it and the link checks itself before it shows.",
        },
        {
          kind: "shot",
          name: "dots-result",
          alt: "A result panel reading “Second player won 6–3 — verifiable” with a green Verified check, the final lattice with all nine boxes claimed in two colours and marks, and a record listing the result, edges drawn, seed, and final hash.",
          caption: "The verifiable result: the final board, re-checked by replay, with a self-verifying share link.",
        },
      ],
    },
  ],
};
