//! Chess over the `chess-wasm` binding: a tap-to-play two-player game against
//! the shelf's engine. You pick your colour (♙ white opens, ♟ black, or a coin),
//! tap a piece to see where it can go, and tap a destination to move. Castling
//! is the king's two-square tap; en passant is offered where it is legal; a
//! promotion opens a picker. **The Engine** replies. A finished game is a
//! verifiable `pond-outcome` record, shareable via `?r=`.
//!
//! The core decides everything about legality: the UI only ever offers the
//! moves `board().legal` lists and plays the code it picked. The board is
//! shown from the human's side — one pure function, [`viewSquare`], is the
//! whole of that geometry; the core's squares never move.

import type { GameModule, GameServices } from "../../contract.js";
import type { GameFrame, GameFrameSpec, Verb } from "../../game-frame.js";
import type { Progress } from "../../progress.js";
import type { SettingRow } from "../../settings-sheet.js";
import { captureUiState, restoreUiState } from "../../ui-state.js";
import {
  chessLevel,
  chessSide,
  hintsEnabled,
  setChessLevel,
  setChessSide,
  type ChessLevel,
  type ChessSide,
} from "../../settings.js";
import {
  decodeRecord,
  encodeRecord,
  verifyRecord,
  type ChessEnvelope,
  type VerifyResult,
} from "./chess-outcome.js";
import { Chess, type BoardView, type LegalMove, type SideCode } from "./chess-wasm.js";

declare global {
  interface Window {
    /** E2E hook: the live binding + a re-render, so tests drive the core. */
    __chess?: {
      game: Chess;
      refresh: () => void;
      seed: bigint;
    };
  }
}

/** The opponent's identity — honest: it is the shelf's engine. */
const OPPONENT = { name: "The Engine", avatar: "🤖" } as const;

/**
 * The beats: the engine's think and the fanfare before the result. `?fast=1`
 * collapses them to a frame — for the browser suite, whose full-game test
 * asserts rules and wiring, not pacing.
 */
const BEATS = { think: 420, fanfare: 1400 } as const;
const FAST_BEATS = { think: 16, fanfare: 60 } as const;
let beats: { think: number; fanfare: number } = BEATS;
const LEVELS: readonly ChessLevel[] = ["Easy", "Medium", "Hard", "Expert"];

/** The seat the human actually sits in this game (the stored side, resolved). */
export type Seat = "white" | "black";

/**
 * The board square shown at view position `view` (view positions are numbered
 * like squares: 0 = the bottom-left cell). Unflipped is the identity; flipped
 * turns the board 180° so Black's pieces are at the bottom. Pinned by
 * `tests/chess-view.test.ts`.
 */
export function viewSquare(view: number, flipped: boolean): number {
  return flipped ? 63 - view : view;
}

/** `"e4"` for square 28. */
export const squareName = (sq: number): string =>
  `${"abcdefgh"[sq % 8]}${Math.floor(sq / 8) + 1}`;

/** The `(from, to)` a packed move code names — the UI reads codes, never builds them. */
const fromTo = (code: number): [number, number] => [code & 63, (code >> 6) & 63];

const KIND_NAMES = ["", "pawn", "knight", "bishop", "rook", "queen", "king"] as const;
/** One glyph per kind (the filled shapes, coloured by CSS for both sides). */
const GLYPHS = ["", "♟", "♞", "♝", "♜", "♛", "♚"] as const;
const PROMO_KINDS: readonly { promo: number; glyph: string; name: string }[] = [
  { promo: 4, glyph: "♛", name: "queen" },
  { promo: 3, glyph: "♜", name: "rook" },
  { promo: 2, glyph: "♝", name: "bishop" },
  { promo: 1, glyph: "♞", name: "knight" },
];

const ownerOf = (v: number): 0 | SideCode => (v === 0 ? 0 : (v & 8) === 0 ? 1 : 2);
const kindOf = (v: number): number => v & 7;

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

// ---------- the result screen (pure DOM) ----------

interface ResultScreenOpts {
  label: string;
  finalBoard: HTMLElement;
  shareUrl?: string;
  onReverify?: () => void;
  onPlayAgain?: () => void;
  shared?: boolean;
}

/** The chess result screen: outcome headline, verification badge, the final
 *  board, the record, and controls. Reuses the shared `sol-*` styling. */
