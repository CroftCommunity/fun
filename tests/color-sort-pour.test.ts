//! The pour's pure half (src/games/color-sort/pour.ts): timings per speed, the
//! plan a pour follows per skin, and the docking geometry — everything the
//! browser spec (mock E3.x) reads back, tested here without a browser. The
//! numbers are mock E's (plan 2026-08-29-plan-color-sort-redesign, D2/D3).

import { describe, expect, it } from "vitest";
import { pourGeometry, pourPlan, pourTimings, type PourSpeed } from "../src/games/color-sort/pour.js";
import { cueFor } from "../src/games/color-sort/sound.js";
import { resolvePourSpeed } from "../src/settings.js";

describe("pourTimings — the mock's numbers at Normal, scaled for Slow and Fast, zero for Off", () => {
  it("Normal is lift 120 · travel 200 · 160 per unit · return 200", () => {
    expect(pourTimings("normal")).toEqual({ lift: 120, travel: 200, perUnit: 160, ret: 200 });
  });
  it("Slow is longer and Fast is shorter in every phase; Off is zero everywhere", () => {
    const n = pourTimings("normal");
    const s = pourTimings("slow");
    const f = pourTimings("fast");
    for (const k of ["lift", "travel", "perUnit", "ret"] as const) {
      expect(s[k]).toBeGreaterThan(n[k]);
      expect(f[k]).toBeLessThan(n[k]);
      expect(f[k]).toBeGreaterThan(0);
    }
    expect(pourTimings("off")).toEqual({ lift: 0, travel: 0, perUnit: 0, ret: 0 });
  });
});

describe("pourPlan — what a pour does, per skin", () => {
  it("water: lift, travel, one step per unit moved, return — and the total follows the count", () => {
    const two = pourPlan({ skin: "water", speed: "normal", units: 2 });
    expect(two.steps.map((s) => s.id)).toEqual(["lift", "travel", "unit-0", "unit-1", "return"]);
    expect(two.steps.map((s) => s.ms)).toEqual([120, 200, 160, 160, 200]);
    expect(two.total).toBe(840);
    expect(pourPlan({ skin: "water", speed: "normal", units: 3 }).total).toBe(1000);
    expect(two.tilts).toBe(true);
  });
  it("ball: no tilt — a lift, one hop per ball at 140ms, a return", () => {
    const p = pourPlan({ skin: "ball", speed: "normal", units: 2 });
    expect(p.tilts).toBe(false);
    expect(p.steps.map((s) => s.id)).toEqual(["lift", "hop-0", "hop-1", "return"]);
    expect(p.steps[1]!.ms).toBe(140);
  });
  it("bolt: no tilt — per nut, unscrew 200 · carry 150 · screw 200", () => {
    const p = pourPlan({ skin: "bolt", speed: "normal", units: 1 });
    expect(p.tilts).toBe(false);
    expect(p.steps.map((s) => s.id)).toEqual(["unscrew-0", "carry-0", "screw-0"]);
    expect(p.steps.map((s) => s.ms)).toEqual([200, 150, 200]);
  });
  it("Off is a single cross-fade step with no transform, in every skin", () => {
    for (const skin of ["water", "ball", "bolt"] as const) {
      const p = pourPlan({ skin, speed: "off", units: 2 });
      expect(p.steps.map((s) => s.id)).toEqual(["fade"]);
      expect(p.tilts).toBe(false);
      expect(p.steps[0]!.ms).toBe(150);
    }
  });
  it("undo reverses the plan at double speed", () => {
    const p = pourPlan({ skin: "water", speed: "normal", units: 1, reverse: true });
    expect(p.reverse).toBe(true);
    expect(p.total).toBe(340); // (120 + 200 + 160 + 200) / 2
  });
});

describe("pourGeometry — the spout docks over the target's mouth, rotating about the lip", () => {
  const rect = (left: number, top: number, w = 48, h = 144): DOMRect =>
    ({ left, top, width: w, height: h, right: left + w, bottom: top + h, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
  it("pouring right: pivot is the top-right lip, the tube tilts clockwise, the spout lands inside the target's left lip", () => {
    const g = pourGeometry(rect(0, 100), rect(200, 100));
    expect(g.origin).toBe("100% 0");
    expect(g.tilt).toBeGreaterThan(90);
    expect(g.dx).toBe(200 + 8 - 48); // target.left + inset − source.right
    expect(g.dy).toBe(-32);
  });
  it("pouring left mirrors: top-left lip, anticlockwise, inside the target's right lip", () => {
    const g = pourGeometry(rect(200, 100), rect(0, 100));
    expect(g.origin).toBe("0 0");
    expect(g.tilt).toBeLessThan(-90);
    expect(g.dx).toBe(48 - 8 - 200); // target.right − inset − source.left
    expect(g.dy).toBe(-32);
  });
  it("a target on a lower row is reached: dy follows the target's top", () => {
    const g = pourGeometry(rect(0, 100), rect(120, 300));
    expect(g.dy).toBe(300 - 32 - 100);
  });
});

describe("resolvePourSpeed — reduced motion is the default, not a lock", () => {
  const cases: [string | null, boolean, PourSpeed][] = [
    [null, false, "normal"],
    [null, true, "off"],
    ["fast", true, "fast"],
    ["slow", false, "slow"],
    ["bogus", true, "off"],
  ];
  for (const [stored, reduce, want] of cases) {
    it(`stored=${String(stored)} reduce=${reduce} → ${want}`, () => {
      expect(resolvePourSpeed(stored, reduce)).toBe(want);
    });
  }
});

describe("cueFor — a distinct sound per skin and per event", () => {
  it("the three skins' pour cues differ, and complete differs from pour", () => {
    const water = cueFor("water", "pour");
    const ball = cueFor("ball", "pour");
    const bolt = cueFor("bolt", "pour");
    expect(water).not.toEqual(ball);
    expect(ball).not.toEqual(bolt);
    expect(water).not.toEqual(bolt);
    expect(cueFor("water", "complete")).not.toEqual(water);
    for (const c of [water, ball, bolt]) expect(c.notes.length).toBeGreaterThan(0);
  });
});
