//! Cribbage's "How to play" guide (pure data — see src/how-to.ts). Leads with
//! the interaction (tap two cards, throw), then the cut, then pegging, then the
//! show and its order — the rule a new player most often gets wrong — then the
//! peg board, winning, and what a game is worth.

import type { Guide } from "../../how-to.js";

export const CRIBBAGE_GUIDE: Guide = {
  title: "How to play Cribbage",
  lede: "Two-hand cribbage to 121, against the shelf's engine. Each deal you get six cards and throw two to the crib, a third hand that belongs to whoever dealt. You peg cards against each other to 31, then count your hands — fifteens, pairs, runs, a flush, his nobs — in a fixed order. First to 121 wins. The app counts for you and shows its work, unless you switch counting on and do it yourself. Every finished game is a record anyone can re-verify.",
  entries: [
    {
      testid: "howto-goal",
      title: "The goal, and the table",
      toc: "The goal",
      blocks: [
        {
          kind: "prose",
          text: "First to 121 points wins. Points come from three places every deal: the cut (a jack is two for the dealer), pegging (the play to 31), and the show (counting your hand, the dealer's hand, and the crib). The board across the middle of the table is the peg board: three streets of forty holes, The Engine's lane above yours, two pegs a side that leapfrog as you score. The red marker on the last street is the skunk line.",
        },
        {
          kind: "prose",
          text: "Your cards are along the bottom. The Engine's are the face-down backs at the top — you only ever see how many it holds (Settings can swap the two). Between the board and your hand sit the cut card, the crib (marked with whose it is), and the cards played in the current count.",
        },
        {
          kind: "shot",
          name: "cribbage-table",
          alt: "A cribbage game: a turn bar naming You and The Engine with scores, a difficulty picker, then the table — The Engine's cards face down at the top, a three-street peg board with two pegs a side and a skunk-line marker, the cut slot and crib below it, and six face-up cards along the bottom with two selected.",
          caption: "The turn bar and the table: the engine's hand, the peg board, the middle, your hand. Two cards are selected for the throw.",
        },
      ],
    },
    {
      testid: "howto-discard",
      title: "The throw: tap two cards",
      toc: "The throw",
      blocks: [
        {
          kind: "steps",
          items: [
            "Tap a card to select it; tap again to unselect. Pick two.",
            "Tap Throw to crib. Those two go face down into the crib.",
            "The Engine throws two as well, and then the cut turns.",
          ],
        },
        {
          kind: "note",
          text: "The crib belongs to the dealer and is counted last. When it is yours, throw cards that help it; when it is The Engine's, throw cards that do not. A pair of fives into your own crib is the classic strong throw — and the classic gift into the other one.",
        },
      ],
    },
    {
      testid: "howto-peg",
      title: "Pegging: play to 31",
      toc: "Pegging",
      blocks: [
        {
          kind: "prose",
          text: "The non-dealer leads. You take turns playing one card, each adding its value to the count (face cards are ten, aces one). The count may not pass 31. As you play, you score: two for making fifteen, two for making exactly thirty-one, two for pairing the last card (six for three of a kind, twelve for four), and a run of three or more for cards that form a sequence in any order.",
        },
        {
          kind: "prose",
          text: "If you cannot play under 31, tap Go. The other player keeps playing while they can, then pegs one for the go and the count starts again. The last card of the deal is worth one.",
        },
        {
          kind: "shot",
          name: "cribbage-pegging",
          alt: "Pegging in progress: two cards in the middle with the count shown, the player's remaining cards below with the ones that can be played ringed, and a status line naming what the last card scored.",
          caption: "The count, the cards played so far, and your playable cards ringed.",
        },
      ],
    },
    {
      testid: "howto-show",
      title: "The show: counting, in order",
      toc: "The show",
      blocks: [
        {
          kind: "prose",
          text: "Once the cards are played, hands are counted against the cut card — always in this order: the non-dealer's hand, then the dealer's, then the crib. The order matters because the game ends the instant anyone reaches 121; as non-dealer you can count out before the dealer scores a point.",
        },
        {
          kind: "prose",
          text: "A hand scores two for each combination adding to fifteen, two per pair, runs of three or more (a pair inside a run doubles it), four for a flush in hand (five with the cut; the crib needs all five), and one for his nobs — a jack matching the cut's suit. The best possible hand is 29.",
        },
        {
          kind: "prose",
          text: "By default the app counts every hand and shows the breakdown. Turn on \"Count my own hands\" in Settings to do it yourself: type your total and the core grades it. Count short and The Engine takes the difference — that is muggins. Count high and you get the true total.",
        },
        {
          kind: "shot",
          name: "cribbage-show",
          alt: "The show: The Engine's four cards face up with a line reading the breakdown of fifteens, runs and a flush, your hand counted below it, and the crib waiting for your count with a number box and a Count it button.",
          caption: "Each hand comes face up in order with its count spelled out.",
        },
      ],
    },
    {
      testid: "howto-win",
      title: "Winning, and what a game is worth",
      toc: "Winning",
      blocks: [
        {
          kind: "prose",
          text: "First to 121. A win is worth one game. If the loser has not crossed the skunk line at 91, it is a skunk, worth two; under 61 it is a double skunk, worth three. The end screen states the value, and the verifiable record carries it.",
        },
        {
          kind: "prose",
          text: "Difficulty sets how The Engine throws and pegs, from Easy to Expert. Expert throws by exact expectation over every card that could be cut and looks two plays ahead when pegging. It cannot see your hand — the engine only ever gets its own view of the table, and the shelf tests that.",
        },
        {
          kind: "note",
          text: "Hints are on by default and point at the engine's preferred throw or play; using one marks the record as assisted. The optional tutor explains your options: exact for a throw, hedged for pegging, because the other hand is unknown.",
        },
        {
          kind: "note",
          text: "On a small screen the board can give way: Settings → Peg board offers two compact score bars, or no board during the deal and a replay of the deal's pegging once it ends. The scores in the turn bar stay either way.",
        },
      ],
    },
  ],
};
