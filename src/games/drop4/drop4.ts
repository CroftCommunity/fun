//! Drop 4 over the `drop4-wasm` binding: a tap-to-play two-player game against
//! the shelf's classic engine. You pick your disc (✕ or ○) and open; tap
//! anywhere in a column to drop into its lowest empty slot, and **The Engine**
//! replies. Four in a row — across, up, or diagonally — wins; a full board is a
//! draw. The core decides legality (a full column is not a legal target), and a
//! finished match is a verifiable `pond-outcome` record, shareable via `?r=`.
//!
//! The opponent is the **live** depth-capped engine (`liveMove`), fast from any
//! position — not the exact oracle (minutes from the opening). Difficulty is a
//! picker (Easy…Perfect) mapped to the engine's strength; both the level and the
//! chosen mark persist.

import type { GameModule } from "../../contract.js";
import { Drop4, type BoardView, type Level } from "./drop4-wasm.js";
import {
  decodeRecord,
  encodeRecord,
  verifyRecord,
  type Drop4Envelope,
  type VerifyResult,
} from "./drop4-outcome.js";
import {
  declareAssistanceEnabled,
  drop4Level,
  drop4Mark,
  hintsEnabled,
  setDeclareAssistance,
  setDrop4Level,
  setDrop4Mark,
  setHintsEnabled,
  type Drop4Mark,
} from "../../settings.js";

declare global {
  interface Window {
    /** E2E hook: the live binding + a re-render, so tests drive the core. */
    __drop4?: {
      game: Drop4;
      refresh: () => void;
      seed: bigint;
    };
  }
}

/** The opponent's identity — honest: it is the shelf's classic engine. */
const OPPONENT = { name: "The Engine", avatar: "🤖" } as const;
/** A brief "thinking" pause before the engine replies, so its move reads. */
const THINK_MS = 450;
/** How long the winning board is held (a little fanfare) before the result. */
const FANFARE_MS = 1300;
const LEVELS: readonly Level[] = ["Easy", "Medium", "Hard", "Perfect"];
/** Display labels for the picker — the internal `Level`/persisted value stays
 *  `Perfect` (it is the exact/best-play level), but "Expert" reads better and
 *  doesn't overclaim (it is only provably perfect once the game is tractable). */
const LEVEL_LABELS: Record<Level, string> = {
  Easy: "Easy",
  Medium: "Medium",
  Hard: "Hard",
  Perfect: "Expert",
};

type Mark = Drop4Mark;
type Cell = [number, number];

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

const glyphFor = (m: Mark): string => (m === "x" ? "✕" : "○");
const other = (m: Mark): Mark => (m === "x" ? "o" : "x");

/** The human-facing outcome from a live/replayed result code (draw-aware). */
function outcomeLabel(code: number): string {
  if (code === 1) return "You won";
  if (code === 2) return `${OPPONENT.name} won`;
  if (code === 0) return "A draw";
  return "Ended early";
}

/** The winning four (row, col) cells for `val`, or `[]` if none. Display-only —
 *  it scans the final board so the win is *shown*, never trusting a flag. */
function winningLine(cells: number[][], val: number): Cell[] {
  if (val !== 1 && val !== 2) return [];
  const h = cells.length;
  const w = cells[0]?.length ?? 0;
  const dirs: Cell[] = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ];
  for (let r = 0; r < h; r += 1) {
    for (let c = 0; c < w; c += 1) {
      if (cells[r]![c] !== val) continue;
      for (const [dr, dc] of dirs) {
        const line: Cell[] = [[r, c]];
        for (let k = 1; k < 4; k += 1) {
          const nr = r + dr * k;
          const nc = c + dc * k;
          if (nr < 0 || nr >= h || nc < 0 || nc >= w || cells[nr]![nc] !== val) break;
          line.push([nr, nc]);
        }
        if (line.length === 4) return line;
      }
    }
  }
  return [];
}

const inLine = (line: Cell[], r: number, c: number): boolean =>
  line.some(([lr, lc]) => lr === r && lc === c);

// ---------- the result screen (pure DOM) ----------

export interface ResultScreenOpts {
  label: string;
  finalBoard: HTMLElement;
  shareUrl?: string;
  onReverify?: () => void;
  onPlayAgain?: () => void;
  shared?: boolean;
}

/** Build the Drop 4 result screen: outcome headline, verification badge, the
 *  final board (winning line highlighted), the record, and controls. */
