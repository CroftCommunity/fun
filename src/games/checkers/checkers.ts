//! Checkers (English draughts) over the `checkers-wasm` binding: a tap-to-play
//! two-player game against the shelf's engine. You pick your men (● black opens,
//! or ○ white), tap a man to see where it can go, and tap a destination to move.
//! Capture is mandatory — when a jump exists the core offers nothing else — and a
//! multi-jump is tapped one landing at a time. **The Engine** replies. A finished
//! match is a verifiable `pond-outcome` record, shareable via `?r=`.
//!
//! The core decides everything about legality. The UI's only job with a jump
//! chain is to *filter* the core's own chains by the landings tapped so far
//! ([`chainStep`]) and commit a complete one; if it ever computed a jump itself
//! that would be a defect regardless of whether it worked.
//!
//! Board geometry mirrors `checkers_core::board`: 32 playable dark squares, index
//! `i` at row `i / 4`, column `2 * (i % 4) + (row even ? 1 : 0)`. Row 0 is the
//! top, which is where Side A (black) starts and away from which it advances.

import type { GameModule } from "../../contract.js";
import {
  checkersLevel,
  checkersSide,
  setCheckersLevel,
  setCheckersSide,
  type CheckersLevel,
  type CheckersSide,
} from "../../settings.js";
import {
  decodeRecord,
  encodeRecord,
  verifyRecord,
  type CheckersEnvelope,
  type VerifyResult,
} from "./checkers-outcome.js";
import { Checkers, type BoardView, type LegalMove, type SideCode } from "./checkers-wasm.js";

declare global {
  interface Window {
    /** E2E hook: the live binding + a re-render, so tests drive the core. */
    __checkers?: {
      game: Checkers;
      refresh: () => void;
      seed: bigint;
    };
  }
}

/** The opponent's identity — honest: it is the shelf's engine. */
const OPPONENT = { name: "The Engine", avatar: "🤖" } as const;

const THINK_MS = 420;
const FANFARE_MS = 1200;
const BOARD = 8;
const LEVELS: readonly CheckersLevel[] = ["Easy", "Medium", "Hard", "Expert"];

/** What the UI may offer next, given the landings tapped so far. */
export interface ChainStep {
  /** The squares that may be tapped next — each is some live chain's next landing. */
  targets: number[];
  /** The move code to commit now, or null while the chain is unfinished. */
  commit: number | null;
}

/**
 * The step-through jump-chain rule, as a pure filter over the core's chains.
 *
 * Given every legal move, the piece the player tapped, and the landings tapped
 * since, return the squares that may be tapped next and — only when the tapped
 * path is a whole chain with nothing continuing through it — the code to commit.
 *
 * A continuation is preferred over committing, so a partially expressed jump is
 * never played as a shorter one. (English draughts cannot actually produce a
 * legal chain that is a strict prefix of another legal chain — a jump must
 * continue while one is available — so this only decides an impossible case; it
 * decides it by asking rather than by guessing.)
 */
export function chainStep(
  moves: readonly LegalMove[],
  from: number,
  prefix: readonly number[],
): ChainStep {
  const live = moves.filter(
    (m) => m.from === from && prefix.every((sq, i) => m.path[i] === sq),
  );
  const targets = [
    ...new Set(
      live.filter((m) => m.path.length > prefix.length).map((m) => m.path[prefix.length]!),
    ),
  ];
  const whole = live.find((m) => m.path.length === prefix.length);
  return { targets, commit: targets.length === 0 && whole ? whole.code : null };
}

/** The dark-square index at `(row, col)`, or null on a light (unplayable) square. */
export function squareAt(row: number, col: number): number | null {
  return (row + col) % 2 === 0 ? null : row * 4 + Math.floor(col / 2);
}

/** The side that owns a cell value (0 empty, 1/2 = A man/king, 3/4 = B man/king). */
const ownerOf = (v: number): 0 | SideCode => (v === 0 ? 0 : v <= 2 ? 1 : 2);
const isKing = (v: number): boolean => v === 2 || v === 4;

/** Count a side's pieces (men and kings alike). */
function pieceCount(cells: readonly number[], side: SideCode): number {
  return cells.filter((v) => ownerOf(v) === side).length;
}

