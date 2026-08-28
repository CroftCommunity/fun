// D3 (native == wasm), D4 (replay cost in wasm), and D6 (divergence bisect).
//
// Run after:
//   cargo run --release --bin digests > native-digests.json
//   cargo build --release --target wasm32-unknown-unknown
//
// Resolve cargo through `rustup which cargo` — Homebrew's shadows rustup on PATH
// here and has no wasm std, the same trap tools/build-wasm.sh documents.

import { readFileSync } from "node:fs";

const wasmPath = "target/wasm32-unknown-unknown/release/orchard_physics_spike.wasm";
const native = JSON.parse(readFileSync("native-digests.json", "utf8"));

const { instance } = await WebAssembly.instantiate(readFileSync(wasmPath), {});
const w = instance.exports;

const hex = (v) => "0x" + (v & 0xffffffffffffffffn).toString(16).padStart(16, "0");

let failures = 0;
const check = (label, got, want) => {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`  ${ok ? "MATCH " : "DIVERGE"}  ${label.padEnd(28)} wasm ${got}  native ${want}`);
  return ok;
};

// ── D3: the digests agree across targets ────────────────────────────────────
console.log("== D3: native == wasm ==");
check("scenario", hex(w.scenario_digest()), native.scenario);
check("perturbed", hex(w.perturbed_digest()), native.perturbed);
check("broken (reversed contacts)", hex(w.broken_tick_digest(native.total_ticks)), native.broken);

console.log("\n  checkpoints:");
for (const [tick, want] of Object.entries(native.checkpoints)) {
  check(`tick ${tick}`, hex(w.tick_digest(Number(tick))), want);
}

// ── D3 believability guards ─────────────────────────────────────────────────
// A digest that agrees proves nothing on its own: it could be insensitive, or
// the scenario could be inert. Both are tested rather than assumed.
console.log("\n== D3 guards: is the digest actually measuring anything? ==");
const scenario = hex(w.scenario_digest());
const perturbed = hex(w.perturbed_digest());
const broken = hex(w.broken_tick_digest(native.total_ticks));

const guard = (label, ok, detail) => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};
guard(
  "one sub-unit of spawn x changes the digest",
  scenario !== perturbed,
  `${scenario} vs ${perturbed}`,
);
guard(
  "breaking contact order changes the digest",
  scenario !== broken,
  `${scenario} vs ${broken}`,
);
guard(
  "the scenario is not inert (early and late digests differ)",
  hex(w.tick_digest(1)) !== hex(w.tick_digest(3600)),
);

// ── D6: bisect the first divergent tick ─────────────────────────────────────
// The point is not that a divergence exists — we manufactured one. The point is
// that the tool NAMES it, so a red cross-check in Phase 6 is a diagnosis rather
// than a wall.
console.log("\n== D6: divergence bisect (against the deliberately-broken build) ==");
const same = (n) => hex(w.tick_digest(n)) === hex(w.broken_tick_digest(n));

if (same(native.total_ticks)) {
  guard("bisect finds a divergence", false, "the two builds agree; nothing to find");
} else {
  let lo = 0;
  let hi = native.total_ticks;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (same(mid)) lo = mid;
    else hi = mid;
  }
  console.log(`  first divergent tick: ${hi} (last agreeing tick: ${lo})`);
  console.log(`    good ${hex(w.tick_digest(hi))}`);
  console.log(`    bad  ${hex(w.broken_tick_digest(hi))}`);
  guard("bisect names a specific first tick", hi > 0 && hi <= native.total_ticks);
}

// ── D4: replay cost in wasm ─────────────────────────────────────────────────
// Swept rather than spot-checked: the question the plan asks is whether a
// one-tap re-verify stalls, and that depends on how the cost scales with game
// length, not on one point.
console.log("\n== D4: replay cost in wasm ==");
console.log("  ticks   game length   wasm ms   ms/1k ticks");
const d4 = [];
for (const ticks of [3600, 9000, 18000, 36000, 57600]) {
  const t0 = process.hrtime.bigint();
  w.tick_digest(ticks);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  d4.push([ticks, ms]);
  const mins = ticks / 64 / 60;
  console.log(
    `  ${String(ticks).padStart(5)}   ${mins.toFixed(1).padStart(5)} min      ` +
      `${ms.toFixed(0).padStart(6)}   ${((ms / ticks) * 1000).toFixed(1).padStart(11)}`,
  );
}
const [, msAt18k] = d4.find(([t]) => t === 18000);
const budgetOk = msAt18k < 1000;
if (!budgetOk) failures++;
console.log(
  `\n  ${budgetOk ? "PASS" : "FAIL"}  the plan's bar: a 4.7-minute game (18,000 ticks) ` +
    `re-verifies in under 1000 ms — measured ${msAt18k.toFixed(0)} ms`,
);

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
