//! M3 — the ShelfModel and the two home layouts.
//!
//! One model, computed once and skin-agnostic; two layouts that render a SUBSET
//! of it. Adding a game or a daily pack updates both layouts for free because
//! neither owns data — only presentation differs.
//!
//! What the model can honestly say is bounded by what is actually stored. There
//! is **no per-game progress anywhere in this repo** (verified 2026-08-28: the
//! only `localStorage` keys are `fun-*` settings and Clumsy Bird's vendored
//! melonJS `me.save`). So the shelf reports what the SHELF observes — which
//! games you opened, and whether you opened today's board — and never "Level 4
//! of 6", which the mock showed and nothing can source.

import { describe, expect, it } from "vitest";

import {
  LAYOUTS,
  buildShelfModel,
  noteOpened,
  openedOn,
  prefersLayoutFor,
  recentFirst,
  resolveLayout,
  today,
} from "../src/shelf.js";
import type { GameEntry } from "../src/contract.js";

const AT = "2026-08-28T09:41:00Z";

const GAMES = [
  { id: "solitaire", title: "Solitaire", emoji: "♠", status: "playable", group: "provable", daily: true },
  { id: "othello", title: "Othello", emoji: "⚫", status: "playable", group: "versus" },
  { id: "wyrdle", title: "Wyrdle", emoji: "🐉", status: "playable", group: "provable", daily: true },
  { id: "cribbage", title: "Cribbage", emoji: "🎴", status: "soon", group: "versus" },
] as unknown as readonly GameEntry[];

