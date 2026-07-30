//! The match-3 board (Candy-Crush-style target-score-in-moves) over the
//! `match3-wasm` binding. Tap a gem, then an adjacent gem, to swap — the core
//! decides which swaps are legal; the UI only highlights and calls `play`. When
//! the move budget runs out the score is graded into stars and a verifiable
//! `pond-outcome` record is shown, shareable via `?r=`.

import type { GameModule } from "../contract.js";
import { Match3, type BoardView, type Frame, type Swap } from "./match3-wasm.js";
import {
  decodeRecord,
  encodeRecord,
  verifyRecord,
  type M3Envelope,
  type VerifyResult,
} from "./match3-outcome.js";
import { dayIndexUTC } from "./share.js";
import {
  declareAssistanceEnabled,
  hintsEnabled,
  setDeclareAssistance,
  setHintsEnabled,
} from "../settings.js";

declare global {
  interface Window {
    /** E2E hook: the live binding + a re-render, so tests drive the core. */
    __match3?: {
      game: Match3;
      refresh: () => void;
      legalMoves: () => Swap[];
      seed: bigint;
    };
  }
}

const GEM_GLYPH = ["●", "▲", "■", "◆", "★", "✚"];
const GEM_NAME = ["circle", "triangle", "square", "diamond", "star", "plus"];

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

const starString = (stars: number): string => "★★★☆☆☆".slice(3 - stars, 6 - stars);

// ---------- the result screen (pure DOM) ----------

function headline(env: M3Envelope, v: VerifyResult): string {
  if (!v.ok) return "Verification FAILED — this result does not check out";
  const stars = env.payload.stars ?? 0;
  if (env.payload.result === "Won") return `Cleared with ${starString(stars)} — verifiable`;
  return "Under target — didn’t reach 1★ this time";
}

export interface ResultScreenOpts {
  shareUrl?: string;
  onReverify?: () => void;
  onPlayAgain?: () => void;
  shared?: boolean;
}

/** Build the match-3 result screen: outcome headline, verification badge, the
 *  record (score / stars / moves / seed / hash), and share/re-verify controls. */
