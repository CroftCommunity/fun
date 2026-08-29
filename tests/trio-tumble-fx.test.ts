//! Unit tests for Trio Tumble's presentation-layer pure logic: the cascade analyser
//! (which board frames are "clear" phases, and which cells cleared — the signal
//! that drives per-phase timing, bursts, and the celebration tier) and the tiny
//! game-event bus. All pure — no wasm, no DOM.

import { describe, expect, it } from "vitest";

import { analyzeCascade, celebrationTier } from "../src/games/trio-tumble-fx.js";
import { createBus, type M3Event } from "../src/games/trio-tumble-events.js";

// Frame encoding (matches the core's to_rows): '.' empty hole, '0'-'9' gem.
describe("analyzeCascade", () => {
  it("finds no clear when nothing empties (holes never rise)", () => {
    const frames = [
      ["012", "345", "012"],
      ["012", "345", "012"],
    ];
    const info = analyzeCascade(frames);
    expect(info.depth).toBe(0);
    expect(info.clears).toEqual([]);
    expect(info.totalCleared).toBe(0);
  });

  it("marks a single clear phase and the cells that emptied", () => {
    // frame 0 = after swap (full); frame 1 = after clear (top row emptied).
    const frames = [
      ["000", "123", "456"],
      ["...", "123", "456"],
    ];
    const info = analyzeCascade(frames);
    expect(info.depth).toBe(1);
    expect(info.clears[0]!.frameIndex).toBe(1);
    expect(info.clears[0]!.cells).toEqual([
      { r: 0, c: 0 },
      { r: 0, c: 1 },
      { r: 0, c: 2 },
    ]);
    expect(info.totalCleared).toBe(3);
  });

  it("counts a cascade: clear, refill (holes fall), then a second clear", () => {
    const frames = [
      ["012", "345", "678"], // after swap
      ["...", "345", "678"], // clear #1 (holes rise)
      ["345", "678", "901"], // fall + refill (holes drop to 0)
      ["345", "...", "901"], // clear #2 (holes rise again)
    ];
    const info = analyzeCascade(frames);
    expect(info.depth).toBe(2);
    expect(info.clears.map((p) => p.frameIndex)).toEqual([1, 3]);
    expect(info.totalCleared).toBe(6);
  });
});

describe("celebrationTier", () => {
  it("stays quiet on a single clear (no banner noise)", () => {
    expect(celebrationTier(0)).toBeNull();
    expect(celebrationTier(1)).toBeNull();
  });
  it("escalates Nice -> Sweet -> Divine with cascade depth", () => {
    expect(celebrationTier(2)?.label).toBe("Nice!");
    expect(celebrationTier(3)?.label).toBe("Sweet!");
    expect(celebrationTier(4)?.label).toBe("Divine!");
    expect(celebrationTier(9)?.label).toBe("Divine!");
    // Levels rise monotonically so the FX can scale intensity.
    expect(celebrationTier(4)!.level).toBeGreaterThan(celebrationTier(2)!.level);
  });
});

describe("createBus", () => {
  it("delivers emitted events to every subscriber", () => {
    const bus = createBus();
    const seen: M3Event[] = [];
    bus.on((e) => seen.push(e));
    bus.on((e) => seen.push(e));
    bus.emit({ type: "cascade", depth: 3, clearedCells: [] });
    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatchObject({ type: "cascade", depth: 3 });
  });

  it("stops delivering after unsubscribe", () => {
    const bus = createBus();
    let n = 0;
    const off = bus.on(() => (n += 1));
    bus.emit({ type: "move", scoreDelta: 10, cascadeDepth: 1, cleared: 3 });
    off();
    bus.emit({ type: "move", scoreDelta: 10, cascadeDepth: 1, cleared: 3 });
    expect(n).toBe(1);
  });

  it("isolates listeners between two buses (game-scoped, not global)", () => {
    const a = createBus();
    const b = createBus();
    let na = 0;
    a.on(() => (na += 1));
    b.emit({ type: "game-over", won: true, mode: "target-score" });
    expect(na).toBe(0);
  });
});
