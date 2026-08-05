//! Regression: the wasm move sentinels must decode to `null` / `"pass"`.
//!
//! The cores return `u32` sentinels (`u32::MAX` = no move, `u32::MAX - 1` =
//! pass), but a wasm `i32` result reaches JS **signed** — so they arrive as `-1`
//! and `-2`. Both wrappers originally compared against the unsigned constants,
//! which never matched: the null/"pass" branches were dead, and callers received
//! a negative number where the signature promised `null` or `"pass"`.
//!
//! Found by the P8 `GameOracle` port, whose contract says `liveMove` returns
//! `null` at a terminal position. The shipped UIs were shielded (Othello checks
//! `board().mustPass` first), but the harness is not — `EnginePlayer` calls
//! `liveMove` directly, so a `-2` would have been played as a move, rejected,
//! and aborted the match.

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { Drop4 } from "../src/games/drop4/drop4-wasm.js";
import { Othello } from "../src/games/othello/othello-wasm.js";

async function withWasm<T>(path: string, load: () => Promise<T>): Promise<T> {
  const bytes = await readFile(path);
  const orig = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(bytes, { headers: { "content-type": "application/wasm" } })) as typeof fetch;
  try {
    return await load();
  } finally {
    globalThis.fetch = orig;
  }
}

describe("wasm move sentinels decode to null / pass, not negative numbers", () => {
  it("drop4: liveMove and oracleBest return null at a terminal position", async () => {
    const g = await withWasm(
      "target/wasm32-unknown-unknown/release/drop4_wasm.wasm",
      () => Drop4.load(),
    );
    g.newGame(7n);
    while (g.board().result === -1) {
      const m = g.liveMove("Perfect");
      expect(typeof m).toBe("number");
      g.play(m as number);
    }
    expect(g.liveMove("Perfect")).toBeNull();
    expect(g.oracleBest("Perfect")).toBeNull();
  }, 120_000);

  it("othello: liveMove returns 'pass' when forced and null at terminal", async () => {
    const g = await withWasm(
      "target/wasm32-unknown-unknown/release/othello_wasm.wasm",
      () => Othello.load(),
    );

    // Seeds are searched because a forced pass is position-dependent; asserting
    // only on a terminal position would leave the "pass" branch unproven.
    let sawForcedPass = false;
    for (let seed = 0; seed < 40 && !sawForcedPass; seed++) {
      g.newGame(BigInt(seed));
      while (g.board().result === -1) {
        if (g.legalMoves().length === 0) {
          expect(g.liveMove("Expert")).toBe("pass");
          sawForcedPass = true;
          g.pass();
          continue;
        }
        const m = g.liveMove("Expert");
        expect(typeof m).toBe("number");
        g.play(m as number);
      }
    }
    expect(sawForcedPass, "no forced pass found in 40 seeds").toBe(true);

    g.newGame(1n);
    while (g.board().result === -1) {
      if (g.legalMoves().length === 0) {
        g.pass();
        continue;
      }
      g.play(g.liveMove("Expert") as number);
    }
    expect(g.liveMove("Expert")).toBeNull();
  }, 300_000);
});
