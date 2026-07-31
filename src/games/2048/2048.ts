//! The 2048 board over the `twenty48-wasm` binding. Slide the grid with the
//! on-screen arrow pad, a swipe, or the arrow/WASD keys; equal tiles that
//! collide merge. The core decides legality — a direction that changes nothing
//! is a no-op. Reach the 2048 tile to win; the game ends when no move is left.
//! A verifiable `pond-outcome` record (score + whether 2048 was reached) is
//! shown, shareable via `?r=`.

import type { GameModule } from "../../contract.js";
import { Twenty48, type BoardView, type Direction } from "./2048-wasm.js";
import {
  decodeRecord,
  encodeRecord,
  verifyRecord,
  type Twenty48Envelope,
  type VerifyResult,
} from "./2048-outcome.js";
import { dayIndexUTC } from "../share.js";
import {
  declareAssistanceEnabled,
  hintsEnabled,
  setDeclareAssistance,
  setHintsEnabled,
} from "../../settings.js";

declare global {
  interface Window {
    /** E2E hook: the live binding + a re-render, so tests drive the core. */
    __t2048?: {
      game: Twenty48;
      refresh: () => void;
      seed: bigint;
      playDir: (dir: Direction) => void;
    };
  }
}

const ARROW: Record<Direction, string> = { Up: "↑", Down: "↓", Left: "←", Right: "→" };

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

/** The magnitude bucket for a tile exponent (colour ramp; the numeral is always shown). */
function bucket(exp: number): string {
  if (exp <= 2) return "t48-lo";
  if (exp <= 5) return "t48-mid";
  if (exp <= 9) return "t48-hi";
  return "t48-max";
}

// ---------- the result screen (pure DOM) ----------

function headline(env: Twenty48Envelope, v: VerifyResult): string {
  if (!v.ok) return "Verification FAILED — this result does not check out";
  return env.payload.result === "Won"
    ? `Made 2048 in ${env.payload.move_count} moves — verifiable`
    : `Score ${env.payload.score ?? 0} — verifiable`;
}

export interface ResultScreenOpts {
  bestTile?: number;
  shareUrl?: string;
  onReverify?: () => void;
  onPlayAgain?: () => void;
  shared?: boolean;
}

/** Build the 2048 result screen: outcome headline, verification badge, the
 *  record (result / score / best tile / moves / seed / hash), and controls. */
export function renderResultScreen(
  env: Twenty48Envelope,
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

  const dl = el("dl", { class: "sol-record" });
  const row = (term: string, value: string, cls = ""): void => {
    dl.append(el("dt", {}, term), el("dd", cls ? { class: cls } : {}, value));
  };
  row("Result", rec.result);
  row("Score", String(rec.score ?? 0));
  if (opts.bestTile) row("Best tile", String(opts.bestTile));
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
    const b = el(
      "button",
      { type: "button", class: "sol-again" },
      opts.shared ? "Play today’s board" : "Play again",
    );
    b.addEventListener("click", opts.onPlayAgain);
    controls.append(b);
  }
  if (controls.childNodes.length) section.append(controls);
  return section;
}

// ---------- the game module ----------