export function renderResultScreen(
  env: Drop4Envelope,
  verification: VerifyResult,
  opts: ResultScreenOpts,
): HTMLElement {
  const rec = env.payload;
  const section = el("section", { class: "sol-result", role: "region", "aria-label": "Result" });
  const headline = verification.ok
    ? `${opts.label} — verifiable`
    : "Verification FAILED — this result does not check out";
  section.append(el("h2", { class: "sol-headline" }, headline));

  const badge = el("p", {
    class: `sol-verify-badge ${verification.ok ? "ok" : "fail"}`,
    role: "status",
  });
  badge.textContent = verification.ok
    ? "Verified ✓ — re-checked by replaying every move against the core."
    : `Verification failed — expected hash ${verification.expected}, replay produced ${verification.actual}.`;
  section.append(badge);

  // The final position, so the winning move (and the four-in-a-row) is visible.
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

/** Construct a fresh Drop 4 module (the registry `load`). */
export function drop4Module(): GameModule {
  let game: Drop4 | null = null;
  let verifier: Drop4 | null = null;
  let container: HTMLElement | null = null;
  let disposed = false;
  let thinking = false;
  let ending = false;
  let seed = 0n;
  let level: Level = drop4Level();
  let playerMark: Mark = drop4Mark();
  let lastMove: Cell | null = null;

  const statusEl = el("p", { class: "sol-status", role: "status", "aria-live": "polite" });
  const setStatus = (msg: string): void => {
    statusEl.textContent = msg;
  };

  // Which mark each side shows: the human (Side A, value 1) plays playerMark;
  // the engine (Side B, value 2) plays the other. Colour follows the mark.
  const markForValue = (v: number): Mark | null =>
    v === 1 ? playerMark : v === 2 ? other(playerMark) : null;

  const randomSeed = (): bigint => {
    const buf = new Uint32Array(2);
    crypto.getRandomValues(buf);
    return (BigInt(buf[0]!) << 16n) ^ BigInt(buf[1]! & 0xffff);
  };

  const shareUrlFor = async (env: Drop4Envelope): Promise<string> =>
    `${location.origin}${location.pathname}?r=${await encodeRecord(env)}`;

  const verify = (env: Drop4Envelope): VerifyResult => verifyRecord(verifier!, env);

  const gameOver = (): boolean => (game ? game.board().result !== -1 : false);
  const humanToMove = (): boolean => (game ? game.board().toMove === 1 : false);

  const columnFill = (cells: number[][], c: number): number => {
    let n = 0;
    for (const rowVals of cells) if (rowVals[c] !== 0) n += 1;
    return n;
  };

  const applyMove = (col: number): boolean => {
    if (!game) return false;
    if (game.play(col) !== "applied") return false;
    lastMove = [columnFill(game.board().cells, col) - 1, col];
    return true;
  };

  const playCol = (col: number): void => {
    if (!game || thinking || ending || gameOver() || !humanToMove()) return;
    if (!applyMove(col)) return; // the core decides; illegal = no-op
    setStatus("");
    if (gameOver()) {
      finish();
      return;
    }
    render();
    scheduleEngine();
  };

  // The engine replies after a brief "thinking" beat, using the fast live engine
  // (never the exact oracle, which is minutes from the opening).
  const scheduleEngine = (): void => {
    if (!game) return;
    thinking = true;
    setStatus(`${OPPONENT.name} is thinking…`);
    render();
    window.setTimeout(() => {
      if (disposed || !game) return;
      const col = game.liveMove(level);
      thinking = false;
      if (col !== null) applyMove(col);
      if (gameOver()) {
        finish();
        return;
      }
      setStatus("");
      render();
    }, THINK_MS);
  };

  // --- hints ---

  const showHint = (): void => {
    if (!game || thinking || ending || gameOver() || !humanToMove()) return;
    // A strong suggestion from the live engine at its top setting (fast, and it
    // consumes no RNG at Perfect). Using a hint counts as assistance.
    const col = game.liveMove("Perfect");
    if (col === null) return;
    game.markAssistance();
    setStatus(`Hint: column ${col + 1} is a strong drop (a hint counts as assistance).`);
  };

  const endNow = (): void => {
    setStatus("Ended early — the match was unfinished.");
    void presentResult();
  };

  // --- rendering ---

  const renderTurnbar = (): HTMLElement => {
    const over = gameOver();
    const youActive = !over && !thinking && !ending && humanToMove();
    const oppActive = !over && (thinking || !humanToMove());
    const you = el(
      "div",
      { class: `drop4-player you${youActive ? " active" : ""}` },
      el("span", { class: `drop4-chip ${playerMark}`, "aria-hidden": "true" }, glyphFor(playerMark)),
      el("span", { class: "drop4-name" }, "You"),
    );
    const opp = el(
      "div",
      { class: `drop4-player opp${oppActive ? " active" : ""}` },
      el(
        "span",
        { class: `drop4-chip ${other(playerMark)}`, "aria-hidden": "true" },
        glyphFor(other(playerMark)),
      ),
      el("span", { class: "drop4-name" }, `${OPPONENT.name} ${OPPONENT.avatar}`),
      ...(thinking ? [el("span", { class: "drop4-thinking" }, "thinking…")] : []),
    );
    return el(
      "div",
      { class: "drop4-turnbar", role: "group", "aria-label": "Players" },
      you,
      el("span", { class: "drop4-vs", "aria-hidden": "true" }, "vs"),
      opp,
    );
  };

  const renderOptions = (): HTMLElement => {
    const opts = el("div", { class: "drop4-options" });

    const levelLabel = el("label", { class: "drop4-level-label" }, "Difficulty ");
    const select = el("select", { class: "drop4-level", "aria-label": "Difficulty" });
    for (const lv of LEVELS) {
      const o = el("option", { value: lv }, LEVEL_LABELS[lv]);
      if (lv === level) (o as HTMLOptionElement).selected = true;
      select.append(o);
    }
    select.addEventListener("change", () => {
      level = (select as HTMLSelectElement).value as Level;
      setDrop4Level(level);
    });
    levelLabel.append(select);

    const marks = el("div", { class: "drop4-marks", role: "group", "aria-label": "Play as" });
    marks.append(el("span", { class: "drop4-marks-label" }, "You play "));
    for (const m of ["x", "o"] as Mark[]) {
      const b = el(
        "button",
        {
          type: "button",
          class: `drop4-mark ${m}`,
          "data-mark": m,
          "aria-pressed": String(playerMark === m),
          "aria-label": `Play as ${m === "x" ? "cross" : "nought"}`,
        },
        glyphFor(m),
      );
      b.addEventListener("click", () => {
        if (playerMark === m) return;
        playerMark = m;
        setDrop4Mark(m);
        render();
      });
      marks.append(b);
    }

    opts.append(levelLabel, marks);
    return opts;
  };

  const renderControls = (): HTMLElement => {
    const bar = el("div", { class: "sol-controls" });
    const modes = el("div", { class: "sol-modes", role: "group", "aria-label": "Game" });
    const fresh = el("button", { type: "button", class: "sol-new" }, "New game");
    fresh.addEventListener("click", () => void startGame());
    modes.append(fresh);

    const hints = hintsEnabled();
    const actionBtn = el(
      "button",
      { type: "button", class: hints ? "sol-hint" : "sol-stuck" },
      hints ? "Hint" : "I’m done",
    );
    actionBtn.addEventListener("click", hints ? showHint : endNow);

    const setting = (
      checked: boolean,
      label: string,
      cls: string,
      onChange: (on: boolean) => void,
    ): HTMLElement => {
      const wrap = el("label", { class: "sol-setting" });
      const input = el("input", { type: "checkbox", class: cls });
      (input as HTMLInputElement).checked = checked;
      input.addEventListener("change", () => onChange((input as HTMLInputElement).checked));
      wrap.append(input, document.createTextNode(` ${label}`));
      return wrap;
    };
    const settings = el("details", { class: "sol-settings" });
    settings.append(
      el("summary", {}, "Settings"),
      setting(hints, "Enable hints", "sol-set-hints", (on) => {
        setHintsEnabled(on);
        render();
      }),
      setting(declareAssistanceEnabled(), "Declare assistance used", "sol-set-assist", (on) => {
        setDeclareAssistance(on);
      }),
    );

    bar.append(modes, actionBtn, settings);
    return bar;
  };

  /** Build a board element. `interactive` adds the drop controls + click/glow;
   *  a static board (result screen / fanfare) just shows the final position. */
  const buildBoard = (board: BoardView, opts: { interactive: boolean; winLine: Cell[] }): HTMLElement => {
    const { interactive, winLine } = opts;
    const boardEl = el("div", {
      class: `drop4-board${interactive ? "" : " drop4-final"}`,
      role: "group",
      "aria-label": interactive ? "Drop 4 board" : "Final board",
    });
    const canDrop = interactive && !thinking && !ending && !gameOver() && humanToMove();
    const cols = el("div", { class: "drop4-cols" });
    for (let c = 0; c < board.width; c += 1) {
      const open = board.legal.includes(c);
      const glow = interactive && open && canDrop;
      const colEl = el("div", {
        class: `drop4-col${glow ? " legal" : ""}`,
        "data-col": String(c),
      });
      if (interactive) {
        // The accessible, keyboard-operable drop control (the whole column is
        // also a pointer target — see the delegated handler below).
        colEl.append(
          el(
            "button",
            {
              type: "button",
              class: "drop4-drop",
              "data-col": String(c),
              "aria-label": open ? `Drop in column ${c + 1}` : `Column ${c + 1} is full`,
            },
            "▼",
          ),
        );
      }
      // Cells top-to-bottom (row 0 is the bottom).
      for (let r = board.height - 1; r >= 0; r -= 1) {
        const v = board.cells[r]![c]!;
        const mark = markForValue(v);
        const who = mark === playerMark ? "you" : mark ? OPPONENT.name : "empty";
        const win = inLine(winLine, r, c);
        const justPlayed = interactive && lastMove?.[0] === r && lastMove?.[1] === c;
        colEl.append(
          el(
            "div",
            {
              class: `drop4-cell${mark ? ` ${mark}` : ""}${win ? " win" : ""}${justPlayed ? " just-played" : ""}`,
              role: "img",
              "aria-label": `Row ${r + 1} column ${c + 1}: ${who === "empty" ? "empty" : `${who} (${mark ? glyphFor(mark) : ""})`}`,
            },
            mark ? glyphFor(mark) : "",
          ),
        );
      }
      cols.append(colEl);
    }
    if (interactive) {
      cols.addEventListener("click", (e) => {
        const colEl = (e.target as HTMLElement).closest<HTMLElement>(".drop4-col");
        if (colEl?.dataset.col) playCol(Number(colEl.dataset.col));
      });
    }
    boardEl.append(cols);
    return boardEl;
  };

  const winLineNow = (b: BoardView): Cell[] =>
    b.result === 1 || b.result === 2 ? winningLine(b.cells, b.result) : [];

  function render(): void {
    if (disposed || !container || !game) return;
    const board = game.board();
    const banner = el(
      "p",
      { class: "drop4-banner" },
      "Tap a column to drop your disc. Line up four in a row — across, up, or diagonally — before the engine does.",
    );
    const game_ = el(
      "div",
      { class: "drop4-game" },
      renderTurnbar(),
      renderOptions(),
      renderControls(),
      banner,
      buildBoard(board, { interactive: true, winLine: winLineNow(board) }),
      statusEl,
    );
    container.replaceChildren(game_);
  }

  // Hold the winning board for a beat (a little fanfare) before the result.
  const finish = (): void => {
    if (!game || !container) return;
    ending = true;
    const board = game.board();
    const line = winLineNow(board);
    const label = outcomeLabel(board.result);
    const flash = el(
      "p",
      { class: `drop4-flash${board.result === 1 ? " win" : ""}`, role: "status" },
      board.result === 0 ? "Draw" : `${label}${board.result === 1 ? " 🎉" : ""}`,
    );
    container.replaceChildren(
      el(
        "div",
        { class: "drop4-game" },
        renderTurnbar(),
        flash,
        buildBoard(board, { interactive: false, winLine: line }),
      ),
    );
    window.setTimeout(() => {
      if (disposed) return;
      void presentResult();
    }, FANFARE_MS);
  };

  const presentResult = async (): Promise<void> => {
    if (!container || !game) return;
    const env = game.outcome(declareAssistanceEnabled()) as Drop4Envelope;
    const board = game.board();
    const label = outcomeLabel(board.result);
    const line = winLineNow(board);
    container.replaceChildren(el("div", { class: "sol-loading" }, "Preparing your verifiable result…"));
    const shareUrl = await shareUrlFor(env);
    if (disposed || !container) return;
    const build = (): HTMLElement =>
      renderResultScreen(env, verify(env), {
        label,
        finalBoard: buildBoard(board, { interactive: false, winLine: line }),
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
    console.debug(`[drop4] mount seed=${seed} level=${level} mark=${playerMark}`);
    exposeHook();
    render();
  }

  const showShared = async (payload: string): Promise<void> => {
    if (!container) return;
    let env: Drop4Envelope;
    try {
      env = await decodeRecord(payload);
    } catch {
      container.replaceChildren(el("div", { class: "sol-error" }, "This shared result could not be read."));
      return;
    }
    if (disposed || !container) return;
    const verification = verify(env);
    const board = verifier!.board();
    const label = outcomeLabel(board.result);
    const line = winLineNow(board);
    const build = (): HTMLElement =>
      renderResultScreen(env, verification, {
        label,
        finalBoard: buildBoard(board, { interactive: false, winLine: line }),
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
    window.__drop4 = { game, refresh: () => render(), seed };
  };

  return {
    mount(c: HTMLElement): void {
      container = c;
      disposed = false;
      level = drop4Level();
      playerMark = drop4Mark();
      container.replaceChildren(el("div", { class: "sol-loading" }, "Loading Drop 4…"));
      void (async () => {
        try {
          game = await Drop4.load();
          verifier = await Drop4.load();
        } catch {
          if (!disposed && container) {
            container.replaceChildren(el("div", { class: "sol-error" }, "Could not load the game engine."));
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
      delete window.__drop4;
      container?.replaceChildren();
      container = null;
      game = null;
      verifier = null;
    },
  };
}
