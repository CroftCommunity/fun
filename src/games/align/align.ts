//! The Align board over the `align-wasm` binding. A real-time falling-block
//! stacker: move with the arrow keys / on-screen pad, rotate, hold, hard-drop.
//! The core owns every rule — gravity, kicks, lock delay, scoring — and the run
//! replays byte-identically from its tick-stamped action record, so the result is
//! a verifiable `pond-outcome` shareable via `?r=`.
//!
//! Determinism contract: the wall clock only drives the fixed-timestep
//! accumulator (how many `tick()`s this frame) and stamps captured inputs with
//! the engine's current tick. Nothing time-based ever decides the outcome.

import type { GameModule, GameServices } from "../../contract.js";
import type { GameFrame, GameFrameSpec } from "../../game-frame.js";
import type { SettingRow } from "../../settings-sheet.js";
import { Align, type Action, type BoardView, type Cell, type SharedVerify } from "./align-wasm.js";
import { decodeRecord, encodeRecord, type AlignEnvelope } from "./align-outcome.js";
import { dayIndexUTC } from "../share.js";
import {
  alignHapticsEnabled,
  alignMoveSpeed,
  ALIGN_MOVE_SPEED_SPEC,
  declareAssistanceEnabled,
  hintsEnabled,
  moveSpeedToMs,
  setAlignHaptics,
  setAlignMoveSpeed,
} from "../../settings.js";

declare global {
  interface Window {
    /** E2E hook: drive the core deterministically without real time. */
    __align?: {
      game: Align;
      input: (a: Action) => void;
      tick: (n?: number) => void;
      board: () => BoardView;
      seed: bigint;
      startFree: (seed: bigint, mode: number) => void;
      /** The live left/right hold-repeat interval (ms) for the current speed. */
      moveRepeatMs: () => number;
    };
  }
}

const CELL = 28;
const COLS = 10;
const VISIBLE = 20;
const ROWS_SHOWN = VISIBLE + 2; // 2 buffer rows as a sliver above the field
const TICK_MS = 1000 / 60;

// Handling (ms). Conventional modern defaults; a config screen is a follow-up.
const DAS_MS = 133;
const ARR_MS = 12;
const SOFT_PER_FRAME = 2;

// On-screen pad: a tap is one clean cell; a hold waits TOUCH_DAS_MS before it
// starts auto-repeating. Left/right repeat at the player's chosen speed
// (`moveSpeedToMs`); soft drop keeps its own snappy fixed cadence.
const TOUCH_DAS_MS = 170;
const SOFT_REPEAT_MS = 45;

// Preview/hold thumbnail shapes (spawn orientation, y-down 0..3). Cosmetic only —
// the authoritative shapes live in the core; these just draw the little previews.
const THUMB: Record<number, Cell[]> = {
  1: [[0, 1], [1, 1], [2, 1], [3, 1]],
  2: [[1, 0], [2, 0], [1, 1], [2, 1]],
  3: [[1, 0], [0, 1], [1, 1], [2, 1]],
  4: [[1, 0], [2, 0], [0, 1], [1, 1]],
  5: [[0, 0], [1, 0], [1, 1], [2, 1]],
  6: [[0, 0], [0, 1], [1, 1], [2, 1]],
  7: [[2, 0], [0, 1], [1, 1], [2, 1]],
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

function palette(): { pieces: string[]; board: string; grid: string; ghost: string } {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string): string => cs.getPropertyValue(name).trim() || fallback;
  return {
    pieces: [
      v("--al-i", "#7c5cff"),
      v("--al-o", "#ff6b5e"),
      v("--al-t", "#1fb6a6"),
      v("--al-s", "#e8b93e"),
      v("--al-z", "#4aa8ff"),
      v("--al-j", "#e05c8f"),
      v("--al-l", "#5cc96a"),
    ],
    board: v("--al-board", "#12141c"),
    grid: v("--al-grid", "#262b3b"),
    ghost: v("--al-ghost", "#6b7186"),
  };
}

