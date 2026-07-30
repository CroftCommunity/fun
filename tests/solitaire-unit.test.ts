//! Unit tests for the solitaire front-end's pure logic (front-plan Phase 4):
//! the share encode/decode round-trip, the daily-seed selection, the
//! verify-orchestration (driven against the REAL wasm binding, not a mock), and
//! the verification-forward result screen. These pin the win/verify/share
//! behaviour independently of the Playwright E2E.

import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";

import {
  decodeRecord,
  dailySeed,
  dayIndexUTC,
  encodeRecord,
  verifyRecord,
  type DealPack,
  type OutcomeEnvelope,
} from "../src/games/solitaire-outcome.js";
import { renderResultScreen } from "../src/games/solitaire.js";
import { Solitaire, type SolMove } from "../src/games/solitaire-wasm.js";

const WASM = "target/wasm32-unknown-unknown/release/solitaire_wasm.wasm";

/** Load the real binding in node/jsdom by serving the on-disk wasm to `fetch`. */
async function loadReal(): Promise<Solitaire> {
  const bytes = await readFile(WASM);
  const orig = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(bytes, { headers: { "content-type": "application/wasm" } })) as typeof fetch;
  try {
    return await Solitaire.load();
  } finally {
    globalThis.fetch = orig;
  }
}

async function loadPack(): Promise<DealPack> {
  return JSON.parse(await readFile("games/solitaire/daily-pack.json", "utf8")) as DealPack;
}

function wonEnvelope(assistance: boolean | null, moveCount = 120): OutcomeEnvelope {
  return {
    kind: "solitaire",
    version: 1,
    payload: {
      kind: "solitaire",
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
    env.payload.moves = ["Draw", "WasteToFoundation", { TableauToTableau: { from: 1, count: 2, to: 3 } }];
    const encoded = await encodeRecord(env);
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("/");
    expect(encoded).not.toContain("=");
    expect(await decodeRecord(encoded)).toEqual(env);
  });

  it("survives a large move list (the win fixture) round-trip, compactly", async () => {
    const pack = await loadPack();
    const env = wonEnvelope(false);
    env.payload.moves = pack.payload.fixture.moves as SolMove[];
    env.payload.move_count = env.payload.moves.length;
    const encoded = await encodeRecord(env);
    // Deflated: even a long win must stay far under any practical URL limit.
    expect(encoded.length).toBeLessThan(4000);
    expect(await decodeRecord(encoded)).toEqual(env);
  });
});

describe("daily-seed selection", () => {
  it("dayIndexUTC counts whole UTC days since the epoch", () => {
    expect(dayIndexUTC(new Date("1970-01-01T00:00:00Z"))).toBe(0);
    expect(dayIndexUTC(new Date("1970-01-02T00:00:00Z"))).toBe(1);
    expect(dayIndexUTC(new Date("1970-01-02T23:59:59Z"))).toBe(1);
  });

  it("indexes the pack by UTC day, wrapping on the seed count", async () => {
    const pack = await loadPack();
    const date = new Date("1970-01-01T12:00:00Z"); // day 0
    expect(dailySeed(pack, date)).toBe(BigInt(pack.payload.seeds[0]!));
    const wrap = new Date(pack.payload.seeds.length * 86400000 + 12 * 3600000); // day == len -> index 0
    expect(dailySeed(pack, wrap)).toBe(BigInt(pack.payload.seeds[0]!));
  });
});

describe("verify-orchestration (real wasm)", () => {
  let game: Solitaire;
  let winEnv: OutcomeEnvelope;

  beforeAll(async () => {
    game = await loadReal();
    const { fixture } = (await loadPack()).payload;
    game.newGame(BigInt(fixture.seed));
    for (const m of fixture.moves as SolMove[]) game.play(m);
    expect(game.isWon()).toBe(true);
    winEnv = game.outcome("abandoned", true) as OutcomeEnvelope;
    expect(winEnv.payload.result).toBe("Won");
  });

  it("re-verifies a genuine win by replaying through the core", () => {
    const v = verifyRecord(game, winEnv);
    expect(v.ok).toBe(true);
    expect(v.actual).toBe(winEnv.payload.final_hash);
  });

  it("rejects a tampered final hash and surfaces expected-vs-actual", () => {
    const tampered: OutcomeEnvelope = {
      ...winEnv,
      payload: { ...winEnv.payload, final_hash: "0".repeat(64) },
    };
    const v = verifyRecord(game, tampered);
    expect(v.ok).toBe(false);
    expect(v.expected).toBe("0".repeat(64));
    expect(v.actual).not.toBe(v.expected);
  });

  it("rejects a tampered move list (replay diverges)", () => {
    const tampered: OutcomeEnvelope = {
      ...winEnv,
      payload: { ...winEnv.payload, moves: winEnv.payload.moves.slice(0, -1) },
    };
    expect(verifyRecord(game, tampered).ok).toBe(false);
  });
});

describe("assistance is self-declared through the binding (real wasm)", () => {
  let game: Solitaire;

  beforeAll(async () => {
    game = await loadReal();
  });

  it("declaration ON after an undo records assistance = true", () => {
    game.newGame(0n);
    game.play("Draw");
    expect(game.undo()).toBe(true);
    const env = game.outcome("abandoned", true) as OutcomeEnvelope;
    expect(env.payload.assistance).toBe(true);
  });

  it("declaration OFF omits assistance (null) even after an undo", () => {
    game.newGame(0n);
    game.play("Draw");
    game.undo();
    const env = game.outcome("abandoned", false) as OutcomeEnvelope;
    expect(env.payload.assistance).toBeNull();
  });
});

describe("result screen (verification-forward)", () => {
  it("leads with clean-clear when won without declared assistance", () => {
    const el = renderResultScreen(wonEnvelope(false), { ok: true, expected: "h", actual: "h" }, {
      shareUrl: "/solitaire/?r=abc",
    });
    expect(el.textContent).toMatch(/clean/i);
    expect(el.textContent).toMatch(/verif/i);
  });

  it("says 'with assistance' when won with declared assistance", () => {
    const el = renderResultScreen(wonEnvelope(true), { ok: true, expected: "h", actual: "h" });
    expect(el.textContent).toMatch(/assistance/i);
  });

  it("shows moves-to-clear and the share link", () => {
    const el = renderResultScreen(wonEnvelope(false, 137), { ok: true, expected: "h", actual: "h" }, {
      shareUrl: "/solitaire/?r=xyz",
    });
    expect(el.textContent).toContain("137");
    const link = el.querySelector<HTMLAnchorElement>("a.sol-share, [data-share]");
    expect(link).not.toBeNull();
    expect(el.querySelector("[data-share]")?.getAttribute("data-share")).toContain("?r=");
  });

  it("flags a failed verification with expected vs actual", () => {
    const el = renderResultScreen(wonEnvelope(false), {
      ok: false,
      expected: "aaa",
      actual: "bbb",
    });
    expect(el.textContent).toMatch(/fail/i);
    expect(el.textContent).toContain("aaa");
    expect(el.textContent).toContain("bbb");
  });

  it("reports a Stuck result", () => {
    const stuck = wonEnvelope(null);
    stuck.payload.result = "Stuck";
    const el = renderResultScreen(stuck, { ok: true, expected: "h", actual: "h" });
    expect(el.textContent).toMatch(/stuck/i);
  });
});
