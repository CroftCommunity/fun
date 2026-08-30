//! The progress store — what "Continue" reads (plan Phase 4, decisions D1, Q6, Q8).
//!
//! One localStorage key per game, the newest record wins, a daily record dies at the
//! local rollover, a free one never expires, a `finished` one is kept until the next
//! rollover so the card can say "won yesterday". The resolver is pure and returns a
//! tagged result, so the reason a record is rejected is a tested value rather than a
//! string in a log call.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearProgress,
  readProgress,
  resolveProgress,
  writeProgress,
  type Progress,
} from "../src/progress.js";

/** A local-zone instant on 2026-08-30. */
const at = (h: number, m = 0, s = 0, ms = 0): Date => new Date(2026, 7, 30, h, m, s, ms);

function record(over: Partial<Progress> = {}): Progress {
  return {
    v: 1,
    status: "in-progress",
    startedAt: at(9).toISOString(),
    updatedAt: at(9, 30).toISOString(),
    setup: { mode: "daily:2026-08-30", seed: 7 },
    record: { moves: [19, 26] },
    summary: { line: "Move 2 · you lead 4–1" },
    ...over,
  };
}

const json = (r: unknown): string => JSON.stringify(r);

describe("resolveProgress — the pure resolver", () => {
  it("accepts v: 1", () => {
    expect(resolveProgress(json(record()), at(10))).toEqual({ ok: true, progress: record() });
  });

  it("rejects v: 0, v: 2 and v: \"1\", each naming the version", () => {
    for (const v of [0, 2, "1"]) {
      const r = resolveProgress(json({ ...record(), v }), at(10));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/version/);
    }
  });

  it("rejects a status outside the two literals", () => {
    const r = resolveProgress(json({ ...record(), status: "paused" }), at(10));
    expect(r).toEqual({ ok: false, reason: "status: paused" });
  });

  it("rejects malformed JSON, null, and a non-object", () => {
    expect(resolveProgress("{not json", at(10))).toEqual({ ok: false, reason: "not JSON" });
    expect(resolveProgress(null, at(10))).toEqual({ ok: false, reason: "nothing stored" });
    expect(resolveProgress(json(42), at(10))).toEqual({ ok: false, reason: "not a record" });
  });

  it("rejects a record without a summary line — the card would be blank", () => {
    const r = resolveProgress(json({ ...record(), summary: {} }), at(10));
    expect(r).toEqual({ ok: false, reason: "no summary line" });
  });

  it("accepts a record of any shape — it is the game's, opaque to the store", () => {
    for (const rec of [null, 3, "moves", [1, 2, 3], { deep: { nested: true } }]) {
      expect(resolveProgress(json(record({ record: rec })), at(10)).ok).toBe(true);
    }
  });

  it("keeps a daily record at 23:59:59.999 the day it was made and drops it at 00:00:00.000 the next", () => {
    const made = record({ updatedAt: at(23, 59, 59).toISOString() });
    expect(resolveProgress(json(made), at(23, 59, 59, 999)).ok).toBe(true);
    const nextDay = new Date(2026, 7, 31, 0, 0, 0, 0);
    expect(resolveProgress(json(made), nextDay)).toEqual({ ok: false, reason: "daily expired" });
  });

  it("keeps a free record from last week — only daily expires", () => {
    const old = record({ setup: { mode: "free", seed: 3 }, updatedAt: new Date(2026, 7, 23).toISOString() });
    expect(resolveProgress(json(old), at(10)).ok).toBe(true);
  });

  it("keeps a finished record until its rollover, like any daily", () => {
    const won = record({ status: "finished" });
    expect(resolveProgress(json(won), at(22)).ok).toBe(true);
    expect(resolveProgress(json(won), new Date(2026, 7, 31, 1)).ok).toBe(false);
  });
});

describe("the storage wrapper", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(console, "debug").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("writes one key per game and reads it back", () => {
    writeProgress("othello", record());
    expect(localStorage.getItem("fun-progress-othello")).not.toBeNull();
    expect(readProgress("othello", at(10))).toEqual(record());
    expect(readProgress("wyrdle", at(10))).toBeNull();
  });

  it("the newest record wins — no history", () => {
    writeProgress("othello", record({ summary: { line: "first" } }));
    writeProgress("othello", record({ summary: { line: "second" } }));
    expect(readProgress("othello", at(10))?.summary.line).toBe("second");
  });

  it("clearProgress removes the key, and clearing an absent key is a no-op", () => {
    writeProgress("othello", record());
    clearProgress("othello");
    expect(readProgress("othello", at(10))).toBeNull();
    expect(() => clearProgress("othello")).not.toThrow();
  });

  it("a rejected record is cleared on read and the reason logged at debug (Q8)", () => {
    localStorage.setItem("fun-progress-othello", json({ ...record(), v: 2 }));
    expect(readProgress("othello", at(10))).toBeNull();
    expect(localStorage.getItem("fun-progress-othello")).toBeNull();
    expect(console.debug).toHaveBeenCalledWith("[progress] othello rejected: version 2");
  });

  it("an expired daily is cleared on read too", () => {
    localStorage.setItem("fun-progress-wyrdle", json(record()));
    expect(readProgress("wyrdle", new Date(2026, 7, 31, 8))).toBeNull();
    expect(localStorage.getItem("fun-progress-wyrdle")).toBeNull();
  });

  it("storage throwing → read is null, write and clear do not throw, one debug line each", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(readProgress("othello", at(10))).toBeNull();
    expect(() => writeProgress("othello", record())).not.toThrow();
    expect(() => clearProgress("othello")).not.toThrow();
    expect(console.debug).toHaveBeenCalledWith("[progress] othello storage denied: read");
    expect(console.debug).toHaveBeenCalledWith("[progress] othello storage denied: write");
  });
});
