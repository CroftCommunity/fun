// Generate the committed fixed-point aim-direction table for the bubble shooter
// (plan V0/V1). Runtime trig is unavailable on wasm32-unknown-unknown (no libm),
// so the core cannot compute cos/sin at run time. Instead we bake an integer
// unit-vector per quantized aim angle here, commit it, and the core marches the
// trajectory with integer math only — deterministic and native==wasm.
//
// Coordinate space: sub-pixel integer units, one bubble diameter D = 256 units
// (radius R = 128). x grows right, y grows DOWN, so "up" is -y. Angles are whole
// degrees measured from the +x axis; 90 deg is straight up. The unit vector is
// scaled to FP = 65536 (shift-16 fixed point): dx = round(cos*FP),
// dy = round(-sin*FP).
//
// Legal fan: MIN_DEG..=MAX_DEG (near-horizontal shots are excluded — you can't
// fire flat or downward). Output: games-agnostic committed data the core embeds.
//
// Usage: node tools/build-bubble-directions.mjs

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FP = 65536; // shift-16 fixed point
const MIN_DEG = 10;
const MAX_DEG = 170;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "crates/bubble-core/data");

const dirs = [];
for (let deg = MIN_DEG; deg <= MAX_DEG; deg += 1) {
  const rad = (deg * Math.PI) / 180;
  const dx = Math.round(Math.cos(rad) * FP);
  const dy = Math.round(-Math.sin(rad) * FP); // y grows down; up is negative
  dirs.push([deg, dx, dy]);
}

const payload = { fp: FP, min_deg: MIN_DEG, max_deg: MAX_DEG, dirs };
await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, "directions.json"), JSON.stringify(payload) + "\n");
console.log(`wrote ${dirs.length} directions (${MIN_DEG}..${MAX_DEG} deg, FP=${FP}) to crates/bubble-core/data/directions.json`);
console.log(`sample: 90deg -> ${JSON.stringify(dirs.find((d) => d[0] === 90))}, 45deg -> ${JSON.stringify(dirs.find((d) => d[0] === 45))}`);
