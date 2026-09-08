//! The bubble-shooter board — a real aim-and-shoot game over the `bubble-wasm`
//! binding. A launcher at the bottom holds a colour; the player **aims an angle**
//! (drag/point on the board, the ←/→ keys, or the angle slider), sees a dotted
//! trajectory preview that bounces off the walls, and **fires** — the projectile
//! flies up, bounces, sticks where the core resolves it, and pops connected
//! clusters of 3+ (disconnected bubbles drop). The core owns every landing (the
//! UI only visualises the path it computes), so the outcome stays verifiable: on
//! a clear (or when shots run out) a `pond-outcome` record is shown, shareable
//! via `?r=`.

import type { GameModule, GameServices } from "../../contract.js";
import type { GameFrame, GameFrameSpec } from "../../game-frame.js";
import type { Progress } from "../../progress.js";
import type { SettingRow } from "../../settings-sheet.js";
import { today } from "../../shelf.js";
import { Bubble, type BoardView, type Geom, type LevelBoardView } from "./bubble-wasm.js";
import {
  aimBand,
  boardSubpixelSize,
  cellCenterOff,
  clampAngle,
  launcherOrigin,
  pointerToAngle,
  snapAngle,
} from "./bubble-aim.js";
import {
  decodeRecord,
  encodeRecord,
  verifyLevelRecord,
  verifyRecord,
  type BubbleEnvelope,
  type VerifyResult,
} from "./bubble-outcome.js";
import { aimSettingRows } from "./bubble-aim-settings.js";
import { EMOJI_FONT, pieceFor } from "./bubble-pieces.js";
import { dayIndexUTC } from "../share.js";
import {
  aimGuideEnabled,
  aimSettleMs,
  aimSnapStep,
  aimSwipeGain,
  declareAssistanceEnabled,
  fireOnReleaseEnabled,
  hintsEnabled,
  setAimGuide,
} from "../../settings.js";

declare global {
  interface Window {
    /** E2E hook: the live binding, geometry, and aim/fire controls, so tests
     *  drive the real UI path against the core. */
    __bubble?: {
      game: Bubble;
      /** A second binding for control replays in the landing-matches-core guardrail. */
      verifier: Bubble;
      refresh: () => void;
      geom: Geom;
      seed: bigint;
      /** Set the aim angle (whole degrees, clamped to the fan) + redraw. */
      setAim: (deg: number) => void;
      /** The current aim angle. */
      aim: () => number;
      /** Fire the current aim; resolves once the shot has been applied. */
      fire: () => Promise<void>;
    };
  }
}


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

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
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

export interface LevelResultOpts extends ResultScreenOpts {
  /** The highest level reached (re-derived by replay). */
  level: number;
}

/** Build the levels result screen: highest level + cumulative score, a star
 *  grade, the verification badge, the record, and share/re-verify controls.
 *  Levels are endless survival, so the headline is "reached level N", never a
 *  clear-the-board win. */
export function renderLevelResultScreen(
  env: BubbleEnvelope,
  verification: VerifyResult,
  opts: LevelResultOpts,
): HTMLElement {
  const rec = env.payload;
  const section = el("section", { class: "sol-result", role: "region", "aria-label": "Result" });
  const stars = rec.stars ?? 0;
  const head = verification.ok
    ? `Reached level ${opts.level} — score ${rec.score ?? 0} — verifiable`
    : "Verification FAILED — this result does not check out";
  section.append(el("h2", { class: "sol-headline" }, head));

  if (stars > 0) {
    section.append(
      el(
        "p",
        { class: "bub-stars", role: "img", "aria-label": `${stars} of 3 stars` },
        "★".repeat(stars) + "☆".repeat(3 - stars),
      ),
    );
  }

  const badge = el("p", { class: `sol-verify-badge ${verification.ok ? "ok" : "fail"}`, role: "status" });
  badge.textContent = verification.ok
    ? "Verified ✓ — re-checked by replaying every shot against the core."
    : `Verification failed — expected hash ${verification.expected}, replay produced ${verification.actual}.`;
  section.append(badge);

  const dl = el("dl", { class: "sol-record" });
  const row = (term: string, value: string, cls = ""): void => {
    dl.append(el("dt", {}, term), el("dd", cls ? { class: cls } : {}, value));
  };
  row("Level reached", String(opts.level));
  row("Score", String(rec.score ?? 0));
  row("Shots fired", String(rec.move_count));
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
      opts.shared ? "Play the daily challenge" : "Play again",
    );
    b.addEventListener("click", opts.onPlayAgain);
    controls.append(b);
  }
  if (controls.childNodes.length) section.append(controls);
  return section;
}

// ---------- canvas palette (theme-aware) ----------

