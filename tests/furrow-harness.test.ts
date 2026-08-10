//! Phase 10 — Furrow meets the scoring rig, and the three shapes it brings.
//!
//! The claim under test is not "Furrow scores well" — it is **"the rig needed no
//! edit"**. Dots established that for a game whose move does not pass the turn;
//! this is the first game to *inherit* it rather than prove it, which is the
//! whole reason mancala was picked next. Three things about it could have made
//! the claim false:
//!
//! - **A move need not pass the turn.** `runMatch` picks the player from the live
//!   board every iteration rather than by move parity. If it did not, a side
//!   would be asked for a move it is not entitled to make, the `play` would be
//!   rejected, and the match would abort — which is what `abortedGames === 0` is
//!   really watching.
//! - **One move rewrites as many as thirteen cells.** The rig sends a code and
//!   re-reads the board, so a sow is no different to it than a single-cell move.
//! - **A terminal rule rewrites the score.** The sweep moves every remaining seed
//!   after the last move. The rig reads `result` rather than counting, so it
//!   never sees the difference.
//!
//! **The graded fraction is the number to read, not the blunder count.** Phase 0
//! predicted ~30% — between checkers' 5% and dots' 83% — because roughly 70% of a
//! game sits above the exact threshold and the scorer grades a move only when
//! `exact` is true. `blunders === 0` over a small denominator says much less than
//! it looks like it says, so `scoredMoves` is asserted *and reported* here.

import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";

import { furrowOracle } from "../src/games/furrow/furrow-oracle.js";
import { Furrow } from "../src/games/furrow/furrow-wasm.js";
import type { GameOracle } from "../src/harness/game-oracle.js";
import { buildBand } from "../src/harness/hybrid-player.js";
import { EnginePlayer } from "../src/harness/match-runner.js";
import { renderReport, runTournament } from "../src/harness/tournament.js";

const WASM = "target/wasm32-unknown-unknown/release/furrow_wasm.wasm";

async function loadReal(): Promise<GameOracle> {
  const bytes = await readFile(WASM);
  const orig = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(bytes, { headers: { "content-type": "application/wasm" } })) as typeof fetch;
  try {
    return furrowOracle(await Furrow.load());
  } finally {
    globalThis.fetch = orig;
  }
}

