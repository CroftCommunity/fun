//! The bubble-shooter board (clear-the-board-in-N-shots) over the `bubble-wasm`
//! binding. The launcher loads a colour; tap a glowing empty cell to drop it
//! there — the core decides which cells are reachable (`legalTargets`), the UI
//! only glows them and calls `shoot`. Clusters of 3+ pop; disconnected bubbles
//! drop. When the board clears (or shots run out) a verifiable `pond-outcome`
//! record is shown, shareable via `?r=`.

import type { GameModule } from "../../contract.js";
import { Bubble, type BoardView, type Target } from "./bubble-wasm.js";
import {
  decodeRecord,
  encodeRecord,
  verifyRecord,
  type BubbleEnvelope,
  type VerifyResult,
} from "./bubble-outcome.js";
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
    __bubble?: {
      game: Bubble;
      refresh: () => void;
      legalTargets: () => Target[];
      seed: bigint;
    };
  }
}

const BUBBLE_GLYPH = ["●", "▲", "■", "◆", "★", "✚"];
const BUBBLE_NAME = ["circle", "triangle", "square", "diamond", "star", "plus"];

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

function headline(env: BubbleEnvelope, v: VerifyResult): string {
  if (!v.ok) return "Verification FAILED — this result does not check out";
  return env.payload.result === "Won"
    ? `Board cleared in ${env.payload.move_count} shots — verifiable`
    : "Ran out of shots — bubbles remain";
}

export interface ResultScreenOpts {
  shareUrl?: string;
  onReverify?: () => void;
  onPlayAgain?: () => void;
  shared?: boolean;
}

/** Build the bubble result screen: outcome headline, verification badge, the
 *  record (result / score / shots / seed / hash), and share/re-verify controls. */
