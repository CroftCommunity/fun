//! Drop 4 over the `drop4-wasm` binding: a tap-to-play two-player game against
//! the shelf's classic engine. You are ✕ (Side A) and open; tap a column to drop
//! a disc into its lowest empty slot, and the engine (○, Side B) replies. Four in
//! a row — across, up, or diagonally — wins; a full board is a draw. The core
//! decides legality (a full column is not a legal target), and a finished match
//! is a verifiable `pond-outcome` record, shareable via `?r=`.
//!
//! The opponent is the **live** depth-capped engine (`liveMove`), fast from any
//! position — not the exact oracle (minutes from the opening). Difficulty is
//! fixed at Medium here; the picker is a follow-up (P2).

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
  hintsEnabled,
  setDeclareAssistance,
  setHintsEnabled,
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

/** The engine's difficulty for P1 (the picker is P2). */
const LEVEL: Level = "Medium";
/** A brief "thinking" pause before the engine replies, so its move reads. */
const THINK_MS = 350;

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

/** The human-facing outcome from a live/replayed result code (draw-aware). */
function outcomeLabel(code: number): string {
  if (code === 1) return "You won";
  if (code === 2) return "The engine won";
  if (code === 0) return "A draw";
  return "Ended early";
}

// ---------- the result screen (pure DOM) ----------

export interface ResultScreenOpts {
  label: string;
  shareUrl?: string;
  onReverify?: () => void;
  onPlayAgain?: () => void;
  shared?: boolean;
}

/** Build the Drop 4 result screen: outcome headline, verification badge, the
 *  record (result / moves / seed / hash), and controls. */
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
  let seed = 0n;

  const statusEl = el("p", { class: "sol-status", role: "status", "aria-live": "polite" });
  const setStatus = (msg: string): void => {
    statusEl.textContent = msg;
  };

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

  const playCol = (col: number): void => {
    if (!game || thinking || gameOver() || !humanToMove()) return;
    if (game.play(col) !== "applied") return; // the core decides; illegal = no-op
    setStatus("");
    render();
    if (!gameOver()) scheduleEngine();
  };

  // The engine replies after a brief "thinking" beat, using the fast live engine
  // (never the exact oracle, which is minutes from the opening).
  const scheduleEngine = (): void => {
    if (!game) return;
    thinking = true;
    setStatus("The engine is thinking…");
    render();
    window.setTimeout(() => {
      if (disposed || !game) return;
      const col = game.liveMove(LEVEL);
      if (col !== null) game.play(col);
      thinking = false;
      setStatus("");
      render();
    }, THINK_MS);
  };

  // --- hints ---

  const showHint = (): void => {
    if (!game || thinking || gameOver() || !humanToMove()) return;
    // A strong suggestion from the live engine at its top setting (fast, and it
    // consumes no RNG at Perfect). Using a hint counts as assistance.
    const col = game.liveMove("Perfect");
    if (col === null) return;
    game.markAssistance();
    setStatus(`Hint: column ${col + 1} is a strong drop (a hint counts as assistance).`);
  };

  const endNow = (): void => {
    setStatus("Ended early — the match was unfinished.");
    render(true);
  };

  // --- rendering ---

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

  const renderBoard = (board: BoardView): HTMLElement => {
    const boardEl = el("div", { class: "drop4-board", role: "group", "aria-label": "Drop 4 board" });

    // The drop controls — one button per column, glowing only where a drop is
    // legal. The core owns legality; illegal columns are disabled no-ops.
    const cols = el("div", { class: "drop4-cols", role: "group", "aria-label": "Drop a disc" });
    const canDrop = !thinking && !gameOver() && humanToMove();
    for (let c = 0; c < board.width; c += 1) {
      const open = board.legal.includes(c);
      // Buttons stay clickable so an illegal tap is a core-decided no-op (the
      // rules leak-guard, BUILDING-GAMES §4); only the *glow* marks a legal drop.
      const glow = open && canDrop;
      const btn = el(
        "button",
        {
          type: "button",
          class: `drop4-col${glow ? " legal" : ""}`,
          "data-col": String(c),
          "aria-label": open ? `Drop in column ${c + 1}` : `Column ${c + 1} is full`,
        },
        "▾",
      );
      cols.append(btn);
    }
    cols.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>(".drop4-col");
      if (btn && btn.dataset.col) playCol(Number(btn.dataset.col));
    });

    // The grid: row 0 is the bottom, so render from the top row down.
    const grid = el("div", { class: "drop4-grid" });
    for (let r = board.height - 1; r >= 0; r -= 1) {
      const rowEl = el("div", { class: "drop4-row" });
      for (let c = 0; c < board.width; c += 1) {
        const v = board.cells[r]![c]!;
        const who = v === 1 ? "you (✕)" : v === 2 ? "the engine (○)" : "empty";
        const glyph = v === 1 ? "✕" : v === 2 ? "○" : "";
        rowEl.append(
          el(
            "div",
            {
              class: `drop4-cell${v === 1 ? " a" : v === 2 ? " b" : ""}`,
              role: "img",
              "aria-label": `Row ${r + 1} column ${c + 1}: ${who}`,
            },
            glyph,
          ),
        );
      }
      grid.append(rowEl);
    }

    boardEl.append(cols, grid);
    return boardEl;
  };

  const presentResult = async (force: boolean): Promise<void> => {
    if (!container || !game) return;
    const env = game.outcome(declareAssistanceEnabled()) as Drop4Envelope;
    const label = outcomeLabel(force && !gameOver() ? -1 : game.resultCode());
    container.replaceChildren(el("div", { class: "sol-loading" }, "Preparing your verifiable result…"));
    const shareUrl = await shareUrlFor(env);
    if (disposed || !container) return;
    const build = (): HTMLElement =>
      renderResultScreen(env, verify(env), {
        label,
        shareUrl,
        onReverify: () => container!.replaceChildren(build()),
        onPlayAgain: () => void startGame(),
      });
    container.replaceChildren(build());
  };

  function render(force = false): void {
    if (disposed || !container || !game) return;
    if (force || gameOver()) {
      void presentResult(force);
      return;
    }
    const board = game.board();
    const banner = el(
      "p",
      { class: "drop4-banner" },
      "Tap a column to drop your disc. Get four in a row — across, up, or diagonally — before the engine does.",
    );
    // A single centred column: controls, banner, board, and status share one
    // vertical axis so the board never hugs the left edge.
    const game_ = el(
      "div",
      { class: "drop4-game" },
      renderControls(),
      banner,
      renderBoard(board),
      statusEl,
    );
    container.replaceChildren(game_);
  }

  async function startGame(seedOverride?: bigint): Promise<void> {
    if (!game || disposed) return;
    thinking = false;
    seed = seedOverride ?? randomSeed();
    game.newGame(seed);
    setStatus("");
    console.debug(`[drop4] mount seed=${seed} level=${LEVEL}`);
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
    const label = outcomeLabel(verifier!.resultCode());
    const build = (): HTMLElement =>
      renderResultScreen(env, verification, {
        label,
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
