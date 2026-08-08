//! Dots and Boxes over the `dots-wasm` binding: a tap-to-play two-player game
//! against the shelf's engine. You tap an undrawn edge; whoever draws the fourth
//! side of a box claims it **and moves again**. When every edge is drawn the
//! side with more boxes wins — nine boxes cannot split, so there is no draw.
//!
//! The extra turn is the thing this game brings to the shelf that no other
//! adversarial game here has, so the UI says it out loud rather than leaving the
//! player wondering why the turn did not pass.
//!
//! 3x3 is a **second-player win** with perfect play, so the human takes the
//! second seat by default and the engine opens. That is a property of the board,
//! not of the engine: opening against a perfect opponent loses by construction.
//!
//! The core decides everything about legality and scoring; the UI's only board
//! arithmetic is the lattice layout (`dots-lattice.ts`, pure and unit-pinned). A
//! finished match is a verifiable `pond-outcome` record, shareable via `?r=`.

import type { GameModule } from "../../contract.js";
import {
  dotsLevel,
  dotsSeat,
  setDotsLevel,
  setDotsSeat,
  type DotsLevel,
  type DotsSeat,
} from "../../settings.js";
import { latticeCells } from "./dots-lattice.js";
import {
  decodeRecord,
  encodeRecord,
  verifyRecord,
  type DotsEnvelope,
  type VerifyResult,
} from "./dots-outcome.js";
import { Dots, type BoardView, type Level, type SideCode } from "./dots-wasm.js";

declare global {
  interface Window {
    /** E2E hook: the live binding + a re-render, so tests drive the core. */
    __dots?: {
      game: Dots;
      refresh: () => void;
      seed: bigint;
    };
  }
}

/** The opponent's identity — honest: it is the shelf's engine. */
const OPPONENT = { name: "The Engine", avatar: "🤖" } as const;

const THINK_MS = 420;
const FANFARE_MS = 1200;
const LEVELS: readonly DotsLevel[] = ["Easy", "Medium", "Hard", "Perfect"];

/** The box mark for a side. Shape, not only colour, tells the two apart. */
const MARK: Record<SideCode, string> = { 1: "▲", 2: "●" };

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

/**
 * How an edge reads out loud: "top side of row 1, column 2" is unhelpful, so an
 * edge is named by its orientation and its position in the lattice. Pure, and
 * used for both the accessible label and any copy that names a move.
 */