describe("shelf state: what the shelf itself observes", () => {
  it("records an open and reads it back as that local day", () => {
    const store = noteOpened({}, "solitaire", new Date(AT));
    expect(openedOn(store, "solitaire", new Date(AT))).toBe(true);
  });

  it("a board opened yesterday is not opened today", () => {
    const store = noteOpened({}, "solitaire", new Date("2026-08-27T23:59:00Z"));
    expect(openedOn(store, "solitaire", new Date("2026-08-29T00:01:00Z"))).toBe(false);
  });

  it("orders by most recently opened, newest first", () => {
    let s = {};
    s = noteOpened(s, "othello", new Date("2026-08-26T10:00:00Z"));
    s = noteOpened(s, "solitaire", new Date("2026-08-28T10:00:00Z"));
    s = noteOpened(s, "wyrdle", new Date("2026-08-27T10:00:00Z"));
    expect(recentFirst(s)).toEqual(["solitaire", "wyrdle", "othello"]);
  });

  it("re-opening moves a game to the front rather than duplicating it", () => {
    let s = noteOpened({}, "othello", new Date("2026-08-26T10:00:00Z"));
    s = noteOpened(s, "solitaire", new Date("2026-08-27T10:00:00Z"));
    s = noteOpened(s, "othello", new Date("2026-08-28T10:00:00Z"));
    expect(recentFirst(s)).toEqual(["othello", "solitaire"]);
  });

  it("never mutates the store it is given", () => {
    const before = noteOpened({}, "othello", new Date(AT));
    const snapshot = JSON.stringify(before);
    noteOpened(before, "solitaire", new Date(AT));
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe("the model both layouts consume", () => {
  const model = buildShelfModel({
    games: GAMES,
    state: noteOpened({}, "othello", new Date(AT)),
    now: new Date(AT),
  });

  it("names what you last opened, and nothing it cannot source", () => {
    expect(model.resume?.id).toBe("othello");
    // Deliberately absent: there is no progress store to read one from.
    expect(model.resume).not.toHaveProperty("progress");
  });

  it("has no resume on a first visit", () => {
    expect(buildShelfModel({ games: GAMES, state: {}, now: new Date(AT) }).resume).toBeUndefined();
  });

  it("lists today's boards, flagging the ones already opened", () => {
    const withDaily = buildShelfModel({
      games: GAMES,
      state: noteOpened({}, "solitaire", new Date(AT)),
      now: new Date(AT),
    });
    expect(withDaily.today.map((t) => t.id)).toEqual(["solitaire", "wyrdle"]);
    expect(withDaily.today.find((t) => t.id === "solitaire")?.opened).toBe(true);
    expect(withDaily.today.find((t) => t.id === "wyrdle")?.opened).toBe(false);
  });

  it("groups games, and every group carries the copy the shelf layout argues with", () => {
    for (const g of model.groups) {
      expect(g.label).toBeTruthy();
      expect(g.headline).toBeTruthy();
      expect(g.blurb).toBeTruthy();
      expect(g.games.length).toBeGreaterThan(0);
    }
  });

  it("places every playable game in exactly one group", () => {
    const placed = model.groups.flatMap((g) => g.games.map((x) => x.id)).sort();
    const playable = GAMES.filter((g) => g.status === "playable").map((g) => g.id).sort();
    expect(placed).toEqual(playable);
  });

  it("drops a 'soon' game from the groups rather than offering a dead tile", () => {
    expect(model.groups.flatMap((g) => g.games.map((x) => x.id))).not.toContain("cribbage");
  });
});

describe("layout is a preference, never a lock", () => {
  it("ships both layouts as first-class, independently reachable options", () => {
    expect(Object.keys(LAYOUTS).sort()).toEqual(["shelf", "today-first"]);
  });

  it("a family's preference seeds the choice", () => {
    for (const id of Object.keys(LAYOUTS)) {
      expect(resolveLayout(null, id)).toBe(id);
    }
  });

  // The rule D5 and forage's prefersDensity share: the reader's explicit choice
  // wins IN BOTH DIRECTIONS. A preference that could only be overridden one way
  // is a lock wearing a preference's name.
  it("an explicit choice wins over the preference, in both directions", () => {
    expect(resolveLayout("shelf", "today-first")).toBe("shelf");
    expect(resolveLayout("today-first", "shelf")).toBe("today-first");
  });

  it("falls back to the preference when the stored choice is stale", () => {
    expect(resolveLayout("mosaic", "shelf")).toBe("shelf");
    expect(resolveLayout("", "today-first")).toBe("today-first");
  });

  it("every family declares a layout it prefers, and it is a real one", () => {
    expect(Object.keys(LAYOUTS)).toContain(prefersLayoutFor("table-light"));
    expect(prefersLayoutFor("table-light")).toBe(prefersLayoutFor("table-dark"));
  });

  it("the preference lives on the FAMILY, so a palette swap never re-lays-out", () => {
    // D5. On the skin, two members of one family could disagree, and then the
    // ☾/☀ control would silently change the information architecture.
    expect(prefersLayoutFor("table-light")).toBe(prefersLayoutFor("table-dark"));
  });
});

describe("today() is a local calendar day", () => {
  it("formats as YYYY-MM-DD", () => {
    expect(today(new Date(AT))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("Continue reads the progress store (plan Phase 5b)", () => {
  const AT2 = new Date(AT);
  const rec = (line: string) => ({
    v: 1 as const,
    status: "in-progress" as const,
    startedAt: AT,
    updatedAt: AT,
    setup: { mode: "free" },
    record: {},
    summary: { line },
  });

  it("an in-progress entry gives resume its id, title and summary line", () => {
    const m = buildShelfModel({ games: GAMES, state: {}, now: AT2, progress: { othello: rec("Move 14 · you lead 9–4") } });
    expect(m.resume).toEqual({ id: "othello", title: "Othello", line: "Move 14 · you lead 9–4" });
  });

  it("a store entry beats a newer last-opened for a different game — Continue is about unfinished games", () => {
    const state = noteOpened(noteOpened({}, "othello", new Date("2026-08-28T08:00:00Z")), "wyrdle", AT2);
    const m = buildShelfModel({ games: GAMES, state, now: AT2, progress: { othello: rec("Move 3") } });
    expect(m.resume?.id).toBe("othello");
    expect(m.resume?.line).toBe("Move 3");
  });

  it("with no store entry, resume is the last-opened game without a line — today's behaviour, pinned", () => {
    const m = buildShelfModel({ games: GAMES, state: noteOpened({}, "wyrdle", AT2), now: AT2, progress: {} });
    expect(m.resume).toEqual({ id: "wyrdle", title: "Wyrdle" });
  });

  it("a stale key for a game not in the registry is ignored", () => {
    const m = buildShelfModel({ games: GAMES, state: {}, now: AT2, progress: { "old-game": rec("Level 2") } });
    expect(m.resume).toBeUndefined();
  });

  it("a finished entry is not Continue material — the last-opened rule applies", () => {
    const m = buildShelfModel({
      games: GAMES,
      state: noteOpened({}, "wyrdle", AT2),
      now: AT2,
      progress: { othello: { ...rec("Won 33–31"), status: "finished" } },
    });
    expect(m.resume).toEqual({ id: "wyrdle", title: "Wyrdle" });
  });
});
