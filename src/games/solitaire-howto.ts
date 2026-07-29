//! Solitaire's "How to play" guide (pure data — see src/how-to.ts). The copy
//! leads with the one thing players ask first: you TAP, you don't drag.

import type { Guide } from "../how-to.js";

export const SOLITAIRE_GUIDE: Guide = {
  title: "How to play solitaire",
  lede: "Klondike draw-1: clear all 52 cards to the four foundations. You play by tapping — tap a card, then tap where it should go. Every win is a record anyone can re-verify.",
  entries: [
    {
      testid: "howto-goal",
      title: "The goal",
      toc: "The goal",
      blocks: [
        {
          kind: "prose",
          text: "Move all 52 cards to the four foundations in the top-right. Each foundation collects one suit and builds up in order — Ace first, then 2, 3, 4 … up to King. Clear all four and you win.",
        },
        {
          kind: "shot",
          name: "solitaire-board",
          alt: "The solitaire board: a green felt table with the stock and waste top-left, four empty foundations top-right, and seven fanned tableau columns below.",
          caption: "The board — stock and waste (top-left), the four foundations (top-right), and the seven tableau columns.",
        },
      ],
    },
    {
      testid: "howto-board",
      title: "The board",
      toc: "The board",
      blocks: [
        {
          kind: "steps",
          items: [
            "Stock (top-left): the face-down pile you draw from. Tap it to turn cards up into the waste; tap it when empty to recycle the waste back.",
            "Waste: the face-up pile next to the stock. Its top card is playable.",
            "Foundations (top-right): one per suit, built up Ace → King. This is where cards go to win.",
            "Tableau: the seven columns. Build them down in alternating colours (a red 6 on a black 7). Face-down cards turn up automatically when you uncover them; an empty column can start with a King.",
          ],
        },
      ],
    },
    {
      testid: "howto-move",
      title: "Making moves: tap, don’t drag",
      toc: "Making moves",
      blocks: [
        {
          kind: "prose",
          text: "You do not drag cards. You tap a source, then tap a destination — the same way with a mouse, a touchscreen, or the keyboard.",
        },
        {
          kind: "steps",
          items: [
            "Tap a card you want to move (the top of the waste, or any face-up card in a column — tapping partway down a column picks up that card and everything on it).",
            "The legal places it can go light up. If nowhere lights up, that card has no legal move right now.",
            "Tap one of the highlighted spots to make the move. Tapping anywhere illegal just clears the selection — the board never changes on an illegal tap.",
            "Double-tap a card to send it straight to its foundation, if it can go.",
            "Tap the stock to draw. When the stock is empty, tap it again to recycle the waste.",
          ],
        },
        {
          kind: "shot",
          name: "solitaire-select",
          alt: "A selected card outlined in gold, with its one legal destination column highlighted by a gold ring.",
          caption: "Tap a card and its legal destinations glow. Tap a glowing spot to move there.",
        },
        {
          kind: "note",
          text: "Drag-and-drop is a planned addition; tapping will always work as well.",
        },
      ],
    },
    {
      testid: "howto-deals",
      title: "Today’s deal vs a new deal",
      toc: "Deals",
      blocks: [
        {
          kind: "steps",
          items: [
            "Today’s deal: the same hand everyone gets today (and it is always winnable). Come back tomorrow for a new one.",
            "New deal: a fresh random hand right now — tap it again any time to reshuffle.",
          ],
        },
      ],
    },
    {
      testid: "howto-help",
      title: "Undo, hints, and getting stuck",
      toc: "Help & hints",
      blocks: [
        {
          kind: "steps",
          items: [
            "Undo steps back one move.",
            "Hint (on by default) points at a good move you can make right now, and only says you are stuck when there is genuinely no move left.",
            "Turn hints off in Settings and the control becomes “I’m stuck”: it ends the game and tells you honestly whether a move was still available.",
          ],
        },
        {
          kind: "note",
          text: "Using undo or a hint counts as assistance — it is recorded, so a clean clear stays meaningful. You can turn “Declare assistance used” off in Settings, but then the result simply doesn’t claim to be clean.",
        },
        {
          kind: "shot",
          name: "solitaire-hint",
          alt: "The Hint control has highlighted a source card and its destination with a green ring, with a status line describing the suggested move.",
          caption: "Hint points at a move (in green) and explains it below the board.",
        },
      ],
    },
    {
      testid: "howto-verify",
      title: "Winning, verifying, and sharing",
      toc: "Verify & share",
      blocks: [
        {
          kind: "prose",
          text: "When you clear the board you get a result you can prove. A “clean clear” means you won with no assistance declared. The result carries the full move list, so anyone can replay it against the game’s rules and confirm the same outcome — no account, no server.",
        },
        {
          kind: "steps",
          items: [
            "Re-verify replays your record right there and checks the result matches.",
            "Share this result makes a link that carries the whole record; opening it re-verifies before it shows anything, so a shared claim is checked, not trusted.",
          ],
        },
        {
          kind: "shot",
          name: "solitaire-win",
          alt: "The win screen leading with “Cleared clean — verifiable”, a Verified badge, the outcome record with moves-to-clear and the final hash, and Re-verify / Share / Play again controls.",
          caption: "The win screen leads with the verifiable clean-clear, the record, and one-tap re-verify + share.",
        },
      ],
    },
  ],
};
