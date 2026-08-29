//! The boundary test: drive the BUILT wasm through the typed TS wrapper and
//! confirm it agrees with the native Rust.
//!
//! Phase 1's vectors prove the solver agrees across targets. This proves nothing
//! is lost *crossing into* wasm, which is a different claim and the one where a
//! width bug lives: `usize` is 32-bit on wasm32 and 64-bit natively, so the
//! scenario deliberately uses a seed with **both halves set**.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { OrchardDrop } from "../src/games/orchard-drop/orchard-wasm.js";

/** The native expectations, emitted by `cargo run --bin expected`. */
const expected = JSON.parse(
  readFileSync("crates/orchard-wasm/expected.json", "utf8"),
) as {
  seed_lo: number;
  seed_hi: number;
  final_hash: string;
  score: number;
  tick: number;
  fruit: number;
  checkpoints: { tick: number; hash: string }[];
};

const SEED = (BigInt(expected.seed_hi) << 32n) | BigInt(expected.seed_lo);

async function load(): Promise<OrchardDrop> {
  const bytes = readFileSync(
    "target/wasm32-unknown-unknown/release/orchard_wasm.wasm",
  );
  const { instance } = await WebAssembly.instantiate(bytes, {});
  return OrchardDrop.fromInstance(instance);
}

/** The scripted run `expected.json` was generated from. */
function play(g: OrchardDrop): number[] {
  g.newGame(SEED);
  const hashesAt: number[] = [];
  let t = 0;
  for (let i = 0; i < 8; i++) {
    expect(g.drop(t, 60 + 45 * i)).toBe("dropped");
    t += 33;
    hashesAt.push(t);
  }
  g.waitUntil(t + 600);
  return hashesAt;
}

describe("the wasm binding through the TS wrapper", () => {
  it("reaches the same state hash as native Rust", async () => {
    const g = await load();
    play(g);
    expect(g.hash()).toBe(expected.final_hash);
  });

  it("agrees with native at every checkpoint, not just the end", async () => {
    // An end-state match could hide two errors cancelling. Checking each drop
    // localises a divergence to the move that caused it.
    const g = await load();
    g.newGame(SEED);
    let t = 0;
    for (const cp of expected.checkpoints) {
      g.drop(t, 60 + 45 * expected.checkpoints.indexOf(cp));
      t += 33;
      expect(g.hash(), `at tick ${t}`).toBe(cp.hash);
    }
  });

  it("carries the score and tick across the boundary", async () => {
    const g = await load();
    play(g);
    expect(g.score()).toBe(expected.score);
    expect(g.tick()).toBe(expected.tick);
  });

  it("hands the renderer a world it can actually draw", async () => {
    const g = await load();
    play(g);
    const w = g.world();
    expect(w).not.toBeNull();
    expect(w!.fruit).toHaveLength(expected.fruit);
    for (const f of w!.fruit) {
      expect(Number.isInteger(f.x)).toBe(true);
      expect(Number.isInteger(f.y)).toBe(true);
      expect(f.r).toBeGreaterThan(0);
      expect(f.tier).toBeGreaterThanOrEqual(0);
      expect(f.tier).toBeLessThan(g.ladderTiers());
    }
  });

  it("round-trips a record and rejects a tampered one", async () => {
    const g = await load();
    play(g);
    const record = g.record();
    expect(record).not.toBeNull();
    expect(g.verify(record!).ok).toBe(true);

    const tampered = record!.replace(/"final_hash":"[0-9a-f]{64}"/, `"final_hash":"${"0".repeat(64)}"`);
    expect(tampered).not.toBe(record);
    expect(g.verify(tampered).ok).toBe(false);
  });

  it("survives whatever a host hands it, because a wasm panic kills the page", async () => {
    const g = await load();
    g.newGame(SEED);
    expect(() => g.verify("")).not.toThrow();
    expect(g.verify("{not json").ok).toBe(false);
    expect(g.verify("null").ok).toBe(false);
    expect(() => g.dailySeed(0xffffffff)).not.toThrow();
    // A read before any drop, and a drop in the past.
    expect(g.world()!.fruit).toHaveLength(0);
    g.drop(500, 220);
    expect(g.drop(1, 220)).toBe("backwards");
  });

  it("a 64-bit seed survives the two-halves crossing", async () => {
    // Both halves set, so a truncation cannot hide.
    const g = await load();
    g.newGame(SEED);
    const withFullSeed = g.hash();
    g.newGame(BigInt(expected.seed_lo));
    expect(g.hash()).not.toBe(withFullSeed);
  });

  it("the daily schedule crosses as a 64-bit value", async () => {
    const g = await load();
    const seed = g.dailySeed(0);
    expect(seed).toBeGreaterThan(0n);
    expect(g.dailySeed(366)).toBe(seed);
  });
});
