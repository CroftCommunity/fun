// native == wasm at the BINDING boundary.
//
// Phase 1's vectors prove the solver agrees across targets; this proves nothing
// is lost crossing into wasm — which is a different claim, and the one where a
// width bug lives. `usize` is 32-bit on wasm32 and 64-bit natively, so the seed
// crosses as two u32 halves and the scenario uses a seed with BOTH set.
//
// Run after:
//   cargo run --release --bin expected > expected.json
//   cargo build -p orchard-wasm --release --target wasm32-unknown-unknown

import { readFileSync } from "node:fs";

const wasmPath =
  process.argv[2] ?? "../../target/wasm32-unknown-unknown/release/orchard_wasm.wasm";
const want = JSON.parse(readFileSync(process.argv[3] ?? "expected.json", "utf8"));

const { instance } = await WebAssembly.instantiate(readFileSync(wasmPath), {});
const w = instance.exports;
const mem = () => new Uint8Array(w.memory.buffer);

/** Read the output buffer the way the real host will. */
function readOut(ptr) {
  const len = w.out_len();
  return new TextDecoder().decode(mem().slice(ptr, ptr + len));
}
const hash = () => JSON.parse(readOut(w.current_hash()));

let failures = 0;
const check = (label, got, expected) => {
  const ok = got === expected;
  if (!ok) failures++;
  console.log(`  ${ok ? "MATCH  " : "DIVERGE"} ${label.padEnd(26)} ${ok ? got : `wasm ${got}  native ${expected}`}`);
};

console.log("== native == wasm across the binding ==");
w.new_game(want.seed_lo, want.seed_hi);

let t = 0;
for (let i = 0; i < 8; i++) {
  const code = w.drop_at(t, 60 + 45 * i);
  if (code !== 0) { console.log(`  drop ${i} refused with code ${code}`); failures++; }
  t += 33;
  check(`after drop ${i} (tick ${t})`, hash(), want.checkpoints[i].hash);
}
w.wait_until(t + 600);

check("final hash", hash(), want.final_hash);
check("score", w.score(), want.score);
check("tick", w.tick(), want.tick);

// The world view the renderer will actually consume.
const world = JSON.parse(readOut(w.world_json()));
check("fruit count", world.fruit.length, want.fruit);

// ── the never-panics contract, exercised from the host side ────────────────
console.log("\n== the module survives what a host will do to it ==");
const guard = (label, fn) => {
  try {
    fn();
    console.log(`  PASS  ${label}`);
  } catch (e) {
    failures++;
    console.log(`  TRAP  ${label} — ${e.message}`);
  }
};
guard("verify with a zero pointer", () => w.verify_json(0, 0));
guard("verify with garbage bytes", () => {
  const bytes = new TextEncoder().encode("{not json");
  const ptr = 1024; // scribble into a low page the module is not using
  mem().set(bytes, ptr);
  const r = w.verify_json(ptr, bytes.length);
  const v = JSON.parse(readOut(r));
  if (v.ok !== false) { failures++; console.log("    garbage verified as ok"); }
});
guard("a huge day index", () => { w.daily_seed_lo(0xffffffff); w.daily_seed_hi(0xffffffff); });
guard("a drop far in the past", () => w.drop_at(0, 220));
guard("reads after the run ends", () => { w.world_json(); w.record_json(); w.current_hash(); });

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
