//! Chess Phase 10 — the hybrid opponent's plug-in proof on CI, with the
//! deterministic `MockRuntime` (no GPU, no model): an in-band reply is the
//! model's move; an out-of-band one, a malformed one, and — the edge a
//! "just check legality" mutation would survive — a LEGAL move that is not in
//! the band all fall back to the engine's top-of-band. And the wiring test:
//! through `chessModule` itself, a hybrid reply lands on the board.

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { MockRuntime } from "../src/harness/ai-runtime.js";
import { buildBand, HybridPlayer } from "../src/harness/hybrid-player.js";
import { chessModule } from "../src/games/chess/chess.js";
import { Chess } from "../src/games/chess/chess-wasm.js";

const WASM = "target/wasm32-unknown-unknown/release/chess_wasm.wasm";

let wasmBytes: Buffer<ArrayBuffer> | null = null; // `Buffer` alone widens to ArrayBufferLike, which BodyInit refuses
async function shimFetch(): Promise<void> {
  wasmBytes ??= await readFile(WASM);
  globalThis.fetch = (async () =>
    new Response(wasmBytes!, { headers: { "content-type": "application/wasm" } })) as typeof fetch;
}

async function loadReal(): Promise<Chess> {
  const orig = globalThis.fetch;
  await shimFetch();
  try {
    return await Chess.load();
  } finally {
    globalThis.fetch = orig;
  }
}

describe("the hybrid opponent's decisions over real chess facts", () => {
  it("a valid in-band reply is taken (source=llm)", async () => {
    const g = await loadReal();
    g.newGame(7n);
    const band = buildBand(g.tutor().moves);
    const pick = band[band.length - 1]!.col; // not the fallback, so the paths differ
    const rt = new MockRuntime({ reply: () => JSON.stringify({ move: pick, reason: "development first" }) });
    const d = await new HybridPlayer(rt).pick(band, { prompt: "your move" });
    expect(d).toMatchObject({ move: pick, source: "llm" });
    expect(g.play(d.move)).toBe("applied");
  }, 60_000);

  it("a malformed reply falls back to the engine's top-of-band", async () => {
    const g = await loadReal();
    g.newGame(7n);
    const band = buildBand(g.tutor().moves);
    const rt = new MockRuntime({ reply: () => "not json {{{" });
    const d = await new HybridPlayer(rt).pick(band, { prompt: "your move" });
    expect(d.source).toBe("fallback");
    expect(d.move).toBe(band[0]!.col);
  }, 60_000);

  it("a LEGAL move that is not in the band falls back — legal is not offered", async () => {
    const g = await loadReal();
    g.newGame(7n);
    const full = buildBand(g.tutor().moves);
    const band = full.slice(0, 3);
    const legalButOut = full[full.length - 1]!.col;
    expect(band.some((m) => m.col === legalButOut)).toBe(false);
    expect(g.legalMoves()).toContain(legalButOut);
    const rt = new MockRuntime({ reply: () => JSON.stringify({ move: legalButOut, reason: "a fine move" }) });
    const d = await new HybridPlayer(rt).pick(band, { prompt: "your move" });
    expect(d.source).toBe("fallback");
    expect(d.move).toBe(band[0]!.col);
  }, 60_000);
});

describe("the wiring: chessModule plays a hybrid reply on the board", () => {
  it("a hybrid move is always in the band, and the board shows it", async () => {
    await shimFetch();
    window.history.replaceState({}, "", "/chess/?seed=7&fast=1");
    let picked: number | null = null;
    window.__CHESS_AI_RUNTIME = () =>
      new MockRuntime({
        reply: (prompt) => {
          // The prompt lists the band's codes; pick the LAST one so the path
          // provably differs from the engine's top-of-band fallback.
          const codes = /Play ONE of these move codes: ([0-9, ]+)\./.exec(prompt)?.[1]?.split(",").map((c) => Number(c.trim())) ?? [];
          picked = codes[codes.length - 1] ?? null;
          return JSON.stringify({ move: picked, reason: "quiet development" });
        },
      });
    const host = document.createElement("div");
    document.body.append(host);
    const mod = chessModule();
    mod.mount(host, { mode: "page" } as never);
    await new Promise<void>((resolve) => {
      const poll = (): void => (window.__chess ? resolve() : void setTimeout(poll, 10));
      poll();
    });
    window.__chess!.setOpponent("local-ai");
    // The human (White) taps e2 then e4 through the real buttons.
    const sq = (name: string): number => "abcdefgh".indexOf(name[0]!) + (Number(name[1]) - 1) * 8;
    host.querySelector<HTMLElement>(`.chess-square[data-sq="${sq("e2")}"]`)!.click();
    host.querySelector<HTMLElement>(`.chess-square[data-sq="${sq("e4")}"]`)!.click();
    // Wait for the hybrid reply (the mock is instant; the beat is a frame).
    await new Promise<void>((resolve) => {
      const poll = (): void =>
        window.__chess!.game.board().toMove === 1 ? resolve() : void setTimeout(poll, 10);
      poll();
    });
    const b = window.__chess!.game.board();
    expect(b.lastMove).toBe(picked);
    expect(window.__chess!.lastAi?.source).toBe("llm");
    mod.unmount();
    delete window.__CHESS_AI_RUNTIME;
  }, 60_000);
});
