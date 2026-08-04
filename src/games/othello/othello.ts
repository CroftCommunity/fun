//! Othello over the `othello-wasm` binding: a tap-to-play two-player game against
//! the shelf's classic engine. You pick your disc (● black opens, or ○ white) and
//! tap any highlighted square to place-and-flip; **The Engine** replies. When a
//! side has no legal move it passes (shown, then auto-advanced); the game ends
//! when neither side can move, and the majority of discs wins. The core decides
//! legality; a finished match is a verifiable `pond-outcome` record, shareable
//! via `?r=` (passes are encoded so it replays exactly).
//!
//! The opponent is the depth-capped heuristic engine (`liveMove`) with an exact
//! endgame — Othello is unsolved from the opening, so there is no "perfect"
//! level. Difficulty (Easy…Expert) and the chosen disc persist.

import type { GameModule } from "../../contract.js";
import {
  othelloDisc,
  othelloLevel,
  setOthelloDisc,
  setOthelloLevel,
  type OthelloDisc,
  type OthelloLevel,
} from "../../settings.js";
import {
  decodeRecord,
  encodeRecord,
  verifyRecord,
  type OthelloEnvelope,
  type VerifyResult,
} from "./othello-outcome.js";
import { Othello, type BoardView, type Level } from "./othello-wasm.js";

declare global {
  interface Window {
    /** E2E hook: the live binding + a re-render, so tests drive the core. */
    __othello?: {
      game: Othello;
      refresh: () => void;
      seed: bigint;
    };
  }
}

/** The opponent's identity — honest: it is the shelf's classic engine. */
const OPPONENT = { name: "The Engine", avatar: "🤖" } as const;