/** Construct a fresh 2048 module (the registry `load`). */
export function twenty48Module(): GameModule {
  let game: Twenty48 | null = null;
  let verifier: Twenty48 | null = null;
  let container: HTMLElement | null = null;
  let disposed = false;

  let mode: "daily" | "free" = "daily";
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

  const shareUrlFor = async (env: Twenty48Envelope): Promise<string> =>
    `${location.origin}${location.pathname}?r=${await encodeRecord(env)}`;

  const verify = (env: Twenty48Envelope): VerifyResult => verifyRecord(verifier!, env);

  const gameOver = (): boolean => {
    if (!game) return false;
    const b = game.board();
    return b.won || b.stuck;
  };

  const playDir = (dir: Direction): void => {
    if (!game || gameOver()) return;
    const before = game.board().score;
    const status = game.move(dir);
    if (status !== "applied") return; // the core decides; illegal = no-op
    const gained = game.board().score - before;
    setStatus("");
    render();
    if (gained > 0) showScoreFloat(gained); // a merge scored — make it visible
  };

  // A brief "+N" that floats up from the score, so a merge is legible even
  // without a full slide animation. Decorative + aria-hidden; reduced-motion safe.
  const showScoreFloat = (gained: number): void => {
    if (!container) return;
    const host = container.querySelector<HTMLElement>(".t48-score");
    if (!host) return;
    const float = el("span", { class: "t48-float", "aria-hidden": "true" }, `+${gained}`);
    host.append(float);
    setTimeout(() => float.remove(), 900);
  };

  // --- hints ---

  const showHint = (): void => {
    if (!game || gameOver()) return;
    const dir = game.hint();
    if (!dir) {
      render();
      return;
    }
    game.markAssistance();
    setStatus(`Hint: try sliding ${dir.toLowerCase()} ${ARROW[dir]} (a hint counts as assistance)`);
  };

  const endNow = (): void => {
    setStatus("Ended early — you still had moves left.");
    render(true);
  };

  // --- rendering ---

  const renderControls = (board: BoardView): HTMLElement => {
    const bar = el("div", { class: "sol-controls" });

    const modes = el("div", { class: "sol-modes", role: "group", "aria-label": "Board" });
    const daily = el(
      "button",
      { type: "button", class: "sol-mode-daily", "aria-pressed": String(mode === "daily") },
      "Today’s board",
    );
    const fresh = el(
      "button",
      { type: "button", class: "sol-new", "aria-pressed": String(mode === "free") },
      "New board",
    );
    daily.addEventListener("click", () => void startGame("daily"));
    fresh.addEventListener("click", () => void startGame("free"));
    modes.append(daily, fresh);

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

    const hud = el(
      "div",
      { class: "t48-hud" },
      el("span", { class: "t48-score" }, `Score ${board.score}`),
      el("span", { class: "t48-best" }, `Best tile ${board.maxTile}`),
    );

    bar.append(modes, actionBtn, settings);
    const wrap = el("div");
    wrap.append(bar, hud);
    return wrap;
  };

  const renderBoard = (board: BoardView): HTMLElement => {
    const boardEl = el("div", {
      class: "t48-board",
      role: "group",
      "aria-label": "2048 board",
      tabindex: "0",
    });
    board.cells.forEach((rowVals, r) => {
      const rowEl = el("div", { class: "t48-row" });
      rowVals.forEach((exp, c) => {
        if (exp > 0) {
          const value = 2 ** exp;
          rowEl.append(
            el(
              "div",
              {
                class: `t48-tile ${bucket(exp)}${value >= 1024 ? " t48-wide" : ""}`,
                role: "img",
                "aria-label": `${value}, row ${r + 1} column ${c + 1}`,
              },
              String(value),
            ),
          );
        } else {
          rowEl.append(el("div", { class: "t48-tile t48-empty", "aria-hidden": "true" }));
        }
      });
      boardEl.append(rowEl);
    });
    attachSwipe(boardEl);
    return boardEl;
  };

  // Pointer swipe -> a direction (the dominant axis, past a small threshold).
  const attachSwipe = (boardEl: HTMLElement): void => {
    let sx = 0;
    let sy = 0;
    let down = false;
    boardEl.addEventListener("pointerdown", (e) => {
      down = true;
      sx = e.clientX;
      sy = e.clientY;
    });
    boardEl.addEventListener("pointerup", (e) => {
      if (!down) return;
      down = false;
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
      if (Math.abs(dx) > Math.abs(dy)) playDir(dx > 0 ? "Right" : "Left");
      else playDir(dy > 0 ? "Down" : "Up");
    });
  };

  const renderPad = (): HTMLElement => {
    const pad = el("div", { class: "t48-pad", role: "group", "aria-label": "Slide" });
    const key = (dir: Direction): HTMLElement =>
      el(
        "button",
        { type: "button", class: `t48-arrow t48-${dir.toLowerCase()}`, "data-dir": dir, "aria-label": `Slide ${dir.toLowerCase()}` },
        ARROW[dir],
      );
    pad.append(key("Up"), key("Left"), key("Down"), key("Right"));
    pad.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>(".t48-arrow");
      if (btn) playDir(btn.dataset.dir as Direction);
    });
    return pad;
  };

  const onKeydown = (e: KeyboardEvent): void => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const map: Record<string, Direction | undefined> = {
      ArrowUp: "Up",
      ArrowDown: "Down",
      ArrowLeft: "Left",
      ArrowRight: "Right",
      w: "Up",
      s: "Down",
      a: "Left",
      d: "Right",
    };
    const dir = map[e.key];
    if (!dir) return;
    playDir(dir);
    e.preventDefault();
  };

  const presentResult = async (): Promise<void> => {
    if (!container || !game) return;
    const env = game.outcome(declareAssistanceEnabled()) as Twenty48Envelope;
    const bestTile = game.board().maxTile;
    container.replaceChildren(el("div", { class: "sol-loading" }, "Preparing your verifiable result…"));
    const shareUrl = await shareUrlFor(env);
    if (disposed || !container) return;
    const build = (): HTMLElement =>
      renderResultScreen(env, verify(env), {
        bestTile,
        shareUrl,
        onReverify: () => container!.replaceChildren(build()),
        onPlayAgain: () => void startGame(mode),
      });
    container.replaceChildren(build());
  };

  function render(force = false): void {
    if (disposed || !container || !game) return;
    if (force || gameOver()) {
      void presentResult();
      return;
    }
    const board = game.board();
    const banner = el(
      "p",
      { class: "t48-banner" },
      "Slide the board — matching numbers combine (2+2=4). Reach the 2048 tile.",
    );
    // A single centered column: controls, banner, board, and d-pad all share
    // one vertical axis so the directional keys read as belonging to the board.
    const game_ = el(
      "div",
      { class: "t48-game" },
      renderControls(board),
      banner,
      renderBoard(board),
      renderPad(),
      statusEl,
    );
    container.replaceChildren(game_);
  }

  async function startGame(nextMode: "daily" | "free", seedOverride?: bigint): Promise<void> {
    if (!game || disposed) return;
    mode = nextMode;
    seed =
      seedOverride ??
      (nextMode === "daily" ? BigInt(game.dailySeed(dayIndexUTC(new Date()))) : randomSeed());
    game.newGame(seed);
    setStatus("");
    console.debug(`[2048] mount seed=${seed} mode=${mode}`);
    exposeHook();
    render();
  }

  const showShared = async (payload: string): Promise<void> => {
    if (!container) return;
    let env: Twenty48Envelope;
    try {
      env = await decodeRecord(payload);
    } catch {
      container.replaceChildren(el("div", { class: "sol-error" }, "This shared result could not be read."));
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
    window.__t2048 = {
      game,
      refresh: () => render(),
      seed,
      playDir: (dir: Direction) => playDir(dir),
    };
  };

  return {
    mount(c: HTMLElement): void {
      container = c;
      disposed = false;
      container.replaceChildren(el("div", { class: "sol-loading" }, "Loading 2048…"));
      document.addEventListener("keydown", onKeydown);
      void (async () => {
        try {
          game = await Twenty48.load();
          verifier = await Twenty48.load();
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
        if (seedParam !== null) {
          await startGame("free", BigInt(seedParam));
          return;
        }
        await startGame("daily");
      })();
    },
    unmount(): void {
      disposed = true;
      document.removeEventListener("keydown", onKeydown);
      delete window.__t2048;
      container?.replaceChildren();
      container = null;
      game = null;
      verifier = null;
    },
  };
}
