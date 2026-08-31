//! Chess's "How to play" guide (pure data — see src/how-to.ts). Leads with what
//! a new player gets wrong: **the board only offers legal moves, so "why can't
//! I move that?" almost always means your king would be in check** — and the
//! three special moves (castling, en passant, promotion) that look like bugs
//! the first time.

import type { Guide } from "../../how-to.js";

export const CHESS_GUIDE: Guide = {
  title: "How to play Chess",
  lede: "Chess on an 8×8 board against The Engine, the shelf's computer opponent. Each piece moves in its own way; the aim is to trap the other side's king so it cannot escape — checkmate. Every finished game is a record anyone can re-verify.",
  entries: [
    {
      testid: "howto-goal",
      title: "The goal",
      toc: "The goal",
      blocks: [
        {
          kind: "prose",
          text: "You and The Engine each start with sixteen pieces. White moves first. A king that is attacked is in check, and it must get out of check at once; a king in check with no way out is checkmated, and the game is over. You cannot make a move that leaves your own king in check — which is the rule behind almost every “why won't it let me?” in your first games.",
        },
        {
          kind: "prose",
          text: "You choose which side you play — White (which opens), Black, or random — and how strong The Engine is (Easy, Medium, Hard, or Expert) on the start screen, or from the New game button under the board. Both choices are remembered for next time. Playing Black turns the board so your pieces are at the bottom.",
        },
        {
          kind: "shot",
          name: "chess-board",
          alt: "An 8×8 chess board in the opening position, White at the bottom, files a–h and ranks 1–8 labelled along the edges; the white king's knight on g1 is outlined as selected and blue dots mark the two squares it can reach, f3 and h3.",
          caption: "The board on your move — tap a piece and dots mark where it can go. Above it sit the two seats (yours is ringed on your move; The Engine’s pulses while it thinks); below it, Undo, Hint, and New game.",
        },
      ],
    },
    {
      testid: "howto-play",
      title: "Playing a move: tap a piece, then tap where it goes",
      toc: "Playing",
      blocks: [
        {
          kind: "prose",
          text: "Every move is two taps — the same with a mouse, a finger, or the keyboard (the arrow keys walk the board; Enter or Space taps).",
        },
        {
          kind: "steps",
          items: [
            "Tap one of your pieces. Only pieces that actually have a legal move are tappable.",
            "The squares it can reach are marked — a dot on an empty square, a ring around a piece it can capture. Tap one to move there.",
            "The Engine takes its turn; the squares it moved from and to are highlighted so you can see what it did, and the last move is named in its seat (for instance Nf3 or exd5). Then it is your move again.",
          ],
        },
        {
          kind: "note",
          text: "The game's core decides what is legal, not the screen — if a square is not offered, that move is not legal here. Usually that means it would leave your king in check, or your king is in check right now and this piece cannot help.",
        },
      ],
    },
    {
      testid: "howto-special",
      title: "Three moves that look like bugs the first time",
      toc: "Special moves",
      blocks: [
        {
          kind: "prose",
          text: "**Castling** — move your king two squares towards a rook, and the rook hops over to the square beside it. It is offered only when neither piece has moved, the squares between are empty, and the king is not in check and does not pass through an attacked square. Tap the king, then the square two files across.",
        },
        {
          kind: "prose",
          text: "**En passant** — yes, that is a real move. If an enemy pawn has just advanced two squares and landed beside one of yours, you may capture it as if it had moved only one: tap your pawn, then the empty square diagonally behind the enemy pawn. It is offered on that very next move and not afterwards.",
        },
        {
          kind: "prose",
          text: "**Promotion** — a pawn that reaches the far rank becomes another piece. When you tap the pawn onto the last rank, a picker asks which: queen, rook, bishop, or knight. Press Escape, or tap outside it, to change your mind and the pawn stays where it was.",
        },
        {
          kind: "shot",
          name: "chess-promotion",
          alt: "A chess board dimmed behind a small white picker card offering four buttons — queen, rook, bishop, and knight; the white pawn on b7 is outlined as selected, about to capture on a8 and promote.",
          caption: "The promotion picker: tap the piece you want; Escape cancels and nothing has moved.",
        },
      ],
    },
    {
      testid: "howto-draws",
      title: "Draws — the game can end without a winner",
      toc: "Draws",
      blocks: [
        {
          kind: "prose",
          text: "A game is drawn when the side to move is not in check but has no legal move at all (stalemate); when the same position appears for the third time; when fifty moves by each side pass with no capture and no pawn move; or when neither side has enough material left to force a checkmate (for instance a lone king against a king and a knight). The game applies all of these itself — you never have to claim one — and the result screen says which it was.",
        },
        {
          kind: "note",
          text: "Being far ahead does not win by itself. If you leave your opponent's king with nowhere to go and it is not in check, that is stalemate, and the game is a draw. It catches everyone once.",
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
          text: "You play against the shelf's engine. Chess is not a solved game, so the engine is a searching player — it counts material, values active pieces and a safe king, and looks a few moves ahead — and it plays out mates exactly when it can see that far. On Easy it looks two moves ahead and is very beatable; on Expert it looks five ahead and punishes a loose piece. Every level answers within a moment, on a phone too.",
        },
        {
          kind: "prose",
          text: 'A built-in tutor (Settings → Tutor) coaches you using the engine\'s own read of the position, so its facts are never wrong — and it needs no download. Tap "Explain my options" for the reasonable moves, each named in chess notation with a one-line idea (takes the knight, gives check, castles, or your strongest line). Hint, when hints are on, points at one good move.',
        },
        {
          kind: "prose",
          text: 'The tutor is honest about certainty. When it has actually proven how a line ends — a mate it can see through — it will say so, and tell you a move threw the game; when it is only reading ahead, it softens to "looks risky" rather than overclaiming, and says "not yet certain" above its list.',
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
          text: 'On a device with WebGPU, Settings offers an "Experimental: local AI opponent" — a small model that runs entirely in your browser (a one-time download). It picks only from the engine\'s reasonable moves and adds a little banter, so it plays legally and never throws the game; the strength is still the engine\'s.',
        },
        {
          kind: "prose",
          text: "When the game ends you get a result you can re-verify. It shows the final board and replays every move — yours and The Engine's — against the game's core to re-derive the outcome, so nothing is taken on trust. Share it and the link checks itself before it shows.",
        },
        {
          kind: "shot",
          name: "chess-result",
          alt: "A result panel reading a chess outcome with a green Verified check, the final 8×8 board, and a record listing the result, moves, seed, and final hash.",
          caption: "The verifiable result: the final board, re-checked by replay, with a self-verifying share link.",
        },
      ],
    },
  ],
};
