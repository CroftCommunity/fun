// Cross-build determinism check (master-plan Phase 2).
//
// Loads the wasm build of `xbuild`, computes solitaire hashes in wasm, and
// asserts they equal the LOCKED NATIVE golden hashes recorded in
// solitaire-core/vectors/. Byte-identical hashes across targets = the Rust->wasm
// determinism property. Exits non-zero on any mismatch.
//
// Usage: node check.mjs <xbuild.wasm> <solitaire-vectors> <dots-vectors> <furrow-vectors>
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const [wasmPath, vectorsDir, dotsVectorsDir, furrowVectorsDir] =
  process.argv.slice(2);
if (!wasmPath || !vectorsDir || !dotsVectorsDir || !furrowVectorsDir) {
  console.error(
    "usage: node check.mjs <xbuild.wasm> <solitaire-vectors-dir> <dots-vectors-dir> <furrow-vectors-dir>",
  );
  process.exit(2);
}

const { instance } = await WebAssembly.instantiate(
  await readFile(wasmPath),
  {},
);
const {
  memory,
  hash_len,
  deal_hash,
  draw_cycle_hash,
  dots_replay_hash,
  dots_in_ptr,
  dots_in_cap,
  furrow_replay_hash,
  move_in_ptr,
  move_in_cap,
} = instance.exports;
const len = hash_len();

function readHash(ptr) {
  return new TextDecoder().decode(new Uint8Array(memory.buffer, ptr, len));
}
async function goldenHash(file) {
  const v = JSON.parse(await readFile(join(vectorsDir, file), "utf8"));
  return v.final_state_hash;
}
async function vectorFrom(dir, file) {
  return JSON.parse(await readFile(join(dir, file), "utf8"));
}
// Write a vector's move bytes into the shared wasm input buffer, then hash the
// replay through `hash`. There is no allocator in a freestanding wasm module, so
// a move list crosses the boundary as bytes in a static buffer and a count.
function replayHash(hash, ptr, cap, moves) {
  if (moves.length > cap())
    throw new Error("move list exceeds the wasm input buffer");
  new Uint8Array(memory.buffer, ptr(), moves.length).set(moves);
  return readHash(hash(moves.length));
}
const dotsHash = (moves) =>
  replayHash(dots_replay_hash, dots_in_ptr, dots_in_cap, moves);
const furrowHash = (moves) =>
  replayHash(furrow_replay_hash, move_in_ptr, move_in_cap, moves);

// (wasm export, native golden vector) pairs — same (seed, moves), both targets.
const cases = [
  {
    name: "deal-only (seed 0)",
    wasm: () => readHash(deal_hash(0, 0)),
    golden: "01-deal-only.json",
  },
  {
    name: "draw-cycle (seed 0)",
    wasm: () => readHash(draw_cycle_hash(0, 0)),
    golden: "02-draw-cycle.json",
  },
];

// Dots and Boxes: the vector file carries both the moves and the native hash, so
// the same file drives both halves of the claim.
for (const file of ["01-empty.json", "02-lowest-legal-game.json"]) {
  const v = await vectorFrom(dotsVectorsDir, file);
  cases.push({
    name: `dots ${v.name}`,
    wasm: () => dotsHash(v.moves),
    goldenValue: v.final_state_hash,
  });
}

// Furrow (mancala). Worth more here than for any other core enrolled: a sow is
// up to thirteen writes from one move code, and the extra-turn chain and the
// end-of-game sweep are the paths where a `usize` on the hashed path would
// actually show. 03 is the vector chosen to walk all three.
for (const file of [
  "01-opening.json",
  "02-lowest-legal-game.json",
  "03-extra-turn-chain.json",
]) {
  const v = await vectorFrom(furrowVectorsDir, file);
  cases.push({
    name: `furrow ${v.name}`,
    wasm: () => furrowHash(v.moves),
    goldenValue: v.final_state_hash,
  });
}

let ok = true;
for (const c of cases) {
  const got = c.wasm();
  const want = c.goldenValue ?? (await goldenHash(c.golden));
  if (got === want) {
    console.log(`PASS  ${c.name}: wasm == native  ${got}`);
  } else {
    console.error(`FAIL  ${c.name}: wasm ${got} != native ${want}`);
    ok = false;
  }
}
console.log(
  ok
    ? "cross-build determinism: OK (wasm hashes == native golden hashes)"
    : "cross-build determinism: FAILED",
);
process.exit(ok ? 0 : 1);