export function renderResultScreen(
  env: M3Envelope,
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
    ? "Verified ✓ — re-checked by replaying every swap against the core."
    : `Verification failed — expected hash ${verification.expected}, replay produced ${verification.actual}.`;
  section.append(badge);

  const dl = el("dl", { class: "sol-record" });
  const row = (term: string, value: string, cls = ""): void => {
    dl.append(el("dt", {}, term), el("dd", cls ? { class: cls } : {}, value));
  };
  row("Result", rec.result);
  row("Score", String(rec.score ?? 0));
  row("Stars", starString(rec.stars ?? 0));
  row("Swaps used", String(rec.move_count));
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

/** Construct a fresh match-3 module (the registry `load`). */
export function match3Module(): GameModule {
  let game: Match3 | null = null;
  let verifier: Match3 | null = null;
  let container: HTMLElement | null = null;
  let disposed = false;

  let mode: "daily" | "free" = "daily";
  let seed = 0n;
  let selected: { r: number; c: number } | null = null;
  let hint: Swap | null = null;
  let cascadeEl: HTMLElement | null = null;
  let lastScore = 0;
  let scoreBumped = false;
  let animating = false;

  // Per-phase cascade animation cadence. A move emits swap + 3 frames per cascade
  // step (clear/fall/refill), so a 1–3-step move runs ~0.3–0.8s.
  const FRAME_MS = 80;
  const delay = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms));

  const reducedMotion = (): boolean => {
    try {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      return true; // no matchMedia (or it threw) → skip the animation, safely
    }
  };

  const statusEl = el("p", { class: "sol-status", role: "status", "aria-live": "polite" });
  const setStatus = (msg: string): void => {
    statusEl.textContent = msg;
  };

  const randomSeed = (): bigint => {
    const buf = new Uint32Array(2);
    crypto.getRandomValues(buf);
    return (BigInt(buf[0]!) << 16n) ^ BigInt(buf[1]! & 0xffff);
  };

  const shareUrlFor = async (env: M3Envelope): Promise<string> =>
    `${location.origin}${location.pathname}?r=${await encodeRecord(env)}`;

  const verify = (env: M3Envelope): VerifyResult => verifyRecord(verifier!, env);

  const adjacent = (a: { r: number; c: number }, r: number, c: number): boolean =>
    Math.abs(a.r - r) + Math.abs(a.c - c) === 1;

  /** The legal swap connecting `a` and `(r,c)`, if the core allows it. */
  const swapBetween = (a: { r: number; c: number }, r: number, c: number): Swap | null => {
    for (const s of game!.legalMoves()) {
      if (
        (s[0] === a.r && s[1] === a.c && s[2] === r && s[3] === c) ||
        (s[0] === r && s[1] === c && s[2] === a.r && s[3] === a.c)
      ) {
        return s;
      }
    }
    return null;
  };

  const gameOver = (): boolean => !!game && (game.movesLeft() === 0 || game.legalMoves().length === 0);

  // One animation frame board (decorative + aria-hidden). Empty cells are holes
  // mid-cascade; letters would be blockers (not present on v1 boards).
  const renderFrame = (rows: Frame): HTMLElement => {
    const boardEl = el("div", { class: "m3-board m3-animating", tabindex: "-1", "aria-hidden": "true" });
    rows.forEach((row) => {
      const rowEl = el("div", { class: "m3-row" });
      for (const ch of row) {
        if (ch >= "0" && ch <= "9") {
          const color = Number(ch);
          const g = el("span", { class: `m3-gem gem-${color}` });
          g.textContent = GEM_GLYPH[color]!;
          rowEl.append(g);
        } else if (ch === ".") {
          rowEl.append(el("span", { class: "m3-gem m3-hole" }));
        } else {
          rowEl.append(el("span", { class: "m3-gem m3-blocker" }, "▨"));
        }
      }
      boardEl.append(rowEl);
    });
    return boardEl;
  };

  // Step through the per-phase snapshots, swapping just the board element so the
  // HUD/controls stay put. Input is gated (`animating`) until the settled render.
  const animateSnapshots = async (frames: Frame[]): Promise<void> => {
    if (!container) return;
    animating = true;
    try {
      for (const frame of frames) {
        if (disposed || !container) return;
        const current = container.querySelector<HTMLElement>(".m3-board");
        if (!current) return;
        current.replaceWith(renderFrame(frame));
        await delay(FRAME_MS);
      }
    } finally {
      animating = false;
    }
  };

  const applySwap = (s: Swap): void => {
    // The core applies the whole move now (wasm state is settled immediately);
    // the frames are only the intermediate boards the UI animates over.
    const frames = game!.playTraced(s);
    selected = null;
    hint = null;
    setStatus("");
    if (reducedMotion() || frames.length === 0) {
      render();
      return;
    }
    void animateSnapshots(frames).then(() => {
      if (!disposed) render();
    });
  };

  const handleClick = (r: number, c: number): void => {
    if (!game || animating || gameOver()) return;
    hint = null;
    if (!selected) {
      selected = { r, c };
      applyGlow();
      return;
    }
    if (selected.r === r && selected.c === c) {
      selected = null;
      applyGlow();
      return;
    }
    if (adjacent(selected, r, c)) {
      const s = swapBetween(selected, r, c);
      if (s) {
        applySwap(s);
        return;
      }
      setStatus("That swap makes no match.");
    }
    selected = { r, c }; // switch selection
    applyGlow();
  };

  // --- hints ---

  const showHint = (): void => {
    if (!game || animating || gameOver()) return;
    const moves = game.legalMoves();
    if (moves.length === 0) {
      render(); // no moves -> the game is over
      return;
    }
    game.markAssistance();
    hint = moves[0]!;
    selected = null;
    setStatus(
      `Hint: swap row ${hint[0] + 1} col ${hint[1] + 1} with row ${hint[2] + 1} col ${hint[3] + 1} (a hint counts as assistance)`,
    );
    applyGlow();
  };

  const endNow = (): void => {
    // "I'm stuck" with hints off: spend the rest of the budget and tally.
    setStatus("");
    render(true);
  };

  // --- rendering ---

  const gemButton = (color: number, r: number, c: number): HTMLElement => {
    const b = el("button", {
      type: "button",
      class: `m3-gem gem-${color}`,
      "data-r": String(r),
      "data-c": String(c),
      draggable: "true", // drag-to-swap fast-follow; tapping still works
      "aria-label": `${GEM_NAME[color]} gem, row ${r + 1} column ${c + 1}`,
    });
    b.textContent = GEM_GLYPH[color]!;
    return b;
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
      { class: "m3-hud" },
      el("span", { class: `m3-score${scoreBumped ? " bump" : ""}` }, `Score ${board.score}`),
      el("span", { class: "m3-moves" }, `Swaps left ${board.movesLeft}`),
      el("span", { class: "m3-stars", "aria-label": `${board.stars} of 3 stars` }, starString(board.stars)),
      el("span", { class: "m3-target" }, `Targets ${board.targets.join(" / ")}`),
    );

    bar.append(modes, actionBtn, settings);
    const wrap = el("div");
    wrap.append(bar, hud);
    return wrap;
  };

  const renderBoard = (board: BoardView): HTMLElement => {
    const boardEl = el("div", { class: "m3-board", tabindex: "-1" });
    board.cells.forEach((row, r) => {
      const rowEl = el("div", { class: "m3-row" });
      row.forEach((color, c) => rowEl.append(gemButton(color, r, c)));
      boardEl.append(rowEl);
    });
    boardEl.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>(".m3-gem");
      if (!btn) return;
      handleClick(Number(btn.dataset.r), Number(btn.dataset.c));
    });

    // Drag-to-swap: same source→target resolution as tapping, so the core still
    // decides legality. Tapping remains the accessible floor.
    let dragFrom: { r: number; c: number } | null = null;
    boardEl.addEventListener("dragstart", (e: DragEvent) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>(".m3-gem");
      if (!btn || animating || gameOver()) {
        e.preventDefault();
        return;
      }
      dragFrom = { r: Number(btn.dataset.r), c: Number(btn.dataset.c) };
      selected = dragFrom;
      hint = null;
      applyGlow();
      e.dataTransfer?.setData("text/plain", "gem");
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
    });
    boardEl.addEventListener("dragover", (e: DragEvent) => {
      if (dragFrom) e.preventDefault();
    });
    boardEl.addEventListener("drop", (e: DragEvent) => {
      if (!dragFrom) return;
      e.preventDefault();
      const btn = (e.target as HTMLElement).closest<HTMLElement>(".m3-gem");
      const from = dragFrom;
      dragFrom = null;
      if (!btn) {
        selected = null;
        applyGlow();
        return;
      }
      const r = Number(btn.dataset.r);
      const c = Number(btn.dataset.c);
      const swap = adjacent(from, r, c) ? swapBetween(from, r, c) : null;
      if (swap) {
        applySwap(swap);
      } else {
        selected = null;
        applyGlow();
        setStatus("That swap makes no match.");
      }
    });
    boardEl.addEventListener("dragend", () => {
      if (!dragFrom) return;
      dragFrom = null;
      selected = null;
      applyGlow();
    });
    return boardEl;
  };

  const gemAt = (r: number, c: number): HTMLElement | null =>
    container?.querySelector<HTMLElement>(`.m3-gem[data-r="${r}"][data-c="${c}"]`) ?? null;

  const applyGlow = (): void => {
    if (!container) return;
    container
      .querySelectorAll(".legal-target, .selected, .hint-from, .hint-to")
      .forEach((e) => e.classList.remove("legal-target", "selected", "hint-from", "hint-to"));
    if (hint) {
      gemAt(hint[0], hint[1])?.classList.add("hint-from");
      gemAt(hint[2], hint[3])?.classList.add("hint-to");
      return;
    }
    if (!selected) return;
    gemAt(selected.r, selected.c)?.classList.add("selected");
    for (const s of game!.legalMoves()) {
      if (s[0] === selected.r && s[1] === selected.c) gemAt(s[2], s[3])?.classList.add("legal-target");
      else if (s[2] === selected.r && s[3] === selected.c) gemAt(s[0], s[1])?.classList.add("legal-target");
    }
  };

  // A brief celebratory gem cascade on a passing result; decorative and
  // aria-hidden; skipped under reduced-motion; removed on unmount.
  const playCascade = (): void => {
    try {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    } catch {
      return;
    }
    const layer = el("div", { class: "sol-cascade", "aria-hidden": "true" });
    for (let i = 0; i < 24; i += 1) {
      const s = el("span", { class: `gem-${i % 6}` }, GEM_GLYPH[i % 6]!);
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
    const env = game.outcome(declareAssistanceEnabled()) as M3Envelope;
    if ((env.payload.stars ?? 0) >= 1) playCascade();
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
    scoreBumped = board.score > lastScore;
    lastScore = board.score;
    container.replaceChildren(renderControls(board), renderBoard(board), statusEl);
    applyGlow();
  }

  async function startGame(nextMode: "daily" | "free", seedOverride?: bigint): Promise<void> {
    if (!game || disposed) return;
    mode = nextMode;
    seed =
      seedOverride ??
      (nextMode === "daily" ? BigInt(dayIndexUTC(new Date())) : randomSeed());
    selected = null;
    hint = null;
    lastScore = 0;
    scoreBumped = false;
    setStatus("");
    game.newGame(seed);
    exposeHook();
    render();
  }

  const showShared = async (payload: string): Promise<void> => {
    if (!container) return;
    let env: M3Envelope;
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
    window.__match3 = {
      game,
      refresh: () => render(),
      legalMoves: () => game!.legalMoves(),
      seed,
    };
  };

  return {
    mount(c: HTMLElement): void {
      container = c;
      disposed = false;
      container.replaceChildren(el("div", { class: "sol-loading" }, "Loading match-3…"));
      void (async () => {
        try {
          game = await Match3.load();
          verifier = await Match3.load();
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
      delete window.__match3;
      cascadeEl?.remove();
      cascadeEl = null;
      container?.replaceChildren();
      container = null;
      game = null;
      verifier = null;
      selected = null;
    },
  };
}
