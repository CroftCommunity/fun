//! Chess Phase 8 — the typed Chess wrapper + verifiable outcome, driven against
//! the REAL chess.wasm (via the fetch-shim). Proves: the opening exposes twenty
//! moves with their codes unpacked; a whole game replays through a fresh
//! binding to the same terminal hash (the verifiable `?r=` property) and each
//! kind of tamper fails for its own reason; the 15-bit move code survives the
//! JSON share path; the level union maps to 0..3; and the terminal sentinel
//! arrives as null.

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import {
  decodeRecord,
  encodeRecord,
  resultLabel,
  verifyRecord,
  type ChessEnvelope,
} from "../src/games/chess/chess-outcome.js";
import { Chess, LEVEL_CODE } from "../src/games/chess/chess-wasm.js";

const WASM = "target/wasm32-unknown-unknown/release/chess_wasm.wasm";

async function loadReal(): Promise<Chess> {
  const bytes = await readFile(WASM);
  const orig = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(bytes, { headers: { "content-type": "application/wasm" } })) as typeof fetch;
  try {
    return await Chess.load();
  } finally {
    globalThis.fetch = orig;
  }
}

/** Play to a terminal position with the shipped opponent on both sides. */
function playOut(g: Chess, level: "Easy" | "Expert" = "Easy"): void {
  let guard = 0;
  while (g.board().result === -1) {
    const m = g.liveMove(level);
    expect(typeof m).toBe("number");
    expect(g.play(m as number)).toBe("applied");
    if (++guard > 400) throw new Error("runaway game");
  }
}

describe("chess wrapper + verifiable outcome (real wasm)", () => {
  it("the opening exposes twenty moves, unpacked, and the board's FEN fields", async () => {
    const g = await loadReal();
    g.newGame(7n);
    const b = g.board();
    expect(b.cells.length).toBe(64);
    expect(b.toMove).toBe(1);
    expect(b.castling).toBe(15);
    expect(b.ep).toBeNull();
    expect(b.halfmove).toBe(0);
    expect(b.fullmove).toBe(1);
    expect(b.inCheck).toBe(false);
    expect(b.lastSan).toBeNull();
    expect(b.captured).toEqual([0, 0]);
    expect(b.result).toBe(-1);
    expect(b.legal.length).toBe(20);
    for (const mv of b.legal) {
      expect(mv.promo).toBe(0);
      expect(mv.code).toBe(mv.from | (mv.to << 6));
    }
    expect(g.legalMoves()).toEqual(b.legal.map((m) => m.code));
    expect(g.fen()).toBe("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");

    // An out-of-range code is rejected, not applied, and never panics the module.
    expect(g.play(0xffff)).toBe("over");
    // e2e4: from 12 to 28.
    const e4 = b.legal.find((m) => m.from === 12 && m.to === 28)!;
    expect(g.san(e4.code)).toBe("e4");
    expect(g.play(e4.code)).toBe("applied");
    const after = g.board();
    expect(after.toMove).toBe(2);
    expect(after.lastSan).toBe("e4");
    expect(after.ep).toBe(20);
  });

  it("a whole game replays to the same hash, and each tamper fails for its own reason", async () => {
    const g = await loadReal();
    g.newGame(11n);
    playOut(g);

    const env = g.outcome(false) as ChessEnvelope;
    expect(env.kind).toBe("chess");
    expect(env.payload.moves.length).toBeGreaterThan(10);
    expect(env.payload.moves.every((c) => Number.isInteger(c))).toBe(true);
    expect(verifyRecord(await loadReal(), env).ok).toBe(true);

    const copy = (): ChessEnvelope => ({
      ...env,
      payload: { ...env.payload, moves: [...env.payload.moves] },
    });

    // One move altered: a different legal opening.
    const altered = copy();
    const fresh = await loadReal();
    fresh.newGame(11n);
    altered.payload.moves[0] = fresh.board().legal.find((m) => m.code !== env.payload.moves[0])!.code;
    expect(verifyRecord(await loadReal(), altered).ok).toBe(false);

    // Truncated by one: a different hash, not a crash.
    const truncated = copy();
    truncated.payload.moves.pop();
    const t = verifyRecord(await loadReal(), truncated);
    expect(t.ok).toBe(false);
    expect(t.actual).not.toBe(t.expected);

    // A move appended after the terminal: refused, so the record fails.
    const padded = copy();
    padded.payload.moves.push(12 | (28 << 6));
    expect(verifyRecord(await loadReal(), padded).ok).toBe(false);

    // A code above MAX_MOVE_CODE (20479): fails without throwing.
    const bogus = copy();
    bogus.payload.moves[3] = 20480;
    expect(() => verifyRecord(fresh, bogus)).not.toThrow();
    expect(verifyRecord(await loadReal(), bogus).ok).toBe(false);
  }, 120_000);

  it("the share payload round-trips as plain numbers", async () => {
    const g = await loadReal();
    g.newGame(5n);
    for (let i = 0; i < 6; i++) g.play(g.board().legal[0]!.code);
    const env = g.outcome(true) as ChessEnvelope;
    const decoded = await decodeRecord(await encodeRecord(env));
    expect(decoded.payload.moves).toEqual(env.payload.moves);
    expect(decoded.payload.assistance).toBe(false);
    expect(decoded.payload.result).toBe("Abandoned");
  });

  it("the level union maps to 0..3 and the reports say what the search did", async () => {
    expect(LEVEL_CODE).toEqual({ Easy: 0, Medium: 1, Hard: 2, Expert: 3 });
    const g = await loadReal();
    g.newGame(1n);
    const coach = g.coach();
    expect(coach.moves.length).toBe(20);
    expect(coach.exact).toBe(false);
    expect(coach.depth).toBeGreaterThanOrEqual(1);
    expect(coach.nodes).toBeGreaterThan(0);
    const first = coach.moves[0]!;
    expect(typeof first.san).toBe("string");
    expect(first.blocksOpponentWin).toBe(false);
    expect(["optimal", "resultPreserving", "blunder"]).toContain(first.quality);
    const values = g.oracleMoveValues();
    expect(values.moves.length).toBe(20);
    expect(values.depth).toBeLessThanOrEqual(5);
    expect(g.assess(0xffff)).toBeNull();
  }, 60_000);

  it("liveMove returns null at a terminal position (the u32 sentinel)", async () => {
    const g = await loadReal();
    g.newGame(2n);
    playOut(g);
    expect(g.liveMove("Easy")).toBeNull();
    expect(g.oracleBest("Expert")).toBeNull();
    expect(resultLabel(g.resultCode(), true)).toMatch(/won|Draw/);
  }, 120_000);

  it("resultLabel reads from the human's seat", () => {
    expect(resultLabel(1, true)).toBe("You won");
    expect(resultLabel(1, false)).toBe("The Engine won");
    expect(resultLabel(2, false)).toBe("You won");
    expect(resultLabel(0, true)).toBe("Draw");
    expect(resultLabel(-1, true)).toBe("In progress");
  });
});
