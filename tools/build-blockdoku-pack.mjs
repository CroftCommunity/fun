// Generate the Blockdoku daily seed pack — a deterministic seed schedule indexed
// by UTC day. Blockdoku is endless score-attack and every deal is playable
// (the deal guarantees a placeable piece), so there is NO solver and NO win-line
// fixture: the daily is simply a shared seed to chase a score against.
//
// Regenerable byte-for-byte: seeds come from a fixed-seed mulberry32, masked to
// 32 bits so they leave headroom for the wasm's config-packed seed transport.
//
// Usage: node tools/build-blockdoku-pack.mjs
// Writes: games/blockdoku/daily-pack.json  (pond-docformat envelope)

import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const outDir = join(root, "games/blockdoku");
const outFile = join(outDir, "daily-pack.json");

const COUNT = 366; // a full year + leap day
const GEN_SEED = 0xb10cd0ce >>> 0; // fixed so regeneration is byte-identical

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(GEN_SEED);
const seeds = [];
for (let i = 0; i < COUNT; i++) {
  // 24-bit seeds: plenty of variety, well clear of the config-packing bits.
  seeds.push(Math.floor(rand() * 0x0100_0000));
}

const envelope = {
  kind: "blockdoku-daily-pack",
  version: 1,
  payload: { seeds },
};

await mkdir(outDir, { recursive: true });
await writeFile(outFile, JSON.stringify(envelope), "utf8");
console.error(`wrote ${outFile} — ${seeds.length} daily seeds`);
