//! The solitaire board (front-plan Phase 4): a Klondike draw-1 board rendered
//! over the `solitaire-wasm` binding, driven by tap-source → tap-target with
//! legal-move highlighting. The UI **never decides legality** — it matches the
//! tapped source/target against the core's `legalMoves()` and calls `play()`;
//! the core is the sole authority. A win yields a verifiable `pond-outcome`
//! record shown on a verification-forward result screen, shareable via `?r=`.

import type { GameModule, GameServices } from "../contract.js";
import type { GameFrame, GameFrameSpec } from "../game-frame.js";
import type { Progress } from "../progress.js";
import type { SettingRow } from "../settings-sheet.js";
import { today } from "../shelf.js";
import { Solitaire, type BoardView, type CardView, type SolMove } from "./solitaire-wasm.js";
import {
  dailySeed,
  decodeRecord,
  encodeRecord,
  verifyRecord,
  type DealPack,
  type OutcomeEnvelope,
  type VerifyResult,
} from "./solitaire-outcome.js";
import {
  autoPlayEnabled,
  declareAssistanceEnabled,
  hintsEnabled,
  setAutoPlay,
} from "../settings.js";

declare global {
  interface Window {
    /** E2E hook: the live binding + a re-render, so tests drive the core. */
    __solitaire?: {
      game: Solitaire;
      refresh: () => void;
      legalMoves: () => SolMove[];
      seed: bigint;
    };
  }
}

const RANK_SHORT = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const RANK_NAME = [
  "",
  "Ace",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Jack",
  "Queen",
  "King",
];
const SUIT_SYM = ["♣", "♦", "♥", "♠"]; // ♣ ♦ ♥ ♠
const SUIT_NAME = ["Clubs", "Diamonds", "Hearts", "Spades"];
const isRed = (suit: number): boolean => suit === 1 || suit === 2;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const c of children) node.append(c);
  return node;
}

// ---------- what the player tapped ----------

type Source = { kind: "waste" } | { kind: "tableau"; pile: number; index: number };
type Hint =
  | { kind: "draw" }
  | { kind: "wasteToFoundation"; suit: number }
  | { kind: "tableauToFoundation"; pile: number; suit: number }
  | { kind: "wasteToTableau"; pile: number }
  | { kind: "tableauToTableau"; from: number; count: number; to: number };
type Ctx =
  | { type: "stock" }
  | { type: "waste" }
  | { type: "foundation"; suit: number }
  | { type: "pile"; pile: number }
  | { type: "card"; pile: number; index: number; faceUp: boolean };

function ctxFromEl(elm: HTMLElement): Ctx | null {
  const kind = elm.dataset.el;
  if (kind === "stock") return { type: "stock" };
  if (kind === "waste") return { type: "waste" };
  if (kind === "foundation") return { type: "foundation", suit: Number(elm.dataset.suit) };
  if (kind === "slot") return { type: "pile", pile: Number(elm.dataset.pile) };
  if (kind === "card") {
    return {
      type: "card",
      pile: Number(elm.dataset.pile),
      index: Number(elm.dataset.index),
      faceUp: elm.dataset.faceup === "1",
    };
  }
  return null;
}

// ---------- the verification-forward result screen (pure DOM) ----------

/** Assistance phrasing for the record detail line. */
function assistanceText(a: boolean | null): string {
  if (a === false) return "none declared (clean clear)";
  if (a === true) return "declared";
  return "not declared";
}

function headline(env: OutcomeEnvelope, v: VerifyResult): string {
  if (!v.ok) return "Verification FAILED — this result does not check out";
  const r = env.payload.result;
  if (r === "Won") {
    const base =
      env.payload.assistance === false
        ? "Cleared clean"
        : env.payload.assistance === true
          ? "Cleared with assistance"
          : "Cleared";
    return `${base} ✓ — verifiable`;
  }
  if (r === "Stuck") return "Stuck — result recorded";
  return "Game abandoned";
}

/** Options wiring the result screen back to the running module. */
export interface ResultScreenOpts {
  /** The `/solitaire/?r=…` share link (omitted on an already-shared view). */
  shareUrl?: string;
  /** A contextual note (e.g. whether a move was still available on a Stuck). */
  note?: string;
  /** Re-run verification and rebuild the screen. */
  onReverify?: () => void;
  /** Start a fresh game. */
  onPlayAgain?: () => void;
  /** This screen is a shared result being viewed, not the player's own win. */
  shared?: boolean;
}

/**
 * Build the result screen: the outcome headline, the verification badge (which
 * re-states the outcome as checked-by-replay, or the expected-vs-actual hash on
 * failure), the record details, and the share/re-verify/play controls.
 */