interface Palette {
  gems: string[];
  surface: string;
  ink: string;
  inkMuted: string;
  focus: string;
  active: string;
  aimLine: string;
}

function palette(): Palette {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string): string => cs.getPropertyValue(name).trim() || fallback;
  return {
    gems: [0, 1, 2, 3, 4, 5].map((i) => v(`--gem-${i}`, "#888")),
    surface: v("--surface", "#ffffff"),
    ink: v("--ink", "#111111"),
    inkMuted: v("--ink-muted", "#888888"),
    focus: v("--focus", "#3b82f6"),
    active: v("--active", "#10b981"),
    aimLine: v("--ink-muted", "#888888"),
  };
}

// ---------- the game module ----------

type Variant = "levels" | "classic";
type BoardSource = "daily" | "free";
const VARIANT_LABEL: Record<Variant, string> = { levels: "Levels", classic: "Classic" };

// The New game card's choices live at module scope: the poster renders the card
// before the module exists, and the module reads them when a game starts.
let chosenVariant: Variant = "levels";
let chosenBoard: BoardSource = "daily";

/** The New game card: which game (levels or classic) and which board (today's or a fresh one). */
export function bubbleSetupRows(): SettingRow[] {
  return [
    {
      kind: "choice",
      id: "variant",
      label: "Game",
      hint: "Levels: the stack descends, the target rises. Classic: clear a fixed board within a shot budget.",
      value: chosenVariant,
      options: [
        { value: "levels", label: "Levels" },
        { value: "classic", label: "Classic" },
      ],
      onChange: (v) => {
        chosenVariant = v === "classic" ? "classic" : "levels";
      },
    },
    {
      kind: "choice",
      id: "board",
      label: "Board",
      hint: "The daily challenge is the same board for everyone today; a new board is a fresh seed.",
      value: chosenBoard,
      options: [
        { value: "daily", label: "Daily challenge" },
        { value: "free", label: "New board" },
      ],
      onChange: (v) => {
        chosenBoard = v === "free" ? "free" : "daily";
      },
    },
  ];
}

/** The poster's setup card — the registry's `setup` factory. */
export const bubbleSetup = (): SettingRow[] => bubbleSetupRows();

