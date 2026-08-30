//! Unit tests for the Mahjong front end's pure logic: the share encode/decode
//! round-trip, the daily seed derivation (mirrors `mahjong_core::daily_seed`),
//! the board-fit maths, and verify-orchestration against the REAL wasm binding.

import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";

import { decodeRecord, encodeRecord, verifyRecord, type MahjongEnvelope } from "../src/games/mahjong/mahjong-outcome.js";
import { fitUnit, layoutName } from "../src/games/mahjong/mahjong.js";
import { dailySeedFor, hashStr, Mahjong, SHUFFLE_CODE } from "../src/games/mahjong/mahjong-wasm.js";

const WASM = "target/wasm32-unknown-unknown/release/mahjong_wasm.wasm";

async function loadReal(): Promise<Mahjong> {
  const bytes = await readFile(WASM);
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => new Response(bytes, { headers: { "content-type": "application/wasm" } })) as typeof fetch;
  try {
    return await Mahjong.load();
  } finally {
    globalThis.fetch = orig;
  }
}

describe("the daily seed is the core's FNV-1a of the date key", () => {
  it("hashStr is FNV-1a 32", () => {
    expect(hashStr("")).toBe(2166136261);
    expect(hashStr("a")).toBe(0xe40c292c);
  });
  it("dailySeedFor hashes mahjong-daily-<date>", () => {
    expect(dailySeedFor("2026-08-30")).toBe(hashStr("mahjong-daily-2026-08-30"));
    expect(dailySeedFor("2026-08-30")).not.toBe(dailySeedFor("2026-08-31"));
  });
  it("the shuffle code is the core's", () => {
    expect(SHUFFLE_CODE).toBe(0x10000);
  });
});

describe("fitUnit — the board fits the stage in both axes", () => {
  it("picks the tighter axis and never goes under the 12px floor", () => {
    // The Turtle: 30 x 16 half units, five layers.
    const wide = fitUnit({ stageW: 1200, stageH: 400, width: 30, height: 16, layers: 5 });
    expect(wide * (16 + 0.35 * 4 + 0.35)).toBeLessThanOrEqual(400);
    const narrow = fitUnit({ stageW: 500, stageH: 900, width: 30, height: 16, layers: 5 });
    expect(narrow * (30 + 0.35 * 4 + 0.35)).toBeLessThanOrEqual(500);
    expect(fitUnit({ stageW: 100, stageH: 100, width: 30, height: 16, layers: 5 })).toBe(12);
  });
  it("names layouts for the chip", () => {
    expect(layoutName("turtle")).toBe("Turtle");
    expect(layoutName("pond")).toBe("Pond");
  });
});

describe("share encode/decode", () => {
  it("round-trips an envelope as base64url", async () => {
    const env: MahjongEnvelope = {
      kind: "mahjong",
      version: 1,
      payload: { kind: "mahjong", seed: 4 * 2 ** 32 + 7, moves: [0x0102, SHUFFLE_CODE, 0x0304], move_count: 3, final_hash: "abc", result: "Won", assistance: false },
    };
    const encoded = await encodeRecord(env);
    expect(encoded).not.toMatch(/[+/=]/);
    expect(await decodeRecord(encoded)).toEqual(env);
  });
});

describe("verify against the real binding", () => {
  let game: Mahjong;
  let verifier: Mahjong;
  beforeAll(async () => {
    game = await loadReal();
    verifier = await loadReal();
  });

  it("an honest clear of level 1 verifies; a tampered record does not", () => {
    game.newLevel(1);
    for (let guard = 0; guard < 40; guard++) {
      const h = game.hint(20_000);
      if (!h) break;
      expect(game.play(h.a, h.b)).toBe("applied");
    }
    expect(game.isWon()).toBe(true);
    const env = game.outcome(true, false) as MahjongEnvelope;
    expect(env.payload.result).toBe("Won");
    expect(verifyRecord(verifier, env).ok).toBe(true);

    const bad: MahjongEnvelope = { ...env, payload: { ...env.payload, moves: env.payload.moves.slice(0, 5) } };
    expect(verifyRecord(verifier, bad).ok).toBe(false);
  });

  it("the core refuses an illegal pair and the shuffle keeps the count", () => {
    game.newLevel(4); // Bridge, 60 tiles
    const b = game.board();
    expect(b.slots).toHaveLength(60);
    const free = b.slots.findIndex((s) => s.free);
    const blocked = b.slots.findIndex((s) => !s.free);
    expect(game.play(free, blocked)).toBe("refused");
    // matchesFor answers for any present slot; every answer is a free tile.
    for (const m of game.matchesFor(blocked)) expect(b.slots[m]!.free).toBe(true);
    expect(game.shuffle()).toBe("applied");
    expect(game.board().remaining).toBe(60);
    expect(game.board().moveCount).toBe(1);
    expect(game.undo()).toBe(true);
    expect(game.board().moveCount).toBe(0);
  });
});
