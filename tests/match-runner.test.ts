//! P6 Phase 1 — the match-runner + `Player` port, driven against the REAL
//! `drop4.wasm` (not a mock). The wiring proof: two players play a full Drop 4
//! game over the wasm and the recorded `(seed, moves)` replays through a fresh
//! binding to the SAME terminal hash — i.e. the runner is live against the
//! shipped core, and it records a verifiable-by-replay match. Also pins the
//! illegal-move guard (the runner must not loop forever) and seeded determinism.

import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";

import { drop4Oracle } from "../src/games/drop4/drop4-oracle.js";
import { Drop4 } from "../src/games/drop4/drop4-wasm.js";
import type { GameOracle } from "../src/harness/game-oracle.js";
import {
  EnginePlayer,
  GreedyPlayer,
  RandomPlayer,
  runMatch,
  type Player,
} from "../src/harness/match-runner.js";

const WASM = "target/wasm32-unknown-unknown/release/drop4_wasm.wasm";

/** Load the real binding in node/jsdom by serving the on-disk wasm to `fetch`. */
async function loadReal(): Promise<GameOracle> {
  const bytes = await readFile(WASM);
  const orig = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(bytes, { headers: { "content-type": "application/wasm" } })) as typeof fetch;
  try {
    return drop4Oracle(await Drop4.load());
  } finally {
    globalThis.fetch = orig;
  }
}

/** Replay `(seed, moves)` through a fresh Drop4 and return the terminal hash. */
async function replayHash(seed: bigint, moves: number[]): Promise<string> {
  const g = await loadReal();
  g.newGame(seed);
  for (const col of moves) {
    expect(g.play(col)).toBe("applied");
  }
  return g.currentHash();
}

describe("match-runner: Player port + runMatch over the real wasm", () => {
  let wasmBytes: Buffer;
  beforeAll(async () => {
    wasmBytes = await readFile(WASM); // fail fast if preunit didn't build it
    expect(wasmBytes.length).toBeGreaterThan(0);
  });

  it(
    "engine-vs-engine plays a full game whose (seed, moves) replays to the same terminal hash",
    async () => {
      const game = await loadReal();
      const a: Player = new EnginePlayer(3);
      const b: Player = new EnginePlayer(3);
      const rec = await runMatch(game, a, b, 0n);

      // Reached a terminal result (Perfect-vs-Perfect fills the board -> draw).
      expect(rec.aborted).toBeFalsy();
      expect(rec.result).not.toBe(-1);
      expect(rec.moves.length).toBeGreaterThan(6);
      // Every recorded move was legal by construction (runMatch only records applied).
      // The wiring proof: the record replays through a FRESH binding to the same hash.
      expect(await replayHash(rec.seed, rec.moves)).toBe(rec.hash);
      // A per-move cost was recorded (the harness's headline "slower not stronger").
      expect(rec.timings?.length).toBe(rec.moves.length);
    },
    30_000,
  );

  it("aborts (does not loop forever) when a player returns an illegal move", async () => {
    const game = await loadReal();
    // A player whose first pick is an out-of-range column the wasm rejects.
    const rogue: Player = { label: "rogue", chooseMove: async () => 99 };
    const rec = await runMatch(game, rogue, new EnginePlayer(0), 3n);
    expect(rec.aborted).toBe(true);
    expect(rec.result).toBe(-1); // ended before a terminal result
    expect(rec.moves.length).toBe(0); // the illegal first move was never recorded
  });

  it("a seeded RandomPlayer matchup is deterministic and every move is legal", async () => {
    const play = async (): Promise<string> => {
      const game = await loadReal();
      const rec = await runMatch(game, new RandomPlayer(7), new RandomPlayer(11), 5n);
      // Legality: the record replays cleanly (every recorded move applied).
      expect(await replayHash(rec.seed, rec.moves)).toBe(rec.hash);
      return `${rec.result}:${rec.hash}:${rec.moves.join(",")}`;
    };
    expect(await play()).toBe(await play());
  });

  it("GreedyPlayer takes an immediate win when one is on offer", async () => {
    const game = await loadReal();
    game.newGame(1n);
    // Build a position where A (to move) has an immediate winning column.
    // A plays col 0 three times, B plays col 6 three times -> A's col 0 wins.
    for (const [ac, bc] of [
      [0, 6],
      [0, 6],
      [0, 6],
    ] as const) {
      expect(game.play(ac)).toBe("applied");
      expect(game.play(bc)).toBe("applied");
    }
    expect(game.board().toMove).toBe(1); // A to move, col 0 completes four
    const greedy = new GreedyPlayer();
    expect(await greedy.chooseMove(game)).toBe(0);
  });

  // `preference` replaces the Drop-4-specific CENTRE_OUT constant that used to
  // live in shared code. All three branches are asserted: a single "centre-out
  // still works" case would survive a mutation that ignores `preference`
  // entirely, because CENTRE_OUT[0] is usually legal anyway.
  it("GreedyPlayer's tie-break is injectable: used, missed, and absent", async () => {
    const game = await loadReal();
    game.newGame(1n); // opening — all 7 columns legal, no win or block on offer
    const legalOrder = game.legalMoves()[0]!;

    // absent -> legal-move order
    expect(await new GreedyPlayer().chooseMove(game)).toBe(legalOrder);
    // present and legal -> the first preferred column
    expect(await new GreedyPlayer([5, 2]).chooseMove(game)).toBe(5);
    // present but none legal -> falls back to legal-move order
    expect(await new GreedyPlayer([99, 42]).chooseMove(game)).toBe(legalOrder);
  });
});
