// D4, measured COLD: one process, one call, nothing warmed. This is the shape a
// user's one-tap re-verify actually has, and it differs from the warmed number
// by ~50% — the same 18,000-tick call measured 1206 ms cold and 797 ms warm in
// the same session, which is why this is its own script rather than a line in
// verify.mjs.
import { readFileSync } from "node:fs";
const ticks = Number(process.argv[2] ?? 18000);
const { instance } = await WebAssembly.instantiate(
  readFileSync("target/wasm32-unknown-unknown/release/orchard_physics_spike.wasm"),
  {},
);
const t0 = process.hrtime.bigint();
instance.exports.tick_digest(ticks);
const ms = Number(process.hrtime.bigint() - t0) / 1e6;
console.log(`${ticks}\t${(ticks / 64 / 60).toFixed(1)} min\t${ms.toFixed(0)} ms`);