export function edgeLabel(edge: number, rows: number, cols: number): string {
  const hEdges = (rows + 1) * cols;
  if (edge < hEdges) {
    const r = Math.floor(edge / cols);
    return `horizontal edge, row ${r + 1}, column ${(edge % cols) + 1}`;
  }
  const v = edge - hEdges;
  const r = Math.floor(v / (cols + 1));
  return `vertical edge, row ${r + 1}, column ${(v % (cols + 1)) + 1}`;
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

/** The Dots result screen: outcome headline, verification badge, the final
 *  board, the record, and controls. Reuses the shared `sol-*` styling. */
function renderResultScreen(
  env: DotsEnvelope,
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
    ? "Verified ✓ — re-checked by replaying every edge against the core."
    : `Verification failed — expected hash ${verification.expected}, replay produced ${verification.actual}.`;
  section.append(badge);

  section.append(opts.finalBoard);

  const dl = el("dl", { class: "sol-record" });
  const row = (term: string, value: string, cls = ""): void => {
    dl.append(el("dt", {}, term), el("dd", cls ? { class: cls } : {}, value));
  };
  row("Result", opts.label);
  row("Edges drawn", String(rec.move_count));
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

/** Construct a fresh Dots and Boxes module (the registry `load`). */
export function dotsModule(): GameModule {
  let game: Dots | null = null;
  let verifier: Dots | null = null;
  let container: HTMLElement | null = null;
  let disposed = false;
  let thinking = false;
  let ending = false;
  let seed = 0n;
  let level: DotsLevel = dotsLevel();
  let seat: DotsSeat = dotsSeat();

  /** The side value the human plays: 1 (opens) or 2 (replies). */
  const humanSide = (): SideCode => (seat === "first" ? 1 : 2);
  const engineSide = (): SideCode => (humanSide() === 1 ? 2 : 1);

  const statusEl = el("p", { class: "dots-status", role: "status", "aria-live": "polite" });
  const setStatus = (msg: string): void => {
    statusEl.textContent = msg;
  };

  const randomSeed = (): bigint => {
    const buf = new Uint32Array(2);
    crypto.getRandomValues(buf);
    return (BigInt(buf[0]!) << 16n) ^ BigInt(buf[1]! & 0xffff);
  };

  const shareUrlFor = async (env: DotsEnvelope): Promise<string> =>
    `${location.origin}${location.pathname}?r=${await encodeRecord(env)}`;
  const verify = (env: DotsEnvelope): VerifyResult => verifyRecord(verifier!, env);

  const gameOver = (): boolean => (game ? game.board().result !== -1 : false);
  const humanToMove = (): boolean => (game ? game.board().toMove === humanSide() : false);

  // --- the turn loop. A capture keeps the turn, so "whose move is it" is read
  // from the board every time rather than toggled — the rule that makes this
  // game different from the shelf's other three. ---
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
    setStatus(`${OPPONENT.name} is thinking…`);
    render();
    window.setTimeout(() => {
      if (disposed || !game) return;
      const mv = game.liveMove(level as Level);
      if (mv !== null) game.play(mv);
      const b = game.board();
      thinking = false;
      setStatus(
        b.keptTurn && b.result === -1
          ? `${OPPONENT.name} closed a box — it goes again.`
          : "",
      );
      step();
    }, THINK_MS);
  };

  const playEdge = (edge: number): void => {
    if (!game || thinking || ending || gameOver() || !humanToMove()) return;
    if (!game.board().legal.includes(edge)) return; // the core decides legality
    if (game.play(edge) !== "applied") return;
    const b = game.board();
    setStatus(
      b.keptTurn && b.result === -1
        ? "You closed a box — your turn again."
        : "",
    );
    step();
  };

  const buildBoard = (board: BoardView, interactive: boolean): HTMLElement => {
    const boardEl = el("div", {
      class: `dots-board${interactive ? "" : " dots-final"}`,
      role: "group",
      "aria-label": interactive ? "Dots and Boxes board" : "Final board",
      style: `grid-template-columns: var(--dots-dot) repeat(${board.cols}, var(--dots-seg) var(--dots-dot)); grid-template-rows: var(--dots-dot) repeat(${board.rows}, var(--dots-seg) var(--dots-dot));`,
    });
    const canPlay = interactive && !thinking && !ending && !gameOver() && humanToMove();
    for (const cell of latticeCells(board.rows, board.cols)) {
      if (cell.kind === "dot") {
        boardEl.append(el("div", { class: "dots-dot", "aria-hidden": "true" }));
        continue;
      }
      if (cell.kind === "box") {
        const owner = board.owners[cell.index] ?? 0;
        const who = owner === humanSide() ? "You" : OPPONENT.name;
        boardEl.append(
          el(
            "div",
            {
              class: `dots-box${owner === 1 ? " a" : owner === 2 ? " b" : ""}`,
              role: "img",
              "aria-label": owner ? `Box claimed by ${who}` : "Unclaimed box",
            },
            owner ? el("span", { class: "dots-mark", "aria-hidden": "true" }, MARK[owner as SideCode]) : "",
          ),
        );
        continue;
      }
      const e = cell.index;
      const owner = board.edgeOwner[e] ?? 0;
      const drawn = board.drawn[e] === true;
      const legal = canPlay && board.legal.includes(e);
      const just = interactive && board.lastEdge === e;
      const name = edgeLabel(e, board.rows, board.cols);
      const shape = cell.kind === "h" ? "h" : "v";
      const marks = `${drawn ? " drawn" : ""}${owner === 1 ? " a" : owner === 2 ? " b" : ""}${just ? " just-drawn" : ""}`;
      if (legal) {
        const closes = game ? game.closesCount(e) : 0;
        boardEl.append(
          el("button", {
            type: "button",
            class: `dots-edge ${shape} legal${marks}`,
            "data-edge": String(e),
            "aria-label": closes > 0 ? `Draw ${name} — closes ${closes === 2 ? "two boxes" : "a box"}` : `Draw ${name}`,
          }),
        );
      } else {
        boardEl.append(
          el("div", {
            class: `dots-edge ${shape}${marks}`,
            "data-edge": String(e),
            "aria-hidden": "true",
          }),
        );
      }
    }
    if (interactive) {
      boardEl.addEventListener("click", (ev) => {
        const target = (ev.target as HTMLElement).closest<HTMLElement>(".dots-edge.legal");
        if (target?.dataset.edge) playEdge(Number(target.dataset.edge));
      });
    }
    return boardEl;
  };

  const yourBoxes = (board: BoardView): number =>
    humanSide() === 1 ? board.boxesA : board.boxesB;
  const theirBoxes = (board: BoardView): number =>
    humanSide() === 1 ? board.boxesB : board.boxesA;

  const renderTurnbar = (board: BoardView): HTMLElement => {
    const turn =
      board.result !== -1
        ? ""
        : board.toMove === humanSide()
          ? "Your move"
          : `${OPPONENT.name} to move`;
    return el(
      "div",
      { class: "dots-turnbar" },
      el(
        "span",
        { class: "dots-score you" },
        `You ${MARK[humanSide()]} ${yourBoxes(board)}`,
      ),
      el(
        "span",
        { class: "dots-score them" },
        `${OPPONENT.name} ${OPPONENT.avatar} ${MARK[engineSide()]} ${theirBoxes(board)}`,
      ),
      el("span", { class: "dots-turn", role: "status", "aria-live": "polite" }, turn),
    );
  };

  const renderControls = (): HTMLElement => {
    const bar = el("div", { class: "sol-controls dots-controls" });

    const levelSel = el("select", { class: "dots-level", "aria-label": "Difficulty" });
    for (const l of LEVELS) {
      const opt = el("option", { value: l }, l);
      if (l === level) opt.setAttribute("selected", "");
      levelSel.append(opt);
    }
    levelSel.addEventListener("change", () => {
      level = levelSel.value as DotsLevel;
      setDotsLevel(level);
    });

    const seatSel = el("select", { class: "dots-seat", "aria-label": "Your seat" });
    for (const [val, txt] of [
      ["second", "Second (reply)"],
      ["first", "First (open)"],
    ] as const) {
      const opt = el("option", { value: val }, txt);
      if (val === seat) opt.setAttribute("selected", "");
      seatSel.append(opt);
    }
    seatSel.addEventListener("change", () => {
      seat = seatSel.value as DotsSeat;
      setDotsSeat(seat);
      void startGame(); // a new seat restarts (it changes who opens)
    });

    const fresh = el("button", { type: "button", class: "sol-fresh" }, "New game");
    fresh.addEventListener("click", () => void startGame());

    bar.append(
      el("label", { class: "dots-field" }, "Difficulty ", levelSel),
      el("label", { class: "dots-field" }, "You play ", seatSel),
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
        { class: "dots-game" },
        renderTurnbar(board),
        renderControls(),
        el(
          "p",
          { class: "dots-banner" },
          "Tap an edge. Draw the fourth side of a box to claim it — and go again. Most boxes wins.",
        ),
        buildBoard(board, true),
        statusEl,
      ),
    );
  }

  const outcomeLabel = (board: BoardView): string => {
    const you = yourBoxes(board);
    const them = theirBoxes(board);
    if (board.result === -1) return "Ended early";
    if (board.result === 0) return `A draw ${you}–${them}`;
    return you > them ? `You won ${you}–${them}` : `${OPPONENT.name} won ${them}–${you}`;
  };

  const finish = (): void => {
    if (!game || !container) return;
    ending = true;
    const board = game.board();
    const won = yourBoxes(board) > theirBoxes(board);
    container.replaceChildren(
      el(
        "div",
        { class: "dots-game" },
        renderTurnbar(board),
        el("p", { class: `dots-flash${won ? " win" : ""}`, role: "status" }, outcomeLabel(board)),
        buildBoard(board, false),
      ),
    );
    window.setTimeout(() => {
      if (disposed) return;
      void presentResult();
    }, FANFARE_MS);
  };

  const presentResult = async (): Promise<void> => {
    if (!container || !game) return;
    const env = game.outcome(false) as DotsEnvelope;
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
    seed = seedOverride ?? randomSeed();
    game.newGame(seed);
    setStatus("");
    exposeHook();
    step(); // if the human took the second seat, the engine opens here
  }

  const showShared = async (payload: string): Promise<void> => {
    if (!container) return;
    let env: DotsEnvelope;
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
    // A shared record is Side-A-centric; the viewer is a spectator, so the label
    // names the sides by seat rather than pretending they played.
    const label =
      board.result === 0
        ? `A draw ${board.boxesA}–${board.boxesB}`
        : board.result === 1
          ? `First player won ${board.boxesA}–${board.boxesB}`
          : `Second player won ${board.boxesB}–${board.boxesA}`;
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
    window.__dots = { game, refresh: () => render(), seed };
  };

  return {
    mount(c: HTMLElement): void {
      container = c;
      disposed = false;
      level = dotsLevel();
      seat = dotsSeat();
      container.replaceChildren(el("div", { class: "sol-loading" }, "Loading Dots and Boxes…"));
      void (async () => {
        try {
          game = await Dots.load();
          verifier = await Dots.load();
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
      delete window.__dots;
      container?.replaceChildren();
      container = null;
      game = null;
      verifier = null;
    },
  };
}