// ---------- the result screen (reuses the shared sol- result styling) ----------

function headline(env: AlignEnvelope, v: SharedVerify): string {
  if (!v.ok) return "Verification FAILED — this result does not check out";
  return env.payload.result === "Won"
    ? `Cleared the goal — score ${env.payload.score ?? 0}, verifiable`
    : `Score ${env.payload.score ?? 0} — verifiable`;
}

interface ResultOpts {
  stats?: { pieces: number; lines: number; tspins: number; aligns: number; maxCombo: number };
  shareUrl?: string;
  onReverify?: () => void;
  onPlayAgain?: () => void;
  shared?: boolean;
}

function renderResultScreen(env: AlignEnvelope, v: SharedVerify, opts: ResultOpts = {}): HTMLElement {
  const rec = env.payload;
  const section = el("section", { class: "sol-result", role: "region", "aria-label": "Result" });
  section.append(el("h2", { class: "sol-headline" }, headline(env, v)));

  const badge = el("p", { class: `sol-verify-badge ${v.ok ? "ok" : "fail"}`, role: "status" });
  badge.textContent = v.ok
    ? "Verified ✓ — re-checked by replaying every move against the core."
    : `Verification failed — expected hash ${v.expected}, replay produced ${v.actual}.`;
  section.append(badge);

  const dl = el("dl", { class: "sol-record" });
  const row = (t: string, val: string, cls = ""): void => {
    dl.append(el("dt", {}, t), el("dd", cls ? { class: cls } : {}, val));
  };
  row("Result", rec.result);
  row("Score", String(rec.score ?? 0));
  if (opts.stats) {
    row("Lines", String(opts.stats.lines));
    row("Pieces", String(opts.stats.pieces));
    if (opts.stats.aligns) row("Aligns", String(opts.stats.aligns));
    if (opts.stats.tspins) row("T-spins", String(opts.stats.tspins));
  }
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

type ModeChoice = "daily" | "marathon" | "sprint";
const MODE_LABEL: Record<ModeChoice, string> = { daily: "Marathon (daily)", marathon: "Marathon", sprint: "Sprint 40" };

// The New game card's choice lives at module scope: the poster renders the card
// before the module exists, and the module reads it when a run starts.
let chosenMode: ModeChoice = "daily";

/** The New game card: today's marathon, a fresh marathon, or a sprint to forty lines. */
export function alignSetupRows(): SettingRow[] {
  return [
    {
      kind: "choice",
      id: "mode",
      label: "Mode",
      hint: "Marathon speeds up as you clear lines; the daily one is the same seed for everyone today. Sprint asks for forty rows as fast as you can.",
      value: chosenMode,
      options: [
        { value: "daily", label: "Marathon (daily)" },
        { value: "marathon", label: "New Marathon" },
        { value: "sprint", label: "Sprint 40" },
      ],
      onChange: (v) => {
        chosenMode = v === "sprint" ? "sprint" : v === "marathon" ? "marathon" : "daily";
      },
    },
  ];
}

/** The poster's setup card — the registry's `setup` factory. */
export const alignSetup = (): SettingRow[] => alignSetupRows();

/** Construct a fresh Align module (the registry `load`). */
export function alignModule(): GameModule {
  let game: Align | null = null;
  let verifier: Align | null = null;
  let container: HTMLElement | null = null;
  let disposed = false;

  let mode: "daily" | "free" = "daily";
  let modeId = 0; // 0 Marathon, 1 Sprint
  const startLevel = 1; // start-level selection is a follow-up (see TODO/align.md)
  let seed = 0n;
  const pal = { ...palette() };

  let canvas: HTMLCanvasElement | null = null;
  let holdCanvas: HTMLCanvasElement | null = null;
  let nextCanvas: HTMLCanvasElement | null = null;
  let callout: HTMLElement | null = null;
  let hintCells: Cell[] | null = null;

  let raf = 0;
  let last = 0;
  let acc = 0;
  let running = false;
  let paused = false;
  let gf: GameFrame | null = null;
  let toasted = false;
  /** The last stats the meters showed — the loop renders every frame; the frame is told only on a change. */
  let shown = "";

  const statusEl = el("p", { class: "sol-status", role: "status", "aria-live": "polite" });
  const setStatus = (m: string): void => {
    statusEl.textContent = m;
  };

  const randomSeed = (): bigint => {
    const buf = new Uint32Array(2);
    crypto.getRandomValues(buf);
    return (BigInt(buf[0]!) << 16n) ^ BigInt(buf[1]! & 0xffff);
  };

  // ---- input handling (DAS/ARR + soft drop) ----
  const held = new Set<string>();
  let dir = 0; // -1 left, +1 right, 0 none
  let dasStart = 0;
  let lastArr = 0;
  let softHeld = false;

  const act = (a: Action): void => {
    if (!game || paused || game.isOver()) return;
    game.input(a);
    hintCells = null;
  };

  const startDir = (d: number): void => {
    dir = d;
    dasStart = performance.now();
    lastArr = dasStart;
    act(d < 0 ? "ShiftL" : "ShiftR");
  };

  const pumpAutorepeat = (now: number): void => {
    if (dir === 0 || !game || paused) return;
    if (now - dasStart < DAS_MS) return;
    if (ARR_MS <= 0) {
      // instant to wall
      while (game.input(dir < 0 ? "ShiftL" : "ShiftR") === "applied") {
        /* shift until it stops */
      }
    } else if (now - lastArr >= ARR_MS) {
      act(dir < 0 ? "ShiftL" : "ShiftR");
      lastArr = now;
    }
    if (softHeld) for (let i = 0; i < SOFT_PER_FRAME; i++) act("SoftStep");
  };

  const onKeydown = (e: KeyboardEvent): void => {
    if (e.metaKey || e.altKey) return;
    const k = e.key;
    if (k === "Escape" || k === "p" || k === "P") {
      togglePause();
      e.preventDefault();
      return;
    }
    if (!game || game.isOver() || paused) return;
    if (held.has(k) && k !== " ") return; // ignore OS auto-repeat except handled below
    held.add(k);
    switch (k) {
      case "ArrowLeft":
        startDir(-1);
        break;
      case "ArrowRight":
        startDir(1);
        break;
      case "ArrowUp":
      case "x":
      case "X":
        act("RotCW");
        break;
      case "z":
      case "Z":
      case "Control":
        act("RotCCW");
        break;
      case "ArrowDown":
        softHeld = true;
        act("SoftStep");
        break;
      case " ":
        act("HardDrop");
        break;
      case "c":
      case "C":
      case "Shift":
        act("Hold");
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  const onKeyup = (e: KeyboardEvent): void => {
    held.delete(e.key);
    if ((e.key === "ArrowLeft" && dir < 0) || (e.key === "ArrowRight" && dir > 0)) dir = 0;
    if (e.key === "ArrowDown") softHeld = false;
  };

  // ---- the fixed-timestep loop ----
  const frame = (now: number): void => {
    if (disposed || !game) return;
    if (!paused) {
      pumpAutorepeat(now);
      acc += Math.min(now - last, 250);
      while (acc >= TICK_MS) {
        game.tick();
        acc -= TICK_MS;
        if (game.isOver()) break;
      }
    }
    last = now;
    render(game.board());
    if (game.isOver()) {
      running = false;
      void presentResult();
      return;
    }
    if (running) raf = requestAnimationFrame(frame);
  };

  const startLoop = (): void => {
    if (running) return;
    running = true;
    last = performance.now();
    acc = 0;
    raf = requestAnimationFrame(frame);
  };

  const togglePause = (): void => {
    if (!game || game.isOver()) return;
    paused = !paused;
    setStatus(paused ? "Paused — press P or Esc to resume." : "");
    if (!paused) {
      last = performance.now();
      if (!running) startLoop();
    }
  };

  // ---- rendering ----
  const drawCell = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    color: string,
    ghost = false,
  ): void => {
    const screenRow = ROWS_SHOWN - 1 - y;
    if (screenRow < 0 || screenRow >= ROWS_SHOWN || x < 0 || x >= COLS) return;
    const px = x * CELL;
    const py = screenRow * CELL;
    if (ghost) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(px + 2, py + 2, CELL - 4, CELL - 4);
      return;
    }
    ctx.fillStyle = color;
    ctx.fillRect(px + 1, py + 1, CELL - 2, CELL - 2);
    // a light top-bevel for a bit of depth
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fillRect(px + 1, py + 1, CELL - 2, 3);
  };

  const render = (b: BoardView): void => {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = pal.board;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // grid
    ctx.strokeStyle = pal.grid;
    ctx.lineWidth = 1;
    for (let x = 0; x <= COLS; x++) {
      ctx.beginPath();
      ctx.moveTo(x * CELL + 0.5, 0);
      ctx.lineTo(x * CELL + 0.5, ROWS_SHOWN * CELL);
      ctx.stroke();
    }
    for (let r = 0; r <= ROWS_SHOWN; r++) {
      ctx.beginPath();
      ctx.moveTo(0, r * CELL + 0.5);
      ctx.lineTo(COLS * CELL, r * CELL + 0.5);
      ctx.stroke();
    }
    // the buffer/field boundary line (below the 2 buffer rows)
    ctx.strokeStyle = pal.ghost;
    ctx.beginPath();
    ctx.moveTo(0, 2 * CELL + 0.5);
    ctx.lineTo(COLS * CELL, 2 * CELL + 0.5);
    ctx.stroke();

    // locked cells
    for (let y = 0; y < ROWS_SHOWN; y++) {
      const rowVals = b.rows[y];
      if (!rowVals) continue;
      for (let x = 0; x < COLS; x++) {
        const id = rowVals[x] ?? 0;
        if (id > 0) drawCell(ctx, x, y, pal.pieces[id - 1]!);
      }
    }
    // ghost, hint, active
    if (b.active) {
      for (const [x, y] of b.active.ghost) drawCell(ctx, x, y, pal.ghost, true);
      if (hintCells) for (const [x, y] of hintCells) drawCell(ctx, x, y, "#ffffff", true);
      for (const [x, y] of b.active.cells) drawCell(ctx, x, y, pal.pieces[b.active.color - 1]!);
    }

    drawThumb(holdCanvas, b.hold, b.holdLocked);
    drawNext(b.next);
    updateHud(b);
  };

  const drawThumb = (cv: HTMLCanvasElement | null, id: number, dim = false): void => {
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const c = 16;
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (id <= 0) return;
    ctx.globalAlpha = dim ? 0.35 : 1;
    ctx.fillStyle = pal.pieces[id - 1]!;
    for (const [x, y] of THUMB[id] ?? []) {
      ctx.fillRect(x * c + 4, y * c + 4, c - 2, c - 2);
    }
    ctx.globalAlpha = 1;
  };

  const drawNext = (next: number[]): void => {
    if (!nextCanvas) return;
    const ctx = nextCanvas.getContext("2d");
    if (!ctx) return;
    const c = 16;
    ctx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
    next.slice(0, 5).forEach((id, i) => {
      if (id <= 0) return;
      ctx.fillStyle = pal.pieces[id - 1]!;
      const oy = i * (3 * c) + 4;
      for (const [x, y] of THUMB[id] ?? []) {
        ctx.fillRect(x * c + 4, y * c + oy, c - 2, c - 2);
      }
    });
  };

  const updateHud = (b: BoardView): void => {
    const stats = `${b.score}|${b.level}|${b.lines}|${b.goalLines}`;
    if (stats !== shown) {
      shown = stats;
      declare();
    }
    if (callout) {
      const parts: string[] = [];
      if (b.combo > 1) parts.push(`Combo ${b.combo}`);
      if (b.b2b) parts.push("Back-to-Back");
      if (b.label) parts.unshift(b.label);
      callout.textContent = parts.join(" · ");
    }
  };

  // ---- hint ----
  const showHint = (): void => {
    if (!game || game.isOver() || paused) return;
    const cells = game.hint();
    if (!cells) return;
    game.markAssistance();
    hintCells = cells;
    setStatus("Hint: the outlined placement is a strong spot (counts as assistance).");
    render(game.board());
  };

  const endNow = (): void => {
    if (!game || game.isOver()) return;
    game.input("Quit");
    setStatus("Ended.");
  };

  // ---- chrome ----
  // A short buzz on a touch press, when haptics are on and the device supports
  // it. Silently a no-op on desktop / iOS Safari; never touches the outcome.
  const haptic = (ms = 10): void => {
    if (!alignHapticsEnabled()) return;
    try {
      navigator.vibrate?.(ms);
    } catch {
      /* vibration unsupported — ignore */
    }
  };

  interface TouchOpts {
    /** Auto-repeat while held (after the initial delay). */
    repeat?: boolean;
    /** Repeat interval in ms; read at hold-start so a settings change applies to
     *  the next press. Defaults to the soft-drop cadence. */
    repeatMs?: () => number;
    /** Extra class for row-specific sizing. */
    cls?: string;
  }

  const touchButton = (label: string, aria: string, a: Action, opts: TouchOpts = {}): HTMLElement => {
    const { repeat = false, repeatMs, cls = "" } = opts;
    const b = el(
      "button",
      { type: "button", class: cls ? `al-tbtn ${cls}` : "al-tbtn", "aria-label": aria },
      label,
    );
    let delay = 0;
    let timer = 0;
    const fire = (): void => act(a);
    const stop = (): void => {
      if (delay) window.clearTimeout(delay);
      if (timer) window.clearInterval(timer);
      delay = 0;
      timer = 0;
    };
    b.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      haptic();
      fire();
      if (!repeat) return;
      const gap = repeatMs ? repeatMs() : SOFT_REPEAT_MS;
      // Wait a beat (DAS) so a tap is one cell, then auto-repeat at `gap`.
      delay = window.setTimeout(() => {
        fire();
        timer = window.setInterval(fire, gap);
      }, TOUCH_DAS_MS);
    });
    b.addEventListener("pointerup", stop);
    b.addEventListener("pointerleave", stop);
    b.addEventListener("pointercancel", stop);
    return b;
  };

  // --- what the frame shows: three stats, the mode chip, verbs, the New game card, preferences ---
  const chosenOf = (): ModeChoice => (mode === "daily" ? "daily" : modeId === 1 ? "sprint" : "marathon");
  const spec = (): GameFrameSpec => {
    const b = game?.board();
    const hints = hintsEnabled();
    return {
      title: "Align",
      mode: MODE_LABEL[chosenOf()],
      meters: [
        { kind: "stat", id: "score", value: b?.score ?? 0, label: "score" },
        { kind: "stat", id: "level", value: b?.level ?? 1, label: "level" },
        { kind: "stat", id: "lines", value: b ? `${b.lines} / ${b.goalLines}` : "0", label: "lines" },
      ],
      verbs: [
        hints
          ? { id: "hint", label: "Hint", icon: "✦", primary: true, onPress: showHint }
          : { id: "done", label: "End run", icon: "⇥", onPress: endNow },
        { id: "new", label: "New game", icon: "⟳", onPress: (btn) => gf?.openSheet("setup", btn) },
      ],
      setup: alignSetupRows(),
      preferences: [
        {
          kind: "toggle",
          id: "haptics",
          label: "Vibration (haptics)",
          hint: "A short buzz on each tap of the on-screen controls, where the device supports it.",
          value: alignHapticsEnabled(),
          onChange: (on) => setAlignHaptics(on),
        },
        {
          kind: "range",
          id: "speed",
          label: "Left/right speed",
          hint: "How fast the piece slides while you hold a move button — drag right for faster.",
          value: alignMoveSpeed(),
          min: ALIGN_MOVE_SPEED_SPEC.min,
          max: ALIGN_MOVE_SPEED_SPEC.max,
          step: 1,
          format: (v) => `${v}/10`,
          onChange: (v) => setAlignMoveSpeed(v),
        },
      ],
      onStart: () => void startGame(chosenMode === "daily" ? "daily" : "free", chosenMode === "sprint" ? 1 : 0),
    };
  };
  const declare = (): void => gf?.update(spec());

  const buildStage = (): HTMLElement => {
    canvas = el("canvas", {
      class: "al-board",
      width: String(COLS * CELL),
      height: String(ROWS_SHOWN * CELL),
      role: "img",
      "aria-label": "Align board",
      tabindex: "0",
    }) as HTMLCanvasElement;

    holdCanvas = el("canvas", { class: "al-mini", width: "72", height: "56", "aria-hidden": "true" }) as HTMLCanvasElement;
    nextCanvas = el("canvas", { class: "al-mini al-next", width: "72", height: "248", "aria-hidden": "true" }) as HTMLCanvasElement;
    callout = el("div", { class: "al-callout", role: "status", "aria-live": "polite" });

    const sideL = el("div", { class: "al-side" }, el("div", { class: "al-label" }, "Hold"), holdCanvas);
    const sideR = el("div", { class: "al-side" }, el("div", { class: "al-label" }, "Next"), nextCanvas);
    const stage = el("div", { class: "al-stage" }, sideL, canvas, sideR);

    // Thumb-first layout, sized to the board width: a wide 50/50 move row, a
    // rotate row with each direction under its matching arrow, then a drop/hold
    // row (soft · hard · hold). Every action still routes through the core.
    const moveRepeat = (): number => moveSpeedToMs(alignMoveSpeed());
    const moveRow = el(
      "div",
      { class: "al-touch-row al-touch-move" },
      touchButton("◄", "Move left", "ShiftL", { repeat: true, repeatMs: moveRepeat, cls: "al-tbtn-move" }),
      touchButton("►", "Move right", "ShiftR", { repeat: true, repeatMs: moveRepeat, cls: "al-tbtn-move" }),
    );
    const rotRow = el(
      "div",
      { class: "al-touch-row al-touch-rot" },
      touchButton("⟲", "Rotate counter-clockwise", "RotCCW", { cls: "al-tbtn-rot" }),
      touchButton("⟳", "Rotate clockwise", "RotCW", { cls: "al-tbtn-rot" }),
    );
    const dropRow = el(
      "div",
      { class: "al-touch-row al-touch-drop" },
      touchButton("▼", "Soft drop", "SoftStep", { repeat: true, cls: "al-tbtn-soft" }),
      touchButton("⤓", "Hard drop", "HardDrop", { cls: "al-tbtn-hard" }),
      touchButton("⇄", "Hold", "Hold", { cls: "al-tbtn-hold" }),
    );
    const pad = el(
      "div",
      { class: "al-touch", role: "group", "aria-label": "Controls" },
      moveRow,
      rotRow,
      dropRow,
    );

    const wrap = el("div", { class: "al-game" }, callout, stage, pad, statusEl);
    return wrap;
  };

  const rebuild = (): void => {
    if (!container || !game) return;
    container.replaceChildren(buildStage());
    canvas?.focus();
    shown = "";
    render(game.board());
    if (!toasted) {
      toasted = true;
      gf?.toast("Move, rotate, drop. Fill a row across to clear it; a T spun into a gap scores extra.", 6000);
    }
  };

  // ---- result / share ----
  const shareUrlFor = async (env: AlignEnvelope): Promise<string> =>
    `${location.origin}${location.pathname}?r=${await encodeRecord(env)}`;

  const presentResult = async (): Promise<void> => {
    if (!container || !game || !verifier) return;
    const env = game.outcome(declareAssistanceEnabled()) as AlignEnvelope;
    const b = game.board();
    const stats = { pieces: 0, lines: b.lines, tspins: 0, aligns: 0, maxCombo: 0 };
    container.replaceChildren(el("div", { class: "sol-loading" }, "Preparing your verifiable result…"));
    const shareUrl = await shareUrlFor(env);
    if (disposed || !container) return;
    const v = verifier.verifyShared(env);
    const build = (): HTMLElement =>
      renderResultScreen(env, v, {
        stats,
        shareUrl,
        onReverify: () => container!.replaceChildren(build()),
        onPlayAgain: () => void startGame(mode, modeId),
      });
    container.replaceChildren(build());
    declare();
  };

  const showShared = async (payload: string): Promise<void> => {
    if (!container || !verifier) return;
    let env: AlignEnvelope;
    try {
      env = await decodeRecord(payload);
    } catch {
      container.replaceChildren(el("div", { class: "sol-error" }, "This shared result could not be read."));
      return;
    }
    if (disposed || !container) return;
    const v = verifier.verifyShared(env);
    const build = (): HTMLElement =>
      renderResultScreen(env, v, {
        shared: true,
        onReverify: () => container!.replaceChildren(build()),
        onPlayAgain: () => {
          location.href = location.pathname;
        },
      });
    container.replaceChildren(build());
  };

  // ---- lifecycle ----
  async function startGame(nextMode: "daily" | "free", nextModeId = 0, seedOverride?: bigint): Promise<void> {
    if (!game || disposed) return;
    running = false;
    cancelAnimationFrame(raf);
    paused = false;
    mode = nextMode;
    modeId = nextMode === "daily" ? 0 : nextModeId;
    seed =
      seedOverride ??
      (nextMode === "daily" ? BigInt(game.dailySeed(dayIndexUTC(new Date()))) : randomSeed());
    game.newGame(seed, modeId, startLevel);
    chosenMode = chosenOf();
    hintCells = null;
    setStatus("");
    console.debug(`[align] seed=${seed} mode=${modeId}`);
    exposeHook();
    rebuild();
    startLoop();
  }

  const exposeHook = (): void => {
    if (!game) return;
    window.__align = {
      game,
      input: (a: Action) => act(a),
      tick: (n = 1) => {
        for (let i = 0; i < n; i++) game!.tick();
        if (game!.isOver()) {
          running = false;
          void presentResult();
        } else {
          render(game!.board());
        }
      },
      board: () => game!.board(),
      seed,
      startFree: (s: bigint, m: number) => void startGame("free", m, s),
      moveRepeatMs: () => moveSpeedToMs(alignMoveSpeed()),
    };
  };

  return {
    mount(c: HTMLElement, services?: GameServices): void {
      container = c;
      gf = services?.frame ?? null;
      disposed = false;
      gf?.onSettingsChange(() => declare()); // Hints flips the verb
      declare();
      Object.assign(pal, palette());
      container.replaceChildren(el("div", { class: "sol-loading" }, "Loading Align…"));
      document.addEventListener("keydown", onKeydown);
      document.addEventListener("keyup", onKeyup);
      void (async () => {
        try {
          game = await Align.load();
          verifier = await Align.load();
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
        const modeParam = url.searchParams.get("mode");
        if (seedParam !== null) {
          await startGame("free", modeParam === "sprint" ? 1 : 0, BigInt(seedParam));
          return;
        }
        await startGame(chosenMode === "daily" ? "daily" : "free", chosenMode === "sprint" ? 1 : 0);
      })();
    },
    unmount(): void {
      disposed = true;
      running = false;
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKeydown);
      document.removeEventListener("keyup", onKeyup);
      delete window.__align;
      container?.replaceChildren();
      container = null;
      gf = null;
      game = null;
      verifier = null;
    },
  };
}
