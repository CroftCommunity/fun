//! Unit tests for match-3's pure logic: the share round-trip, verify-
//! orchestration against the REAL wasm (+ tamper), and the result screen.

import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";

import { decodeRecord, encodeRecord, verifyRecord, type M3Envelope } from "../src/games/match3-outcome.js";
import { renderResultScreen } from "../src/games/match3.js";
import { Match3, type Swap } from "../src/games/match3-wasm.js";
import { analyzeCascade } from "../src/games/match3-fx.js";

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

describe("clear-the-blockers verify-orchestration (real wasm)", () => {
  let game: Match3;
  let env: M3Envelope;

  beforeAll(async () => {
    game = await loadReal();
    // The committed pack fixture (re-locked after the B0 specials pack regen):
    // seed 19 clears in a single swap.
    game.newBlockersGame(19n);
    game.play([5, 5, 6, 5]);
    env = game.outcome(true) as M3Envelope;
  });

  it("grades a cleared blocker board as a verifiable Won", () => {
    expect(env.kind).toBe("match3-blockers");
    expect(env.payload.result).toBe("Won");
    expect(env.payload.score).toBeUndefined(); // blockers mode has no score/stars
    const v = verifyRecord(game, env);
    expect(v.ok).toBe(true);
    expect(v.actual).toBe(env.payload.final_hash);
  });

  it("rejects a tampered blocker swap list", () => {
    const tampered: M3Envelope = { ...env, payload: { ...env.payload, moves: [[0, 0, 0, 1]] } };
    expect(verifyRecord(game, tampered).ok).toBe(false);
  });
});

describe("clear-the-jelly verify-orchestration (real wasm)", () => {
  let game: Match3;
  let env: M3Envelope;

  beforeAll(async () => {
    game = await loadReal();
    // The committed jelly pack fixture (re-derived after the B4 2×2/deal change):
    // seed 35 clears in two swaps.
    game.newJellyGame(35n);
    game.play([6, 0, 6, 1]);
    game.play([6, 5, 6, 6]);
    env = game.outcome(true) as M3Envelope;
  });

  it("grades a scrubbed jelly board as a verifiable Won", () => {
    expect(env.kind).toBe("match3-jelly");
    expect(env.payload.result).toBe("Won");
    expect(env.payload.score).toBeUndefined(); // jelly mode has no score/stars
    const v = verifyRecord(game, env);
    expect(v.ok).toBe(true);
    expect(v.actual).toBe(env.payload.final_hash);
  });

  it("rejects a tampered jelly swap list", () => {
    const tampered: M3Envelope = { ...env, payload: { ...env.payload, moves: [[0, 0, 0, 1]] } };
    expect(verifyRecord(game, tampered).ok).toBe(false);
  });
});

describe("checklist verify-orchestration (real wasm)", () => {
  let game: Match3;
  let env: M3Envelope;

  beforeAll(async () => {
    game = await loadReal();
    // The committed checklist pack fixture: seed 3 completes every goal in two swaps.
    game.newChecklistGame(3n);
    game.play([5, 4, 5, 5]);
    game.play([6, 3, 6, 4]);
    env = game.outcome(true) as M3Envelope;
  });

  it("grades a completed checklist as a verifiable Won", () => {
    expect(env.kind).toBe("match3-checklist");
    expect(env.payload.result).toBe("Won");
    expect(env.payload.score).toBeUndefined(); // checklist mode has no score/stars
    const v = verifyRecord(game, env);
    expect(v.ok).toBe(true);
    expect(v.actual).toBe(env.payload.final_hash);
  });

  it("rejects a tampered checklist swap list", () => {
    const tampered: M3Envelope = { ...env, payload: { ...env.payload, moves: [[0, 0, 0, 1]] } };
    expect(verifyRecord(game, tampered).ok).toBe(false);
  });
});

