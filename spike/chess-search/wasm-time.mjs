// Phase 0 D2 spike (plan 2026-08-30-plan-chess-vs-engine.md): time the same
// searches the native driver measures, inside Chromium, over the spike's wasm
// build. THROWAWAY. Run from the spike directory:
//   node wasm-time.mjs
// Prints per-depth median/p95/worst ms (quiescence on) and the implied nps.
import { readFile } from "node:fs/promises";
import { chromium } from "/Users/cpettet/git/chasemp/CroftC/fun/node_modules/playwright-core/index.mjs";

const WASM = "target/wasm32-unknown-unknown/release/chess_search_spike.wasm";
const DEPTHS = [2, 3, 4, 5];

const bytes = await readFile(WASM);
const browser = await chromium.launch();
const page = await browser.newPage();

const report = await page.evaluate(async ({ b64, depths }) => {
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const { instance } = await WebAssembly.instantiate(bin, {});
  const { pos_count, search_nodes } = instance.exports;
  const n = pos_count();
  // Warm-up so the first measurement is not paying tier-up compilation.
  search_nodes(0, 3, 1);
  const out = [];
  for (const depth of depths) {
    const ms = [];
    let nodes = 0n;
    for (let p = 0; p < n; p++) {
      const t0 = performance.now();
      nodes += search_nodes(p, depth, 1);
      ms.push(performance.now() - t0);
    }
    ms.sort((a, c) => a - c);
    const totalMs = ms.reduce((a, c) => a + c, 0);
    const pick = (q) => ms[Math.round((ms.length - 1) * q)];
    out.push({
      depth,
      positions: n,
      medianMs: +pick(0.5).toFixed(1),
      p95Ms: +pick(0.95).toFixed(1),
      worstMs: +pick(1).toFixed(1),
      over400: ms.filter((v) => v > 400).length,
      nps: Math.round(Number(nodes) / (totalMs / 1000)),
    });
  }
  return out;
}, { b64: bytes.toString("base64"), depths: DEPTHS });

console.log("Chromium (playwright-core), quiescence ON, fresh TT per call");
console.log("depth  median-ms  p95-ms  worst-ms  over-400ms  nps");
for (const r of report) {
  console.log(
    `${r.depth}      ${String(r.medianMs).padStart(8)}  ${String(r.p95Ms).padStart(6)}  ` +
    `${String(r.worstMs).padStart(8)}  ${String(r.over400).padStart(3)}/${r.positions}     ${r.nps}`,
  );
}
await browser.close();
