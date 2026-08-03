//! HybridPlayer wiring (MockRuntime, CI-gated): the engine builds a never-throw
//! band, the LLM picks within it under a schema, and ANY failure falls back to
//! the engine's top-of-band. Three distinct paths are pinned — an in-band pick,
//! a malformed reply (parse/schema guard), and a schema-valid-but-out-of-band
//! pick (band-membership guard) — so a mutation that drops the band check while
//! keeping JSON parsing is caught. The real runtime is proven by `ai:trial`.

import { describe, expect, it } from "vitest";
import { MockRuntime } from "../src/harness/ai-runtime.js";
import { buildBand, HybridPlayer, type TutorFactMove } from "../src/harness/hybrid-player.js";

const MOVES: readonly TutorFactMove[] = [
  { col: 3, value: 10, quality: "optimal", immediateWin: false, blocksOpponentWin: false },
  { col: 2, value: 8, quality: "resultPreserving", immediateWin: false, blocksOpponentWin: false },
  { col: 5, value: 6, quality: "resultPreserving", immediateWin: false, blocksOpponentWin: true },
  { col: 0, value: -100, quality: "blunder", immediateWin: false, blocksOpponentWin: false },
];

describe("buildBand", () => {
  it("excludes class-dropping blunders — the never-throw floor", () => {
    const band = buildBand(MOVES);
    expect(band.map((m) => m.col).sort((a, b) => a - b)).toEqual([2, 3, 5]);
    expect(band.some((m) => m.col === 0)).toBe(false);
  });

  it("attaches an engine-grounded idea to each band move", () => {
    const idea = buildBand(MOVES).find((m) => m.col === 5)?.idea ?? "";
    expect(idea).toMatch(/block/i); // col 5 blocks the opponent's threat
  });
});

describe("HybridPlayer.pick", () => {
  const band = buildBand(MOVES); // cols 3 (v10, top), 2 (v8), 5 (v6)

  it("takes the LLM's in-band pick and reports source=llm", async () => {
    const rt = new MockRuntime({ reply: () => JSON.stringify({ move: 2, reason: "flank left" }) });
    const d = await new HybridPlayer(rt).pick(band, { prompt: "your move" });
    expect(d).toMatchObject({ move: 2, reason: "flank left", source: "llm" });
  });

  it("falls back to the engine top-of-band on malformed output (parse guard)", async () => {
    const rt = new MockRuntime({ reply: () => "not json {{{" });
    const d = await new HybridPlayer(rt).pick(band, { prompt: "your move" });
    expect(d.source).toBe("fallback");
    expect(d.move).toBe(3); // highest value in the band
  });

  it("falls back on a schema-valid but OUT-OF-BAND pick (band-membership guard)", async () => {
    // Well-formed JSON, but col 0 was filtered out as a blunder — a distinct
    // failure mode from malformed output; it must NOT be played.
    const rt = new MockRuntime({ reply: () => JSON.stringify({ move: 0, reason: "throws the game" }) });
    const d = await new HybridPlayer(rt).pick(band, { prompt: "your move" });
    expect(d.source).toBe("fallback");
    expect(d.move).toBe(3);
  });
});