function renderResultScreen(
  env: ChessEnvelope,
  verification: VerifyResult,
  opts: ResultScreenOpts,
): HTMLElement {
  const rec = env.payload;
  const section = el("section", { class: "sol-result", role: "region", "aria-label": "Result" });
  section.append(
    el(
      "h2",
      { class: "sol-headline" },
      verification.ok
        ? `${opts.label} — verifiable`
        : "Verification FAILED — this result does not check out",
    ),
  );
  const badge = el("p", {
    class: `sol-verify-badge ${verification.ok ? "ok" : "fail"}`,
    role: "status",
  });
  badge.textContent = verification.ok
    ? "Verified ✓ — re-checked by replaying every move against the core."
    : `Verification failed — expected hash ${verification.expected}, replay produced ${verification.actual}.`;
  section.append(badge, opts.finalBoard);

  const dl = el("dl", { class: "sol-record" });
  const row = (term: string, value: string, cls = ""): void => {
    dl.append(el("dt", {}, term), el("dd", cls ? { class: cls } : {}, value));
  };
  row("Result", opts.label);
  row("Moves", String(rec.move_count));
  row("Seed", String(rec.seed));
  row("Final hash", rec.final_hash, "sol-hash");
  section.append(dl);

  const controls = el("div", { class: "sol-result-controls" });
  if (opts.onReverify) {
    const b = el("button", { type: "button", class: "sol-reverify" }, "Re-verify");
    b.addEventListener("click", opts.onReverify);
    controls.append(b);
  }
  if (opts.shareUrl) {
    controls.append(
      el("a", { class: "sol-share", href: opts.shareUrl, "data-share": opts.shareUrl }, "Share this result"),
    );
  }
  if (opts.onPlayAgain) {
    const b = el("button", { type: "button", class: "sol-again" }, opts.shared ? "Play a game" : "Play again");
    b.addEventListener("click", opts.onPlayAgain);
    controls.append(b);
  }
  if (controls.childNodes.length) section.append(controls);
  return section;
}

// ---------- the game module ----------

/** The New game card: difficulty and which colour you play. One builder for the poster and the sheet. */
export function chessSetupRows(onChange?: {
  level?(l: ChessLevel): void;
  side?(s: ChessSide): void;
}): SettingRow[] {
  return [
    {
      kind: "choice",
      id: "level",
      label: "Difficulty",
      hint: "A searching engine; chess is unsolved, so Expert is the deepest search, not a proof.",
      value: chessLevel(),
      options: LEVELS.map((l) => ({ value: l, label: l })),
      onChange: (v) => {
        setChessLevel(v as ChessLevel);
        onChange?.level?.(v as ChessLevel);
      },
    },
    {
      kind: "choice",
      id: "side",
      label: "You play",
      value: chessSide(),
      options: [
        { value: "white", label: "♙ White, opens" },
        { value: "black", label: "♟ Black" },
        { value: "random", label: "Random" },
      ],
      onChange: (v) => {
        setChessSide(v as ChessSide);
        onChange?.side?.(v as ChessSide);
      },
    },
  ];
}

/** The poster's setup card — the registry's `setup` factory. */
export const chessSetup = (): SettingRow[] => chessSetupRows();

