//! The cribbage board: a real three-street board of 120 holes plus the start
//! and the game hole, two lanes, two pegs a side that leapfrog, and the score
//! events a deal accumulates for the end-of-deal recap. Geometry is pure and
//! pinned here; what the browser does with it is the e2e's business.

import { describe, expect, it } from "vitest";

import {
  BOARD,
  advancePegs,
  holePoint,
  pegSteps,
  renderBoard,
  scoreEvents,
  type Pegs,
} from "../src/games/cribbage/cribbage-board.js";

describe("the board is three streets of forty, down and back", () => {
  it("street one runs left to right, street two back, street three forward again", () => {
    expect(holePoint(1, 0).x).toBeLessThan(holePoint(40, 0).x);
    expect(holePoint(41, 0).x).toBeGreaterThan(holePoint(80, 0).x);
    expect(holePoint(81, 0).x).toBeLessThan(holePoint(120, 0).x);
  });
  it("a turnaround keeps its column: hole 41 sits under hole 40, hole 81 under hole 80", () => {
    expect(holePoint(41, 0).x).toBe(holePoint(40, 0).x);
    expect(holePoint(41, 0).y).toBeGreaterThan(holePoint(40, 0).y);
    expect(holePoint(81, 0).x).toBe(holePoint(80, 0).x);
  });
  it("holes come in fives: the gap after a group is wider than the gap inside it", () => {
    const inside = holePoint(5, 0).x - holePoint(4, 0).x;
    const between = holePoint(6, 0).x - holePoint(5, 0).x;
    expect(between).toBeGreaterThan(inside);
    expect(holePoint(3, 0).x - holePoint(2, 0).x).toBe(inside);
  });
  it("the two lanes share every column and differ only in height", () => {
    for (const h of [1, 23, 40, 41, 77, 120]) {
      expect(holePoint(h, 1).x).toBe(holePoint(h, 0).x);
      expect(holePoint(h, 1).y).not.toBe(holePoint(h, 0).y);
    }
  });
  it("the start hole is before hole 1, and the single game hole is past hole 120 between the lanes", () => {
    expect(holePoint(0, 0).x).toBeLessThan(holePoint(1, 0).x);
    expect(holePoint(121, 0).x).toBeGreaterThan(holePoint(120, 0).x);
    expect(holePoint(121, 0)).toEqual(holePoint(121, 1));
    const mid = (holePoint(120, 0).y + holePoint(120, 1).y) / 2;
    expect(holePoint(121, 0).y).toBeCloseTo(mid, 5);
  });
  it("every hole lies inside the drawing", () => {
    for (let h = 0; h <= 121; h += 1) {
      for (const lane of [0, 1] as const) {
        const p = holePoint(h, lane);
        expect(p.x).toBeGreaterThan(0);
        expect(p.x).toBeLessThan(BOARD.width);
        expect(p.y).toBeGreaterThan(0);
        expect(p.y).toBeLessThan(BOARD.height);
      }
    }
  });
});

describe("two pegs a side leapfrog", () => {
  it("a score moves the back peg ahead of the front one", () => {
    const start: Pegs = { back: 0, front: 0 };
    const first = advancePegs(start, 14);
    expect(first).toEqual({ back: 0, front: 14 });
    expect(advancePegs(first, 20)).toEqual({ back: 14, front: 20 });
  });
  it("no change leaves both pegs where they are; the game hole is the end of the board", () => {
    const p: Pegs = { back: 14, front: 20 };
    expect(advancePegs(p, 20)).toBe(p);
    expect(advancePegs(p, 129)).toEqual({ back: 20, front: 121 });
  });
  it("lists the holes a peg passes through, stopping at the game hole", () => {
    expect(pegSteps(14, 20)).toEqual([15, 16, 17, 18, 19, 20]);
    expect(pegSteps(119, 125)).toEqual([120, 121]);
    expect(pegSteps(5, 5)).toEqual([]);
  });
});

describe("a deal's score events are recorded from score changes", () => {
  it("one event per seat that scored, in seat order, from and to", () => {
    expect(scoreEvents([10, 20], [12, 20])).toEqual([{ seat: 1, from: 10, to: 12 }]);
    expect(scoreEvents([10, 20], [10, 27])).toEqual([{ seat: 2, from: 20, to: 27 }]);
    expect(scoreEvents([10, 20], [10, 20])).toEqual([]);
  });
});

describe("the rendered board", () => {
  const pegs = { 1: { back: 10, front: 14 }, 2: { back: 3, front: 9 } } as const;
  it("draws two lanes, a skunk line on each, two pegs a side and a ticking score", () => {
    const svg = renderBoard({ pegs, shown: { 1: 14, 2: 9 }, names: { 1: "You", 2: "The Engine" } });
    expect(svg.querySelectorAll(".crib-track")).toHaveLength(2);
    expect(svg.querySelectorAll(".crib-skunk")).toHaveLength(2);
    expect(svg.querySelectorAll(".crib-peg-front")).toHaveLength(2);
    expect(svg.querySelectorAll(".crib-peg-back")).toHaveLength(2);
    const you = svg.querySelector('.crib-peg-front[data-seat="1"]')!;
    expect(you.getAttribute("data-hole")).toBe("14");
    expect(svg.querySelector('.crib-board-score[data-seat="1"]')!.textContent).toBe("14");
    expect(svg.querySelector('.crib-board-score[data-seat="2"]')!.textContent).toBe("9");
  });
  it("names each lane for a screen reader with its score out of 121", () => {
    const svg = renderBoard({ pegs, shown: { 1: 14, 2: 9 }, names: { 1: "You", 2: "The Engine" } });
    const labels = [...svg.querySelectorAll(".crib-track")].map((t) => t.getAttribute("aria-label"));
    expect(labels).toEqual(["The Engine: 9 of 121", "You: 14 of 121"]);
  });
});
