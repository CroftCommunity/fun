//! Trio Tumble presentation FX: the cascade analyser (pure) plus the decorative burst
//! + celebration layer (DOM). The analyser reads the per-phase board frames the
//! core emits (`playTraced`) and reports which frames are *clear* phases and which
//! cells emptied — the single signal that drives per-phase animation timing, the
//! particle bursts, and the escalating celebration tier, so they never disagree.
//!
//! The DOM helpers are decorative and `aria-hidden`; callers gate them on
//! reduced-motion. Particles are `<span>`s only — never buttons — so the board's
//! interactive gem count is untouched.

import type { Cell } from "./trio-tumble-events.js";

/** One clear phase: the cells that emptied and the frame index it lands on. */
export interface ClearPhase {
  cells: Cell[];
  frameIndex: number;
}

/** The cascade of a single move: its clear phases, depth, and total cells cleared. */
export interface CascadeInfo {
  clears: ClearPhase[];
  depth: number;
  totalCleared: number;
}

/** A board frame as row strings (`.` empty hole, `0`-`9` gem, `A`-`Z` blocker). */
export type Frame = string[];

const isGem = (ch: string | undefined): boolean => ch !== undefined && ch >= "0" && ch <= "9";

const holeCount = (frame: Frame): number => {
  let n = 0;
  for (const row of frame) for (const ch of row) if (ch === ".") n += 1;
  return n;
};

/** Analyse a move's per-phase frames. A transition whose hole-count *rises* is a
 *  clear phase (matches remove gems → holes); fall/refill lower the hole-count.
 *  The cells that went gem→empty across that transition are the cleared cells. */
export function analyzeCascade(frames: Frame[]): CascadeInfo {
  const clears: ClearPhase[] = [];
  for (let k = 0; k + 1 < frames.length; k += 1) {
    const before = frames[k]!;
    const after = frames[k + 1]!;
    if (holeCount(after) <= holeCount(before)) continue; // fall/refill, not a clear
    const cells: Cell[] = [];
    for (let r = 0; r < after.length; r += 1) {
      const row = after[r]!;
      for (let c = 0; c < row.length; c += 1) {
        if (row[c] === "." && isGem(before[r]?.[c])) cells.push({ r, c });
      }
    }
    if (cells.length) clears.push({ cells, frameIndex: k + 1 });
  }
  return { clears, depth: clears.length, totalCleared: clears.reduce((n, p) => n + p.cells.length, 0) };
}

/** The celebration banner for a cascade depth, or `null` to stay quiet. A single
 *  clear says nothing (avoids per-move noise); chains escalate Nice→Sweet→Divine
 *  with a rising `level` the FX scales intensity on. */
export function celebrationTier(depth: number): { label: string; level: number } | null {
  if (depth <= 1) return null;
  if (depth === 2) return { label: "Nice!", level: 1 };
  if (depth === 3) return { label: "Sweet!", level: 2 };
  return { label: "Divine!", level: 3 };
}

// ---------- DOM (decorative; caller gates on reduced-motion) ----------

/** The pixel centre of cell `(r,c)` within `board`, relative to `layer`, by
 *  querying the live grid element there — exact at any gem size / breakpoint, and
 *  valid for both the settled board and an animation frame (same grid). */
function cellCenter(layer: HTMLElement, board: HTMLElement, cell: Cell): { x: number; y: number } | null {
  const row = board.children[cell.r] as HTMLElement | undefined;
  const el = row?.children[cell.c] as HTMLElement | undefined;
  if (!el) return null;
  const cr = el.getBoundingClientRect();
  const lr = layer.getBoundingClientRect();
  return { x: cr.left - lr.left + cr.width / 2, y: cr.top - lr.top + cr.height / 2 };
}

/** Spawn a short particle burst at each cleared cell. `level` scales the count.
 *  Particles are decorative `<span>`s that remove themselves; nothing here is
 *  interactive or accessible (the layer is `aria-hidden`). */
export function spawnBurst(layer: HTMLElement, board: HTMLElement, cells: Cell[], level: number): void {
  const per = 4 + level * 2;
  for (const cell of cells) {
    const at = cellCenter(layer, board, cell);
    if (!at) continue;
    for (let i = 0; i < per; i += 1) {
      const p = document.createElement("span");
      p.className = "m3-particle";
      const angle = (i / per) * Math.PI * 2;
      const dist = 12 + level * 6;
      p.style.left = `${at.x}px`;
      p.style.top = `${at.y}px`;
      p.style.setProperty("--dx", `${Math.cos(angle) * dist}px`);
      p.style.setProperty("--dy", `${Math.sin(angle) * dist}px`);
      layer.append(p);
      p.addEventListener("animationend", () => p.remove(), { once: true });
    }
  }
}

/** Flash the escalating celebration label over the board (decorative). */
export function showCelebration(layer: HTMLElement, label: string, level: number): void {
  const el = document.createElement("div");
  el.className = `m3-celebrate m3-celebrate-${level}`;
  el.textContent = label;
  layer.append(el);
  el.addEventListener("animationend", () => el.remove(), { once: true });
}
