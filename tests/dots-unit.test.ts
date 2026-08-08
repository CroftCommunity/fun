//! Phase 6 — the typed Dots and Boxes wrapper, the lattice the UI draws, and the
//! verifiable outcome, driven against the REAL dots.wasm (via the fetch-shim).
//! Proves: the empty lattice offers all 24 edges; closing a box scores it and
//! keeps the turn (the rule no other shelf game has); a full game replays through
//! a fresh binding to the same terminal hash (the `?r=` property); and the
//! `liveMove` sentinel decodes to `null` rather than a negative number.
//!
//! `latticeCells` is the UI's only piece of board arithmetic. It is pure and
//! pinned here against the numbering diagram in `crates/dots-core/RULES.md`,
//! because an off-by-one there would draw an edge in the wrong place while every
//! rules test stayed green.

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { verifyRecord, type DotsEnvelope } from "../src/games/dots/dots-outcome.js";
import { Dots } from "../src/games/dots/dots-wasm.js";
import { latticeCells } from "../src/games/dots/dots-lattice.js";

const WASM = "target/wasm32-unknown-unknown/release/dots_wasm.wasm";

async function loadReal(): Promise<Dots> {
  const bytes = await readFile(WASM);
  const orig = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(bytes, { headers: { "content-type": "application/wasm" } })) as typeof fetch;
  try {
    return await Dots.load();
  } finally {
    globalThis.fetch = orig;
  }
}

describe("the lattice the UI draws", () => {
  it("lays out dots, edges and boxes in the core's own numbering", () => {
    const cells = latticeCells(3, 3);
    // A 3x3-box board draws on a 7x7 grid: 4 dot rows interleaved with 3 box rows.
    expect(cells).toHaveLength(49);
    const row = (r: number): string[] =>
      cells.slice(r * 7, r * 7 + 7).map((c) => (c.kind === "dot" ? "*" : `${c.kind}${c.index}`));
    // RULES.md: the top dot row carries H(0,0..2) = edges 0..2, and the first box
    // row carries V(0,0..3) = edges 12..15 around boxes 0..2.
    expect(row(0)).toEqual(["*", "h0", "*", "h1", "*", "h2", "*"]);
    expect(row(1)).toEqual(["v12", "box0", "v13", "box1", "v14", "box2", "v15"]);
    expect(row(2)).toEqual(["*", "h3", "*", "h4", "*", "h5", "*"]);
    // The last row is dots and the final horizontal edges H(3,0..2) = 9..11.
    expect(row(6)).toEqual(["*", "h9", "*", "h10", "*", "h11", "*"]);
    // Every edge and every box appears exactly once.
    const edges = cells.filter((c) => c.kind === "h" || c.kind === "v").map((c) => c.index);
    expect([...edges].sort((a, b) => a - b)).toEqual([...Array(24).keys()]);
    expect(cells.filter((c) => c.kind === "box")).toHaveLength(9);
  });
});

describe("dots wrapper + verifiable outcome (real wasm)", () => {
  it("the empty lattice offers all 24 edges and Side A opens", async () => {
    const g = await loadReal();
    g.newGame(7n);
    const b = g.board();
    expect(b.rows).toBe(3);
    expect(b.cols).toBe(3);
    expect(b.edges).toBe(24);
    expect(b.toMove).toBe(1);
    expect(b.result).toBe(-1);
    expect(b.legal).toHaveLength(24);
    expect(b.drawn.every((d) => !d)).toBe(true);
    expect(b.lastEdge).toBeNull();
    expect(b.keptTurn).toBe(false);
    expect(g.play(0)).toBe("applied");
    expect(g.play(0)).toBe("illegal"); // an already-drawn edge
    expect(g.board().toMove).toBe(2); // a quiet edge passes the turn
  });

  it("closing a box scores it and keeps the turn", async () => {
    const g = await loadReal();
    g.newGame(7n);
    // Box 0 closes on edges 0, 3, 12, 13 — the fourth of them captures.
    for (const e of [0, 3, 12]) expect(g.play(e)).toBe("applied");
    expect(g.board().keptTurn).toBe(false);
    expect(g.closesCount(13)).toBe(1);
    expect(g.play(13)).toBe("applied");
    const after = g.board();
    expect(after.keptTurn).toBe(true);
    expect(after.toMove).toBe(2); // B closed it, so B moves again
    expect(after.boxesB).toBe(1);
    expect(after.owners[0]).toBe(2);
    expect(after.lastEdge).toBe(13);
    expect(after.edgeOwner[13]).toBe(2);
  });

  it("a full game replays to the same verifiable hash, and liveMove ends at null", async () => {
    const g = await loadReal();
    g.newGame(3n);
    let guard = 0;
    while (g.board().result === -1) {
      const mv = g.liveMove("Perfect");
      expect(typeof mv).toBe("number");
      expect(g.play(mv as number)).toBe("applied");
      if ((guard += 1) > 24) throw new Error("runaway game");
    }
    expect(g.liveMove("Perfect")).toBeNull(); // the sentinel, not -1
    expect(g.board().result).toBe(2); // 3x3 is a second-player win

    const env = g.outcome(false) as DotsEnvelope;
    expect(env.payload.kind).toBe("dots");
    expect(env.payload.moves).toHaveLength(24);
    expect(env.payload.result).toBe("Lost"); // Side A lost it, by construction

    const fresh = await loadReal();
    const v = verifyRecord(fresh, env);
    expect(v.ok).toBe(true);
    expect(v.actual).toBe(env.payload.final_hash);
  }, 120_000);

  it("verification fails when a move is tampered with", async () => {
    const g = await loadReal();
    g.newGame(5n);
    while (g.board().result === -1) g.play(g.liveMove("Hard") as number);
    const env = g.outcome(false) as DotsEnvelope;
    // Drop the final edge: the replay reaches a different position, so the
    // re-derived hash cannot match the stored one.
    const forged: DotsEnvelope = {
      ...env,
      payload: { ...env.payload, moves: env.payload.moves.slice(0, -1) },
    };
    expect(verifyRecord(await loadReal(), forged).ok).toBe(false);
  }, 120_000);
});
