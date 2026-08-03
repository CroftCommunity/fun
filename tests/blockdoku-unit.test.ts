//! Unit tests for the Blockdoku front-end's pure logic (B6/B8), driven against
//! the REAL wasm binding (not a mock): the share encode/decode round-trip, the
//! verify-orchestration, TS↔Rust seed-packing parity, and the verification-
//! forward result screen. These pin the verify/share behaviour independently of
//! the Playwright E2E.

import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";

import {
  decodeRecord,
  encodeRecord,
  verifyRecord,
  type BlockdokuEnvelope,
} from "../src/games/blockdoku/blockdoku-outcome.js";
import { anchorFromClone, renderResultScreen } from "../src/games/blockdoku/blockdoku.js";
import { Blockdoku, DEFAULT_CONFIG } from "../src/games/blockdoku/blockdoku-wasm.js";

const WASM = "target/wasm32-unknown-unknown/release/blockdoku_wasm.wasm";

/** Load the real binding in node/jsdom by serving the on-disk wasm to `fetch`. */
async function loadReal(): Promise<Blockdoku> {
  const bytes = await readFile(WASM);
  const orig = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(bytes, { headers: { "content-type": "application/wasm" } })) as typeof fetch;
  try {
    return await Blockdoku.load();
  } finally {
    globalThis.fetch = orig;
  }
}

/** Play a run by always taking the first legal move, then return its outcome. */
function playRun(game: Blockdoku, base: bigint, config = DEFAULT_CONFIG): BlockdokuEnvelope {
  game.newGame(base, config);
  for (let i = 0; i < 40 && !game.isOver(); i++) {
    const legal = game.legalMoves();
    if (legal.length === 0) break;
    const m = legal[0]!;
    game.playPlace(m.slot, m.row, m.col);
  }
  return game.outcome(true) as BlockdokuEnvelope;
}

let game: Blockdoku;
let verifier: Blockdoku;
beforeAll(async () => {
  game = await loadReal();
  verifier = await loadReal();
});

describe("share encode/decode", () => {
  it("round-trips an outcome envelope through deflated base64url", async () => {
    const env = playRun(game, 12345n);
    const payload = await encodeRecord(env);
    const back = await decodeRecord(payload);
    expect(back).toEqual(env);
  });
});

describe("verify against the real core", () => {
  it("an honest record verifies and carries its score", () => {
    const env = playRun(game, 777n);
    const v = verifyRecord(verifier, env);
    expect(v.ok).toBe(true);
    expect(env.payload.kind).toBe("blockdoku");
    expect(typeof env.payload.score).toBe("number");
  });

  it("a tampered hash fails verification", () => {
    const env = playRun(game, 42n);
    const tampered: BlockdokuEnvelope = {
      ...env,
      payload: { ...env.payload, final_hash: "0".repeat(64) },
    };
    expect(verifyRecord(verifier, tampered).ok).toBe(false);
  });

  it("a tampered score fails verification", () => {
    const env = playRun(game, 99n);
    const tampered: BlockdokuEnvelope = {
      ...env,
      payload: { ...env.payload, score: (env.payload.score ?? 0) + 1000 },
    };
    expect(verifyRecord(verifier, tampered).ok).toBe(false);
  });

  it("options ride in the packed seed: a hard-mode run verifies", () => {
    // TS packSeed must match Rust unpack_seed, or replay would diverge.
    const env = playRun(game, 555n, { ...DEFAULT_CONFIG, difficulty: "hard" });
    expect(verifyRecord(verifier, env).ok).toBe(true);
  });
});

describe("drag geometry: anchorFromClone", () => {
  // A 30px cell grid whose top-left cell (0,0) starts at viewport (100, 200).
  const geom = { left: 100, top: 200, cell: 30 };

  it("maps the clone's top-left to the nearest board cell", () => {
    // Clone top-left near cell (2,3): x = 100 + 3*30 = 190, y = 200 + 2*30 = 260.
    expect(anchorFromClone(190, 260, geom, { rows: 1, cols: 1 })).toEqual({ r: 2, c: 3 });
    // A little off still rounds to the same cell.
    expect(anchorFromClone(196, 254, geom, { rows: 1, cols: 1 })).toEqual({ r: 2, c: 3 });
  });

  it("clamps so the whole shape stays on the 9×9 board", () => {
    // A 2×3 piece dragged far past the bottom-right clamps to the last fit.
    expect(anchorFromClone(9999, 9999, geom, { rows: 2, cols: 3 })).toEqual({ r: 7, c: 6 });
    // ...and past the top-left clamps to (0,0).
    expect(anchorFromClone(-9999, -9999, geom, { rows: 2, cols: 3 })).toEqual({ r: 0, c: 0 });
  });
});

describe("result screen", () => {
  it("leads with the verified score and shows the record", () => {
    const env = playRun(game, 2026n);
    const node = renderResultScreen(env, verifyRecord(verifier, env), { shareUrl: "?r=abc" });
    expect(node.querySelector(".sol-headline")?.textContent).toContain("verifiable");
    expect(node.querySelector(".sol-verify-badge.ok")).not.toBeNull();
    expect(node.querySelector('[data-share="?r=abc"]')).not.toBeNull();
  });

  it("flags a failed verification loudly", () => {
    const env = playRun(game, 3n);
    const bad = verifyRecord(verifier, {
      ...env,
      payload: { ...env.payload, final_hash: "0".repeat(64) },
    });
    const node = renderResultScreen(env, bad);
    expect(node.querySelector(".sol-verify-badge.fail")).not.toBeNull();
    expect(node.querySelector(".sol-headline")?.textContent).toContain("FAILED");
  });
});
