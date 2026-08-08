//! Phase 10 — dots meets the scoring rig, and the two shapes it brings with it.
//!
//! The claim under test is not "dots scores well" — it is **"the rig needed no
//! edit"**. Two things about this game could have made that false:
//!
//! - **A move does not have to pass the turn.** `runMatch` picks the player from
//!   the live board every iteration rather than by move parity, so a capture's
//!   extra move should just work. If it did not, a side would be asked for a move
//!   it is not entitled to make, the `play` would be rejected, and the match would
//!   abort — which is what `abortedGames === 0` is really watching here.
//! - **The value is a box margin, not a class.** The scorer grades on `quality`,
//!   which the game derives from the margin's sign, so nothing about a margin
//!   reaches the rig.
//!
//! Unlike checkers, a proven pair is *not* rare here: 3x3 is solved from four
//! plies in, so most of a graded game is exact. That makes `blunders === 0` a
//! real assertion rather than a near-vacuous one — but `scoredMoves` is still
//! asserted and reported, because a class floor over an empty denominator is the
//! trap this phase names.

import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";

import { dotsOracle } from "../src/games/dots/dots-oracle.js";
import { Dots } from "../src/games/dots/dots-wasm.js";
import type { GameOracle } from "../src/harness/game-oracle.js";
import { buildBand } from "../src/harness/hybrid-player.js";
import { EnginePlayer } from "../src/harness/match-runner.js";
import { renderReport, runTournament } from "../src/harness/tournament.js";

const WASM = "target/wasm32-unknown-unknown/release/dots_wasm.wasm";

async function loadReal(): Promise<GameOracle> {
  const bytes = await readFile(WASM);
  const orig = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(bytes, { headers: { "content-type": "application/wasm" } })) as typeof fetch;
  try {
    return dotsOracle(await Dots.load());
  } finally {
    globalThis.fetch = orig;
  }
}

describe("dots meets the harness (the generality proof, fourth game)", () => {
  beforeAll(async () => {
    const bytes = await readFile(WASM); // fail fast if preunit didn't build it
    expect(bytes.length).toBeGreaterThan(0);
  });

  it("an edge index is already a wire code, so the adapter passes it through", async () => {
    const oracle = await loadReal();
    oracle.newGame(7n);
    const codes = oracle.legalMoves();
    expect(codes).toHaveLength(24);
    expect(codes.every((c) => c >= 0 && c < 24)).toBe(true);
    expect(oracle.play(codes[0]!)).toBe("applied");
    const live = oracle.liveMove(3);
    expect(typeof live).toBe("number");
    expect(oracle.play(live!)).toBe("applied");
    const a = oracle.assess(oracle.legalMoves()[0]!);
    expect(a).not.toBeNull();
    // The game has no "block the opponent's winning move" notion — a box is
    // claimed by whoever closes it and cannot be defended — so it is carried
    // false rather than invented.
    expect(a!.blocksOpponentWin).toBe(false);
  }, 120_000);

  it("the mover keeps the turn after a capture, and the rig follows the board", async () => {
    const oracle = await loadReal();
    oracle.newGame(0n);
    // Box 0 closes on 0, 3, 12, 13; the fourth of them captures.
    for (const e of [0, 3, 12]) expect(oracle.play(e)).toBe("applied");
    const before = oracle.board().toMove;
    expect(oracle.play(13)).toBe("applied");
    // The side that closed the box is still to move — the property no other game
    // on the shelf has, seen through the port the rig reads.
    expect(oracle.board().toMove).toBe(before);
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
    expect(plies).toBe(24); // every edge, exactly once
  }, 120_000);

  it(
    "grades a self-play tournament with no rig edit",
    async () => {
      const report = await runTournament(loadReal, new EnginePlayer(1), new EnginePlayer(1), {
        games: 2,
        baseSeed: 0n,
      });
      expect(report.card.blunders).toBe(0);
      // Not vacuous: this board is solved from four plies in, so most moves are
      // graded rather than skipped as unproven.
      expect(report.card.scoredMoves).toBeGreaterThan(0);
      expect(report.abortedGames).toBe(0);
      expect(report.card.games).toBe(2);
      expect(renderReport(report)).toContain("aborted");
    },
    900_000,
  );

  it("a weaker player grades worse than the strong one", async () => {
    const strong = await runTournament(loadReal, new EnginePlayer(3), new EnginePlayer(3), {
      games: 2,
      baseSeed: 11n,
    });
    const weak = await runTournament(loadReal, new EnginePlayer(0), new EnginePlayer(3), {
      games: 2,
      baseSeed: 11n,
    });
    // The comparison the phase is for: the rig can tell the levels apart. Easy
    // carries no class floor, so it throws games the top level never does.
    expect(weak.card.blunders).toBeGreaterThan(strong.card.blunders);
  }, 900_000);
});

describe("the band carries the game's own idea", () => {
  it("labels a capture as one, over the real wasm", async () => {
    const oracle = await loadReal();
    let sawCapture = false;
    for (let seed = 0n; seed < 4n && !sawCapture; seed += 1n) {
      oracle.newGame(seed);
      while (oracle.board().result === -1) {
        const band = buildBand(oracle.tutor().moves);
        expect(band.every((m) => m.idea.length > 0)).toBe(true);
        if (band.some((m) => /closes .* box/.test(m.idea))) {
          sawCapture = true;
          break;
        }
        const mv = oracle.liveMove(0);
        if (mv === null) break;
        oracle.play(mv);
      }
    }
    expect(sawCapture, "no capture ever appeared in 4 games").toBe(true);
  }, 300_000);
});
