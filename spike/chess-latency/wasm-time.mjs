// Phase 4 latency table (plan 2026-08-30-plan-chess-vs-engine.md): time the
// provisional levels in Chromium over the real chess-solver wasm build.
// KEEP-AS-FIXTURE: Phase 13 runs this same harness on the phones.
//   node wasm-time.mjs
import { readFile } from "node:fs/promises";
import { chromium } from "/Users/cpettet/git/chasemp/CroftC/fun/node_modules/playwright-core/index.mjs";

const WASM = "target/wasm32-unknown-unknown/release/chess_latency.wasm";
// level, max_depth, node cap (0 = unlimited) — the provisional ladder, budgets
// picked from the native table so every level fits a tap in Chromium.
const LEVELS = [
  ["Easy", 2, 10_000],
  ["Medium", 3, 40_000],
  ["Hard", 4, 100_000],
  ["Expert", 5, 150_000],
];

const bytes = await readFile(WASM);
const browser = await chromium.launch();
const page = await browser.newPage();
const report = await page.evaluate(async ({ b64, levels }) => {
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const { instance } = await WebAssembly.instantiate(bin, {});
  const { pos_count, run_deepened } = instance.exports;
  const n = pos_count();
  run_deepened(0, 3, 0, 0); // warm-up past tier-up compilation
  const out = [];
  for (const [name, depth, cap] of levels) {
    const ms = [];
    let nodes = 0n;
    for (let p = 0; p < n; p++) {
      const t0 = performance.now();
      nodes += run_deepened(p, depth, cap & 0xffffffff, Math.floor(cap / 2 ** 32));
      ms.push(performance.now() - t0);
    }
    ms.sort((a, c) => a - c);
    const pick = (q) => ms[Math.round((ms.length - 1) * q)];
    out.push({
      name, depth, cap, positions: n,
      medianMs: +pick(0.5).toFixed(1), p95Ms: +pick(0.95).toFixed(1),
      worstMs: +pick(1).toFixed(1), over400: ms.filter((v) => v > 400).length,
      nps: Math.round(Number(nodes) / (ms.reduce((a, c) => a + c, 0) / 1000)),
    });
  }
  return out;
}, { b64: bytes.toString("base64"), levels: LEVELS });
console.log("Chromium (playwright-core), chess-solver search_root");
console.log("level   depth  cap      median  p95   worst  over400  nps");
for (const r of report) {
  console.log(
    `${r.name.padEnd(7)} ${r.depth}      ${String(r.cap).padEnd(8)} ` +
    `${String(r.medianMs).padStart(6)} ${String(r.p95Ms).padStart(6)} ${String(r.worstMs).padStart(6)}  ` +
    `${r.over400}/${r.positions}     ${r.nps}`,
  );
}
await browser.close();