/** A human-readable square label, e.g. square 0 -> "row 1, column 2" (1-based). */
const squareLabel = (sq: number): string => {
  const row = Math.floor(sq / 4);
  const col = 2 * (sq % 4) + (row % 2 === 0 ? 1 : 0);
  return `row ${row + 1}, column ${col + 1}`;
};

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

/** Build the checkers result screen: outcome headline, verification badge, the
 *  final board, the record, and controls. Reuses the shared `sol-*` styling. */
function renderResultScreen(
  env: CheckersEnvelope,
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
      el(
        "a",
        { class: "sol-share", href: opts.shareUrl, "data-share": opts.shareUrl },
        "Share this result",
      ),
    );
  }
  if (opts.onPlayAgain) {
    const b = el(
      "button",
      { type: "button", class: "sol-again" },
      opts.shared ? "Play a game" : "Play again",
    );
    b.addEventListener("click", opts.onPlayAgain);
    controls.append(b);
  }
  if (controls.childNodes.length) section.append(controls);
  return section;
}

// ---------- the game module ----------

/** Construct a fresh checkers module (the registry `load`). */
export function checkersModule(): GameModule {
  let game: Checkers | null = null;
  let verifier: Checkers | null = null;
  let container: HTMLElement | null = null;
  let disposed = false;
  let thinking = false;
  let ending = false;
  let seed = 0n;
  let level: CheckersLevel = checkersLevel();
  let side: CheckersSide = checkersSide();
  // The in-progress tap: the piece picked up, and the landings tapped so far.
  let selected: number | null = null;
  let prefix: number[] = [];
  // The last move played (either side), highlighted so the reply is visible.
  let lastFrom: number | null = null;
  let lastTo: number | null = null;

  /** The side value the human plays: 1 (black, opens) or 2 (white). */
  const humanSide = (): SideCode => (side === "black" ? 1 : 2);

  const statusEl = el("p", { class: "sol-status", role: "status", "aria-live": "polite" });
  const setStatus = (msg: string): void => {
    statusEl.textContent = msg;
  };

  const randomSeed = (): bigint => {
    const buf = new Uint32Array(2);
    crypto.getRandomValues(buf);
    return (BigInt(buf[0]!) << 16n) ^ BigInt(buf[1]! & 0xffff);
  };

  const shareUrlFor = async (env: CheckersEnvelope): Promise<string> =>
    `${location.origin}${location.pathname}?r=${await encodeRecord(env)}`;
  const verify = (env: CheckersEnvelope): VerifyResult => verifyRecord(verifier!, env);

  const gameOver = (): boolean => (game ? game.board().result !== -1 : false);
  const humanToMove = (): boolean => (game ? game.board().toMove === humanSide() : false);

  /** Play a move code, remembering where it came from so the UI can show it. */
  const applyMove = (code: number): boolean => {
    if (!game) return false;
    const detail = game.board().legal.find((m) => m.code === code) ?? null;
    if (game.play(code) !== "applied") return false;
    lastFrom = detail?.from ?? null;
    lastTo = detail?.to ?? null;
    selected = null;
    prefix = [];
    return true;
  };

  // --- turn loop: after any move, let the engine reply until it is the human's
  // turn again, or the game ends. Checkers has no pass — a side with no legal
  // move has lost, and the core reports that as the result. ---
  const step = (): void => {
    if (disposed || !game || !container) return;
    if (gameOver()) {
      finish();
      return;
    }
    if (humanToMove()) {
      thinking = false;
      setStatus("");
      render(); // wait for the human's tap
      return;
    }
    thinking = true;
    setStatus(`${OPPONENT.name} is thinking…`);
    render();
    window.setTimeout(() => {
      if (disposed || !game) return;
      const mv = game.liveMove(level);
      if (mv !== null) applyMove(mv);
      thinking = false;
      step();
    }, THINK_MS);
  };

  /** A tap on a playable square: pick a piece up, extend a chain, or commit. */
  const tapSquare = (sq: number): void => {
    if (!game || thinking || ending || gameOver() || !humanToMove()) return;
    const moves = game.board().legal; // the core decides legality, always
    if (selected !== null) {
      const step0 = chainStep(moves, selected, prefix);
      if (step0.targets.includes(sq)) {
        prefix = [...prefix, sq];
        const next = chainStep(moves, selected, prefix);
        if (next.commit !== null) {
          if (applyMove(next.commit)) {
            setStatus("");
            step();
            return;
          }
        }
        setStatus("Keep jumping — tap the next landing.");
        render();
        return;
      }
      if (sq === selected) {
        selected = null;
        prefix = [];
        setStatus("");
        render();
        return;
      }
    }
    // Otherwise: pick up a piece, but only one the core offers a move for.
    if (!moves.some((m) => m.from === sq)) return;
    selected = sq;
    prefix = [];
    setStatus("");
    render();
  };

  // ---------- rendering ----------

  const pieceNode = (v: number): HTMLElement =>
    el(
      "span",
      {
        class: `checkers-piece ${ownerOf(v) === 1 ? "a" : "b"}${isKing(v) ? " king" : ""}`,
        "aria-hidden": "true",
      },
      isKing(v) ? "♛" : "",
    );

  const describe = (v: number): string =>
    v === 0
      ? "empty"
      : `${ownerOf(v) === humanSide() ? "your" : "the engine's"} ${isKing(v) ? "king" : "man"}`;

  const buildBoard = (board: BoardView, interactive: boolean): HTMLElement => {
    const boardEl = el("div", {
      class: `checkers-board${interactive ? "" : " checkers-final"}`,
      role: "group",
      "aria-label": interactive ? "Checkers board" : "Final board",
    });
    const canPlay = interactive && !thinking && !ending && !gameOver() && humanToMove();
    const stepNow =
      canPlay && selected !== null ? chainStep(board.legal, selected, prefix) : null;
    for (let r = 0; r < BOARD; r += 1) {
      for (let c = 0; c < BOARD; c += 1) {
        const sq = squareAt(r, c);
        if (sq === null) {
          boardEl.append(el("div", { class: "checkers-square light", "aria-hidden": "true" }));
          continue;
        }
        const v = board.cells[sq]!;
        const label = `${squareLabel(sq)}: ${describe(v)}`;
        const isTarget = stepNow?.targets.includes(sq) ?? false;
        const canPick = canPlay && board.legal.some((m) => m.from === sq);
        const marks = [
          isTarget ? " target" : "",
          canPick ? " selectable" : "",
          selected === sq ? " selected" : "",
          prefix.includes(sq) ? " chain-step" : "",
          interactive && (lastFrom === sq || lastTo === sq) ? " just-played" : "",
        ].join("");
        if (interactive && (isTarget || canPick || selected === sq)) {
          boardEl.append(
            el(
              "button",
              {
                type: "button",
                class: `checkers-square dark${marks}`,
                "data-sq": String(sq),
                "aria-label": isTarget ? `Move to ${squareLabel(sq)}` : `Select ${label}`,
              },
              v ? pieceNode(v) : "",
            ),
          );
        } else {
          boardEl.append(
            el(
              "div",
              {
                class: `checkers-square dark${marks}`,
                "data-sq": String(sq),
                role: "img",
                "aria-label": label,
              },
              v ? pieceNode(v) : "",
            ),
          );
        }
      }
    }
    if (interactive) {
      boardEl.addEventListener("click", (e) => {
        const cell = (e.target as HTMLElement).closest<HTMLElement>(".checkers-square.dark");
        if (cell?.dataset.sq) tapSquare(Number(cell.dataset.sq));
      });
    }
    return boardEl;
  };

  const renderTurnbar = (board: BoardView): HTMLElement => {
    const them: SideCode = humanSide() === 1 ? 2 : 1;
    const turn =
      board.result !== -1 ? "" : board.toMove === humanSide() ? "Your move" : `${OPPONENT.name} to move`;
    return el(
      "div",
      { class: "checkers-turnbar" },
      el(
        "span",
        { class: "checkers-score you" },
        `You ${humanSide() === 1 ? "●" : "○"} ${pieceCount(board.cells, humanSide())}`,
      ),
      el(
        "span",
        { class: "checkers-score them" },
        `${OPPONENT.name} ${OPPONENT.avatar} ${them === 1 ? "●" : "○"} ${pieceCount(board.cells, them)}`,
      ),
      el("span", { class: "checkers-turn", role: "status", "aria-live": "polite" }, turn),
    );
  };

  const renderControls = (): HTMLElement => {
    const bar = el("div", { class: "sol-controls checkers-controls" });

    const levelSel = el("select", { class: "checkers-level", "aria-label": "Difficulty" });
    for (const l of LEVELS) {
      const opt = el("option", { value: l }, l);
      if (l === level) opt.setAttribute("selected", "");
      levelSel.append(opt);
    }
    levelSel.addEventListener("change", () => {
      level = levelSel.value as CheckersLevel;
      setCheckersLevel(level);
    });

    const sideSel = el("select", { class: "checkers-side-pick", "aria-label": "Your men" });
    for (const [val, txt] of [
      ["black", "● Black (opens)"],
      ["white", "○ White"],
    ] as const) {
      const opt = el("option", { value: val }, txt);
      if (val === side) opt.setAttribute("selected", "");
      sideSel.append(opt);
    }
    sideSel.addEventListener("change", () => {
      side = sideSel.value as CheckersSide;
      setCheckersSide(side);
      void startGame(); // a new colour restarts (it changes who opens)
    });

    const fresh = el("button", { type: "button", class: "sol-fresh" }, "New game");
    fresh.addEventListener("click", () => void startGame());

    bar.append(
      el("label", { class: "checkers-field" }, "Difficulty ", levelSel),
      el("label", { class: "checkers-field" }, "You play ", sideSel),
      fresh,
    );
    return bar;
  };

  function render(): void {
    if (disposed || !container || !game) return;
    const board = game.board();
    container.replaceChildren(
      el(
        "div",
        { class: "checkers-game" },
        renderTurnbar(board),
        renderControls(),
        el(
          "p",
          { class: "checkers-banner" },
          "Tap a man, then tap where it goes. Capture is mandatory — when a jump is on offer it is your only move — and a multi-jump is tapped one landing at a time. Reach the far row to be crowned.",
        ),
        buildBoard(board, true),
        statusEl,
      ),
    );
  }

  const outcomeLabel = (board: BoardView): string => {
    const you = pieceCount(board.cells, humanSide());
    const them = pieceCount(board.cells, humanSide() === 1 ? 2 : 1);
    const code = board.result;
    const head =
      code === 0
        ? "A draw"
        : (code === 1 && humanSide() === 1) || (code === 2 && humanSide() === 2)
          ? "You won"
          : code === -1
            ? "Ended early"
            : `${OPPONENT.name} won`;
    return code === -1 ? head : `${head} ${you}–${them}`;
  };

  const finish = (): void => {
    if (!game || !container) return;
    ending = true;
    const board = game.board();
    const label = outcomeLabel(board);
    const flash = el(
      "p",
      { class: `checkers-flash${board.result === humanSide() ? " win" : ""}`, role: "status" },
      board.result === 0 ? "Draw" : label,
    );
    container.replaceChildren(
      el("div", { class: "checkers-game" }, renderTurnbar(board), flash, buildBoard(board, false)),
    );
    window.setTimeout(() => {
      if (disposed) return;
      void presentResult();
    }, FANFARE_MS);
  };

  const presentResult = async (): Promise<void> => {
    if (!container || !game) return;
    const env = game.outcome(false) as CheckersEnvelope;
    const board = game.board();
    const label = outcomeLabel(board);
    container.replaceChildren(
      el("div", { class: "sol-loading" }, "Preparing your verifiable result…"),
    );
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

  async function startGame(seedOverride?: bigint): Promise<void> {
    if (!game || disposed) return;
    thinking = false;
    ending = false;
    selected = null;
    prefix = [];
    lastFrom = null;
    lastTo = null;
    seed = seedOverride ?? randomSeed();
    game.newGame(seed);
    setStatus("");
    exposeHook();
    step(); // if the human plays White, the engine (Black) opens here
  }

  const showShared = async (payload: string): Promise<void> => {
    if (!container) return;
    let env: CheckersEnvelope;
    try {
      env = await decodeRecord(payload);
    } catch {
      container.replaceChildren(
        el("div", { class: "sol-error" }, "This shared result could not be read."),
      );
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
    window.__checkers = { game, refresh: () => render(), seed };
  };

  return {
    mount(c: HTMLElement): void {
      container = c;
      disposed = false;
      level = checkersLevel();
      side = checkersSide();
      container.replaceChildren(el("div", { class: "sol-loading" }, "Loading checkers…"));
      void (async () => {
        try {
          game = await Checkers.load();
          verifier = await Checkers.load();
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
        const seedParam = url.searchParams.get("seed");
        await startGame(seedParam !== null ? BigInt(seedParam) : undefined);
      })();
    },
    unmount(): void {
      disposed = true;
      delete window.__checkers;
      container?.replaceChildren();
      container = null;
      game = null;
      verifier = null;
    },
  };
}
