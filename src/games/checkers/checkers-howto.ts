//! Checkers' "How to play" guide (pure data — see src/how-to.ts). Leads with the
//! two rules a new player gets wrong: **capture is mandatory**, and **crowning
//! ends the move**.

import type { Guide } from "../../how-to.js";

export const CHECKERS_GUIDE: Guide = {
  title: "How to play Checkers",
  lede: "Checkers — English draughts — on an 8×8 board against The Engine, the shelf's computer opponent. Men move one square diagonally forward and capture by jumping; reach the far row and you are crowned a king, which can move and jump backwards too. Take all your opponent's pieces, or leave them with no move, and you win. Every finished game is a record anyone can re-verify.",
  entries: [
    {
      testid: "howto-goal",
      title: "The goal",
      toc: "The goal",
      blocks: [
        {
          kind: "prose",
          text: "You and The Engine each start with 12 men on the dark squares — only the dark squares are ever used. Black moves first. A man moves one square diagonally forward to an empty square. You win by capturing every enemy piece, or by leaving your opponent with no legal move at all; if neither side makes progress for a long stretch — 40 moves each with no capture and no man advanced — the game is a draw.",
        },
        {
          kind: "prose",
          text: 'You choose which side you play — ● Black (which opens) or ○ White — and how strong The Engine is (Easy, Medium, Hard, or Expert) on the start screen, or from the New game button under the board. Both choices are remembered for next time, and the level shows beside the game\u2019s name.',
        },
        {
          kind: "shot",
          name: "checkers-board",
          alt: "A checkers game inside the game frame: two seats above the board showing You and The Engine with their piece counts, an 8×8 wooden board with black and white men on the dark squares, one man selected and gold dots marking where it can go, and New game and Settings buttons under it.",
          caption: "The two seats (yours is ringed on your move; The Engine’s pulses while it thinks), and the board — gold dots mark where the selected man can go.",
        },
      ],
    },
    {
      testid: "howto-play",
      title: "Playing a move: tap a man, then tap where it goes",
      toc: "Playing",
      blocks: [
        {
          kind: "prose",
          text: "Every move is two taps — the same with a mouse, a finger, or the keyboard.",
        },
        {
          kind: "steps",
          items: [
            "Tap one of your men. Only men that actually have a move are tappable.",
            "The squares it can reach show a gold dot — tap one to move there.",
            "The Engine takes its turn; the squares it moved from and to are ringed so you can see what it did, then it is your move again.",
          ],
        },
        {
          kind: "note",
          text: "The game's core decides what is legal, not the screen — if a square is not offered, it is not a legal move, and no tap will make it one.",
        },
      ],
    },
    {
      testid: "howto-capture",
      title: "Capture is mandatory — and a jump can continue",
      toc: "Capturing",
      blocks: [
        {
          kind: "prose",
          text: "You capture by jumping an enemy piece that sits diagonally next to you, landing on the empty square directly beyond it; the jumped piece is removed. Capturing is **not optional**: whenever a jump exists anywhere on the board, a jump is the only kind of move you are offered. If that surprises you, that is the rule, not a bug — it is what makes draughts sharp.",
        },
        {
          kind: "steps",
          items: [
            "If a jump is available, the men that can jump are the only ones tappable.",
            "Tap the man, then tap the square it lands on — the jumped piece disappears.",
            "If that same piece can jump again from where it landed, it must: the next landing square lights up and you tap on, one hop at a time, until the chain is done. Nothing is committed until you finish it.",
          ],
        },
        {
          kind: "shot",
          name: "checkers-capture",
          alt: "A checkers board mid-game with one man selected and a single gold dot two squares away diagonally, marking the landing square of a mandatory jump over an enemy man.",
          caption: "A jump in progress: the landing square is offered, and a multi-jump is tapped one landing at a time.",
        },
      ],
    },
    {
      testid: "howto-kings",
      title: "Kings — and why crowning ends your move",
      toc: "Kings",
      blocks: [
        {
          kind: "prose",
          text: "A man that reaches the far row is crowned a king, marked with a crown and a gold ring. A king moves and jumps diagonally in **both** directions, which makes it far stronger than a man.",
        },
        {
          kind: "note",
          text: "Crowning ends the move immediately. If a man jumps its way into the far row, it is crowned and stops there — it does not carry on jumping as a king in the same turn. This catches everyone once.",
        },
      ],
    },
    {
      testid: "howto-opponent",
      title: "The Engine, and the tutor",
      toc: "The opponent",
      blocks: [
        {
          kind: "prose",
          text: "You play against the shelf's engine. Checkers is not a solved game from the opening, so the engine is a strong searching player — it counts material, values kings and the back row, and pushes men forward — and it plays out proven wins and losses exactly when it can see that far. On Easy it plays loosely and is very beatable; on Expert it punishes a loose man.",
        },
        {
          kind: "prose",
          text: 'A built-in tutor (Settings → Tutor) coaches you using the engine\'s own read of the position, so its facts are never wrong — and it needs no download. Tap "Explain my options" for the reasonable moves, each with a one-line idea (takes a piece, your strongest line, or stays safe).',
        },
        {
          kind: "prose",
          text: 'The tutor is honest about certainty. When it has actually proven how a line ends, it will tell you a move threw the game; when it is only reading ahead, it softens to "looks risky" rather than overclaiming — and says "not yet certain" above its list. Checkers cannot be solved from the opening, so that distinction is the whole point.',
        },
        {
          kind: "shot",
          name: "checkers-tutor",
          alt: 'A checkers board mid-game with the tutor panel below it: an "Explain my options" button, a "Reading ahead (not yet certain)" note, and a list of reasonable moves, each with a short reason such as "takes a piece" or "stays safe".',
          caption: "The tutor lists the reasonable moves and the idea behind each — engine-grounded, no model download.",
        },
      ],
    },
    {
      testid: "howto-result",
      title: "The experimental opponent, and the verifiable result",
      toc: "AI & result",
      blocks: [
        {
          kind: "prose",
          text: 'On a device with WebGPU, Settings offers an "Experimental: local AI opponent" — a small model that runs entirely in your browser (a one-time download). It picks only from the engine\'s safe moves and adds a little banter, so it plays legally and never throws the game; the strength is still the engine\'s.',
        },
        {
          kind: "prose",
          text: "When the game ends you get a result you can re-verify. It shows the final board and replays every move — yours and The Engine's — against the game's core to re-derive the outcome, so nothing is taken on trust. Share it and the link checks itself before it shows.",
        },
        {
          kind: "shot",
          name: "checkers-result",
          alt: "A result panel reading “A draw 1–6 — verifiable” with a green Verified check, the final 8×8 board showing two crowned kings and four white men, and a record listing the result, moves, seed, and final hash.",
          caption: "The verifiable result: the final board, re-checked by replay, with a self-verifying share link.",
        },
      ],
    },
  ],
};