export function renderResultScreen(
  env: OutcomeEnvelope,
  verification: VerifyResult,
  opts: ResultScreenOpts = {},
): HTMLElement {
  const rec = env.payload;
  const section = el("section", { class: "sol-result", role: "region", "aria-label": "Result" });

  section.append(el("h2", { class: "sol-headline" }, headline(env, verification)));

  const badge = el("p", {
    class: `sol-verify-badge ${verification.ok ? "ok" : "fail"}`,
    role: "status",
  });
  badge.textContent = verification.ok
    ? "Verified ✓ — re-checked by replaying every move against the core."
    : `Verification failed — expected hash ${verification.expected}, replay produced ${verification.actual}.`;
  section.append(badge);

  if (opts.note) section.append(el("p", { class: "sol-note" }, opts.note));

  const dl = el("dl", { class: "sol-record" });
  const row = (term: string, value: string, cls = ""): void => {
    dl.append(el("dt", {}, term), el("dd", cls ? { class: cls } : {}, value));
  };
  row("Result", rec.result);
  row("Moves to clear", String(rec.move_count));
  row("Seed", String(rec.seed));
  row("Assistance", assistanceText(rec.assistance));
  row("Final hash", rec.final_hash, "sol-hash");
  section.append(dl);

  const controls = el("div", { class: "sol-result-controls" });
  if (opts.onReverify) {
    const b = el("button", { type: "button", class: "sol-reverify" }, "Re-verify");
    b.addEventListener("click", opts.onReverify);
    controls.append(b);
  }
  if (opts.shareUrl) {
    const link = el(
      "a",
      { class: "sol-share", href: opts.shareUrl, "data-share": opts.shareUrl },
      "Share this result",
    );
    controls.append(link);
  }
  if (opts.onPlayAgain) {
    const b = el(
      "button",
      { type: "button", class: "sol-again" },
      opts.shared ? "Play today’s deal" : "Play again",
    );
    b.addEventListener("click", opts.onPlayAgain);
    controls.append(b);
  }
  if (controls.childNodes.length) section.append(controls);

  return section;
}

// ---------- the game module ----------

/** Which deal the next game is: today's (winnable, shared) or a fresh random one. */
let chosenMode: "daily" | "free" = "daily";

/** The New deal card — one builder for the poster and the sheet. */
export function solitaireSetupRows(): SettingRow[] {
  return [
    {
      kind: "choice",
      id: "deal",
      label: "Deal",
      value: chosenMode,
      options: [
        { value: "daily", label: "Today’s deal", hint: "the same winnable hand everyone gets today" },
        { value: "free", label: "New deal", hint: "a fresh random hand" },
      ],
      onChange: (v) => {
        chosenMode = v === "free" ? "free" : "daily";
      },
    },
  ];
}

/** The poster's setup card — the registry's `setup` factory. */
export const solitaireSetup = (): SettingRow[] => solitaireSetupRows();

