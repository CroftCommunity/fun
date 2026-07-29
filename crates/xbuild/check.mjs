// Cross-build determinism check (master-plan Phase 2).
//
// Loads the wasm build of `xbuild`, computes solitaire hashes in wasm, and
// asserts they equal the LOCKED NATIVE golden hashes recorded in
// solitaire-core/vectors/. Byte-identical hashes across targets = the Rust->wasm
// determinism property. Exits non-zero on any mismatch.
//
// Usage: node check.mjs <xbuild.wasm> <vectors-dir>
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const [wasmPath, vectorsDir] = process.argv.slice(2);
if (!wasmPath || !vectorsDir) {
  console.error("usage: node check.mjs <xbuild.wasm> <vectors-dir>");
  process.exit(2);
}

const { instance } = await WebAssembly.instantiate(await readFile(wasmPath), {});
const { memory, hash_len, deal_hash, draw_cycle_hash } = instance.exports;
const len = hash_len();

function readHash(ptr) {
  return new TextDecoder().decode(new Uint8Array(memory.buffer, ptr, len));
}
async function goldenHash(file) {
  const v = JSON.parse(await readFile(join(vectorsDir, file), "utf8"));
  return v.final_state_hash;
}

// (wasm export, native golden vector) pairs — same (seed, moves), both targets.
const cases = [
  { name: "deal-only (seed 0)", wasm: () => readHash(deal_hash(0, 0)), golden: "01-deal-only.json" },
  { name: "draw-cycle (seed 0)", wasm: () => readHash(draw_cycle_hash(0, 0)), golden: "02-draw-cycle.json" },
];

let ok = true;
for (const c of cases) {
  const got = c.wasm();
  const want = await goldenHash(c.golden);
  if (got === want) {
    console.log(`PASS  ${c.name}: wasm == native  ${got}`);
  } else {
    console.error(`FAIL  ${c.name}: wasm ${got} != native ${want}`);
    ok = false;
  }
}
console.log(ok ? "cross-build determinism: OK (wasm hashes == native golden hashes)" : "cross-build determinism: FAILED");
process.exit(ok ? 0 : 1);