/** Construct a fresh chess module (the registry `load`). */
export function chessModule(): GameModule {
  let game: Chess | null = null;
  let verifier: Chess | null = null;
  let container: HTMLElement | null = null;
  let disposed = false;
  let thinking = false;
  let frame: GameFrame | null = null;
  let pendingResume: Progress | null = null;
  let moves: number[] = [];
  let hinted = false;
  let ending = false;
  let seed = 0n;
  let level: ChessLevel = chessLevel();
  let side: ChessSide = chessSide();
  let seat: Seat = side === "black" ? "black" : "white";
  // The in-progress tap: the piece picked up.
  let selected: number | null = null;
  // A promotion waiting for its piece: the four codes for one (from, to).
  let pendingPromotion: { from: number; to: number; options: LegalMove[] } | null = null;
  // The Hint ring, until the next move.
  let hint: [number, number] | null = null;

  /** The side value the human plays: 1 (white, opens) or 2 (black). */
  const humanSide = (): SideCode => (seat === "white" ? 1 : 2);
  const flipped = (): boolean => seat === "black";

  const statusEl = el("p", { class: "chess-status", role: "status", "aria-live": "polite" });
  const setStatus = (msg: string): void => {
    statusEl.textContent = msg;
  };

  const randomSeed = (): bigint => {
    const buf = new Uint32Array(2);
    crypto.getRandomValues(buf);
    return (BigInt(buf[0]!) << 16n) ^ BigInt(buf[1]! & 0xffff);
  };

  const shareUrlFor = async (env: ChessEnvelope): Promise<string> =>
    `${location.origin}${location.pathname}?r=${await encodeRecord(env)}`;
  const verify = (env: ChessEnvelope): VerifyResult => verifyRecord(verifier!, env);

  const gameOver = (): boolean => (game ? game.board().result !== -1 : false);
  const humanToMove = (): boolean => (game ? game.board().toMove === humanSide() : false);

  /** Play a move code; the binding remembers the last move and its SAN. */
  const applyMove = (code: number): boolean => {
    if (!game) return false;
    if (game.play(code) !== "applied") return false;
    moves.push(code);
    selected = null;
    pendingPromotion = null;
    hint = null;
    return true;
  };

  // --- turn loop: after any move, let the engine reply until it is the human's
  // turn again, or the game ends. ---
  const step = (): void => {
    if (disposed || !game || !container) return;
    if (gameOver()) {
      finish();
      return;
    }
    if (humanToMove()) {
      thinking = false;
      render();
      return;
    }
    thinking = true;
    render();
    window.setTimeout(() => {
      if (disposed || !game) return;
      const mv = game.liveMove(level);
      if (mv !== null) applyMove(mv);
      thinking = false;
      step();
    }, beats.think);
  };

  /** A tap on a square: pick a piece up, move it, or open the promotion picker. */
  const tapSquare = (sq: number): void => {
    if (!game || thinking || ending || gameOver() || !humanToMove() || pendingPromotion) return;
    const legal = game.board().legal; // the core decides legality, always
    if (selected !== null) {
      const options = legal.filter((m) => m.from === selected && m.to === sq);
      if (options.length === 1) {
        if (applyMove(options[0]!.code)) {
          setStatus("");
          step();
        }
        return;
      }
      if (options.length > 1) {
        // A promotion: the same (from, to) four ways. The picker decides.
        pendingPromotion = { from: selected, to: sq, options };
        render();
        return;
      }
      if (sq === selected) {
        selected = null;
        render();
        return;
      }
    }
    // Otherwise: pick up a piece, but only one the core offers a move for.
    if (!legal.some((m) => m.from === sq)) {
      selected = null;
      render();
      return;
    }
    selected = sq;
    render();
  };

  const choosePromotion = (promo: number): void => {
    if (!pendingPromotion) return;
    const pick = pendingPromotion.options.find((m) => m.promo === promo);
    pendingPromotion = null;
    if (pick && applyMove(pick.code)) {
      setStatus("");
      step();
    } else {
      render();
    }
  };

  const cancelPromotion = (): void => {
    if (!pendingPromotion) return;
    // Cancelling puts the piece down too: the next tap on it picks it up again
    // rather than deselecting (the picker test caught the other reading).
    pendingPromotion = null;
    selected = null;
    render();
  };

  /** Undo takes back a pair of plies — yours and The Engine's — and is assistance. */
  const undo = (): void => {
    if (!game || thinking || ending || gameOver() || !humanToMove() || moves.length < 2) return;
    const keep = moves.slice(0, -2);
    game.newGame(seed);
    moves = [];
    for (const code of keep) applyMove(code);
    game.markAssistance();
    selected = null;
    hint = null;
    setStatus("");
    render();
  };

  /** Hint rings the coach's best move and names it — assistance, declared. */
  const showHint = (): void => {
    if (!game || thinking || ending || gameOver() || !humanToMove()) return;
    const report = game.coach();
    if (report.bestCol === null) return;
    hint = fromTo(report.bestCol);
    game.markAssistance();
    frame?.toast(`Try ${game.san(report.bestCol)}`, 4000);
    render();
  };

  // ---------- rendering ----------

  const pieceNode = (v: number): HTMLElement =>
    el(
      "span",
      { class: `chess-piece ${ownerOf(v) === 1 ? "a" : "b"}`, "aria-hidden": "true" },
      GLYPHS[kindOf(v)] ?? "",
    );

  const describe = (v: number): string =>
    v === 0 ? "empty" : `${ownerOf(v) === 1 ? "white" : "black"} ${KIND_NAMES[kindOf(v)]}`;

  const kingSquare = (board: BoardView, who: SideCode): number =>
    board.cells.findIndex((v) => ownerOf(v) === who && kindOf(v) === 6);

  const buildBoard = (board: BoardView, interactive: boolean): HTMLElement => {
    const boardEl = el("div", {
      class: `chess-board${interactive ? "" : " chess-final"}`,
      role: "group",
      "aria-label": interactive ? "Chess board" : "Final board",
    });
    const canPlay =
      interactive && !thinking && !ending && !gameOver() && humanToMove() && !pendingPromotion;
    const targets = new Set(
      canPlay && selected !== null
        ? board.legal.filter((m) => m.from === selected).map((m) => m.to)
        : [],
    );
    const checked = board.inCheck ? kingSquare(board, board.toMove) : -1;
    const [lastFrom, lastTo] = board.lastMove === null ? [-1, -1] : fromTo(board.lastMove);
    const flip = flipped();
    // View rows from the top: view rank 7 down to 0, files left to right.
    for (let vr = 7; vr >= 0; vr -= 1) {
      for (let vf = 0; vf < 8; vf += 1) {
        const view = vr * 8 + vf;
        const sq = viewSquare(view, flip);
        const v = board.cells[sq]!;
        const file = sq % 8;
        const rank = Math.floor(sq / 8);
        const isTarget = targets.has(sq);
        const canPick = canPlay && board.legal.some((m) => m.from === sq);
        const marks = [
          (file + rank) % 2 === 0 ? " dark" : " light",
          isTarget ? " target" : "",
          isTarget && v !== 0 ? " occupied" : "",
          canPick ? " selectable" : "",
          selected === sq ? " selected" : "",
          interactive && (lastFrom === sq || lastTo === sq) ? " just-played" : "",
          interactive && hint !== null && (hint[0] === sq || hint[1] === sq) ? " hint" : "",
          checked === sq ? " check" : "",
        ].join("");
        const attrs: Record<string, string> = {
          type: "button",
          class: `chess-square${marks}`,
          "data-sq": String(sq),
          "data-view": String(view),
          "aria-label": isTarget
            ? `Move to ${squareName(sq)}`
            : `${squareName(sq)}, ${describe(v)}${checked === sq ? ", in check" : ""}`,
        };
        // The edge labels ride on the outer view row/column, so a flipped board labels itself.
        if (vr === 0) attrs["data-file"] = "abcdefgh"[file]!;
        if (vf === 0) attrs["data-rank"] = String(rank + 1);
        boardEl.append(el("button", attrs, v ? pieceNode(v) : ""));
      }
    }
    if (interactive) {
      boardEl.addEventListener("click", (e) => {
        const cell = (e.target as HTMLElement).closest<HTMLElement>(".chess-square");
        if (cell?.dataset.sq) tapSquare(Number(cell.dataset.sq));
      });
      // Arrow keys walk the view grid; Enter/Space is the button's own tap.
      boardEl.addEventListener("keydown", (e) => {
        const cell = (e.target as HTMLElement).closest<HTMLElement>(".chess-square");
        if (!cell?.dataset.view) return;
        const view = Number(cell.dataset.view);
        const delta: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: 8, ArrowDown: -8 };
        const d = delta[e.key];
        if (d === undefined) return;
        const next = view + d;
        if (next < 0 || next > 63) return;
        if ((d === 1 && view % 8 === 7) || (d === -1 && view % 8 === 0)) return;
        e.preventDefault();
        boardEl.querySelector<HTMLElement>(`[data-view="${next}"]`)?.focus();
      });
    }
    return boardEl;
  };

  const buildPicker = (): HTMLElement => {
    const scrim = el("div", { class: "chess-picker", role: "dialog", "aria-label": "Promote to" });
    const card = el("div", { class: "chess-picker-card" });
    for (const k of PROMO_KINDS) {
      const b = el(
        "button",
        { type: "button", "data-promo": String(k.promo), "aria-label": `Promote to ${k.name}` },
        k.glyph,
      );
      b.addEventListener("click", () => choosePromotion(k.promo));
      card.append(b);
    }
    scrim.addEventListener("click", (e) => {
      if (e.target === scrim) cancelPromotion();
    });
    scrim.addEventListener("keydown", (e) => {
      if (e.key === "Escape") cancelPromotion();
    });
    scrim.append(card);
    queueMicrotask(() => card.querySelector<HTMLElement>("button")?.focus());
    return scrim;
  };

  const materialLine = (board: BoardView): string => {
    const you = board.captured[humanSide() - 1]!;
    const them = board.captured[2 - humanSide()]!;
    const diff = you - them;
    return diff === 0 ? "level" : diff > 0 ? `you're up ${diff}` : `you're down ${-diff}`;
  };

  // --- what the frame shows: seats, the level chip, the verbs, setup ---
  const spec = (): GameFrameSpec => {
    const b = game?.board();
    const opp = OPPONENT;
    const live = b !== undefined && b.result === -1;
    const humanTurn = live && b.toMove === humanSide();
    const engineThinking = live && !humanTurn && thinking;
    const youScore = b ? b.captured[humanSide() - 1]! : 0;
    const themScore = b ? b.captured[2 - humanSide()]! : 0;
    const canUndo = live && humanTurn && !thinking && !ending && moves.length >= 2;
    const canHint = live && humanTurn && !thinking && !ending;
    const verbs: Verb[] = [
      { id: "undo", label: "Undo", icon: "↶", disabled: !canUndo, onPress: () => undo() },
      ...(hintsEnabled()
        ? [{ id: "hint", label: "Hint", icon: "✦", disabled: !canHint, onPress: () => showHint() }]
        : []),
      { id: "new", label: "New game", icon: "⟳", onPress: (btn: HTMLButtonElement) => frame?.openSheet("setup", btn) },
    ];
    // The sub-lines: "your move" / "check!" on the human's seat, "thinking…" on
    // the engine's, and the last move's SAN under whoever just played — the
    // frame reserves the line, so nothing above the board changes height.
    const lastByHuman = b?.lastMove !== null && b !== undefined && b.toMove !== humanSide();
    const youSub = humanTurn && !thinking ? (b.inCheck ? "check!" : "your move") : lastByHuman ? (b?.lastSan ?? "") : "";
    const engineSub = engineThinking ? "thinking…" : live && !lastByHuman ? (b?.lastSan ?? "") : "";
    return {
      title: "Chess",
      mode: level,
      meters: [
        {
          kind: "seat",
          id: "you",
          name: "You",
          glyph: seat === "white" ? "♙" : "♟",
          score: youScore,
          state: humanTurn && !thinking ? "active" : "idle",
          ...(youSub ? { sub: youSub } : {}),
        },
        {
          kind: "seat",
          id: "engine",
          name: `${opp.name} ${opp.avatar}`,
          glyph: seat === "white" ? "♟" : "♙",
          score: themScore,
          state: engineThinking ? "thinking" : "idle",
          ...(engineSub ? { sub: engineSub } : {}),
        },
      ],
      verbs,
      setup: chessSetupRows({
        level: (l) => {
          level = l;
        },
        side: (sd) => {
          side = sd;
        },
      }),
      preferences: [],
      onStart: () => void startGame(),
    };
  };
  const declare = (): void => frame?.update(spec());

  function render(): void {
    if (disposed || !container || !game) return;
    const board = game.board();
    const parts: (Node | string)[] = [buildBoard(board, true), statusEl];
    if (pendingPromotion) parts.push(buildPicker());
    // The player owns the focus; the model does not.
    const ui = captureUiState(container);
    container.replaceChildren(el("div", { class: "chess-game" }, ...parts));
    restoreUiState(container, ui);
    declare();
    if (!hinted && moves.length <= 1 && humanToMove() && !thinking) {
      hinted = true;
      frame?.toast("Tap a piece, then tap where it goes — only legal moves light up.", 5000);
    }
  }

  const outcomeLabel = (board: BoardView): string => {
    const code = board.result;
    if (code === 0) return "A draw";
    if (code === -1) return "Ended early";
    return code === humanSide() ? "You won" : `${OPPONENT.name} won`;
  };

  const finish = (): void => {
    if (!game || !container) return;
    ending = true;
    const board = game.board();
    const label = outcomeLabel(board);
    const decisive = board.result === 1 || board.result === 2;
    const flash = el(
      "p",
      { class: `chess-flash${board.result === humanSide() ? " win" : ""}`, role: "status" },
      decisive ? `Checkmate — ${label}` : "Draw",
    );
    // The fanfare sits BELOW the final board; rule 1 holds to the end.
    container.replaceChildren(el("div", { class: "chess-game" }, buildBoard(board, false), flash));
    declare();
    window.setTimeout(() => {
      if (disposed) return;
      void presentResult();
    }, beats.fanfare);
  };

  const presentResult = async (): Promise<void> => {
    if (!container || !game) return;
    const env = game.outcome(true) as ChessEnvelope;
    const board = game.board();
    const label = outcomeLabel(board);
    container.replaceChildren(el("div", { class: "sol-loading" }, "Preparing your verifiable result…"));
    const shareUrl = await shareUrlFor(env);
    if (disposed || !container) return;
    const build = (): HTMLElement =>
      renderResultScreen(env, verify(env), {
        label,
        finalBoard: buildBoard(board, false),
        shareUrl,
        onReverify: () => container!.replaceChildren(build()),
        onPlayAgain: () => void startGame(),
      });
    container.replaceChildren(build());
  };

  const resolveSeat = (s: bigint): Seat =>
    side === "random" ? ((s & 1n) === 1n ? "black" : "white") : side;

  async function startGame(seedOverride?: bigint): Promise<void> {
    if (!game || disposed) return;
    thinking = false;
    ending = false;
    selected = null;
    pendingPromotion = null;
    hint = null;
    seed = seedOverride ?? randomSeed();
    seat = resolveSeat(seed);
    game.newGame(seed);
    moves = [];
    hinted = false;
    setStatus("");
    exposeHook();
    step(); // if the human plays Black, the engine (White) opens here
  }

  /** Replay a stored game: the seed and every move code, then re-enter the turn loop. */
  const applyResume = (p: Progress): void => {
    if (!game || disposed) return;
    const rec = p.record as { seed?: unknown; moves?: unknown };
    const setup = p.setup as { level?: unknown; seat?: unknown };
    if (LEVELS.includes(setup.level as ChessLevel)) level = setup.level as ChessLevel;
    if (setup.seat === "black" || setup.seat === "white") seat = setup.seat;
    thinking = false;
    ending = false;
    selected = null;
    pendingPromotion = null;
    hint = null;
    hinted = true;
    seed = typeof rec.seed === "string" ? BigInt(rec.seed) : randomSeed();
    game.newGame(seed);
    moves = [];
    for (const code of Array.isArray(rec.moves) ? (rec.moves as unknown[]) : []) {
      if (typeof code !== "number" || !applyMove(code)) break;
    }
    setStatus("");
    exposeHook();
    step();
  };

  const showShared = async (payload: string): Promise<void> => {
    if (!container) return;
    let env: ChessEnvelope;
    try {
      env = await decodeRecord(payload);
    } catch {
      container.replaceChildren(el("div", { class: "sol-error" }, "This shared result could not be read."));
      return;
    }
    if (disposed || !container) return;
    const verification = verify(env);
    const board = verifier!.board();
    const label = outcomeLabel(board);
    const build = (): HTMLElement =>
      renderResultScreen(env, verification, {
        label,
        finalBoard: buildBoard(board, false),
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
    window.__chess = { game, refresh: () => render(), seed };
  };

  return {
    mount(c: HTMLElement, services?: GameServices): void {
      container = c;
      frame = services?.frame ?? null;
      disposed = false;
      level = chessLevel();
      side = chessSide();
      seat = side === "black" ? "black" : "white";
      declare();
      container.replaceChildren(el("div", { class: "sol-loading" }, "Loading chess…"));
      void (async () => {
        try {
          game = await Chess.load();
          verifier = await Chess.load();
        } catch {
          if (!disposed && container) {
            container.replaceChildren(el("div", { class: "sol-error" }, "Could not load the game engine."));
          }
          return;
        }
        if (disposed) return;
        const url = new URL(location.href);
        beats = url.searchParams.get("fast") === "1" ? FAST_BEATS : BEATS;
        const shared = url.searchParams.get("r");
        if (shared) {
          await showShared(shared);
          return;
        }
        if (pendingResume) {
          const p = pendingResume;
          pendingResume = null;
          applyResume(p);
        } else {
          const seedParam = url.searchParams.get("seed");
          await startGame(seedParam !== null ? BigInt(seedParam) : undefined);
        }
      })();
    },
    unmount(): void {
      disposed = true;
      delete window.__chess;
      container?.replaceChildren();
      container = null;
      frame = null;
      game = null;
      verifier = null;
    },
    // --- the progress store: the seed and the move codes; resume is replay ---
    snapshot(): Progress {
      const b = game?.board();
      const now = new Date().toISOString();
      const done = gameOver();
      return {
        v: 1,
        status: done ? "finished" : "in-progress",
        startedAt: now,
        updatedAt: now,
        setup: { mode: "free", seed: seed.toString(), level, seat },
        record: { seed: seed.toString(), moves: [...moves] },
        summary: {
          line: done && b ? outcomeLabel(b) : `Move ${Math.floor(moves.length / 2) + 1} · ${b ? materialLine(b) : "level"}`,
        },
      };
    },
    resume(p: Progress): void {
      if (game) applyResume(p);
      else pendingResume = p;
    },
  };
}
