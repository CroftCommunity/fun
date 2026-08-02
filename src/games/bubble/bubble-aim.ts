//! Pure aim/geometry helpers for the bubble-shooter UI. Mirrors the core's
//! sub-pixel geometry (`bubble_core::aim`) so the canvas draws bubbles and the
//! trajectory preview in the exact space the core resolves shots in. No DOM, no
//! wasm — pure functions, unit-tested. Angles are whole degrees measured from
//! the +x axis with y growing down (90° = straight up), matching the committed
//! direction table.

import type { Geom } from "./bubble-wasm.js";

/** A point in the core's sub-pixel space. */
export interface Pt {
  x: number;
  y: number;
}

/** Sub-pixel centre of hex cell `(r, c)` at `parityOffset` — mirrors
 *  `bubble_core::aim::cell_center_off`. A row is short/indented when
 *  `(r + parityOffset)` is odd; the offset flips when levels mode pushes a new
 *  row in at the top. */
export function cellCenterOff(r: number, c: number, geom: Geom, parityOffset = 0): Pt {
  const x =
    (r + parityOffset) % 2 === 0
      ? geom.radius + c * geom.diam
      : geom.radius + geom.diam / 2 + c * geom.diam;
  const y = geom.radius + r * geom.rowH;
  return { x, y };
}

/** Sub-pixel centre of hex cell `(r, c)` in the base (offset-0) layout — mirrors
 *  `bubble_core::aim::cell_center`. Parity-carrying render code passes the board's
 *  offset via {@link cellCenterOff}. */
export function cellCenter(r: number, c: number, geom: Geom): Pt {
  return cellCenterOff(r, c, geom, 0);
}

/** The launcher origin (board-centre, just below the last row) — mirrors
 *  `resolve_shot`'s launcher. */
export function launcherOrigin(width: number, height: number, geom: Geom): Pt {
  return { x: (width * geom.diam) / 2, y: geom.radius + height * geom.rowH };
}

/** Total sub-pixel canvas size: top pad (row-0 centre) + rows + a radius of
 *  bottom pad so the launcher bubble is fully visible. */
export function boardSubpixelSize(width: number, height: number, geom: Geom): { w: number; h: number } {
  return { w: width * geom.diam, h: 2 * geom.radius + height * geom.rowH };
}

/** Clamp a (possibly fractional) degree to the legal fan, as a whole degree. */
export function clampAngle(deg: number, geom: Geom): number {
  return Math.max(geom.fanLo, Math.min(geom.fanHi, Math.round(deg)));
}

/** Snap a (possibly fractional) degree to the legal fan, then to the nearest
 *  multiple of `step` anchored on 90° (straight up — so the anchor is always
 *  reachable), re-clamping into the fan. `step <= 1` is the plain clamp (no
 *  snapping). A larger step makes it easier to land on a stable angle on a
 *  jittery touchscreen. */
export function snapAngle(deg: number, step: number, geom: Geom): number {
  const clamped = clampAngle(deg, geom);
  if (step <= 1) return clamped;
  const snapped = 90 + Math.round((clamped - 90) / step) * step;
  return clampAngle(snapped, geom);
}

/** The slider band for a swipe gain: a window of width `min(gain, fanSpan)`
 *  placed to contain `center` and shifted fully inside the fan (so the width is
 *  preserved even at the edges). At full gain the window is the whole fan
 *  regardless of centre, which makes the slider an absolute aim (today's
 *  behaviour); a smaller gain narrows it around the current aim for finer
 *  control, recentred between grabs. */
export function aimBand(center: number, gain: number, geom: Geom): { lo: number; hi: number } {
  const fanSpan = geom.fanHi - geom.fanLo;
  const width = Math.max(0, Math.min(gain, fanSpan));
  let lo = center - width / 2;
  let hi = center + width / 2;
  if (lo < geom.fanLo) {
    lo = geom.fanLo;
    hi = geom.fanLo + width;
  }
  if (hi > geom.fanHi) {
    hi = geom.fanHi;
    lo = geom.fanHi - width;
  }
  return { lo, hi };
}

/** The aim angle (whole degrees, clamped to the fan) from the launcher `origin`
 *  toward sub-pixel point `(px, py)`. Straight up = 90°, right ≈ fan low,
 *  left ≈ fan high. A point at or below the launcher clamps into the fan. */
export function pointerToAngle(px: number, py: number, origin: Pt, geom: Geom): number {
  const dx = px - origin.x;
  const dyUp = origin.y - py; // screen y grows down; "up" is positive here
  const deg = (Math.atan2(dyUp, dx) * 180) / Math.PI; // -180..180, 90 = up
  return clampAngle(deg, geom);
}