/** Construct a fresh solitaire module (the registry `load`). */
export function solitaireModule(): GameModule {
  let game: Solitaire | null = null;
  let verifier: Solitaire | null = null;
  let pack: DealPack | null = null;
  let container: HTMLElement | null = null;
  let frame: GameFrame | null = null;
  let pendingResume: Progress | null = null;
  let disposed = false;

  let mode: "daily" | "free" = "daily";
  let seed = 0n;
  let selected: Source | null = null;
  let hint: Hint | null = null;
  let stuckDeclared = false;
  let stuckNote = "";
  let moveCount = 0;
  let cascadeEl: HTMLElement | null = null;

  const statusEl = el("p", { class: "sol-status", role: "status", "aria-live": "polite" });
  const setStatus = (msg: string): void => {
    statusEl.textContent = msg;
  };

  const randomSeed = (): bigint => {
    const buf = new Uint32Array(2);
    crypto.getRandomValues(buf);
    // Keep within Number.MAX_SAFE_INTEGER so the record's seed round-trips
    // exactly through JSON (and thus through a share link).
    return (BigInt(buf[0]!) << 16n) ^ BigInt(buf[1]! & 0xffff);
  };

  const shareUrlFor = async (env: OutcomeEnvelope): Promise<string> =>
    `${location.origin}${location.pathname}?r=${await encodeRecord(env)}`;

  const verify = (env: OutcomeEnvelope): VerifyResult => verifyRecord(verifier!, env);

  // --- move resolution: matches (source, target) against the core's legal list ---

  const legalTargets = (src: Source): { foundations: Set<number>; piles: Set<number> } => {
    const foundations = new Set<number>();
    const piles = new Set<number>();
    const moves = game!.legalMoves();
    const board = game!.board();
    if (src.kind === "waste") {
      for (const m of moves) {
        if (m === "WasteToFoundation" && board.wasteTop) foundations.add(board.wasteTop.suit);
        else if (typeof m === "object" && "WasteToTableau" in m) piles.add(m.WasteToTableau.pile);
      }
    } else {
      const pile = board.tableau[src.pile]!;
      const count = pile.length - src.index;
      const card = pile[src.index]?.card;
      for (const m of moves) {
        if (
          typeof m === "object" &&
          "TableauToFoundation" in m &&
          m.TableauToFoundation.pile === src.pile &&
          count === 1 &&
          card
        ) {
          foundations.add(card.suit);
        } else if (
          typeof m === "object" &&
          "TableauToTableau" in m &&
          m.TableauToTableau.from === src.pile &&
          m.TableauToTableau.count === count
        ) {
          piles.add(m.TableauToTableau.to);
        }
      }
    }
    return { foundations, piles };
  };

  const findMove = (src: Source, ctx: Ctx): SolMove | null => {
    const moves = game!.legalMoves();
    const board = game!.board();
    if (src.kind === "waste") {
      if (ctx.type === "foundation" && board.wasteTop?.suit === ctx.suit) {
        return moves.includes("WasteToFoundation") ? "WasteToFoundation" : null;
      }
      if (ctx.type === "pile" || ctx.type === "card") {
        const pile = ctx.type === "pile" ? ctx.pile : ctx.pile;
        return (
          moves.find(
            (m): m is Extract<SolMove, { WasteToTableau: unknown }> =>
              typeof m === "object" && "WasteToTableau" in m && m.WasteToTableau.pile === pile,
          ) ?? null
        );
      }
      return null;
    }
    const srcPile = board.tableau[src.pile]!;
    const count = srcPile.length - src.index;
    const card = srcPile[src.index]?.card;
    if (ctx.type === "foundation" && count === 1 && card && card.suit === ctx.suit) {
      return moves.find(
        (m): m is Extract<SolMove, { TableauToFoundation: unknown }> =>
          typeof m === "object" && "TableauToFoundation" in m && m.TableauToFoundation.pile === src.pile,
      )
        ? { TableauToFoundation: { pile: src.pile } }
        : null;
    }
    if ((ctx.type === "pile" || ctx.type === "card") && ctx.pile !== src.pile) {
      return (
        moves.find(
          (m): m is Extract<SolMove, { TableauToTableau: unknown }> =>
            typeof m === "object" &&
            "TableauToTableau" in m &&
            m.TableauToTableau.from === src.pile &&
            m.TableauToTableau.count === count &&
            m.TableauToTableau.to === ctx.pile,
        ) ?? null
      );
    }
    return null;
  };

  const isSelectable = (ctx: Ctx): Source | null => {
    if (ctx.type === "waste" && game!.board().wasteTop) return { kind: "waste" };
    if (ctx.type === "card" && ctx.faceUp) return { kind: "tableau", pile: ctx.pile, index: ctx.index };
    return null;
  };

  const sameSource = (a: Source, ctx: Ctx): boolean =>
    (a.kind === "waste" && ctx.type === "waste") ||
    (a.kind === "tableau" && ctx.type === "card" && a.pile === ctx.pile && a.index === ctx.index);

  // --- actions ---

  const sameColorOther = [3, 2, 1, 0]; // ♣→♠, ♦→♥, ♥→♦, ♠→♣

  /** A card is provably safe to auto-send to its foundation when it can never be
   *  needed in the tableau: Aces/2s always, else both opposite-colour
   *  foundations are within one rank and the same-colour other suit within two. */
  const safeToFoundation = (card: CardView, f: readonly number[]): boolean => {
    if (card.rank <= 2) return true;
    const opp = isRed(card.suit) ? [0, 3] : [1, 2];
    return (
      f[opp[0]!]! >= card.rank - 1 &&
      f[opp[1]!]! >= card.rank - 1 &&
      f[sameColorOther[card.suit]!]! >= card.rank - 2
    );
  };

  /** Opt-in: repeatedly play any safe foundation move the core offers. These are
   *  obvious moves, so they are a convenience, not assistance. */
  const autoPlaySafe = (): void => {
    if (!game || !autoPlayEnabled()) return;
    for (let guard = 0; guard < 60; guard += 1) {
      const board = game.board();
      const play = (m: SolMove): boolean => game!.play(m) === "applied";
      const move = game.legalMoves().find((m) => {
        if (m === "WasteToFoundation") {
          return board.wasteTop ? safeToFoundation(board.wasteTop, board.foundations) : false;
        }
        if (typeof m === "object" && "TableauToFoundation" in m) {
          const top = board.tableau[m.TableauToFoundation.pile]!.at(-1)?.card;
          return top ? safeToFoundation(top, board.foundations) : false;
        }
        return false;
      });
      if (!move || !play(move)) break;
      moveCount += 1;
    }
  };

  const applyMove = (move: SolMove): void => {
    const status = game!.play(move);
    if (status === "applied") {
      moveCount += 1;
      setStatus("");
      autoPlaySafe();
    } else {
      setStatus("That move is not legal.");
    }
    selected = null;
    render(true);
  };

  const doDraw = (): void => {
    const status = game!.play("Draw");
    if (status === "applied") {
      moveCount += 1;
      autoPlaySafe();
    } else {
      setStatus("Nothing left to draw.");
    }
    selected = null;
    render(true);
  };

  const autoToFoundation = (ctx: Ctx): void => {
    let src: Source | null = null;
    if (ctx.type === "waste") src = { kind: "waste" };
    else if (ctx.type === "card" && ctx.faceUp) {
      const pile = game!.board().tableau[ctx.pile]!;
      if (ctx.index === pile.length - 1) src = { kind: "tableau", pile: ctx.pile, index: ctx.index };
    }
    if (!src) return;
    const target: Ctx =
      src.kind === "waste"
        ? { type: "foundation", suit: game!.board().wasteTop!.suit }
        : { type: "foundation", suit: game!.board().tableau[src.pile]![src.index]!.card!.suit };
    const move = findMove(src, target);
    if (move) applyMove(move);
  };

  const handleClick = (ctx: Ctx): void => {
    if (!game) return;
    if (ctx.type === "stock") {
      doDraw();
      return;
    }
    if (!selected) {
      const src = isSelectable(ctx);
      if (src) {
        selected = src;
        applySelectionStyles();
      }
      return;
    }
    if (sameSource(selected, ctx)) {
      selected = null;
      applySelectionStyles();
      return;
    }
    const move = findMove(selected, ctx);
    if (move) {
      applyMove(move);
      return;
    }
    const next = isSelectable(ctx);
    if (next) {
      selected = next;
      applySelectionStyles();
    } else {
      setStatus("No legal move there.");
      selected = null;
      applySelectionStyles();
    }
  };

  // --- rendering ---

  const cardButton = (suit: number, rank: number, dataset: Record<string, string>): HTMLElement => {
    const b = el("button", {
      type: "button",
      class: `sol-card ${isRed(suit) ? "red" : "black"}`,
      "aria-label": `${RANK_NAME[rank]} of ${SUIT_NAME[suit]}, face up`,
      draggable: "true", // drag-and-drop fast-follow; tapping still works
      ...dataset,
    });
    b.append(el("span", { class: "sol-rank" }, RANK_SHORT[rank]!), el("span", { class: "sol-suit" }, SUIT_SYM[suit]!));
    return b;
  };

  // --- hints ---

  const cardName = (c: CardView): string => `${RANK_NAME[c.rank]} of ${SUIT_NAME[c.suit]}`;

  /** The most useful legal move to point at, in priority order, or null if the
   *  game is a genuine dead end (no legal move — not even a draw). */
  const bestHint = (): Hint | null => {
    const moves = game!.legalMoves();
    const board = game!.board();
    if (moves.includes("WasteToFoundation") && board.wasteTop) {
      return { kind: "wasteToFoundation", suit: board.wasteTop.suit };
    }
    for (const m of moves) {
      if (typeof m === "object" && "TableauToFoundation" in m) {
        const top = board.tableau[m.TableauToFoundation.pile]!.at(-1)?.card;
        if (top) return { kind: "tableauToFoundation", pile: m.TableauToFoundation.pile, suit: top.suit };
      }
    }
    const t2t = moves.filter(
      (m): m is Extract<SolMove, { TableauToTableau: unknown }> =>
        typeof m === "object" && "TableauToTableau" in m,
    );
    // Prefer a move that reveals a face-down card or empties a column.
    const productive = t2t.find((m) => {
      const from = board.tableau[m.TableauToTableau.from]!;
      const remaining = from.length - m.TableauToTableau.count;
      return remaining === 0 || !from[remaining - 1]!.faceUp;
    });
    const pick = productive ?? t2t[0];
    if (pick) return { kind: "tableauToTableau", ...pick.TableauToTableau };
    for (const m of moves) {
      if (typeof m === "object" && "WasteToTableau" in m) {
        return { kind: "wasteToTableau", pile: m.WasteToTableau.pile };
      }
    }
    if (moves.includes("Draw")) return { kind: "draw" };
    return null;
  };

  const describeHint = (h: Hint): string => {
    const board = game!.board();
    switch (h.kind) {
      case "draw":
        return "draw a card from the stock.";
      case "wasteToFoundation":
        return board.wasteTop
          ? `send the ${cardName(board.wasteTop)} up to its foundation.`
          : "send the waste card up to its foundation.";
      case "tableauToFoundation": {
        const top = board.tableau[h.pile]!.at(-1)?.card;
        return top
          ? `send the ${cardName(top)} up to its foundation.`
          : `send column ${h.pile + 1}'s top card up to its foundation.`;
      }
      case "wasteToTableau":
        return board.wasteTop
          ? `move the ${cardName(board.wasteTop)} onto column ${h.pile + 1}.`
          : `move the waste card onto column ${h.pile + 1}.`;
      case "tableauToTableau":
        return `move ${h.count} card${h.count === 1 ? "" : "s"} from column ${h.from + 1} onto column ${h.to + 1}.`;
    }
  };

  const applyHintStyles = (): void => {
    if (!container || !hint || !game) return;
    const root = container.querySelector<HTMLElement>(".sol-board");
    if (!root) return;
    const glow = (sel: string, cls: "hint-from" | "hint-to"): void => {
      root.querySelector(sel)?.classList.add(cls);
    };
    const pileTarget = (p: number): void => {
      const slot = root.querySelector(`[data-el="slot"][data-pile="${p}"]`);
      if (slot) {
        slot.classList.add("hint-to");
      } else {
        const cards = root.querySelectorAll(`[data-el="card"][data-pile="${p}"]`);
        cards[cards.length - 1]?.classList.add("hint-to");
      }
    };
    switch (hint.kind) {
      case "draw":
        glow('[data-el="stock"]', "hint-to");
        break;
      case "wasteToFoundation":
        glow('[data-el="waste"]', "hint-from");
        glow(`[data-el="foundation"][data-suit="${hint.suit}"]`, "hint-to");
        break;
      case "tableauToFoundation": {
        const pile = game.board().tableau[hint.pile]!;
        glow(`[data-el="card"][data-pile="${hint.pile}"][data-index="${pile.length - 1}"]`, "hint-from");
        glow(`[data-el="foundation"][data-suit="${hint.suit}"]`, "hint-to");
        break;
      }
      case "wasteToTableau":
        glow('[data-el="waste"]', "hint-from");
        pileTarget(hint.pile);
        break;
      case "tableauToTableau": {
        const from = game.board().tableau[hint.from]!;
        glow(`[data-el="card"][data-pile="${hint.from}"][data-index="${from.length - hint.count}"]`, "hint-from");
        pileTarget(hint.to);
        break;
      }
    }
  };

  const endStuck = (note: string): void => {
    selected = null;
    hint = null;
    stuckNote = note;
    stuckDeclared = true;
    render(true);
  };

  // Hints ON: point at the best legal move (counts as assistance); a genuine
  // dead end ends the game as Stuck.
  const showHint = (): void => {
    if (!game || !container) return;
    selected = null;
    const h = bestHint();
    if (!h) {
      endStuck("No legal moves left — a genuine dead end.");
      return;
    }
    game.markAssistance();
    hint = h;
    setStatus(`Hint: ${describeHint(h)} (a hint counts as assistance)`);
    applySelectionStyles(); // clears any prior glow (selected is null)
    applyHintStyles();
    declare(); // the store must learn the assistance flag now, not at the next move
  };

  // Hints OFF: "I'm stuck" ends the game, honestly reporting whether a legal
  // move was still available when the player gave up.
  const declareStuck = (): void => {
    if (!game) return;
    endStuck(
      bestHint()
        ? "You ended the game while a legal move was still available."
        : "You ended the game — there were no legal moves left.",
    );
  };

  // --- what the frame shows: the deal chip, three meters, the verbs, setup, preferences ---
  const doUndo = (): void => {
    if (game!.undo()) {
      moveCount = Math.max(0, moveCount - 1);
      setStatus("Move undone (counts as assistance).");
    }
    selected = null;
    render(true);
  };
  const spec = (): GameFrameSpec => {
    const b = game?.board();
    const home = b ? b.foundations.reduce((n, f) => n + f, 0) : 0;
    const hints = hintsEnabled();
    return {
      title: "Solitaire",
      mode: mode === "daily" ? "Today’s deal" : "Free deal",
      meters: [
        { kind: "stat", id: "moves", value: moveCount, label: "moves" },
        { kind: "stat", id: "stock", value: b?.stockCount ?? 0, label: "in stock" },
        { kind: "stat", id: "home", value: `${home} / 52`, label: "home" },
      ],
      verbs: [
        { id: "undo", label: "Undo", icon: "↶", onPress: doUndo },
        // Hints on → "Hint" points at a legal move (counts as assistance); the verb
        // flips to "I'm stuck" (ends the game) when hints are off (§6).
        hints
          ? { id: "hint", label: "Hint", icon: "✦", primary: true, onPress: showHint }
          : { id: "stuck", label: "I’m stuck", icon: "⇥", onPress: declareStuck },
        { id: "new", label: "New deal", icon: "⟳", onPress: (btn) => frame?.openSheet("setup", btn) },
      ],
      setup: solitaireSetupRows(),
      preferences: [
        {
          kind: "toggle",
          id: "autoplay",
          label: "Auto-play safe cards to foundations",
          hint: "Obvious moves the core offers — a convenience, not assistance.",
          value: autoPlayEnabled(),
          onChange: (on) => setAutoPlay(on),
        },
      ],
      onStart: () => void startDeal(chosenMode),
    };
  };
  const declare = (): void => frame?.update(spec());

  const renderBoard = (board: BoardView): HTMLElement => {
    const boardEl = el("div", { class: "sol-board", tabindex: "-1" });

    const top = el("section", { class: "sol-top" });

    const stock = el("button", {
      type: "button",
      class: "sol-stock",
      "data-el": "stock",
      "aria-label":
        board.stockCount > 0
          ? `Stock, ${board.stockCount} cards. Draw one.`
          : "Stock empty. Tap to recycle the waste.",
    });
    stock.append(el("span", { class: "sol-pip" }, board.stockCount > 0 ? String(board.stockCount) : "↻"));

    const waste = el("div", { class: "sol-waste" });
    if (board.wasteTop) {
      waste.append(
        cardButton(board.wasteTop.suit, board.wasteTop.rank, { "data-el": "waste" }),
      );
    } else {
      // Decorative empty placeholder — the waste is never a drop target, so it
      // carries no accessible name (a generic element may not be aria-labelled).
      waste.append(el("div", { class: "sol-slot empty" }));
    }

    const foundations = el("div", { class: "sol-foundations", role: "group", "aria-label": "Foundations" });
    board.foundations.forEach((top4, suit) => {
      const label =
        top4 === 0
          ? `${SUIT_NAME[suit]} foundation, empty`
          : `${SUIT_NAME[suit]} foundation, top ${RANK_NAME[top4]}`;
      const f = el("button", {
        type: "button",
        class: `sol-foundation ${isRed(suit) ? "red" : "black"}`,
        "data-el": "foundation",
        "data-suit": String(suit),
        "aria-label": label,
      });
      f.append(
        el("span", { class: "sol-suit" }, SUIT_SYM[suit]!),
        el("span", { class: "sol-rank" }, top4 === 0 ? "" : RANK_SHORT[top4]!),
      );
      foundations.append(f);
    });

    top.append(stock, waste, foundations);

    const tableau = el("section", { class: "sol-tableau", role: "group", "aria-label": "Tableau" });
    board.tableau.forEach((pile, p) => {
      const col = el("div", { class: "sol-pile", "data-pile": String(p) });
      if (pile.length === 0) {
        col.append(
          el("button", {
            type: "button",
            class: "sol-slot empty",
            "data-el": "slot",
            "data-pile": String(p),
            "aria-label": `Empty pile ${p + 1}`,
          }),
        );
      } else {
        // Fan downward: face-down cards sit tight, face-up cards spread so each
        // rank+suit corner stays readable. `top` accumulates per card.
        let offset = 0;
        pile.forEach((slot, index) => {
          if (slot.faceUp && slot.card) {
            const c = cardButton(slot.card.suit, slot.card.rank, {
              "data-el": "card",
              "data-pile": String(p),
              "data-index": String(index),
              "data-faceup": "1",
            });
            c.style.top = `${offset}rem`;
            col.append(c);
            offset += 1.7;
          } else {
            const back = el("div", {
              class: "sol-card back",
              role: "img",
              "aria-label": "Face-down card",
            });
            back.style.top = `${offset}rem`;
            col.append(back);
            offset += 0.8;
          }
        });
      }
      tableau.append(col);
    });

    boardEl.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-el]");
      if (!btn) return;
      const ctx = ctxFromEl(btn);
      if (ctx) handleClick(ctx);
    });
    boardEl.addEventListener("dblclick", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-el]");
      if (!btn) return;
      const ctx = ctxFromEl(btn);
      if (ctx && (ctx.type === "waste" || ctx.type === "card")) autoToFoundation(ctx);
    });

    // Drag-and-drop (fast-follow): the same source→target resolution as tapping,
    // so the core still decides legality. Tapping remains the accessible floor.
    let dragSource: Source | null = null;
    boardEl.addEventListener("dragstart", (e: DragEvent) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-el="card"], [data-el="waste"]');
      const ctx = btn ? ctxFromEl(btn) : null;
      const src = ctx ? isSelectable(ctx) : null;
      if (!src) {
        e.preventDefault();
        return;
      }
      dragSource = src;
      selected = src;
      hint = null;
      applySelectionStyles(); // glow the legal drop targets
      e.dataTransfer?.setData("text/plain", "card");
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
    });
    boardEl.addEventListener("dragover", (e: DragEvent) => {
      if (dragSource) e.preventDefault(); // allow a drop; legality is checked on drop
    });
    boardEl.addEventListener("drop", (e: DragEvent) => {
      if (!dragSource) return;
      e.preventDefault();
      const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-el]");
      const ctx = btn ? ctxFromEl(btn) : null;
      const move = ctx ? findMove(dragSource, ctx) : null;
      dragSource = null;
      if (move) {
        applyMove(move);
      } else {
        selected = null;
        applySelectionStyles();
        setStatus("No legal move there.");
      }
    });
    boardEl.addEventListener("dragend", () => {
      if (!dragSource) return; // a successful drop already cleared it
      dragSource = null;
      selected = null;
      applySelectionStyles();
    });

    boardEl.append(top, tableau);
    return boardEl;
  };

  const applySelectionStyles = (): void => {
    if (!container) return;
    const root = container.querySelector<HTMLElement>(".sol-board");
    if (!root) return;
    root
      .querySelectorAll(".legal-target, .hint-from, .hint-to")
      .forEach((e) => e.classList.remove("legal-target", "hint-from", "hint-to"));
    root.querySelectorAll(".selected").forEach((e) => e.classList.remove("selected"));
    if (!selected) return;
    const selEl =
      selected.kind === "waste"
        ? root.querySelector('[data-el="waste"]')
        : root.querySelector(`[data-el="card"][data-pile="${selected.pile}"][data-index="${selected.index}"]`);
    selEl?.classList.add("selected");
    const { foundations, piles } = legalTargets(selected);
    for (const suit of foundations) {
      root.querySelector(`[data-el="foundation"][data-suit="${suit}"]`)?.classList.add("legal-target");
    }
    for (const p of piles) {
      const slot = root.querySelector(`[data-el="slot"][data-pile="${p}"]`);
      if (slot) {
        slot.classList.add("legal-target");
      } else {
        const cards = root.querySelectorAll(`[data-el="card"][data-pile="${p}"]`);
        cards[cards.length - 1]?.classList.add("legal-target");
      }
    }
  };

  // A brief celebratory cascade over the felt on a win. Decorative and
  // aria-hidden; skipped under reduced-motion; removed on unmount.
  const playCascade = (): void => {
    try {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    } catch {
      return;
    }
    const glyphs = ["♣", "♦", "♥", "♠"];
    const layer = el("div", { class: "sol-cascade", "aria-hidden": "true" });
    for (let i = 0; i < 24; i += 1) {
      const s = el("span", {}, glyphs[i % 4]!);
      if (i % 4 === 1 || i % 4 === 2) s.className = "red";
      s.style.left = `${(i * 4.15) % 100}%`;
      s.style.animationDelay = `${(i % 8) * 0.08}s`;
      layer.append(s);
    }
    document.body.append(layer);
    cascadeEl = layer;
    setTimeout(() => {
      layer.remove();
      if (cascadeEl === layer) cascadeEl = null;
    }, 1900);
  };

  const presentResult = async (kind: "won" | "stuck"): Promise<void> => {
    if (!container || !game) return;
    if (kind === "won") playCascade();
    const env = game.outcome(
      kind === "stuck" ? "stuck" : "abandoned",
      declareAssistanceEnabled(),
    ) as OutcomeEnvelope;
    container.replaceChildren(el("div", { class: "sol-loading" }, "Preparing your verifiable result…"));
    const shareUrl = await shareUrlFor(env);
    if (disposed || !container) return;
    const note = kind === "stuck" ? stuckNote : undefined;
    const build = (): HTMLElement =>
      renderResultScreen(env, verify(env), {
        shareUrl,
        note,
        onReverify: () => container!.replaceChildren(build()),
        onPlayAgain: () => void startDeal(mode),
      });
    container.replaceChildren(build());
    declare();
  };

  function render(focusBoard = false): void {
    if (disposed || !container || !game) return;
    if (game.isWon()) {
      void presentResult("won");
      return;
    }
    if (stuckDeclared) {
      void presentResult("stuck");
      return;
    }
    container.replaceChildren(renderBoard(game.board()), statusEl);
    applySelectionStyles();
    if (focusBoard) container.querySelector<HTMLElement>(".sol-board")?.focus();
    declare();
  }

  async function startDeal(nextMode: "daily" | "free", seedOverride?: bigint): Promise<void> {
    if (!game || disposed) return;
    if (nextMode === "daily" && seedOverride === undefined) {
      if (!pack) {
        try {
          pack = await fetchPack();
        } catch {
          showDailyError();
          return;
        }
        if (disposed) return;
      }
      seed = dailySeed(pack, new Date());
    } else {
      seed = seedOverride ?? randomSeed();
    }
    mode = nextMode;
    chosenMode = nextMode;
    stuckDeclared = false;
    stuckNote = "";
    selected = null;
    hint = null;
    moveCount = 0;
    setStatus("");
    game.newGame(seed);
    exposeHook();
    render();
  }

  /** Replay a stored deal: the seed, every move, and the assistance flag. */
  const applyResume = (p: Progress): void => {
    if (!game || disposed) return;
    const rec = p.record as { seed?: unknown; moves?: unknown; assistance?: unknown };
    mode = p.setup.mode.startsWith("daily:") ? "daily" : "free";
    chosenMode = mode;
    stuckDeclared = false;
    stuckNote = "";
    selected = null;
    hint = null;
    seed = typeof rec.seed === "string" ? BigInt(rec.seed) : randomSeed();
    game.newGame(seed);
    moveCount = 0;
    for (const m of Array.isArray(rec.moves) ? (rec.moves as SolMove[]) : []) {
      if (game.play(m) !== "applied") break;
      moveCount += 1;
    }
    if (rec.assistance === true) game.markAssistance();
    setStatus("");
    exposeHook();
    render();
  };

  const fetchPack = async (): Promise<DealPack> => {
    const res = await fetch("/daily-pack.json");
    if (!res.ok) throw new Error(`daily-pack.json: ${res.status}`);
    return (await res.json()) as DealPack;
  };

  const showDailyError = (): void => {
    if (!container) return;
    const box = el("div", { class: "sol-error" });
    box.append(
      el("p", {}, "Today’s deal could not be loaded."),
      (() => {
        const b = el("button", { type: "button", class: "sol-mode-free" }, "Play free instead");
        b.addEventListener("click", () => void startDeal("free"));
        return b;
      })(),
    );
    container.replaceChildren(box);
  };

  const showShared = async (payload: string): Promise<void> => {
    if (!container) return;
    let env: OutcomeEnvelope;
    try {
      env = await decodeRecord(payload);
    } catch {
      container.replaceChildren(
        el("div", { class: "sol-error" }, "This shared result could not be read."),
      );
      return;
    }
    if (disposed || !container) return;
    const build = (): HTMLElement =>
      renderResultScreen(env, verify(env), {
        shared: true,
        onReverify: () => container!.replaceChildren(build()),
        onPlayAgain: () => {
          location.href = location.pathname;
        },
      });
    container.replaceChildren(build());
  };

  const exposeHook = (): void => {
    if (!game) return;
    window.__solitaire = {
      game,
      refresh: () => render(),
      legalMoves: () => game!.legalMoves(),
      seed,
    };
  };

  return {
    mount(c: HTMLElement, services?: GameServices): void {
      container = c;
      frame = services?.frame ?? null;
      disposed = false;
      // Hints on/off is an "Every game" row of the frame's sheet; it relabels this
      // game's verb, so re-render when it changes.
      frame?.onSettingsChange(() => render());
      declare();
      container.replaceChildren(el("div", { class: "sol-loading" }, "Loading solitaire…"));
      void (async () => {
        try {
          game = await Solitaire.load();
          verifier = await Solitaire.load();
        } catch {
          if (!disposed && container) {
            container.replaceChildren(
              el("div", { class: "sol-error" }, "Could not load the game engine."),
            );
          }
          return;
        }
        if (disposed) return;

        const url = new URL(location.href);
        const shared = url.searchParams.get("r");
        if (shared) {
          await showShared(shared);
          return;
        }
        if (pendingResume) {
          const p = pendingResume;
          pendingResume = null;
          applyResume(p);
          return;
        }
        const seedParam = url.searchParams.get("seed");
        if (seedParam !== null) {
          await startDeal("free", BigInt(seedParam));
          return;
        }
        await startDeal(chosenMode);
      })();
    },
    unmount(): void {
      disposed = true;
      delete window.__solitaire;
      cascadeEl?.remove();
      cascadeEl = null;
      container?.replaceChildren();
      container = null;
      frame = null;
      game = null;
      verifier = null;
      selected = null;
    },
    // --- the progress store: the seed and the core's own move list; resume is replay ---
    snapshot(): Progress {
      const env = game ? (game.outcome("abandoned", declareAssistanceEnabled()) as OutcomeEnvelope) : null;
      const b = game?.board();
      const home = b ? b.foundations.reduce((n, f) => n + f, 0) : 0;
      const now = new Date().toISOString();
      const done = (game?.isWon() ?? false) || stuckDeclared;
      return {
        v: 1,
        status: done ? "finished" : "in-progress",
        startedAt: now,
        updatedAt: now,
        setup: { mode: mode === "daily" ? `daily:${today(new Date())}` : "free", seed: seed.toString() },
        record: { seed: seed.toString(), moves: env?.payload.moves ?? [], assistance: env?.payload.assistance === true },
        summary: {
          line: done
            ? game?.isWon()
              ? `Cleared in ${moveCount} moves`
              : `Stuck after ${moveCount} moves`
            : `${moveCount} move${moveCount === 1 ? "" : "s"} · ${home} of 52 home`,
        },
      };
    },
    resume(p: Progress): void {
      if (game) applyResume(p);
      else pendingResume = p;
    },
  };
}
