// Binding wiring check (delivery plan Phase C): drive solitaire-wasm through the
// raw wasm boundary under node and assert the board, determinism (vs the locked
// NATIVE golden hash), illegal-move rejection, and the outcome envelope.
// Usage: node check.mjs <solitaire_wasm.wasm> <solitaire-core vectors dir>
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const [wasmPath, vectorsDir] = process.argv.slice(2);
const { instance } = await WebAssembly.instantiate(await readFile(wasmPath), {});
const x = instance.exports;
const mem = () => new Uint8Array(x.memory.buffer);

function readOut(ptr) {
  const len = x.out_len();
  return new TextDecoder().decode(mem().subarray(ptr, ptr + len));
}
const board = () => JSON.parse(readOut(x.board_json()));
const hash = () => JSON.parse(readOut(x.current_hash()));
const outcome = (unfinished, declare) => JSON.parse(readOut(x.outcome_json(unfinished, declare)));

let ok = true;
const check = (cond, msg) => {
  if (cond) console.log(`PASS  ${msg}`);
  else {
    console.error(`FAIL  ${msg}`);
    ok = false;
  }
};

// --- deal ---
x.new_game(0, 0);
const b = board();
check(b.tableau.length === 7, "7 tableau piles");
check(b.tableau.every((p, i) => p.length === i + 1), "pile sizes 1..7");
check(b.tableau.every((p) => p[p.length - 1].faceUp === true), "each pile top is face-up");
check(
  b.tableau.every((p) => p.slice(0, -1).every((s) => s.faceUp === false && s.card === undefined)),
  "face-down cards omit rank/suit (hidden)",
);
check(b.stockCount === 24 && b.wasteCount === 0, "24 stock, 0 waste");
check(JSON.stringify(b.foundations) === "[0,0,0,0]" && b.won === false, "empty foundations, not won");

// --- determinism through the boundary: 28-draw cycle == locked native golden hash ---
const golden = JSON.parse(await readFile(join(vectorsDir, "02-draw-cycle.json"), "utf8")).final_state_hash;
for (let i = 0; i < 28; i++) check(x.play_draw() === 0, `play_draw #${i + 1} applied`);
check(hash() === golden, `draw-cycle hash == native golden (${golden.slice(0, 12)}…)`);

// --- illegal move rejected, board unchanged ---
x.new_game(0, 0);
const before = JSON.stringify(board());
check(x.play_waste_to_foundation() === 1, "illegal move (empty waste) → status 1");
check(JSON.stringify(board()) === before, "board unchanged after illegal move");

// --- outcome envelope ---
const rec = outcome(0, 1); // Abandoned if not won; declare assistance
check(rec.kind === "solitaire" && rec.version === 1, "outcome is a v1 solitaire envelope");
check(rec.payload.result === "Abandoned" && rec.payload.assistance === false, "declared: Abandoned, no assistance");

console.log(ok ? "binding: OK" : "binding: FAILED");
process.exit(ok ? 0 : 1);
