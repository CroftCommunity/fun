//! The game record (src/record.ts; plan D9): one `$type`-shaped object per game,
//! holding stats and the game in progress, persisted through a substrate seam —
//! local to the browser now, shaped so a later atproto substrate can publish it
//! unchanged. The caller owns persistence; a substrate never reaches for
//! `localStorage` on its own (forage's rule).

import { describe, expect, it } from "vitest";
import {
  RECORD_TYPE,
  emptyRecord,
  localSubstrate,
  memorySubstrate,
  readRecord,
  recordSolve,
  resolveRecord,
  writeRecord,
  type GameRecord,
} from "../src/record.js";

describe("the game record", () => {
  it("mock E6.5: the record is one $type-shaped object behind a substrate", () => {
    const r = emptyRecord("color-sort");
    expect(r.$type).toBe(RECORD_TYPE);
    expect(RECORD_TYPE).toMatch(/^ing\.croft\.fun\./);
    expect(r.game).toBe("color-sort");
    expect(r.did).toBeNull();
    expect(r.stats).toEqual({ solved: 0, strictSolved: 0, streak: 0, maxStreak: 0, lastDay: -1, bestLevel: 1, played: 0 });
    expect(r.inProgress).toBeNull();
    expect(typeof r.updatedAt).toBe("string");
  });

  it("a substrate round-trips the record, and the caller chooses which substrate", () => {
    const mem = memorySubstrate();
    expect(readRecord("color-sort", mem)).toBeNull();
    const r: GameRecord = { ...emptyRecord("color-sort"), inProgress: { mode: "endless", level: 3, seed: "42", moves: [[0, 1]] } };
    writeRecord(r, mem);
    expect(readRecord("color-sort", mem)).toEqual(r);
    expect(readRecord("wyrdle", mem)).toBeNull();
    // The local substrate is the same seam over localStorage.
    writeRecord(r, localSubstrate);
    expect(readRecord("color-sort", localSubstrate)).toEqual(r);
    expect(JSON.parse(localStorage.getItem("fun-record-color-sort")!).$type).toBe(RECORD_TYPE);
  });

  it("resolveRecord refuses a wrong type, a wrong game, or a malformed stats block", () => {
    const good = emptyRecord("color-sort");
    expect(resolveRecord(JSON.stringify(good), "color-sort").ok).toBe(true);
    expect(resolveRecord(JSON.stringify({ ...good, $type: "other" }), "color-sort")).toMatchObject({ ok: false });
    expect(resolveRecord(JSON.stringify(good), "wyrdle")).toMatchObject({ ok: false });
    expect(resolveRecord(JSON.stringify({ ...good, stats: { solved: "many" } }), "color-sort")).toMatchObject({ ok: false });
    expect(resolveRecord("not json", "color-sort")).toMatchObject({ ok: false });
  });
});

describe("recordSolve — the gate's input and the daily streak", () => {
  it("every solve counts toward played; only dailies build the streak, once per day", () => {
    let r = emptyRecord("color-sort");
    r = recordSolve(r, { kind: "endless", level: 2, strict: false, day: 100 });
    expect(r.stats).toMatchObject({ played: 1, solved: 1, streak: 0, bestLevel: 2 });
    r = recordSolve(r, { kind: "daily", strict: true, day: 100 });
    expect(r.stats).toMatchObject({ played: 2, solved: 2, strictSolved: 1, streak: 1, maxStreak: 1, lastDay: 100 });
    r = recordSolve(r, { kind: "daily", strict: false, day: 100 }); // same day again: no second streak step
    expect(r.stats).toMatchObject({ played: 2, streak: 1 });
    r = recordSolve(r, { kind: "daily", strict: false, day: 101 });
    expect(r.stats).toMatchObject({ streak: 2, maxStreak: 2, lastDay: 101 });
    r = recordSolve(r, { kind: "daily", strict: false, day: 105 }); // a gap resets
    expect(r.stats).toMatchObject({ streak: 1, maxStreak: 2 });
    expect(r.stats.bestLevel).toBe(2);
    expect(recordSolve(r, { kind: "endless", level: 9, strict: false, day: 105 }).stats.bestLevel).toBe(9);
  });
});