const THINK_MS = 450;
const PASS_MS = 950;
const FANFARE_MS = 1200;
const LEVELS: readonly OthelloLevel[] = ["Easy", "Medium", "Hard", "Expert"];
const LEVEL_LABELS: Record<OthelloLevel, string> = {
  Easy: "Easy",
  Medium: "Medium",
  Hard: "Hard",
  Expert: "Expert",
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

/** The disc glyph for a cell value (1 = black/A, 2 = white/B). */
const glyphFor = (v: number): string => (v === 1 ? "●" : v === 2 ? "○" : "");

/** Count discs of a side value on the board. */
function discCount(cells: number[][], v: number): number {
  let n = 0;
  for (const row of cells) for (const cell of row) if (cell === v) n += 1;
  return n;
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

/** Build the Othello result screen: outcome headline, verification badge, the
 *  final board, the record, and controls. Reuses the shared `sol-*` styling. */
function renderResultScreen(
  env: OthelloEnvelope,
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
  section.append(badge);

  section.append(opts.finalBoard);

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

/** Construct a fresh Othello module (the registry `load`). */
export function othelloModule(): GameModule {
  let game: Othello | null = null;
  let verifier: Othello | null = null;
  let container: HTMLElement | null = null;
  let disposed = false;
  let thinking = false;
  let ending = false;
  let seed = 0n;
  let level: OthelloLevel = othelloLevel();
  let disc: OthelloDisc = othelloDisc();
  let lastMove: number | null = null;

  /** The side value the human plays: 1 (black, opens) or 2 (white). */
  const humanSide = (): 1 | 2 => (disc === "black" ? 1 : 2);

  const statusEl = el("p", { class: "sol-status", role: "status", "aria-live": "polite" });
  const setStatus = (msg: string): void => {
    statusEl.textContent = msg;
  };

  const randomSeed = (): bigint => {
    const buf = new Uint32Array(2);
    crypto.getRandomValues(buf);
    return (BigInt(buf[0]!) << 16n) ^ BigInt(buf[1]! & 0xffff);
  };

  const shareUrlFor = async (env: OthelloEnvelope): Promise<string> =>
    `${location.origin}${location.pathname}?r=${await encodeRecord(env)}`;
  const verify = (env: OthelloEnvelope): VerifyResult => verifyRecord(verifier!, env);

  const gameOver = (): boolean => (game ? game.board().result !== -1 : false);
  const humanToMove = (): boolean => (game ? game.board().toMove === humanSide() : false);

  const applyMove = (idx: number): boolean => {
    if (!game || game.play(idx) !== "applied") return false;
    lastMove = idx;
    return true;
  };

  // --- turn loop: after any move, advance auto-turns (passes + the engine)
  // until it is the human's turn to place, or the game ends. ---
  const step = (): void => {
    if (disposed || !game || !container) return;
    if (gameOver()) {
      finish();
      return;
    }
    const b = game.board();
    if (b.toMove === humanSide()) {
      if (b.mustPass) {
        thinking = true; // block input during the pass beat
        setStatus("You have no legal move — passing.");
        render();
        window.setTimeout(() => {
          if (disposed || !game) return;
          game.pass();
          thinking = false;
          lastMove = null;
          step();
        }, PASS_MS);
        return;
      }
      thinking = false;
      setStatus("");
      render(); // wait for the human's tap
      return;
    }
    // The opponent's turn (place or forced pass), after a brief beat.
    thinking = true;
    setStatus(b.mustPass ? `${OPPONENT.name} has no move — passing.` : `${OPPONENT.name} is thinking…`);
    render();
    window.setTimeout(() => {
      if (disposed || !game) return;
      const mv = game.liveMove(level as Level);
      if (mv === "pass") {
        game.pass();
        lastMove = null;
      } else if (typeof mv === "number") {
        applyMove(mv);
      }
      thinking = false;
      step();
    }, b.mustPass ? PASS_MS : THINK_MS);
  };

  const playCell = (idx: number): void => {
    if (!game || thinking || ending || gameOver() || !humanToMove()) return;
    if (!game.board().legal.includes(idx)) return; // the core decides legality
    if (!applyMove(idx)) return;
    setStatus("");
    step();
  };

  const buildBoard = (board: BoardView, interactive: boolean): HTMLElement => {
    const boardEl = el("div", {
      class: `othello-board${interactive ? "" : " othello-final"}`,
      role: "group",
      "aria-label": interactive ? "Othello board" : "Final board",
    });
    const canPlay = interactive && !thinking && !ending && !gameOver() && humanToMove();
    for (let r = 0; r < board.size; r += 1) {
      for (let c = 0; c < board.size; c += 1) {
        const idx = r * board.size + c;
        const v = board.cells[r]![c]!;
        const owner = v === 1 ? "black" : v === 2 ? "white" : "empty";
        const legal = interactive && canPlay && board.legal.includes(idx);
        const just = interactive && lastMove === idx;
        const label = `Row ${r + 1}, column ${c + 1}: ${owner}`;
        if (legal) {
          const btn = el("button", {
            type: "button",
            class: "othello-cell legal",
            "data-idx": String(idx),
            "aria-label": `Play ${label.replace(": empty", "")}`,
          });
          boardEl.append(btn);
        } else {
          boardEl.append(
            el(
              "div",
              {
                class: `othello-cell${v ? ` ${owner}` : ""}${just ? " just-played" : ""}`,
                role: "img",
                "aria-label": label,
              },
              v ? el("span", { class: "othello-disc", "aria-hidden": "true" }, glyphFor(v)) : "",
            ),
          );
        }
      }
    }
    if (interactive) {
      boardEl.addEventListener("click", (e) => {
        const cell = (e.target as HTMLElement).closest<HTMLElement>(".othello-cell.legal");
        if (cell?.dataset.idx) playCell(Number(cell.dataset.idx));
      });
    }
    return boardEl;
  };

  const renderTurnbar = (board: BoardView): HTMLElement => {
    const themSide = humanSide() === 1 ? 2 : 1;
    const you = discCount(board.cells, humanSide());
    const them = discCount(board.cells, themSide);
    const turn =
      board.result !== -1
        ? ""
        : board.toMove === humanSide()
          ? "Your move"
          : `${OPPONENT.name} to move`;
    return el(
      "div",
      { class: "othello-turnbar" },
      el("span", { class: "othello-score you" }, `You ${glyphFor(humanSide())} ${you}`),
      el(
        "span",
        { class: "othello-score them" },
        `${OPPONENT.name} ${OPPONENT.avatar} ${glyphFor(themSide)} ${them}`,
      ),
      el("span", { class: "othello-turn", role: "status", "aria-live": "polite" }, turn),
    );
  };

  const renderControls = (): HTMLElement => {
    const bar = el("div", { class: "sol-controls othello-controls" });

    const levelSel = el("select", { class: "othello-level", "aria-label": "Difficulty" });
    for (const l of LEVELS) {
      const opt = el("option", { value: l }, LEVEL_LABELS[l]);
      if (l === level) opt.setAttribute("selected", "");
      levelSel.append(opt);
    }
    levelSel.addEventListener("change", () => {
      level = levelSel.value as OthelloLevel;
      setOthelloLevel(level);
    });

    const discSel = el("select", { class: "othello-disc-pick", "aria-label": "Your disc" });
    for (const [val, txt] of [
      ["black", "● Black (open)"],
      ["white", "○ White"],
    ] as const) {
      const opt = el("option", { value: val }, txt);
      if (val === disc) opt.setAttribute("selected", "");
      discSel.append(opt);
    }
    discSel.addEventListener("change", () => {
      disc = discSel.value as OthelloDisc;
      setOthelloDisc(disc);
      void startGame(); // a new colour restarts (it changes who opens)
    });

    const fresh = el("button", { type: "button", class: "sol-fresh" }, "New game");
    fresh.addEventListener("click", () => void startGame());

    bar.append(
      el("label", { class: "othello-field" }, "Difficulty ", levelSel),
      el("label", { class: "othello-field" }, "You play ", discSel),
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
        { class: "othello-game" },
        renderTurnbar(board),
        renderControls(),
        el(
          "p",
          { class: "othello-banner" },
          "Tap a highlighted square to place your disc and flip the line. Most discs when neither side can move wins.",
        ),
        buildBoard(board, true),
        statusEl,
      ),
    );
  }

  const outcomeLabel = (board: BoardView): string => {
    const you = discCount(board.cells, humanSide());
    const them = discCount(board.cells, humanSide() === 1 ? 2 : 1);
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
      { class: `othello-flash${board.result === humanSide() ? " win" : ""}`, role: "status" },
      board.result === 0 ? "Draw" : label,
    );
    container.replaceChildren(
      el("div", { class: "othello-game" }, renderTurnbar(board), flash, buildBoard(board, false)),
    );
    window.setTimeout(() => {
      if (disposed) return;
      void presentResult();
    }, FANFARE_MS);
  };

  const presentResult = async (): Promise<void> => {
    if (!container || !game) return;
    const env = game.outcome(false) as OthelloEnvelope;
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
    lastMove = null;
    seed = seedOverride ?? randomSeed();
    game.newGame(seed);
    setStatus("");
    exposeHook();
    step(); // if the human is White, the engine (Black) opens here
  }

  const showShared = async (payload: string): Promise<void> => {
    if (!container) return;
    let env: OthelloEnvelope;
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
    window.__othello = { game, refresh: () => render(), seed };
  };

  return {
    mount(c: HTMLElement): void {
      container = c;
      disposed = false;
      level = othelloLevel();
      disc = othelloDisc();
      container.replaceChildren(el("div", { class: "sol-loading" }, "Loading Othello…"));
      void (async () => {
        try {
          game = await Othello.load();
          verifier = await Othello.load();
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
      delete window.__othello;
      container?.replaceChildren();
      container = null;
      game = null;
      verifier = null;
    },
  };
}
