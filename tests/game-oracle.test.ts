//! P8 Phase 1 — the `GameOracle` port, proven against the REAL `drop4.wasm`.
//!
//! The port is what lets the scoring rig grade *any* shelf game instead of only
//! Drop 4. This suite's job is to pin the two contracts a second and third game
//! will be held to (see `src/harness/game-oracle.ts`):
//!
//!   1. a move is the game's compact **numeric wire code**, and
//!   2. `liveMove` takes a **numeric level** `0..3`, because the games' own
//!      `Level` unions disagree on the top member (Drop 4 `"Perfect"` vs
//!      Othello `"Expert"`).
//!
//! The wiring test drives a full game through the port surface **alone** — no
//! `Drop4` method is called after construction. If that is possible, the rig can
//! be written against `GameOracle` without knowing which game it is grading.

import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";

import { drop4Oracle } from "../src/games/drop4/drop4-oracle.js";
import { Drop4 } from "../src/games/drop4/drop4-wasm.js";
import type { GameOracle, OracleLevel } from "../src/harness/game-oracle.js";

const WASM = "target/wasm32-unknown-unknown/release/drop4_wasm.wasm";

/** Load the real binding in node/jsdom by serving the on-disk wasm to `fetch`. */
async function loadDrop4(): Promise<Drop4> {
  const bytes = await readFile(WASM);
  const orig = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(bytes, { headers: { "content-type": "application/wasm" } })) as typeof fetch;
  try {
    return await Drop4.load();
  } finally {
    globalThis.fetch = orig;
  }
}

async function loadOracle(): Promise<GameOracle> {
  return drop4Oracle(await loadDrop4());
}

describe("GameOracle: the game-agnostic port, over the real drop4 wasm", () => {
  beforeAll(async () => {
    const bytes = await readFile(WASM); // fail fast if preunit didn't build it
    expect(bytes.length).toBeGreaterThan(0);
  });

  it(
    "drives a full game to a terminal result through the port surface alone",
    async () => {
      const oracle = await loadOracle();
      oracle.newGame(7n);

      let plies = 0;
      while (oracle.board().result === -1) {
        const code = oracle.liveMove(3);
        expect(code).not.toBeNull();
        expect(oracle.legalMoves()).toContain(code);
        expect(oracle.play(code!)).toBe("applied");
        plies += 1;
        expect(plies).toBeLessThanOrEqual(42); // 7x6 board: a game cannot outlast this
      }

      expect(oracle.board().result).not.toBe(-1);
      expect(oracle.currentHash()).toMatch(/^[0-9a-f]+$/);
      expect(plies).toBeGreaterThan(0);
    },
    120_000,
  );

  it("reports the board, legal moves and a text rendering through the port", async () => {
    const oracle = await loadOracle();
    oracle.newGame(1n);

    const board = oracle.board();
    expect(board.result).toBe(-1);
    expect([1, 2]).toContain(board.toMove);
    expect(oracle.legalMoves()).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(oracle.renderText().length).toBeGreaterThan(0);
  });

  it("assesses a legal move with a quality and an exactness flag", async () => {
    const oracle = await loadOracle();
    oracle.newGame(1n);

    const a = oracle.assess(3);
    expect(a).not.toBeNull();
    expect(["optimal", "resultPreserving", "blunder"]).toContain(a!.quality);
    expect(typeof a!.exact).toBe("boolean");
    // The one-ply facts the rig's GreedyPlayer reads must survive the port.
    expect(typeof a!.immediateWin).toBe("boolean");
    expect(typeof a!.blocksOpponentWin).toBe("boolean");
  });

  it("returns a tutor report whose moves carry the shared band fields", async () => {
    const oracle = await loadOracle();
    oracle.newGame(1n);

    const report = oracle.tutor();
    expect(report.moves.length).toBeGreaterThan(0);
    expect(report.bestCol).not.toBeNull();
    for (const m of report.moves) {
      expect(typeof m.col).toBe("number");
      expect(typeof m.value).toBe("number");
      expect(["optimal", "resultPreserving", "blunder"]).toContain(m.quality);
    }
  });

  // The boundary cases: a level map collapsed to a single constant would pass a
  // single-level assertion, so every code is exercised, and the top code is
  // pinned to Drop 4's own word for it.
  it("accepts every level code 0..3 and returns a legal move for each", async () => {
    const oracle = await loadOracle();
    for (const level of [0, 1, 2, 3] as OracleLevel[]) {
      oracle.newGame(11n);
      const code = oracle.liveMove(level);
      expect(code, `level ${level} returned no move`).not.toBeNull();
      expect(oracle.legalMoves()).toContain(code);
    }
  });

  it("maps level code 3 to Drop 4's own top level (Perfect)", async () => {
    const viaPort = await loadOracle();
    const viaWrapper = await loadDrop4();
    viaPort.newGame(11n);
    viaWrapper.newGame(11n);
    expect(viaPort.liveMove(3)).toBe(viaWrapper.liveMove("Perfect"));
  });

  it("returns null from liveMove once the position is terminal", async () => {
    const oracle = await loadOracle();
    oracle.newGame(7n);
    while (oracle.board().result === -1) {
      const code = oracle.liveMove(3);
      oracle.play(code!);
    }
    expect(oracle.liveMove(3)).toBeNull();
  }, 120_000);
});
