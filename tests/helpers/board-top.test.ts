//! The sampler's judgement, at its boundaries (plan Phase 6).

import { describe, expect, it } from "vitest";

import { judgeTops, sample } from "./board-top.js";

describe("judgeTops", () => {
  it("throws on zero frames — a sampler that saw nothing must not report stable", () => {
    expect(() => judgeTops([])).toThrow(/no frames observed/);
  });

  it("one frame reports that value as both min and max: stable, delta 0", () => {
    expect(judgeTops([112.1875])).toEqual({ stable: true, delta: 0 });
  });

  it("sub-pixel drift is stable; a pixel is a jump (the boundary is 1)", () => {
    expect(judgeTops([100, 100.4, 100]).stable).toBe(true);
    expect(judgeTops([100, 100.999, 100]).stable).toBe(true);
    expect(judgeTops([100, 101, 100])).toEqual({ stable: false, delta: 1 });
    expect(judgeTops([100, 124.8, 100]).delta).toBeCloseTo(24.8);
  });
});

describe("sample", () => {
  it("reads every frame until stopped, skips frames where the element is absent, and takes none after", () => {
    const queue: (() => void)[] = [];
    const raf = (cb: () => void): void => {
      queue.push(cb);
    };
    const tops: (number | null)[] = [100, null, 101, 100];
    let i = 0;
    const s = sample(() => (i < tops.length ? tops[i++]! : 100), raf);
    // the first read happened synchronously; drive three more frames
    queue.shift()!();
    queue.shift()!();
    queue.shift()!();
    const seen = s.stop();
    queue.shift()!(); // a frame that fires after stop() records nothing
    expect(seen).toEqual([100, 101, 100]);
  });
});
