//! Unit tests for match-3's pure logic: the share round-trip, verify-
//! orchestration against the REAL wasm (+ tamper), and the result screen.

import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";

import { decodeRecord, encodeRecord, verifyRecord, type M3Envelope } from "../src/games/match3-outcome.js";
import { renderResultScreen } from "../src/games/match3.js";
import { Match3, type Swap } from "../src/games/match3-wasm.js";

const WASM = "target/wasm32-unknown-unknown/release/match3_wasm.wasm";

async function loadReal(): Promise<Match3> {
  const bytes = await readFile(WASM);
  const orig = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(bytes, { headers: { "content-type": "application/wasm" } })) as typeof fetch;
  try {
    return await Match3.load();
  } finally {
    globalThis.fetch = orig;
  }
}

function envelope(result: "Won" | "Lost", stars: number, score: number): M3Envelope {
  return {
    kind: "match3",
    version: 1,
    payload: {
      kind: "match3",
      seed: 7,
      moves: [[0, 0, 0, 1]],
      move_count: 1,
      final_hash: "deadbeef",
      result,
      assistance: false,
      score,
      stars,
    },
  };
}

describe("share encode/decode", () => {
  it("round-trips a match-3 envelope through deflated base64url", async () => {
    const env = envelope("Won", 2, 1200);
    env.payload.moves = [[0, 0, 0, 1], [3, 4, 4, 4], [1, 1, 1, 2]] as Swap[];
    const encoded = await encodeRecord(env);
    expect(encoded).not.toMatch(/[+/=]/);
    expect(await decodeRecord(encoded)).toEqual(env);
  });
});

describe("verify-orchestration (real wasm)", () => {
  let game: Match3;
  let env: M3Envelope;

  beforeAll(async () => {
    game = await loadReal();
    game.newGame(7n);
    for (let i = 0; i < 6; i += 1) {
      const moves = game.legalMoves();
      if (moves.length === 0) break;
      game.play(moves[0]!);
    }
    env = game.outcome(true) as M3Envelope;
  });

  it("re-verifies a genuine run by replaying the swaps through the core", () => {
    const v = verifyRecord(game, env);
    expect(v.ok).toBe(true);
    expect(v.actual).toBe(env.payload.final_hash);
  });

  it("rejects a tampered hash", () => {
    const tampered: M3Envelope = { ...env, payload: { ...env.payload, final_hash: "0".repeat(64) } };
    expect(verifyRecord(game, tampered).ok).toBe(false);
  });

  it("rejects a tampered swap list", () => {
    const tampered: M3Envelope = { ...env, payload: { ...env.payload, moves: env.payload.moves.slice(0, -1) } };
    expect(verifyRecord(game, tampered).ok).toBe(false);
  });
});

describe("result screen", () => {
  it("leads with the stars earned when won", () => {
    const el = renderResultScreen(envelope("Won", 2, 1200), { ok: true, expected: "h", actual: "h" }, {
      shareUrl: "/match3/?r=abc",
    });
    expect(el.textContent).toMatch(/verif/i);
    expect(el.textContent).toContain("1200");
    expect(el.querySelector("[data-share]")?.getAttribute("data-share")).toContain("?r=");
  });

  it("says under target when no star was earned", () => {
    const el = renderResultScreen(envelope("Lost", 0, 120), { ok: true, expected: "h", actual: "h" });
    expect(el.textContent).toMatch(/under target/i);
  });

  it("flags a failed verification", () => {
    const el = renderResultScreen(envelope("Won", 3, 2000), { ok: false, expected: "aaa", actual: "bbb" });
    expect(el.textContent).toMatch(/fail/i);
    expect(el.textContent).toContain("aaa");
  });
});
