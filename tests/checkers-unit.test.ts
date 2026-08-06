//! P8 Phase 12 — the typed Checkers wrapper + verifiable outcome, driven against
//! the REAL checkers.wasm (via the fetch-shim). Proves: the opening exposes the 7
//! textbook man-advances with full chain detail; a whole game replays through a
//! fresh binding to the same terminal hash (the verifiable `?r=` property) and a
//! **tampered** record does not; and the packed move code — the shelf's first
//! move code above 255 — survives the JSON share path intact.

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import {
  decodeRecord,
  encodeRecord,
  verifyRecord,
  type CheckersEnvelope,
} from "../src/games/checkers/checkers-outcome.js";
import { Checkers } from "../src/games/checkers/checkers-wasm.js";

const WASM = "target/wasm32-unknown-unknown/release/checkers_wasm.wasm";

async function loadReal(): Promise<Checkers> {
  const bytes = await readFile(WASM);
  const orig = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(bytes, { headers: { "content-type": "application/wasm" } })) as typeof fetch;
  try {
    return await Checkers.load();
  } finally {
    globalThis.fetch = orig;
  }
}

/** Play to a terminal position with the shipped opponent on both sides. */
function playOut(g: Checkers, level: "Easy" | "Expert" = "Easy"): void {
  let guard = 0;
  while (g.board().result === -1) {
    const m = g.liveMove(level);
    expect(typeof m).toBe("number");
    expect(g.play(m as number)).toBe("applied");
    if (++guard > 400) throw new Error("runaway game");
  }
}

describe("checkers wrapper + verifiable outcome (real wasm)", () => {
  it("the opening exposes the 7 man-advances, each with its chain detail", async () => {
    const g = await loadReal();
    g.newGame(7n);
    const b = g.board();
    expect(b.squares).toBe(32);
    expect(b.cells.length).toBe(32);
    expect(b.toMove).toBe(1);
    expect(b.noProgress).toBe(0);
    expect(b.result).toBe(-1);
    expect(b.legal.length).toBe(7);

    for (const mv of b.legal) {
      expect(mv.path).toEqual([mv.to]); // a simple move lands once
      expect(mv.captures).toEqual([]);
      expect(mv.crowns).toBe(false);
      expect(mv.code).toBe(mv.from | (mv.to << 5)); // variant 0 for simple moves
    }
    expect(g.legalMoves()).toEqual(b.legal.map((m) => m.code));

    // An out-of-range code is rejected, not applied, and never panics the module.
    expect(g.play(0xffff)).toBe("over");

    const first = b.legal[0]!;
    expect(g.play(first.code)).toBe("applied");
    const after = g.board();
    expect(after.toMove).toBe(2);
    expect(after.cells[first.from]).toBe(0);
    expect(after.cells[first.to]).toBe(1);
  });

  it("a whole game replays to the same hash, and a tampered record does not", async () => {
    const g = await loadReal();
    g.newGame(11n);
    playOut(g);

    const env = g.outcome(false) as CheckersEnvelope;
    expect(env.kind).toBe("checkers");
    expect(env.payload.moves.length).toBeGreaterThan(10);
    // The wire contract: plain JSON numbers, and checkers is the first game whose
    // codes exceed a `u8` — a silent `u8` assumption anywhere would truncate them.
    expect(env.payload.moves.every((c) => Number.isInteger(c))).toBe(true);
    expect(env.payload.moves.some((c) => c > 255)).toBe(true);

    expect(verifyRecord(await loadReal(), env).ok).toBe(true);

    // Tamper with one move — a different legal opening, deliberately > 255.
    const tampered: CheckersEnvelope = {
      ...env,
      payload: { ...env.payload, moves: [...env.payload.moves] },
    };
    const fresh = await loadReal();
    fresh.newGame(11n);
    const swap = fresh.board().legal.find((m) => m.code !== env.payload.moves[0])!;
    expect(swap.code).toBeGreaterThan(255);
    tampered.payload.moves[0] = swap.code;
    expect(verifyRecord(await loadReal(), tampered).ok).toBe(false);
  }, 120_000);

  it("the share payload round-trips as plain numbers", async () => {
    const g = await loadReal();
    g.newGame(5n);
    for (let i = 0; i < 6; i++) g.play(g.board().legal[0]!.code);
    const env = g.outcome(true) as CheckersEnvelope;

    const decoded = await decodeRecord(await encodeRecord(env));
    expect(decoded.payload.moves).toEqual(env.payload.moves);
    expect(decoded.payload.assistance).toBe(false);
    expect(decoded.payload.result).toBe("Abandoned");
  });

  it("a real jump chain arrives with its captures and step-through path", async () => {
    const g = await loadReal();
    let jump: { captures: number[]; path: number[] } | null = null;
    for (let seed = 0; seed < 8 && jump === null; seed++) {
      g.newGame(BigInt(seed));
      let guard = 0;
      while (g.board().result === -1 && jump === null) {
        for (const mv of g.board().legal) {
          if (mv.captures.length >= 1) jump = mv;
        }
        const m = g.liveMove("Easy");
        expect(g.play(m as number)).toBe("applied");
        if (++guard > 400) break;
      }
    }
    expect(jump, "no capture found in 8 games").not.toBeNull();
    // The path is one landing per hop, so the UI can step a player through it.
    expect(jump!.path.length).toBe(jump!.captures.length);
  }, 120_000);

  it("the tutor report typechecks with sane facts", async () => {
    const g = await loadReal();
    g.newGame(1n);
    const report = g.tutor();
    expect(report.exact).toBe(false); // the opening is horizon-approximate
    expect(typeof report.bestCol).toBe("number");
    expect(report.moves.length).toBe(g.legalMoves().length);
    const first = report.moves[0]!;
    expect(first.immediateWin).toBe(false); // checkers has no one-move win
    expect(first.blocksOpponentWin).toBe(false);
    expect(typeof first.captures).toBe("number");
    expect(["optimal", "resultPreserving", "blunder"]).toContain(first.quality);

    const a = g.assess(g.legalMoves()[0]!);
    expect(a).not.toBeNull();
    expect(["optimal", "resultPreserving", "blunder"]).toContain(a!.quality);
    expect(g.assess(0xffff)).toBeNull();
  }, 60_000);

  it("liveMove returns null at a terminal position (the u32 sentinel)", async () => {
    const g = await loadReal();
    g.newGame(2n);
    playOut(g);
    expect(g.liveMove("Easy")).toBeNull();
    expect(g.oracleBest("Expert")).toBeNull();
  }, 120_000);
});
