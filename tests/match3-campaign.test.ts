//! Unit tests for the match-3 campaign: the pure star reinterpretation + level
//! navigation, and the localStorage-backed progress/resume persistence. The
//! campaign is a presentational wrapper over verifiable core seeds — stars are a
//! front-end reading of the recorded score, so nothing here touches the hash.

import { beforeEach, describe, expect, it } from "vitest";

import {
  campaignStars,
  clearResume,
  levelById,
  loadProgress,
  loadResume,
  nextLevelId,
  recordStars,
  saveResume,
  unlockedLevel,
  type Campaign,
} from "../src/games/match3-campaign.js";

const CAMPAIGN: Campaign = {
  levels: [
    { id: 1, seed: 341, stars: [300, 800, 1500] },
    { id: 2, seed: 245, stars: [400, 1000, 1800] },
    { id: 3, seed: 3, stars: [700, 1600, 2800] },
  ],
};

// jsdom gives each test a real localStorage; clear it so cases don't bleed.
beforeEach(() => localStorage.clear());

describe("campaignStars", () => {
  it("grades a score against the level's three thresholds", () => {
    expect(campaignStars(0, [300, 800, 1500])).toBe(0);
    expect(campaignStars(299, [300, 800, 1500])).toBe(0);
    expect(campaignStars(300, [300, 800, 1500])).toBe(1);
    expect(campaignStars(800, [300, 800, 1500])).toBe(2);
    expect(campaignStars(1499, [300, 800, 1500])).toBe(2);
    expect(campaignStars(1500, [300, 800, 1500])).toBe(3);
  });
});

describe("level navigation", () => {
  it("finds a level by id and the next level's id", () => {
    expect(levelById(CAMPAIGN, 2)?.seed).toBe(245);
    expect(levelById(CAMPAIGN, 9)).toBeUndefined();
    expect(nextLevelId(CAMPAIGN, 1)).toBe(2);
    expect(nextLevelId(CAMPAIGN, 3)).toBeNull(); // last level
  });
});

describe("progress persistence", () => {
  it("records the best stars per level (never downgrades)", () => {
    recordStars(1, 2);
    expect(loadProgress()[1]).toBe(2);
    recordStars(1, 1); // a worse replay doesn't lower the record
    expect(loadProgress()[1]).toBe(2);
    recordStars(1, 3);
    expect(loadProgress()[1]).toBe(3);
  });

  it("unlocks the next contiguous level once one is cleared (>=1 star)", () => {
    expect(unlockedLevel(CAMPAIGN)).toBe(1); // fresh: only level 1
    recordStars(1, 1);
    expect(unlockedLevel(CAMPAIGN)).toBe(2);
    recordStars(2, 3);
    expect(unlockedLevel(CAMPAIGN)).toBe(3);
    recordStars(3, 1);
    expect(unlockedLevel(CAMPAIGN)).toBe(3); // caps at the last level
  });
});

describe("resume persistence (move-list, not board)", () => {
  it("round-trips a resume blob and clears it", () => {
    saveResume({ objective: "target-score", seed: "341", level: 1, moves: [[3, 3, 3, 4]] });
    expect(loadResume()).toEqual({ objective: "target-score", seed: "341", level: 1, moves: [[3, 3, 3, 4]] });
    clearResume();
    expect(loadResume()).toBeNull();
  });
});
