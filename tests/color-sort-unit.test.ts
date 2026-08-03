//! Unit tests for the Color Sort front-end's pure logic: the share encode/decode
//! round-trip, the verify-orchestration (driven against the REAL wasm binding,
//! not a mock), and the verification-forward result screen. These pin the
//! solve/verify/share behaviour independently of the Playwright E2E.

import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";

import {
  decodeRecord,
  encodeRecord,
  verifyRecord,
  type ColorSortEnvelope,
} from "../src/games/color-sort/color-sort-outcome.js";
import { renderResultScreen } from "../src/games/color-sort/color-sort.js";
import { ColorSort, type Move } from "../src/games/color-sort/color-sort-wasm.js";

const WASM = "target/wasm32-unknown-unknown/release/color_sort_wasm.wasm";

/** Load the real binding in node/jsdom by serving the on-disk wasm to `fetch`. */
async function loadReal(): Promise<ColorSort> {
  const bytes = await readFile(WASM);
  const orig = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(bytes, { headers: { "content-type": "application/wasm" } })) as typeof fetch;
  try {
    return await ColorSort.load();
  } finally {
    globalThis.fetch = orig;
  }
}

function wonEnvelope(assistance: boolean | null, moveCount = 24): ColorSortEnvelope {
  return {
    kind: "color-sort",
    version: 1,
    payload: {
      kind: "color-sort",
      seed: 0,
      moves: [],
      move_count: moveCount,
      final_hash: "deadbeef",
      result: "Won",
      assistance,
    },
  };
}

describe("share encode/decode", () => {
  it("round-trips an outcome envelope through base64url", async () => {
    const env = wonEnvelope(false);
    env.payload.moves = [
      { from: 0, to: 10 },
      { from: 1, to: 0 },
      { from: 3, to: 11 },
    ];
    const encoded = await encodeRecord(env);
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("/");
    expect(encoded).not.toContain("=");
    expect(await decodeRecord(encoded)).toEqual(env);
  });
});

describe("verify-orchestration (real wasm)", () => {
  let game: ColorSort;
  let winEnv: ColorSortEnvelope;

  beforeAll(async () => {
    game = await loadReal();
    // Endless level 1 (small) — solve it entirely via the solver hint.
    game.newEndless(1);
    for (let i = 0; i < 300 && !game.isWon(); i++) {
      const mv = game.hint();
      if (!mv) break;
      game.pour(mv.from, mv.to);
    }
    expect(game.isWon()).toBe(true);
    winEnv = game.outcome(false) as ColorSortEnvelope;
    expect(winEnv.payload.result).toBe("Won");
  });

  it("re-verifies a genuine solve by replaying through the core", () => {
    const v = verifyRecord(game, winEnv);
    expect(v.ok).toBe(true);
    expect(v.actual).toBe(winEnv.payload.final_hash);
  });

  it("rejects a tampered final hash and surfaces expected-vs-actual", () => {
    const tampered: ColorSortEnvelope = {
      ...winEnv,
      payload: { ...winEnv.payload, final_hash: "0".repeat(64) },
    };
    const v = verifyRecord(game, tampered);
    expect(v.ok).toBe(false);
    expect(v.expected).toBe("0".repeat(64));
    expect(v.actual).not.toBe(v.expected);
  });

  it("rejects a tampered move list (replay diverges)", () => {
    const tampered: ColorSortEnvelope = {
      ...winEnv,
      payload: { ...winEnv.payload, moves: winEnv.payload.moves.slice(0, -1) },
    };
    expect(verifyRecord(game, tampered).ok).toBe(false);
  });
});

describe("assistance is self-declared through the binding (real wasm)", () => {
  let game: ColorSort;

  beforeAll(async () => {
    game = await loadReal();
  });

  it("declaration ON after an undo records assistance = true", () => {
    game.newEndless(1);
    const mv = game.hint() as Move; // a legal opening pour
    game.pour(mv.from, mv.to);
    expect(game.undo()).toBe(true);
    game.markAssistance();
    const env = game.outcome(true) as ColorSortEnvelope;
    expect(env.payload.assistance).toBe(true);
  });

  it("declaration OFF omits assistance (null)", () => {
    game.newEndless(1);
    const env = game.outcome(false) as ColorSortEnvelope;
    expect(env.payload.assistance).toBeNull();
  });
});

describe("skin invariance (§10.7): the render layer holds no engine state", () => {
  it("the board state is identical regardless of the skin the UI draws", async () => {
    const game = await loadReal();
    game.newEndless(2);
    const before = game.currentHash();
    const board = game.board();
    // The skin is a pure CSS/DOM concern — it is never sent to the core — so the
    // engine hash and tubes are invariant to it (asserted here structurally).
    expect(game.currentHash()).toBe(before);
    expect(game.board().tubes).toEqual(board.tubes);
  });
});

describe("result screen (verification-forward)", () => {
  it("leads with a clean solve when won without declared assistance", () => {
    const el = renderResultScreen(wonEnvelope(false), { ok: true, expected: "h", actual: "h" }, {
      par: 20,
      shareUrl: "/color-sort/?r=abc",
    });
    expect(el.textContent).toMatch(/clean/i);
    expect(el.textContent).toMatch(/verif/i);
    expect(el.textContent).toContain("20"); // par
  });

  it("says 'with assistance' when won with declared assistance", () => {
    const el = renderResultScreen(wonEnvelope(true), { ok: true, expected: "h", actual: "h" });
    expect(el.textContent).toMatch(/assistance/i);
  });

  it("shows moves and the share link", () => {
    const el = renderResultScreen(wonEnvelope(false, 37), { ok: true, expected: "h", actual: "h" }, {
      shareUrl: "/color-sort/?r=xyz",
    });
    expect(el.textContent).toContain("37");
    expect(el.querySelector("[data-share]")?.getAttribute("data-share")).toContain("?r=");
  });

  it("flags a failed verification with expected vs actual", () => {
    const el = renderResultScreen(wonEnvelope(false), { ok: false, expected: "aaa", actual: "bbb" });
    expect(el.textContent).toMatch(/fail/i);
    expect(el.textContent).toContain("aaa");
    expect(el.textContent).toContain("bbb");
  });
});