export function renderResultScreen(
  env: BubbleEnvelope,
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
    ? "Verified ✓ — re-checked by replaying every shot against the core."
    : `Verification failed — expected hash ${verification.expected}, replay produced ${verification.actual}.`;
  section.append(badge);

  const dl = el("dl", { class: "sol-record" });
  const row = (term: string, value: string, cls = ""): void => {
    dl.append(el("dt", {}, term), el("dd", cls ? { class: cls } : {}, value));
  };
  row("Result", rec.result);
  row("Score", String(rec.score ?? 0));
  row("Shots used", String(rec.move_count));
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

/** Construct a fresh bubble-shooter module (the registry `load`). */
export function bubbleModule(): GameModule {
  let game: Bubble | null = null;
  let verifier: Bubble | null = null;
  let container: HTMLElement | null = null;
  let disposed = false;

  let mode: "daily" | "free" = "daily";
  let seed = 0n;
  let hint: Target | null = null;
  let cascadeEl: HTMLElement | null = null;

  const statusEl = el("p", { class: "sol-status", role: "status", "aria-live": "polite" });
  const setStatus = (msg: string): void => {
    statusEl.textContent = msg;
  };

  const randomSeed = (): bigint => {
    const buf = new Uint32Array(2);
    crypto.getRandomValues(buf);
    return (BigInt(buf[0]!) << 16n) ^ BigInt(buf[1]! & 0xffff);
  };

  const shareUrlFor = async (env: BubbleEnvelope): Promise<string> =>
    `${location.origin}${location.pathname}?r=${await encodeRecord(env)}`;

  const verify = (env: BubbleEnvelope): VerifyResult => verifyRecord(verifier!, env);

  // The round is over when the board clears or the shot budget runs out.
  const gameOver = (): boolean => {
    if (!game) return false;
    const b = game.board();
    return b.cleared || b.shotsLeft === 0;
  };

  const isLegal = (r: number, c: number): boolean =>
    game!.legalTargets().some((t) => t[0] === r && t[1] === c);

  const shootAt = (r: number, c: number): void => {
    if (!game || gameOver()) return;
    if (!isLegal(r, c)) return; // the core decides; an illegal tap is a no-op
    hint = null;
    setStatus("");
    game.shoot([r, c]);
    render();
  };

  // --- hints ---

  const showHint = (): void => {
    if (!game || gameOver()) return;
    const targets = game.legalTargets();
    if (targets.length === 0) {
      render(); // no targets -> the game is over
      return;
    }
    game.markAssistance();
    hint = targets[0]!;
    setStatus(`Hint: aim at row ${hint[0] + 1} col ${hint[1] + 1} (a hint counts as assistance)`);
    applyGlow();
  };

  const endNow = (): void => {
    // "I'm stuck" with hints off: end the round and report honestly.
    const stuckWithMoves = !!game && !gameOver() && game.legalTargets().length > 0;
    setStatus(
      stuckWithMoves ? "Ended early — a legal shot was still available." : "Ended — no shot was available.",
    );
    render(true);
  };

  // --- rendering ---

  const launcher = (board: BoardView): HTMLElement => {
    const color = board.currentColor;
    const chip = el(
      "span",
      { class: `bub-cell bub-bubble bub-color-${color}`, role: "img", "aria-label": `${BUBBLE_NAME[color] ?? "bubble"} bubble loaded` },
      BUBBLE_GLYPH[color] ?? "●",
    );
    return el("div", { class: "bub-launcher" }, el("span", { class: "bub-launcher-label" }, "Launcher"), chip);
  };

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
      { class: "bub-hud" },
      el("span", { class: "bub-score" }, `Score ${board.score}`),
      el("span", { class: "bub-shots" }, `Shots left ${board.shotsLeft}`),
    );

    bar.append(modes, actionBtn, settings);
    const wrap = el("div");
    wrap.append(bar, launcher(board), hud);
    return wrap;
  };

  const renderBoard = (board: BoardView): HTMLElement => {
    const legal = new Set(game!.legalTargets().map((t) => `${t[0]},${t[1]}`));
    const boardEl = el("div", { class: "bub-board", tabindex: "-1" });
    board.cells.forEach((row, r) => {
      const rowEl = el("div", { class: `bub-row${r % 2 === 1 ? " bub-row-odd" : ""}` });
      row.forEach((color, c) => {
        if (color >= 0) {
          const b = el(
            "span",
            {
              class: `bub-cell bub-bubble bub-color-${color}`,
              role: "img",
              "aria-label": `${BUBBLE_NAME[color] ?? "bubble"} bubble, row ${r + 1} column ${c + 1}`,
            },
            BUBBLE_GLYPH[color] ?? "●",
          );
          rowEl.append(b);
        } else if (legal.has(`${r},${c}`)) {
          const t = el("button", {
            type: "button",
            class: "bub-cell bub-target legal-target",
            "data-r": String(r),
            "data-c": String(c),
            "aria-label": `drop here, row ${r + 1} column ${c + 1}`,
          });
          rowEl.append(t);
        } else {
          rowEl.append(el("span", { class: "bub-cell bub-empty", "aria-hidden": "true" }));
        }
      });
      boardEl.append(rowEl);
    });
    boardEl.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>(".bub-target");
      if (!btn) return;
      shootAt(Number(btn.dataset.r), Number(btn.dataset.c));
    });
    return boardEl;
  };

  const applyGlow = (): void => {
    if (!container) return;
    container.querySelectorAll(".hint-target").forEach((e) => e.classList.remove("hint-target"));
    if (hint) {
      container
        .querySelector<HTMLElement>(`.bub-target[data-r="${hint[0]}"][data-c="${hint[1]}"]`)
        ?.classList.add("hint-target");
    }
  };

  // A brief celebratory bubble cascade on a cleared board; decorative and
  // aria-hidden; skipped under reduced-motion; removed on unmount.
  const playCascade = (): void => {
    try {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    } catch {
      return;
    }
    const layer = el("div", { class: "sol-cascade", "aria-hidden": "true" });
    for (let i = 0; i < 24; i += 1) {
      // Reuse the shared `.sol-cascade .gem-N` colour + fall animation.
      const s = el("span", { class: `gem-${i % 6}` }, BUBBLE_GLYPH[i % 6]!);
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

  const presentResult = async (): Promise<void> => {
    if (!container || !game) return;
    const env = game.outcome(declareAssistanceEnabled()) as BubbleEnvelope;
    if (env.payload.result === "Won") playCascade();
    container.replaceChildren(el("div", { class: "sol-loading" }, "Preparing your verifiable result…"));
    const shareUrl = await shareUrlFor(env);
    if (disposed || !container) return;
    const build = (): HTMLElement =>
      renderResultScreen(env, verify(env), {
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
    container.replaceChildren(renderControls(board), renderBoard(board), statusEl);
    applyGlow();
  }

  async function startGame(nextMode: "daily" | "free", seedOverride?: bigint): Promise<void> {
    if (!game || disposed) return;
    mode = nextMode;
    seed =
      seedOverride ??
      (nextMode === "daily" ? BigInt(game.dailySeed(dayIndexUTC(new Date()))) : randomSeed());
    game.newGame(seed);
    hint = null;
    setStatus("");
    exposeHook();
    render();
  }

  const showShared = async (payload: string): Promise<void> => {
    if (!container) return;
    let env: BubbleEnvelope;
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
    window.__bubble = {
      game,
      refresh: () => render(),
      legalTargets: () => game!.legalTargets(),
      seed,
    };
  };

  return {
    mount(c: HTMLElement): void {
      container = c;
      disposed = false;
      container.replaceChildren(el("div", { class: "sol-loading" }, "Loading bubble shooter…"));
      void (async () => {
        try {
          game = await Bubble.load();
          verifier = await Bubble.load();
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
      delete window.__bubble;
      cascadeEl?.remove();
      cascadeEl = null;
      container?.replaceChildren();
      container = null;
      game = null;
      verifier = null;
      hint = null;
    },
  };
}
