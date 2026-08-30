//! Furrow's "How to play" guide (pure data — see src/how-to.ts). Leads with the
//! interaction ("tap a pit"), then the sow, then the two rules that give the game
//! its shape — **landing in your store means you go again**, and **landing in an
//! empty pit of yours captures** — then the sweep, which is the only rule on this
//! shelf that rewrites the score after play has finished.

import type { Guide } from "../../how-to.js";

export const FURROW_GUIDE: Guide = {
  title: "How to play Furrow",
  lede: "Mancala, on the board most people mean by it: six pits a side, four seeds in each, and a store at each end. You take turns lifting every seed out of one of your pits and dropping them one at a time around the board. Land your last seed in your own store and you go again. Land it in an empty pit on your side and you take that seed and everything facing it. When one side runs out, the other sweeps up what is left, and the bigger store wins. Every finished game is a record anyone can re-verify.",
  entries: [
    {
      testid: "howto-goal",
      title: "The goal",
      toc: "The goal",
      blocks: [
        {
          kind: "prose",
          text: "Forty-eight seeds are on the board and both stores start empty. The whole game is about getting more than half of them — twenty-five — into your store. Twenty-four each is a real draw, unlike some games on this shelf where the numbers cannot split.",
        },
        {
          kind: "prose",
          text: "Your six pits are the bottom row, marked ▲; The Engine's are the top row, marked ●. Your store is the tall well at the right-hand end, its store at the left. The number in each pit is how many seeds are in it — that number is the only thing a pit tells you, so it is never dimmed.",
        },
        {
          kind: "prose",
          text: 'The New game card — on the start screen, or from the button under the board — sets "Difficulty", how hard The Engine tries, from Easy up to Expert. It stops at Expert rather than Perfect on purpose: this board is too big to solve from the opening, so even the top level is searching rather than proving. It is remembered for next time.',
        },
        {
          kind: "shot",
          name: "furrow-board",
          alt: "A Furrow game inside the game frame: two seats above the board showing both players' banked seeds, and a carved wooden board with two rows of six pits between two tall stores. The player's pits carry a teal ring showing which can be sown.",
          caption: "The two seats and the board — a teal ring marks each pit you can sow right now.",
        },
      ],
    },
    {
      testid: "howto-play",
      title: "Playing a move: tap a pit",
      toc: "Playing",
      blocks: [
        {
          kind: "prose",
          text: "One tap is one move. Tap any of your pits that has seeds in it, and every seed comes out and goes back one at a time, moving to your right along your row, through your store, and on around the opponent's row.",
        },
        {
          kind: "steps",
          items: [
            "Tap one of your pits — the ones with a teal ring are the ones you can sow.",
            "The seeds land one at a time, and you can watch each one drop.",
            "Your own store gets a seed on the way past. The opponent's store is skipped — you never add to it.",
            "Where the last seed lands decides what happens next.",
          ],
        },
        {
          kind: "prose",
          text: "An empty pit is not a move. You can tap it, and nothing will happen — the rules live in the game's core, not in the buttons, so the board simply declines rather than the tap being blocked. A pit with a dashed rim is one that is empty.",
        },
      ],
    },
    {
      testid: "howto-again",
      title: "Landing in your store: go again",
      toc: "Going again",
      blocks: [
        {
          kind: "prose",
          text: "If your last seed drops into your own store, your turn does not end. You move again. This is the rule that makes mancala more than counting, and it is why the pit four places from your store is the famous opening: it holds four seeds, so the fourth lands in the store and you get a free second move.",
        },
        {
          kind: "prose",
          text: "Chains happen. Two or three moves in a row is common, and five in a row is possible. The line under the board always says whose turn it is and why — if it did not, a board that failed to change hands would look like a bug.",
        },
        {
          kind: "shot",
          name: "furrow-again",
          alt: "A Furrow board just after the player sowed the pit four places from their store: the store shows one seed and the line under the board reads that the seed landed in the store, so the player goes again.",
          caption: "The last seed reached the store, so the turn stays put — and the board says so.",
        },
      ],
    },
    {
      testid: "howto-capture",
      title: "Landing in an empty pit of yours: capture",
      toc: "Capturing",
      blocks: [
        {
          kind: "prose",
          text: "If your last seed lands in a pit on your own side that was empty, and the pit directly facing it across the board has seeds in it, you take both piles — the seed you just dropped and everything facing it — straight into your store.",
        },
        {
          kind: "steps",
          items: [
            "The landing pit must be yours, and must have been empty before that seed arrived.",
            "The pit facing it must not be empty. If it is, nothing is captured and the seed just stays where it fell.",
            "Both piles go to your store, and your turn ends.",
          ],
        },
        {
          kind: "prose",
          text: "That second condition is worth remembering, because it makes an empty pit on your own row a trap you can set. Leave one empty, wait for the opponent to fill the pit facing it, then land a single seed in yours.",
        },
      ],
    },
    {
      testid: "howto-sweep",
      title: "The end: one side empties, the other sweeps",
      toc: "The sweep",
      blocks: [
        {
          kind: "prose",
          text: "The game ends the moment either side has no seeds left to sow. Everything still sitting on the other side's row goes straight into that side's store.",
        },
        {
          kind: "prose",
          text: "This is worth knowing before it happens to you, because the final score is not what accumulated during play — a sweep can move a dozen seeds at once. The board says so when it fires. Running yourself out of seeds while the opponent's row is full is a way to lose a game you were winning.",
        },
      ],
    },
    {
      testid: "howto-help",
      title: "Hints and the tutor",
      toc: "Hints",
      blocks: [
        {
          kind: "prose",
          text: 'The "Hint" button names a pit the engine likes and says why — and tells you plainly that taking it counts as assistance, which your finished record will say. Turn hints off in Settings and the button becomes "I\'m done", which ends the match and reports honestly how much was left rather than pretending it finished.',
        },
        {
          kind: "prose",
          text: 'Settings also has an optional tutor panel. "Explain my options" lists the moves worth considering with the engine\'s own reason for each — "lands in your store — you go again", "captures 5", "safe, but feeds them 3 seeds".',
        },
        {
          kind: "prose",
          text: "Read the heading above that list carefully, because it is the honest part. Late in a game it says “Solved from here”, and it means it: the engine has searched to the end and knows. Earlier it says “Reading ahead (not yet certain)”, and it means that too. This board is too big to solve from the opening, so for most of a game the engine is guessing well rather than knowing. It will never tell you a move threw the game unless it can prove it.",
        },
        {
          kind: "shot",
          name: "furrow-tutor",
          alt: "A Furrow game with the tutor panel open, listing several pits with the engine's reason for each — one landing in the store for another turn, others described by how many seeds they feed to the opponent — under a heading saying the engine is reading ahead and not yet certain.",
          caption: "The tutor lists your options with the engine's own reasoning — and says whether it knows or is still reading.",
        },
      ],
    },
    {
      testid: "howto-record",
      title: "Every game is a record",
      toc: "The record",
      blocks: [
        {
          kind: "prose",
          text: "When a game ends you get a result screen with a verification badge. The badge is not decoration: it means the whole game was replayed, move by move, through the same rules that played it, and the position it reached was hashed and compared. Nothing stored is trusted — not the score, not the hash.",
        },
        {
          kind: "prose",
          text: "The share link carries the whole game, not a claim about it. Whoever opens it re-runs the same check in their own browser. A record with a move that could not legally have been played will not verify, and one played with a hint says so.",
        },
        {
          kind: "shot",
          name: "furrow-result",
          alt: "A Furrow result screen: the final score, a green verified badge, the finished board with all forty-eight seeds in the two stores, and the record's seed, move count and hash.",
          caption: "The result screen — the badge means the game was replayed and re-hashed, not that a stored field was read.",
        },
      ],
    },
  ],
};