describe("Furrow meets the harness (the generality proof, fifth game)", () => {
  beforeAll(async () => {
    const bytes = await readFile(WASM); // fail fast if preunit didn't build it
    expect(bytes.length).toBeGreaterThan(0);
  });

  it("a pit index is already a wire code, so the adapter passes it through", async () => {
    const oracle = await loadReal();
    oracle.newGame(7n);
    const codes = oracle.legalMoves();
    // Six pits a side, and the opening belongs to Side A — so the codes are A's
    // own cells, not all twelve pits.
    expect(codes).toEqual([0, 1, 2, 3, 4, 5]);
    expect(oracle.play(codes[0]!)).toBe("applied");
    const live = oracle.liveMove(3);
    expect(typeof live).toBe("number");
    expect(oracle.play(live!)).toBe("applied");
    const a = oracle.assess(oracle.legalMoves()[0]!);
    expect(a).not.toBeNull();
    // Mancala has no "block the opponent's winning move" notion — there is no
    // single move that wins on the spot to block — so it is carried false rather
    // than invented.
    expect(a!.blocksOpponentWin).toBe(false);
  }, 120_000);

  it("a store index is never offered as a move", async () => {
    // The one shape of illegal code this game can produce. If a store ever
    // appeared in `legalMoves`, the rig would send it and the match would abort.
    const oracle = await loadReal();
    oracle.newGame(3n);
    while (oracle.board().result === -1) {
      const codes = oracle.legalMoves();
      expect(codes).not.toContain(6);
      expect(codes).not.toContain(13);
      const code = oracle.liveMove(1);
      if (code === null) break;
      expect(oracle.play(code)).toBe("applied");
    }
  }, 120_000);

  it("the mover keeps the turn after landing in its store, and the rig follows the board", async () => {
    const oracle = await loadReal();
    oracle.newGame(0n);
    // Pit 2 holds four seeds and sits four cells from A's store, so the fourth
    // seed lands there — the classic opening, and the rule dots proved the port
    // already carried.
    const before = oracle.board().toMove;
    expect(oracle.play(2)).toBe("applied");
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
      expect(plies).toBeLessThan(400);
    }
    expect(oracle.liveMove(0)).toBeNull();
    // Unlike dots, the number of moves is not fixed — the game ends when a side
    // empties, and Phase 0 measured 47.2 moves on average with a maximum of 77.
    expect(plies).toBeGreaterThan(10);
  }, 120_000);

  it(
    "grades a self-play tournament with no rig edit, and reports what it graded",
    async () => {
      const report = await runTournament(loadReal, new EnginePlayer(1), new EnginePlayer(1), {
        games: 2,
        baseSeed: 0n,
      });
      expect(report.card.blunders).toBe(0);
      // The non-vacuity assertion, and the one that matters most for this game:
      // the scorer grades a move only where `exact` is true, and ~70% of a game
      // is above the exact threshold. A class floor over an empty denominator is
      // the trap this phase names.
      expect(report.card.scoredMoves).toBeGreaterThan(0);
      expect(report.abortedGames).toBe(0);
      expect(report.card.games).toBe(2);
      expect(renderReport(report)).toContain("aborted");
      // Recorded rather than asserted tightly, because the fraction is a finding:
      // Phase 0 predicted ~30%, between checkers' 5% and dots' 83%.
      console.log(
        `furrow graded ${report.card.scoredMoves} moves, ${report.card.blunders} blunders`,
      );
    },
    900_000,
  );

  it("a weaker player loses every game — and the blunder count cannot see it", async () => {
    // **The finding of this phase, asserted rather than described.**
    //
    // Measured over 12 games: Expert-vs-Expert grades 78 of 288 candidate moves
    // (27%) with 0 blunders and a 6-0-6 split; Easy-vs-Expert grades 22 of 139
    // with **0 blunders** and a record of **0-0-12**. Easy loses every single
    // game and never once registers a blunder.
    //
    // That is not a bug in the rig, it is a property of what the rig grades. The
    // scorer only grades where `exact` is true — the endgame — and Easy has
    // already lost the game in the unproven midgame by the time it gets there. A
    // blunder is a move that **drops a class**, and you cannot drop out of a
    // class you are already in: from a lost position every move is losing, so
    // none of them is a blunder.
    //
    // So the discrimination is asserted on the signal that actually carries it.
    const strong = await runTournament(loadReal, new EnginePlayer(3), new EnginePlayer(3), {
      games: 4,
      baseSeed: 11n,
    });
    const weak = await runTournament(loadReal, new EnginePlayer(0), new EnginePlayer(3), {
      games: 4,
      baseSeed: 11n,
    });
    expect(weak.card.wins).toBeLessThan(strong.card.wins);
    expect(weak.card.losses).toBeGreaterThan(strong.card.losses);
    // And the honest half: the blunder count is *not* what separated them.
    expect(weak.card.blunders).toBe(0);
    expect(strong.card.blunders).toBe(0);
  }, 900_000);
});

describe("the band carries the game's own idea", () => {
  it("labels an extra turn as one, over the real wasm", async () => {
    const oracle = await loadReal();
    let sawExtraTurn = false;
    for (let seed = 0n; seed < 4n && !sawExtraTurn; seed += 1n) {
      oracle.newGame(seed);
      while (oracle.board().result === -1) {
        const band = buildBand(oracle.tutor().moves);
        expect(band.every((m) => m.idea.length > 0)).toBe(true);
        if (band.some((m) => /go again/.test(m.idea))) {
          sawExtraTurn = true;
          break;
        }
        const code = oracle.liveMove(1);
        if (code === null) break;
        oracle.play(code);
      }
    }
    expect(sawExtraTurn, "no band move was ever labelled as keeping the turn").toBe(true);
  }, 900_000);

  it("the band's ideas are not all the same sentence", async () => {
    // The Phase 8 lesson, asserted where the model actually reads them: a band
    // whose every option says the same thing gives a hybrid player nothing to
    // choose on, and gives a persona nothing to say.
    const oracle = await loadReal();
    oracle.newGame(7n);
    for (let i = 0; i < 6 && oracle.board().result === -1; i += 1) {
      const code = oracle.liveMove(1);
      if (code === null) break;
      oracle.play(code);
    }
    const band = buildBand(oracle.tutor().moves);
    expect(band.length).toBeGreaterThan(1);
    expect(new Set(band.map((m) => m.idea)).size).toBeGreaterThan(1);
  }, 900_000);
});
