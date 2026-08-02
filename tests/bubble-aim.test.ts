//! Unit tests for the pure bubble-shooter aim/geometry helpers. These mirror the
//! Rust core's geometry, so they pin the shared coordinate contract the canvas
//! and the core both depend on.

import { describe, expect, it } from "vitest";
import {
  aimBand,
  boardSubpixelSize,
  cellCenter,
  clampAngle,
  launcherOrigin,
  pointerToAngle,
  snapAngle,
} from "../src/games/bubble/bubble-aim.js";
import type { Geom } from "../src/games/bubble/bubble-wasm.js";

// The core's committed geometry (bubble_core::aim + directions.json fan).
const GEOM: Geom = { diam: 256, radius: 128, rowH: 222, fanLo: 10, fanHi: 170 };

describe("cellCenter", () => {
  it("places even rows flush and odd rows shifted half a bubble", () => {
    expect(cellCenter(0, 0, GEOM)).toEqual({ x: 128, y: 128 });
    expect(cellCenter(0, 1, GEOM)).toEqual({ x: 384, y: 128 });
    // Odd row: shifted +DIAM/2, and one row down.
    expect(cellCenter(1, 0, GEOM)).toEqual({ x: 256, y: 350 });
  });
});

describe("launcherOrigin", () => {
  it("sits at board-centre just below the last row", () => {
    expect(launcherOrigin(8, 11, GEOM)).toEqual({ x: 1024, y: 2570 });
  });
});

describe("boardSubpixelSize", () => {
  it("spans the columns wide and rows + padding tall", () => {
    expect(boardSubpixelSize(8, 11, GEOM)).toEqual({ w: 2048, h: 2698 });
  });
});

describe("clampAngle", () => {
  it("rounds and clamps into the legal fan", () => {
    expect(clampAngle(90.4, GEOM)).toBe(90);
    expect(clampAngle(5, GEOM)).toBe(10);
    expect(clampAngle(200, GEOM)).toBe(170);
  });
});

describe("snapAngle", () => {
  it("is the plain clamped whole degree at step 1 (no snapping)", () => {
    expect(snapAngle(93.4, 1, GEOM)).toBe(93);
    expect(snapAngle(5, 1, GEOM)).toBe(10);
    expect(snapAngle(200, 1, GEOM)).toBe(170);
  });

  it("snaps to multiples of the step anchored on 90° (straight up)", () => {
    expect(snapAngle(90, 3, GEOM)).toBe(90); // the anchor is always reachable
    expect(snapAngle(91, 3, GEOM)).toBe(90);
    expect(snapAngle(94, 3, GEOM)).toBe(93);
    expect(snapAngle(89, 3, GEOM)).toBe(90);
    expect(snapAngle(86, 3, GEOM)).toBe(87);
  });

  it("keeps every snapped angle inside the legal fan", () => {
    for (let step = 1; step <= 5; step += 1) {
      for (let deg = GEOM.fanLo; deg <= GEOM.fanHi; deg += 1) {
        const a = snapAngle(deg, step, GEOM);
        expect(a).toBeGreaterThanOrEqual(GEOM.fanLo);
        expect(a).toBeLessThanOrEqual(GEOM.fanHi);
      }
    }
  });
});

describe("aimBand", () => {
  it("covers the whole fan at full gain, wherever it is centred", () => {
    const span = GEOM.fanHi - GEOM.fanLo;
    expect(aimBand(90, span, GEOM)).toEqual({ lo: 10, hi: 170 });
    expect(aimBand(170, span, GEOM)).toEqual({ lo: 10, hi: 170 });
    expect(aimBand(10, span, GEOM)).toEqual({ lo: 10, hi: 170 });
  });

  it("makes a narrow window around the centre at low gain", () => {
    expect(aimBand(90, 40, GEOM)).toEqual({ lo: 70, hi: 110 });
  });

  it("shifts the window fully inside the fan at the edges (width preserved)", () => {
    expect(aimBand(10, 40, GEOM)).toEqual({ lo: 10, hi: 50 });
    expect(aimBand(170, 40, GEOM)).toEqual({ lo: 130, hi: 170 });
  });
});

describe("pointerToAngle", () => {
  const origin = launcherOrigin(8, 11, GEOM);

  it("maps a point straight above the launcher to 90°", () => {
    expect(pointerToAngle(origin.x, origin.y - 1000, origin, GEOM)).toBe(90);
  });

  it("maps up-and-right below 90 and up-and-left above 90", () => {
    const right = pointerToAngle(origin.x + 1000, origin.y - 1000, origin, GEOM);
    const left = pointerToAngle(origin.x - 1000, origin.y - 1000, origin, GEOM);
    expect(right).toBeLessThan(90);
    expect(left).toBeGreaterThan(90);
    // Symmetric 45° up-diagonals about straight-up.
    expect(right).toBe(45);
    expect(left).toBe(135);
  });

  it("clamps a flat or downward aim into the legal fan", () => {
    const cases: [number, number][] = [
      [1000, 500],
      [-1000, 500],
      [1000, 0],
      [-1000, 0],
    ];
    for (const [dx, dy] of cases) {
      const a = pointerToAngle(origin.x + dx, origin.y + dy, origin, GEOM);
      expect(a).toBeGreaterThanOrEqual(GEOM.fanLo);
      expect(a).toBeLessThanOrEqual(GEOM.fanHi);
    }
  });
});
