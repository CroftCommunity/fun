//! Chess Phase 11 — the harness's generality proof, sixth game and the widest
//! move code yet. Drop 4's move is a column, checkers' a 14-bit packed path;
//! chess's is a 15-bit `from | to<<6 | promo<<12` (max 20479), so it is the
//! first move code above 16383 the rig has graded. The claim under test is not
//! "chess scores well" — it is **"the rig needed no edit"**: the phase's
//! `git diff --stat` gate on `match-runner` / `scorer` / `tournament` is the
//! other half of it.
//!
//! On `blunders === 0`: chess is `exact` only where a line reached a proven
//! terminal, so — like checkers — a zero-blunder assertion over two games says
//! little alone. The load-bearing assertions are the denominator
//! (`scoredMoves > 0`) and `abortedGames === 0` together: a truncated code
//! would surface as a rejected `play` and an abort, and a tournament that
//! graded nothing would read as a clean zero-blunder Report without the
//! denominator.

import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";

import { chessOracle } from "../src/games/chess/chess-oracle.js";
import { Chess } from "../src/games/chess/chess-wasm.js";
import type { GameOracle } from "../src/harness/game-oracle.js";
import { buildBand } from "../src/harness/hybrid-player.js";
import { EnginePlayer } from "../src/harness/match-runner.js";
import { renderReport, runTournament } from "../src/harness/tournament.js";

const WASM = "target/wasm32-unknown-unknown/release/chess_wasm.wasm";

async function loadReal(): Promise<GameOracle> {
  const bytes = await readFile(WASM);
  const orig = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(bytes, { headers: { "content-type": "application/wasm" } })) as typeof fetch;
  try {
    return chessOracle(await Chess.load());
  } finally {
    globalThis.fetch = orig;
  }
}

describe("chess meets the harness (the generality proof, sixth game)", () => {
  beforeAll(async () => {
    const bytes = await readFile(WASM); // fail fast if preunit didn't build it
    expect(bytes.length).toBeGreaterThan(0);
  });

  it("the adapter passes 15-bit move codes through the port untruncated", async () => {
    const oracle = await loadReal();
    oracle.newGame(7n);
    const codes = oracle.legalMoves();
    expect(codes).toHaveLength(20);
    // Every opening move's code exceeds a u8 (to<<6 alone is ≥ 1024 for a
    // pawn or knight move). If any layer narrowed it, `play` would reject it.
    expect(codes.every((c) => c > 255)).toBe(true);
    expect(oracle.play(codes[0]!)).toBe("applied");
    expect(oracle.board().toMove).toBe(2);
    const live = oracle.liveMove(3);
    expect(typeof live).toBe("number");
    expect(oracle.play(live!)).toBe("applied");
    const a = oracle.assess(oracle.legalMoves()[0]!);
    expect(a).not.toBeNull();
    expect(a!.immediateWin).toBe(false);
    // Chess has no "blocks the opponent's immediate win" one-ply fact.
    expect(a!.blocksOpponentWin).toBe(false);
  }, 120_000);

  it("liveMove returns null only at a terminal position, so no match aborts", async () => {
    const oracle = await loadReal();
    oracle.newGame(5n);
    let plies = 0;
    while (oracle.board().result === -1) {
      const code = oracle.liveMove(0);
      expect(code, `liveMove returned null at a live position (ply ${plies})`).not.toBeNull();
      expect(oracle.play(code!)).toBe("applied");
      plies += 1;
    }
    expect(oracle.liveMove(0)).toBeNull();
    expect(plies).toBeGreaterThan(10);
  }, 300_000);

  it(
    "grades a self-play tournament with no rig edit",
    async () => {
      const report = await runTournament(loadReal, new EnginePlayer(1), new EnginePlayer(1), {
        games: 2,
        baseSeed: 0n,
      });

      // The class floor holds for a sixth game...
      expect(report.card.blunders).toBe(0);
      // ...it is not vacuous — moves were actually graded (proven values found)...
      expect(report.card.scoredMoves).toBeGreaterThan(0);
      // ...and the games finished. A truncated 15-bit code would abort here.
      expect(report.abortedGames).toBe(0);

      expect(report.card.games).toBe(2);
      expect(renderReport(report)).toContain("aborted");
    },
    900_000,
  );
});

/**
 * The same enrichment for chess, whose one-ply facts are richer than any
 * game before it: a capture names the piece taken, a check says so. The
 * adapter and the page must say the SAME thing — the plan's "ideaFor set in
 * both" — which is enforced by there being one function, imported by both.
 */
describe("the band carries chess's own idea, and it is the page's idea", () => {
  it("labels a capture by the piece it takes, over the real wasm", async () => {
    const oracle = await loadReal();
    let sawCapture = false;
    for (let seed = 0n; seed < 4n && !sawCapture; seed += 1n) {
      oracle.newGame(seed);
      let plies = 0;
      while (oracle.board().result === -1 && plies < 40) {
        const band = buildBand(oracle.tutor().moves);
        expect(band.every((m) => m.idea.length > 0)).toBe(true);
        if (band.some((m) => /^takes the (pawn|knight|bishop|rook|queen)$/.test(m.idea))) {
          sawCapture = true;
          break;
        }
        const mv = oracle.liveMove(0);
        if (mv === null) break;
        oracle.play(mv);
        plies += 1;
      }
    }
    expect(sawCapture, "no capture ever reached the band in 4 games").toBe(true);
  }, 300_000);

  it("is the same function the page uses (one definition, two importers)", async () => {
    const page = await import("../src/games/chess/chess.js");
    const oracle = await import("../src/games/chess/chess-oracle.js");
    expect(page.ideaFor).toBe(oracle.ideaFor);
  });
});
