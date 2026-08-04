//! P7 Phase 4 — the typed Othello wrapper + verifiable outcome, driven against
//! the REAL othello.wasm (via the fetch-shim). Proves: the opening exposes the 4
//! textbook moves and a placement flips; a full game (forced passes included)
//! replays through a fresh binding to the same terminal hash (the verifiable
//! `?r=` property); and the tutor shape typechecks with sane facts.

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import {
  PASS_CODE,
  verifyRecord,
  type OthelloEnvelope,
} from "../src/games/othello/othello-outcome.js";
import { Othello } from "../src/games/othello/othello-wasm.js";

const WASM = "target/wasm32-unknown-unknown/release/othello_wasm.wasm";

async function loadReal(): Promise<Othello> {
  const bytes = await readFile(WASM);
  const orig = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(bytes, { headers: { "content-type": "application/wasm" } })) as typeof fetch;
  try {
    return await Othello.load();
  } finally {
    globalThis.fetch = orig;
  }
}

describe("othello wrapper + verifiable outcome (real wasm)", () => {
  it("the opening exposes the 4 textbook moves and a placement flips", async () => {
    const g = await loadReal();
    g.newGame(7n);
    const b = g.board();
    expect(b.size).toBe(8);
    expect(b.toMove).toBe(1);
    expect(b.mustPass).toBe(false);
    expect([...b.legal].sort((x, y) => x - y)).toEqual([19, 26, 37, 44]);
    expect(g.pass()).toBe("illegal"); // a pass is illegal while placements exist

    expect(g.play(19)).toBe("applied"); // d3
    const after = g.board();
    expect(after.cells[3]![3]).toBe(1); // (3,3) flipped to A
    expect(after.toMove).toBe(2); // now B to move
  });

  it("a full game (passes included) replays to the same verifiable hash", async () => {
    const g = await loadReal();
    g.newGame(3n);
    let guard = 0;
    while (g.board().result === -1) {
      const b = g.board();
      if (b.mustPass) g.pass();
      else expect(g.play(b.legal[0]!)).toBe("applied");
      if (++guard > 200) throw new Error("runaway game");
    }
    const env = g.outcome(false) as OthelloEnvelope;
    expect(env.kind).toBe("othello");
    // Passes serialize as the compact PASS_CODE (64) — the game hit at least one.
    expect(env.payload.moves).toContain(PASS_CODE);

    const verifier = await loadReal();
    expect(verifyRecord(verifier, env).ok).toBe(true);
  });

  it("the tutor report typechecks with sane facts", async () => {
    const g = await loadReal();
    g.newGame(1n);
    const report = g.tutor();
    expect(report.exact).toBe(false); // the opening is horizon-approximate
    expect(typeof report.bestCol).toBe("number");
    expect(report.moves.length).toBe(g.legalMoves().length);
    const first = report.moves[0]!;
    expect(first.immediateWin).toBe(false); // Othello has no immediate line-win
    expect(typeof first.takesCorner).toBe("boolean");
    expect(["optimal", "resultPreserving", "blunder"]).toContain(first.quality);

    const a = g.assess(g.legalMoves()[0]!);
    expect(a).not.toBeNull();
    expect(["optimal", "resultPreserving", "blunder"]).toContain(a!.quality);
  });
});
