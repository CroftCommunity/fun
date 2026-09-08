//! Phase 8 of the play-surface plan (mock F, Q5): Furrow stands up on a phone.
//! A mancala row cannot wrap, so across a portrait stage it scrolls and the
//! stores clip. Upright, the same fourteen cells are two columns of six with a
//! store at each end — the board turned a quarter, the core's pit order
//! untouched. The preference Board: Auto / Across / Upright; Auto follows the
//! stage's aspect.

import { describe, expect, it } from "vitest";

import { furrowUpright, resolveFurrowOrient } from "../src/settings.js";

describe("resolveFurrowOrient", () => {
  it("is Auto unless Across or Upright is stored", () => {
    expect(resolveFurrowOrient(null)).toBe("auto");
    expect(resolveFurrowOrient("sideways")).toBe("auto");
    expect(resolveFurrowOrient("across")).toBe("across");
    expect(resolveFurrowOrient("upright")).toBe("upright");
  });
});

describe("furrowUpright — does the board stand up?", () => {
  it("Auto stands up on a portrait stage and lies across on a landscape one", () => {
    expect(furrowUpright("auto", { w: 366, h: 572 })).toBe(true);
    expect(furrowUpright("auto", { w: 960, h: 796 })).toBe(false);
    expect(furrowUpright("auto", { w: 500, h: 500 })).toBe(false);
  });
  it("Across and Upright ignore the stage", () => {
    expect(furrowUpright("across", { w: 366, h: 572 })).toBe(false);
    expect(furrowUpright("upright", { w: 960, h: 796 })).toBe(true);
  });
  it("an unmeasured stage (0×0, before layout) lies across — the default the board always had", () => {
    expect(furrowUpright("auto", { w: 0, h: 0 })).toBe(false);
  });
});