describe("clear-the-obstacles verify-orchestration (real wasm)", () => {
  let game: Match3;
  let env: M3Envelope;

  beforeAll(async () => {
    game = await loadReal();
    // The committed obstacles pack fixture: seed 72 clears every obstacle in one swap.
    game.newObstaclesGame(72n);
    game.play([6, 2, 7, 2]);
    env = game.outcome(true) as M3Envelope;
  });

  it("grades a cleared obstacle board as a verifiable Won", () => {
    expect(env.kind).toBe("match3-obstacles");
    expect(env.payload.result).toBe("Won");
    expect(env.payload.score).toBeUndefined(); // obstacles mode has no score/stars
    const v = verifyRecord(game, env);
    expect(v.ok).toBe(true);
    expect(v.actual).toBe(env.payload.final_hash);
  });

  it("rejects a tampered obstacle swap list", () => {
    const tampered: M3Envelope = { ...env, payload: { ...env.payload, moves: [[0, 0, 0, 1]] } };
    expect(verifyRecord(game, tampered).ok).toBe(false);
  });
});

describe("target-score par table (real wasm)", () => {
  it("serves the baked ladder tiers for a daily (in-table) seed", async () => {
    const game = await loadReal();
    const pack = JSON.parse(await readFile("games/match3/par-pack.json", "utf8")) as {
      payload: { entries: { seed: number; tiers: [number, number, number] }[] };
    };
    const entry = pack.payload.entries.find((e) => e.seed === 7)!;
    game.newGame(7n);
    const board = game.board();
    expect(board.mode).toBe("target-score");
    expect(board.targets).toEqual(entry.tiers); // ladder, not the old 30/60/90%
    // 3★ is a strong-but-attainable bar well above the old 90%-of-greedy.
    expect(board.targets[2]).toBeGreaterThan(board.targets[1]);
    expect(board.targets[1]).toBeGreaterThan(board.targets[0]);
  });

  it("exposes a target-score daily seed from the table", async () => {
    const game = await loadReal();
    const seed = game.targetDailySeed(0);
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThan(365); // the 365-seed contiguous par table
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

  it("pluralises swaps in the clear headline (one swap, not '1 swaps')", () => {
    const clear = (moveCount: number): M3Envelope => ({
      kind: "match3-blockers",
      version: 1,
      payload: {
        kind: "match3-blockers",
        seed: 7,
        moves: [],
        move_count: moveCount,
        final_hash: "h",
        result: "Won",
        assistance: false,
      },
    });
    const headline = (env: M3Envelope): string | null | undefined =>
      renderResultScreen(env, { ok: true, expected: "h", actual: "h" })
        .querySelector(".sol-headline")
        ?.textContent;
    expect(headline(clear(1))).toBe("All blockers cleared in 1 swap — verifiable");
    expect(headline(clear(2))).toBe("All blockers cleared in 2 swaps — verifiable");
  });
});

describe("analyzeCascade over real trace frames (real wasm)", () => {
  it("reports a real move's clear phases and cleared cells within the board", async () => {
    const game = await loadReal();
    game.newGame(7n);
    const move = game.legalMoves()[0]!; // a legal swap always makes at least one match
    const frames = game.playTraced(move);
    expect(frames.length).toBeGreaterThan(1); // after-swap + at least one clear/settle
    const info = analyzeCascade(frames);
    expect(info.depth).toBeGreaterThanOrEqual(1);
    expect(info.totalCleared).toBeGreaterThanOrEqual(3); // a match is 3+ gems
    const h = frames[0]!.length;
    const w = frames[0]![0]!.length;
    for (const phase of info.clears) {
      expect(phase.frameIndex).toBeGreaterThan(0);
      expect(phase.frameIndex).toBeLessThan(frames.length);
      for (const cell of phase.cells) {
        expect(cell.r).toBeGreaterThanOrEqual(0);
        expect(cell.r).toBeLessThan(h);
        expect(cell.c).toBeGreaterThanOrEqual(0);
        expect(cell.c).toBeLessThan(w);
      }
    }
  });
});
