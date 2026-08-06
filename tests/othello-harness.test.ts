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
import { MockRuntime } from "../src/harness/ai-runtime.js";
import { HybridPlayer } from "../src/harness/hybrid-player.js";
import { EnginePlayer, HybridAiPlayer, runMatch } from "../src/harness/match-runner.js";
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

/**
 * The abort the rig's own counter caught (P8 Phase 15): a 2-game hybrid trial
 * reported 1 aborted game, while drop4 and checkers aborted none. The cause is
 * Othello-shaped but the bug was in the shared players — at a forced pass there
 * is no placement to band, and the player returned `null`, which `runMatch` reads
 * as an abort.
 *
 * This drives the **real** wasm with the **real** `HybridAiPlayer` over a
 * `MockRuntime` (CI has no GPU), across enough seeds to be sure a forced pass is
 * in there, and asserts both halves: no match aborts, and a pass really was
 * played (otherwise the test would pass by never reaching the condition).
 */
describe("a forced pass does not abort the match (any player)", () => {
  // BOTH sides are the hybrid on purpose. With an engine on one side the forced
  // pass usually falls to *it*, and `EnginePlayer` never had the bug — the match
  // completes and the test passes against the unfixed code. (Measured: the first
  // version of this test was green with the defect restored.)
  //
  // ONE seed, not a sweep. Seed 0 is where the bug reproduced, and every move
  // here runs Othello's exact endgame solve through the real wasm — a six-seed
  // sweep took 27s locally and blocked vitest's worker long enough on CI that its
  // RPC heartbeat timed out and the whole run failed while every test passed. The
  // pass assertion below is what keeps the single seed honest: if seed 0 ever
  // stops containing a forced pass, this fails loudly instead of proving nothing.
  it("hybrid-vs-hybrid plays through a forced pass over the real wasm", async () => {
    const rt = new MockRuntime({ reply: () => "not json" }); // always the fallback path
    const hybrid = (): HybridAiPlayer => new HybridAiPlayer(new HybridPlayer(rt));
    const rec = await runMatch(await loadReal(), hybrid(), hybrid(), 0n);
    expect(rec.abortReason).toBe("none");
    expect(rec.aborted).toBe(false);
    expect(rec.result).not.toBe(-1);
    expect(
      rec.moves.filter((m) => m === PASS_CODE).length,
      "seed 0 no longer contains a forced pass — the guard was never exercised",
    ).toBeGreaterThan(0);
  }, 120_000);
});
