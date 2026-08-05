//! P8 Phase 3 — the harness's generality proof: the rig grades a **second** game.
//!
//! This is the phase Part A exists for. Othello has shipped with the same
//! `assess`/`tutor` `{quality, exact}` surface as Drop 4 since it landed, but the
//! rig could not grade it, because the rig imported `Drop4` by type.
//!
//! The claim under test is not "Othello scores well" — it is **"the rig needed no
//! edit"**. If grading a game with forced passes and a different move space
//! requires touching `match-runner` / `scorer` / `tournament`, the port designed
//! in Phase 1 is wrong, and that is the finding. The phase's `git diff --stat`
//! gate on those three files is the other half of this assertion.

import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";

import { othelloOracle } from "../src/games/othello/othello-oracle.js";
import { PASS_CODE } from "../src/games/othello/othello-outcome.js";
import { Othello } from "../src/games/othello/othello-wasm.js";
import type { GameOracle } from "../src/harness/game-oracle.js";
import { EnginePlayer } from "../src/harness/match-runner.js";
import { renderReport, runTournament } from "../src/harness/tournament.js";

const WASM = "target/wasm32-unknown-unknown/release/othello_wasm.wasm";

async function loadReal(): Promise<GameOracle> {
  const bytes = await readFile(WASM);
  const orig = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(bytes, { headers: { "content-type": "application/wasm" } })) as typeof fetch;
  try {
    return othelloOracle(await Othello.load());
  } finally {
    globalThis.fetch = orig;
  }
}

describe("othello meets the harness (the generality proof)", () => {
  beforeAll(async () => {
    const bytes = await readFile(WASM); // fail fast if preunit didn't build it
    expect(bytes.length).toBeGreaterThan(0);
  });

  // The adapter's whole job. `liveMove` returns the string "pass"; the port
  // returns numbers, and `match-runner` treats `null` as an ABORT — so a naive
  // adapter mapping "pass" to null would silently record aborted matches that
  // graded nothing, while still producing a well-formed Report.
  it("normalizes a forced pass to PASS_CODE, and plays it", async () => {
    const oracle = await loadReal();
    let sawForcedPass = false;
    for (let seed = 0; seed < 40 && !sawForcedPass; seed++) {
      oracle.newGame(BigInt(seed));
      while (oracle.board().result === -1) {
        if (oracle.legalMoves().length === 0) {
          expect(oracle.liveMove(3)).toBe(PASS_CODE);
          expect(oracle.play(PASS_CODE)).toBe("applied");
          sawForcedPass = true;
          continue;
        }
        const code = oracle.liveMove(3);
        expect(typeof code).toBe("number");
        expect(oracle.play(code!)).toBe("applied");
      }
    }
    expect(sawForcedPass, "no forced pass found in 40 seeds").toBe(true);
  }, 300_000);

  it(
    "grades a top-level self-play tournament with no rig edit",
    async () => {
      const report = await runTournament(loadReal, new EnginePlayer(3), new EnginePlayer(3), {
        games: 2,
        baseSeed: 0n,
      });

      // Three assertions, each closing a different way this can pass vacuously.
      // The class floor holds for a second game:
      expect(report.card.blunders).toBe(0);
      // ...and is not vacuous — the exact endgame was actually reached:
      expect(report.card.scoredMoves).toBeGreaterThan(0);
      // ...and the games actually finished. Without this, an Othello match whose
      // forced pass was mishandled would abort, grade nothing, and still render
      // a clean zero-blunder Report (Phase 2c).
      expect(report.abortedGames).toBe(0);

      expect(report.card.games).toBe(2);
      expect(renderReport(report)).toContain("aborted");
    },
    600_000,
  );
});