/** Construct a fresh bubble-shooter module (the registry `load`). */
export function bubbleModule(): GameModule {
  let game: Bubble | null = null;
  let verifier: Bubble | null = null;
  let container: HTMLElement | null = null;
  let disposed = false;

  // `variant` picks the game: levels (escalating, point-gated, descending rows —
  // the default experience) or classic (clear the daily board within a budget).
  // `mode` is the board source within either variant (daily vs free-play).
  let variant: Variant = "levels";
  let mode: BoardSource = "daily";
  let seed = 0n;
  let frame: GameFrame | null = null;
  let pendingResume: Progress | null = null;
  /** Every angle fired this game, in order — the progress record; the outcome carries the same list. */
  let moves: number[] = [];
  let geom: Geom = { diam: 256, radius: 128, rowH: 222, fanLo: 10, fanHi: 170 };
  let aim = 90;
  let animating = false;
  let raf = 0;
  let canvas: HTMLCanvasElement | null = null;
  let aimInput: HTMLInputElement | null = null;
  let aimReadout: HTMLElement | null = null;
  // Pending fire-on-release settle timer (0 = none). A re-grab of the slider
  // cancels it; it clears on unmount/animation.
  let settleTimer = 0;
  let cascadeEl: HTMLElement | null = null;
  // Presentational per-level countdown (levels only; never a verified loss).
  let timerEnabled = false;
  let timerEnd = 0;
  let timerTick = 0;
  let lastLevel = 0;

  const isLevels = (): boolean => variant === "levels";

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

  const verify = (env: BubbleEnvelope): VerifyResult =>
    env.kind === "bubble-levels"
      ? verifyLevelRecord(verifier!, env)
      : verifyRecord(verifier!, env);

  // The highest level reached, re-derived by replaying the record (works for a
  // just-ended live run and a shared `?r=` record alike).
  const replayLevel = (env: BubbleEnvelope): number => {
    verifier!.newLevelGame(BigInt(env.payload.seed));
    for (const angle of env.payload.moves) verifier!.levelShoot(angle);
    return verifier!.levelBoard().level;
  };

  // A board normalized across variants for the shared canvas/aim code: geometry
  // + parity + cells + launcher colours + whether the round is over.
  interface Uni {
    width: number;
    height: number;
    parityOffset: number;
    cells: number[][];
    currentColor: number;
    nextColor: number;
    over: boolean;
  }

  const levelView = (): LevelBoardView | null => (isLevels() && game ? game.levelBoard() : null);

  // The unified board for the active variant. Classic has no parity offset (0).
  const uni = (): Uni | null => {
    if (!game) return null;
    if (isLevels()) {
      const b = game.levelBoard();
      return {
        width: b.width,
        height: b.height,
        parityOffset: b.parityOffset,
        cells: b.cells,
        currentColor: b.currentColor,
        nextColor: b.nextColor,
        over: b.lost,
      };
    }
    const b: BoardView = game.board();
    return {
      width: b.width,
      height: b.height,
      parityOffset: 0,
      cells: b.cells,
      currentColor: b.currentColor,
      nextColor: b.nextColor,
      over: b.cleared || b.shotsLeft === 0,
    };
  };

  const activeTrajectory = (angle: number) =>
    isLevels() ? game!.levelTrajectory(angle) : game!.trajectory(angle);

  // The round is over when the levels stack crosses the deadline, or the classic
  // board clears / the shot budget runs out.
  const gameOver = (): boolean => {
    const u = uni();
    return u ? u.over : false;
  };

  const origin = (u: Uni) => launcherOrigin(u.width, u.height, geom);

  // ---------- canvas drawing ----------

  const drawBubble = (
    ctx: CanvasRenderingContext2D,
    p: Palette,
    x: number,
    y: number,
    color: number,
    scale = 1,
    alpha = 1,
  ): void => {
    const r = geom.radius * 0.92 * scale;
    ctx.save();
    ctx.globalAlpha = alpha;
    // A glass bubble: a faint tinted disc, a rim, and a highlight up-left — the
    // fruit sits inside it (mock F phase 10; the owner's fruit set, Q7).
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = p.surface;
    ctx.fill();
    const tint = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    tint.addColorStop(0, "rgba(255,255,255,0.32)");
    tint.addColorStop(0.55, "rgba(255,255,255,0.04)");
    tint.addColorStop(1, "rgba(0,0,0,0.18)");
    ctx.fillStyle = tint;
    ctx.fill();
    ctx.lineWidth = Math.max(1, r * 0.08);
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.stroke();
    ctx.font = `${Math.round(geom.radius * 1.12 * scale)}px ${EMOJI_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = p.gems[color] ?? p.ink; // the fallback glyph's colour; an emoji ignores it
    ctx.fillText(pieceFor(color).glyph, x, y + geom.radius * 0.06 * scale);
    ctx.restore();
  };

  // The launcher: a ring the loaded piece sits in, so the shot's origin reads
  // as a thing on the table rather than a bubble that happens to be low.
  const drawLauncher = (ctx: CanvasRenderingContext2D, p: Palette, o: { x: number; y: number }): void => {
    const r = geom.radius * 1.3;
    ctx.save();
    ctx.beginPath();
    ctx.arc(o.x, o.y, r, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.fill();
    ctx.lineWidth = Math.max(2, geom.radius * 0.14);
    ctx.strokeStyle = p.inkMuted;
    ctx.globalAlpha = 0.7;
    ctx.stroke();
    ctx.restore();
  };

  // The on-deck ("next") piece, drawn small in a dashed ring beside the launcher
  // so the player can plan the shot after this one (a next-piece preview).
  const drawOnDeck = (
    ctx: CanvasRenderingContext2D,
    p: Palette,
    o: { x: number; y: number },
    color: number,
  ): void => {
    const x = o.x + geom.diam * 1.15;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, o.y, geom.radius * 0.75, 0, Math.PI * 2);
    ctx.setLineDash([geom.radius * 0.25, geom.radius * 0.2]);
    ctx.lineWidth = Math.max(1, geom.radius * 0.08);
    ctx.strokeStyle = p.inkMuted;
    ctx.globalAlpha = 0.6;
    ctx.stroke();
    ctx.restore();
    drawBubble(ctx, p, x, o.y, color, 0.58, 0.85);
  };

  // A translucent danger band over the reserved bottom deadline rows (levels
  // only) — telegraphs "don't let the stack reach here". `yShift` slides it with
  // the board during an insert animation.
  const drawDeadline = (
    ctx: CanvasRenderingContext2D,
    p: Palette,
    u: Uni,
    deadlineRows: number,
    yShift = 0,
  ): void => {
    if (deadlineRows <= 0) return;
    const top = geom.radius + (u.height - deadlineRows) * geom.rowH - geom.radius + yShift;
    ctx.save();
    ctx.globalAlpha = 0.14;
    ctx.fillStyle = p.focus;
    ctx.fillRect(0, top, u.width * geom.diam, deadlineRows * geom.rowH + geom.radius);
    ctx.restore();
  };

  // Draw the board + launcher, plus (when `flight` is null) the dotted aim
  // preview, or (during a shot) the flying projectile at `flight`. `yShift` nudges
  // the whole stack down (the insert slide animation).
  const drawScene = (flight: { x: number; y: number } | null = null, yShift = 0): void => {
    if (!canvas || !game) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const u = uni();
    if (!u) return;
    const lv = levelView();
    const p = palette();
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (lv) drawDeadline(ctx, p, u, lv.deadlineRows, yShift);

    u.cells.forEach((rowCells, r) => {
      rowCells.forEach((color, c) => {
        if (color >= 0) {
          const { x, y } = cellCenterOff(r, c, geom, u.parityOffset);
          drawBubble(ctx, p, x, y + yShift, color);
        }
      });
    });

    const o = origin(u);
    if (!u.over) {
      drawLauncher(ctx, p, o);
      drawBubble(ctx, p, o.x, o.y, u.currentColor);
      drawOnDeck(ctx, p, o, u.nextColor);
    }

    if (flight) {
      drawBubble(ctx, p, flight.x, flight.y, u.currentColor);
      return;
    }
    if (gameOver() || !aimGuideEnabled()) return;

    // Dotted trajectory preview + a landing ring where the shot resolves (the
    // optional aim guide — off = a harder aiming challenge).
    const traj = activeTrajectory(aim);
    ctx.save();
    ctx.strokeStyle = p.aimLine;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = Math.max(2, geom.radius * 0.16);
    ctx.setLineDash([geom.radius * 0.5, geom.radius * 0.7]);
    ctx.beginPath();
    traj.points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.stroke();
    ctx.restore();

    const [lr, lc] = traj.landing;
    const lp = cellCenterOff(lr, lc, geom, u.parityOffset);
    ctx.save();
    ctx.strokeStyle = p.active;
    ctx.lineWidth = Math.max(2, geom.radius * 0.16);
    ctx.beginPath();
    ctx.arc(lp.x, lp.y, geom.radius * 0.9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  };

  // ---------- flight animation ----------

  const pathAt = (points: [number, number][], dist: number): { x: number; y: number } => {
    let acc = 0;
    for (let i = 1; i < points.length; i += 1) {
      const [ax, ay] = points[i - 1]!;
      const [bx, by] = points[i]!;
      const seg = Math.hypot(bx - ax, by - ay);
      if (acc + seg >= dist) {
        const t = seg === 0 ? 0 : (dist - acc) / seg;
        return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t };
      }
      acc += seg;
    }
    const last = points[points.length - 1]!;
    return { x: last[0], y: last[1] };
  };

  const animateFlight = (points: [number, number][]): Promise<void> =>
    new Promise((resolve) => {
      const total = points.slice(1).reduce((s, [x, y], i) => {
        const [px, py] = points[i]!;
        return s + Math.hypot(x - px, y - py);
      }, 0);
      const speed = geom.diam * 0.06; // sub-pixels per ms → ~short, snappy flight
      const dur = Math.min(700, Math.max(140, total / speed));
      const start = performance.now();
      const step = (now: number): void => {
        if (disposed) return resolve();
        const t = Math.min(1, (now - start) / dur);
        drawScene(pathAt(points, t * total));
        if (t >= 1) return resolve();
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    });

  // The shot resolution: popped bubbles burst (scale up + fade), orphaned
  // bubbles fall away (translate down + fade) over the settled board — so a pop
  // and its knock-on drops read as cause→effect instead of vanishing. Drawn on
  // the post-shot board; skipped under reduced motion (the caller checks).
  const animateResolve = (ls: { popped: number[][]; dropped: number[][] }): Promise<void> =>
    new Promise((resolve) => {
      if (!canvas || !game) return resolve();
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve();
      const u = uni();
      if (!u) return resolve();
      const p = palette();
      const o = origin(u);
      const dur = 380;
      const start = performance.now();
      const step = (now: number): void => {
        if (disposed || !canvas) return resolve();
        const t = Math.min(1, (now - start) / dur);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        u.cells.forEach((rowCells, r) => {
          rowCells.forEach((color, c) => {
            if (color >= 0) {
              const { x, y } = cellCenterOff(r, c, geom, u.parityOffset);
              drawBubble(ctx, p, x, y, color);
            }
          });
        });
        if (!u.over) {
          drawBubble(ctx, p, o.x, o.y, u.currentColor);
          drawOnDeck(ctx, p, o, u.nextColor);
        }
        // Popped: a quick outward burst that fades.
        for (const [r, c, color] of ls.popped) {
          const { x, y } = cellCenterOff(r!, c!, geom, u.parityOffset);
          drawBubble(ctx, p, x, y, color!, 1 + 0.7 * t, 1 - t);
        }
        // Orphans: accelerate downward (gravity) and fade as they leave.
        const fall = t * t * geom.rowH * 7;
        for (const [r, c, color] of ls.dropped) {
          const { x, y } = cellCenterOff(r!, c!, geom, u.parityOffset);
          drawBubble(ctx, p, x, y + fall, color!, 1, 1 - 0.85 * t);
        }
        if (t >= 1) return resolve();
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    });

  // The top-row insert (levels): the whole stack slides down one row into place
  // as the new row appears at the ceiling. `drawScene`'s yShift animates from
  // one row up to settled.
  const animateInsert = (): Promise<void> =>
    new Promise((resolve) => {
      if (!canvas || !game) return resolve();
      const dur = 260;
      const start = performance.now();
      const step = (now: number): void => {
        if (disposed || !canvas) return resolve();
        const t = Math.min(1, (now - start) / dur);
        drawScene(null, -(1 - t) * geom.rowH);
        if (t >= 1) return resolve();
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    });

  const fire = async (): Promise<void> => {
    if (!game || gameOver() || animating) return;
    cancelReleaseFire();
    const angle = aim;
    const traj = activeTrajectory(angle);
    setStatus(`Fired at ${angle} degrees`);
    animating = true;
    syncControlsDisabled();
    if (!prefersReducedMotion() && traj.points.length >= 2) {
      await animateFlight(traj.points);
    }
    if (disposed || !game) {
      animating = false;
      return;
    }
    if (isLevels()) {
      game.levelShoot(angle);
      moves.push(angle);
      const ls = game.levelLastShot();
      if (!prefersReducedMotion()) {
        // On an insert shot the stack-slide is the dominant motion (the pop/drop
        // cells are in pre-insert coordinates, so we don't overlay them there);
        // otherwise the usual burst + orphan-fall.
        if (ls.inserted) await animateInsert();
        else if (ls.popped.length > 0 || ls.dropped.length > 0) await animateResolve(ls);
      }
    } else {
      game.shoot(angle);
      moves.push(angle);
      const ls = game.lastShot();
      if (!prefersReducedMotion() && (ls.popped.length > 0 || ls.dropped.length > 0)) {
        await animateResolve(ls);
      }
    }
    animating = false;
    if (disposed || !game) return;
    render();
  };

  // ---------- controls + interaction ----------

  // Point the aim slider's window at the current aim for the active swipe gain
  // (min/max = the band). At full gain this is always the whole fan, so the
  // slider is an absolute aim (the default feel); a lower gain narrows it around
  // the current aim for finer control, recentred here between grabs.
  const applyBand = (): void => {
    if (!aimInput) return;
    const { lo, hi } = aimBand(aim, aimSwipeGain(), geom);
    aimInput.min = String(lo);
    aimInput.max = String(hi);
  };

  const syncAim = (): void => {
    if (aimInput) aimInput.value = String(aim);
    if (aimReadout) aimReadout.textContent = `${aim}°`;
    if (canvas) canvas.setAttribute("aria-label", boardLabel());
  };

  const setAim = (deg: number): void => {
    aim = snapAngle(deg, aimSnapStep(), geom);
    syncAim();
    if (!animating) drawScene();
  };

  const cancelReleaseFire = (): void => {
    if (settleTimer) {
      clearTimeout(settleTimer);
      settleTimer = 0;
    }
  };

  // Fire-on-release: after the slider is let go, wait the settle window, then
  // fire — unless the slider is re-grabbed (which cancels), or the round is over.
  const scheduleReleaseFire = (): void => {
    cancelReleaseFire();
    if (!fireOnReleaseEnabled() || animating || gameOver()) return;
    settleTimer = window.setTimeout(() => {
      settleTimer = 0;
      void fire();
    }, aimSettleMs());
  };

  const syncControlsDisabled = (): void => {
    const off = animating || gameOver();
    aimInput?.toggleAttribute("disabled", off);
    container?.querySelector<HTMLButtonElement>(".bub-fire")?.toggleAttribute("disabled", off);
  };

  const boardLabel = (): string => {
    if (!game) return "Bubble board";
    const lv = levelView();
    if (lv) {
      return `Bubble board: level ${lv.level}, score ${lv.totalScore} of ${lv.targetScore} to next level, ${lv.shotsToInsert} shots until the stack drops, aiming ${aim} degrees`;
    }
    const b = game.board();
    const bubbles = b.cells.reduce((n, row) => n + row.filter((c) => c >= 0).length, 0);
    return `Bubble board: ${bubbles} bubbles left, ${b.shotsLeft} shots left, aiming ${aim} degrees`;
  };

  const canvasToSub = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = canvas!.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * canvas!.width,
      y: ((clientY - rect.top) / rect.height) * canvas!.height,
    };
  };

  const showHint = (): void => {
    if (!game || gameOver()) return;
    if (isLevels()) {
      game.levelMarkAssistance();
      setAim(game.levelHintAngle());
    } else {
      game.markAssistance();
      setAim(game.hintAngle());
    }
    setStatus(`Hint: aim at ${aim} degrees (a hint counts as assistance)`);
  };

  const endNow = (): void => {
    setStatus("Ended — reporting the result honestly.");
    render(true);
  };

  const fmtClock = (ms: number): string => {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };

  const renderHud = (u: Uni): HTMLElement => {
    const color = u.currentColor;
    const nextColor = u.nextColor;
    const launcher = el(
      "div",
      { class: "bub-launcher-hud" },
      el(
        "span",
        {
          class: `bub-loaded bub-color-${color}`,
          role: "img",
          "aria-label": `Launcher loaded: ${pieceFor(color).name}`,
        },
        pieceFor(color).glyph,
      ),
      el(
        "span",
        {
          class: `bub-next bub-color-${nextColor}`,
          role: "img",
          "aria-label": `Next up: ${pieceFor(nextColor).name}`,
        },
        pieceFor(nextColor).glyph,
      ),
    );

    const hud = el("div", { class: "bub-hud" }, launcher);
    const lv = levelView();
    if (lv) {
      const pct = lv.targetScore > 0 ? Math.min(100, (lv.levelScore / lv.targetScore) * 100) : 0;
      const progress = el(
        "div",
        {
          class: "bub-progress",
          role: "progressbar",
          "aria-label": "Level score progress",
          "aria-valuemin": "0",
          "aria-valuemax": String(lv.targetScore),
          "aria-valuenow": String(lv.levelScore),
        },
        el("span", { class: "bub-progress-fill", style: `width:${pct}%` }),
      );
      hud.append(
        progress,
        el("span", { class: "bub-target" }, `${lv.levelScore} / ${lv.targetScore} to next`),
        el("span", { class: "bub-drop" }, `Stack drops in ${lv.shotsToInsert}`),
      );
    }
    return hud;
  };

  // --- what the frame shows: three fixed stats, the variant chip, verbs, setup, preferences ---
  const spec = (): GameFrameSpec => {
    const lv = levelView();
    const b = !lv && game ? game.board() : null;
    const hints = hintsEnabled();
    const clock: GameFrameSpec["meters"][number] = lv
      ? { kind: "stat", id: "clock", value: timerEnabled ? fmtClock(timerEnd - Date.now()) : "—", label: "clock" }
      : { kind: "stat", id: "clock", value: b ? b.cells.flat().filter((c) => c >= 0).length : 0, label: "bubbles left" };
    return {
      title: "Bubble",
      mode: VARIANT_LABEL[variant],
      meters: [
        lv
          ? { kind: "stat", id: "stage", value: `Level ${lv.level}`, label: `${lv.levelScore} / ${lv.targetScore}` }
          : { kind: "stat", id: "stage", value: b?.shotsLeft ?? 0, label: "shots left" },
        { kind: "stat", id: "score", value: lv ? lv.totalScore : (b?.score ?? 0), label: "score" },
        clock,
      ],
      verbs: [
        hints
          ? { id: "hint", label: "Hint", icon: "✦", primary: true, onPress: showHint }
          : { id: "done", label: "I’m done", icon: "⇥", onPress: endNow },
        { id: "new", label: "New game", icon: "⟳", onPress: (btn) => frame?.openSheet("setup", btn) },
      ],
      setup: bubbleSetupRows(),
      preferences: [
        {
          kind: "toggle",
          id: "aim-guide",
          label: "Show aim guide",
          hint: "The dotted trajectory preview. A display choice only — the shot lands wherever the angle sends it.",
          value: aimGuideEnabled(),
          onChange: (on) => {
            setAimGuide(on);
            drawScene();
          },
        },
        {
          kind: "toggle",
          id: "timer",
          label: "Show level timer (practice clock)",
          hint: "Levels only. A per-level countdown on the clock meter; never part of your verified result, and running it down never ends the run.",
          value: timerEnabled,
          onChange: (on) => {
            timerEnabled = on;
            runTimer();
            declare();
          },
        },
        ...aimSettingRows({
          geom,
          // A coarser/finer snap re-snaps the current aim immediately.
          onSnapChange: () => setAim(aim),
          // A changed gain re-centres the slider band on the current aim.
          onGainChange: () => applyBand(),
        }),
      ],
      onStart: () => {
        variant = chosenVariant;
        lastLevel = 0;
        void startGame(chosenBoard);
      },
    };
  };
  const declare = (): void => frame?.update(spec());

  const renderAimBar = (): HTMLElement => {
    const bar = el("div", { class: "bub-aimbar" });

    const band = aimBand(aim, aimSwipeGain(), geom);
    const range = el("input", {
      type: "range",
      class: "bub-aim",
      min: String(band.lo),
      max: String(band.hi),
      step: "1",
      value: String(aim),
      "aria-label": "Aim angle in degrees",
    }) as HTMLInputElement;
    aimInput = range;
    const readout = el("span", { class: "bub-aim-readout", "aria-hidden": "true" }, `${aim}°`);
    aimReadout = readout;

    range.addEventListener("input", () => setAim(Number(range.value)));
    // Grabbing recentres the band on the current aim (fine-gain mode) and cancels
    // any pending release-fire; letting go schedules a fire when fire-on-release
    // is on. At full gain the band is the whole fan, so this is a plain slider.
    range.addEventListener("pointerdown", () => {
      cancelReleaseFire();
      applyBand();
    });
    range.addEventListener("pointerup", () => {
      applyBand();
      scheduleReleaseFire();
    });

    const row = el(
      "div",
      { class: "bub-aim-row" },
      el("span", { class: "bub-aim-label" }, "Aim"),
      range,
      readout,
    );

    const fireBtn = el("button", { type: "button", class: "bub-fire" }, "Fire");
    fireBtn.addEventListener("click", () => void fire());

    bar.append(row, fireBtn);
    return bar;
  };

  const renderCanvas = (u: Uni): HTMLCanvasElement => {
    const { w, h } = boardSubpixelSize(u.width, u.height, geom);
    const c = el("canvas", {
      class: "bub-canvas",
      width: String(w),
      height: String(h),
      tabindex: "0",
      role: "img",
    }) as HTMLCanvasElement;
    canvas = c;
    c.setAttribute("aria-label", boardLabel());

    const aimFromEvent = (e: PointerEvent): void => {
      if (animating || gameOver()) return;
      const s = canvasToSub(e.clientX, e.clientY);
      setAim(pointerToAngle(s.x, s.y, origin(u), geom));
    };
    c.addEventListener("pointermove", aimFromEvent);
    c.addEventListener("pointerdown", (e) => {
      c.setPointerCapture(e.pointerId);
      aimFromEvent(e);
    });
    c.addEventListener("pointerup", (e) => {
      aimFromEvent(e);
      void fire();
    });
    c.addEventListener("keydown", (e) => {
      if (animating || gameOver()) return;
      // One key press moves at least the snap step, so arrows always advance to
      // the next reachable angle even at a coarse snap.
      const kb = Math.max(2, aimSnapStep());
      if (e.key === "ArrowLeft") {
        setAim(aim + kb); // left = larger angle (toward 170°)
        e.preventDefault();
      } else if (e.key === "ArrowRight") {
        setAim(aim - kb);
        e.preventDefault();
      } else if (e.key === " " || e.key === "Enter" || e.key === "ArrowUp") {
        void fire();
        e.preventDefault();
      }
    });
    return c;
  };

  // A brief celebratory bubble cascade on a cleared board; decorative and
  // aria-hidden; skipped under reduced-motion; removed on unmount.
  const playCascade = (): void => {
    if (prefersReducedMotion()) return;
    const layer = el("div", { class: "sol-cascade", "aria-hidden": "true" });
    for (let i = 0; i < 24; i += 1) {
      const s = el("span", { class: `gem-${i % 6}` }, pieceFor(i % 6).glyph);
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
    if (isLevels()) {
      const env = game.levelOutcome(declareAssistanceEnabled()) as BubbleEnvelope;
      const level = game.levelBoard().level;
      container.replaceChildren(
        el("div", { class: "sol-loading" }, "Preparing your verifiable result…"),
      );
      const shareUrl = await shareUrlFor(env);
      if (disposed || !container) return;
      const build = (): HTMLElement =>
        renderLevelResultScreen(env, verify(env), {
          level,
          shareUrl,
          onReverify: () => container!.replaceChildren(build()),
          onPlayAgain: () => void startGame(mode),
        });
      container.replaceChildren(build());
      declare();
      return;
    }
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
    declare();
  };

  function render(force = false): void {
    if (disposed || !container || !game) return;
    if (raf) cancelAnimationFrame(raf);
    cancelReleaseFire();
    if (force || gameOver()) {
      canvas = null;
      aimInput = null;
      aimReadout = null;
      void presentResult();
      return;
    }
    const u = uni();
    if (!u) return;
    aim = clampAngle(aim, geom);
    // Reset the presentational clock when a new level begins.
    const lv = levelView();
    if (lv && lv.level !== lastLevel) {
      lastLevel = lv.level;
      timerEnd = Date.now() + lv.timeLimitSecs * 1000;
    }
    const root = el(
      "div",
      { class: "bub-game" },
      renderHud(u),
      renderCanvas(u),
      renderAimBar(),
      statusEl,
    );
    container.replaceChildren(root);
    syncControlsDisabled();
    drawScene();
    runTimer();
    exposeHook();
    declare();
  }

  // Tick the presentational clock (levels + timer setting on). Never touches game
  // state — a spent clock is a nudge, not a loss.
  const runTimer = (): void => {
    window.clearInterval(timerTick);
    timerTick = 0;
    if (!isLevels() || !timerEnabled || gameOver()) return;
    timerTick = window.setInterval(() => {
      if (disposed || !timerEnabled || !isLevels() || gameOver()) {
        window.clearInterval(timerTick);
        timerTick = 0;
        return;
      }
      declare(); // the clock is a meter; a second is its resolution
    }, 1000);
  };

  async function startGame(nextMode: BoardSource, seedOverride?: bigint): Promise<void> {
    if (!game || disposed) return;
    mode = nextMode;
    moves = [];
    // Levels reuse the clear-board daily seed as a fixed "daily challenge" start.
    seed =
      seedOverride ??
      (nextMode === "daily" ? BigInt(game.dailySeed(dayIndexUTC(new Date()))) : randomSeed());
    if (isLevels()) game.newLevelGame(seed);
    else game.newGame(seed);
    geom = game.geom();
    aim = clampAngle(90, geom);
    animating = false;
    lastLevel = 0;
    setStatus("");
    render();
  }

  /** Resume is replay: the variant, the board source, the seed, then every angle fired. */
  const applyResume = (p: Progress): void => {
    if (!game || disposed) return;
    const rec = p.record as { seed?: unknown; moves?: unknown; variant?: unknown };
    variant = chosenVariant = rec.variant === "classic" ? "classic" : "levels";
    mode = chosenBoard = typeof p.setup.mode === "string" && p.setup.mode.startsWith("daily:") ? "daily" : "free";
    seed = typeof rec.seed === "string" ? BigInt(rec.seed) : randomSeed();
    if (isLevels()) game.newLevelGame(seed);
    else game.newGame(seed);
    moves = [];
    for (const angle of Array.isArray(rec.moves) ? (rec.moves as unknown[]) : []) {
      if (typeof angle !== "number") break;
      if (isLevels()) game.levelShoot(angle);
      else game.shoot(angle);
      moves.push(angle);
    }
    geom = game.geom();
    aim = clampAngle(90, geom);
    animating = false;
    lastLevel = 0;
    setStatus("");
    render();
  };

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
    if (env.kind === "bubble-levels") {
      const level = replayLevel(env);
      const build = (): HTMLElement =>
        renderLevelResultScreen(env, verify(env), {
          level,
          shared: true,
          onReverify: () => container!.replaceChildren(build()),
          onPlayAgain: () => {
            location.href = location.pathname;
          },
        });
      container.replaceChildren(build());
      return;
    }
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
    if (!game || !verifier) return;
    window.__bubble = {
      game,
      verifier,
      refresh: () => render(),
      geom,
      seed,
      setAim,
      aim: () => aim,
      fire,
    };
  };

  return {
    mount(c: HTMLElement, services?: GameServices): void {
      container = c;
      frame = services?.frame ?? null;
      disposed = false;
      frame?.onSettingsChange(() => render()); // Hints flips the verb
      declare();
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
        if (pendingResume) {
          const p = pendingResume;
          pendingResume = null;
          applyResume(p);
          return;
        }
        // Levels is the default experience; `?variant=classic` opens the classic
        // clear-the-board game instead.
        if (url.searchParams.get("variant") === "classic") chosenVariant = "classic";
        variant = chosenVariant;
        const seedParam = url.searchParams.get("seed");
        if (seedParam !== null) {
          await startGame("free", BigInt(seedParam));
          return;
        }
        await startGame(chosenBoard);
      })();
    },
    unmount(): void {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      window.clearInterval(timerTick);
      cancelReleaseFire();
      raf = 0;
      timerTick = 0;
      frame = null;
      delete window.__bubble;
      cascadeEl?.remove();
      cascadeEl = null;
      container?.replaceChildren();
      container = null;
      canvas = null;
      aimInput = null;
      aimReadout = null;
      game = null;
      verifier = null;
    },
    // --- the progress store: variant, board source, seed and every angle fired; resume is replay ---
    snapshot(): Progress {
      const lv = levelView();
      const b = !lv && game ? game.board() : null;
      const now = new Date().toISOString();
      const done = gameOver();
      const line = lv
        ? `Levels · level ${lv.level} · score ${lv.totalScore}`
        : `Classic · score ${b?.score ?? 0} · ${b?.shotsLeft ?? 0} shots left`;
      return {
        v: 1,
        status: done ? "finished" : "in-progress",
        startedAt: now,
        updatedAt: now,
        setup: { mode: mode === "daily" ? `daily:${today(new Date())}` : "free", variant, seed: seed.toString() },
        record: { seed: seed.toString(), variant, moves: [...moves] },
        summary: { line: done ? `${line} · over` : line },
      };
    },
    resume(p: Progress): void {
      if (game) applyResume(p);
      else pendingResume = p;
    },
  };
}
