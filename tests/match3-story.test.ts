//! Unit tests for the narrative scaffold: which success events map to a Biscuit
//! beat, and the story engine that fires each beat at most once ever (a persisted
//! seen-set) and at most once per board. Pure logic + a fake bus — no DOM.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createBus, type Bus } from "../src/games/match3-events.js";
import { attachStory, beatForEvent, BEATS, type Beat } from "../src/games/match3-story.js";

beforeEach(() => localStorage.clear());

describe("beatForEvent", () => {
  it("maps successes to their beat key, and ignores the rest", () => {
    expect(beatForEvent({ type: "move", scoreDelta: 10, cascadeDepth: 1, cleared: 3 })).toBe("first-clear");
    expect(beatForEvent({ type: "move", scoreDelta: 0, cascadeDepth: 0, cleared: 0 })).toBeNull();
    expect(beatForEvent({ type: "cascade", depth: 3, clearedCells: [] })).toBe("first-cascade-3");
    expect(beatForEvent({ type: "cascade", depth: 2, clearedCells: [] })).toBeNull();
    expect(beatForEvent({ type: "special", kind: "striped-h" })).toBe("first-special");
    expect(beatForEvent({ type: "level-win", level: 1, stars: 2, score: 900, clutch: false })).toBe("level-1-complete");
    expect(beatForEvent({ type: "level-win", level: 2, stars: 1, score: 500, clutch: false })).toBe("level-2-complete");
    expect(beatForEvent({ type: "level-win", level: 3, stars: 3, score: 9, clutch: true })).toBe("comeback");
    expect(beatForEvent({ type: "level-lose", level: 1 })).toBeNull();
  });

  it("every beat key has copy", () => {
    for (const key of ["first-clear", "first-cascade-3", "first-special", "level-1-complete", "level-2-complete", "comeback"]) {
      expect(BEATS[key]?.caption.length ?? 0).toBeGreaterThan(0);
    }
  });
});

describe("attachStory", () => {
  let bus: Bus;
  beforeEach(() => (bus = createBus()));

  it("shows a beat once, then never again (seen-set persists)", () => {
    const show = vi.fn((_beat: Beat) => true);
    attachStory(bus, show);
    bus.emit({ type: "special", kind: "wrapped" });
    bus.emit({ type: "special", kind: "wrapped" });
    expect(show).toHaveBeenCalledTimes(1);
    expect(show.mock.calls[0]![0]).toMatchObject({ key: "first-special" });

    // A fresh engine (e.g. next page load) still won't re-fire a seen beat.
    const show2 = vi.fn((_beat: Beat) => true);
    attachStory(bus, show2);
    bus.emit({ type: "special", kind: "striped-v" });
    expect(show2).not.toHaveBeenCalled();
  });

  it("fires at most one beat per board (resetForNewBoard re-arms)", () => {
    const show = vi.fn((_beat: Beat) => true);
    const engine = attachStory(bus, show);
    // A big opening move emits both `move` (first-clear) and `cascade` (first-cascade-3);
    // only the first beat of the board shows.
    bus.emit({ type: "move", scoreDelta: 99, cascadeDepth: 4, cleared: 12 });
    bus.emit({ type: "cascade", depth: 4, clearedCells: [] });
    expect(show).toHaveBeenCalledTimes(1);
    engine.resetForNewBoard();
    bus.emit({ type: "cascade", depth: 3, clearedCells: [] });
    expect(show).toHaveBeenCalledTimes(2);
  });

  it("stops delivering after stop()", () => {
    const show = vi.fn((_beat: Beat) => true);
    const engine = attachStory(bus, show);
    engine.stop();
    bus.emit({ type: "special", kind: "fish" });
    expect(show).not.toHaveBeenCalled();
  });
});
