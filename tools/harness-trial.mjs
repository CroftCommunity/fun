// The browser AI-scoring harness trial (P6 Phase 4) — a STANDALONE script (not a
// Playwright project, so it never runs on the CI gate or under bundled Chromium).
// It serves the built app, launches **system Chrome** (channel:"chrome") against a
// real same-origin page (WebGPU needs a real secure origin), imports the embedded
// /vendor/harness.js, and runs a Hybrid-vs-Engine tournament over the REAL WebGPU
// model + wasm — printing the aggregate Report plus a STAGED diagnostic so a slow
// or hung run is legible and an implausible Report is localizable.
//
//   npm run harness:trial
//   HARNESS_TRIAL_GAMES=4 HARNESS_TRIAL_MODEL=Qwen2.5-0.5B-Instruct-q4f16_1-MLC npm run harness:trial
//   HARNESS_TRIAL_GAME=othello npm run harness:trial   (default: drop4)
//
// A persistent cache dir means the model downloads only once.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, "dist");
const PORT = 4180;
const origin = `http://localhost:${PORT}`;
const MODEL = process.env.HARNESS_TRIAL_MODEL ?? "Qwen2.5-0.5B-Instruct-q4f16_1-MLC";
const GAMES = Number(process.env.HARNESS_TRIAL_GAMES ?? "2");
// Numeric since P8 Phase 2a: the port's level is 0..3 (Easy..top), because the
// games' own Level unions disagree on the top member ("Perfect" vs "Expert").
const LEVEL = Number(process.env.HARNESS_TRIAL_LEVEL ?? "3");
const GAME = process.env.HARNESS_TRIAL_GAME ?? "drop4";
const cacheDir = join(root, ".webllm-cache"); // persists the model across runs (gitignored)

if (!existsSync(join(dist, "vendor", "harness.js"))) {
  console.error("harness-trial: dist/vendor/harness.js missing — run `node build.mjs` first.");
  process.exit(1);
}
if (!existsSync(join(dist, "drop4.wasm"))) {
  console.error("harness-trial: dist/drop4.wasm missing — run `npm run build:wasm && node build.mjs` first.");
  process.exit(1);
}
mkdirSync(cacheDir, { recursive: true });

const GPU_ARGS = ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--use-angle=metal", "--ignore-gpu-blocklist"];

// A tiny stamped progress line (mirrors the CLAUDE.md long-op convention).
function stamp(msg) {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  console.log(`${hh}:${mm} — harness-trial: ${msg}`);
}

const server = spawn("node", [join(root, "tools", "serve.mjs")], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 700));

stamp(`game=${GAME}  mode=hybrid-vs-L${LEVEL}  model=${MODEL}  games=${GAMES}  origin=${origin}  (system Chrome, embedded /vendor/harness.js)`);
const context = await chromium.launchPersistentContext(cacheDir, { channel: "chrome", headless: true, args: GPU_ARGS });

let exitCode = 1;
try {
  const page = await context.newPage();
  // Surface the staged diagnostic emitted from inside the page in real time.
  page.on("console", (m) => {
    const t = m.text();
    if (t.startsWith("STAGE ")) stamp(t.slice(6));
    else if (/error|webgpu|shader|fetch failed|Cannot/i.test(t)) console.log("    [page]", t.slice(0, 180));
  });

  await page.goto(`${origin}/`, { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(
    async ({ model, games, level, baseSeed, game }) => {
      const log = (s) => console.log(`STAGE ${s}`);
      // Stage 1: a real WebGPU adapter must exist (else the model can't load).
      if (!("gpu" in navigator)) return { ok: false, error: "navigator.gpu absent (opaque origin?)" };
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return { ok: false, error: "no WebGPU adapter" };
      const info = adapter.info ?? {};
      log(`gpu-adapter ok (${info.vendor ?? "?"}/${info.architecture ?? "?"})`);

      // Stage 2: import the embedded harness bundle.
      let runHybridTrial;
      try {
        ({ runHybridTrial } = await import("/vendor/harness.js"));
      } catch (e) {
        return { ok: false, error: `import /vendor/harness.js failed: ${e}` };
      }
      log("harness-loaded ok");

      // Stage 3+: run the trial, streaming model-load + per-game progress.
      let firstMoveLogged = false;
      try {
        const { text, report } = await runHybridTrial({
          model,
          game,
          games,
          level,
          baseSeed,
          onProgress: (p) => {
            if (!firstMoveLogged) {
              log(`model-load ${String(p).slice(0, 60)}`);
            }
          },
          onGame: (line) => {
            if (!firstMoveLogged) {
              log("first-move produced");
              firstMoveLogged = true;
            }
            log(line);
          },
        });
        return { ok: true, text, card: report.card };
      } catch (e) {
        return { ok: false, error: `trial failed: ${e}` };
      }
    },
    { model: MODEL, games: GAMES, level: LEVEL, baseSeed: 0, game: GAME },
  );

  if (result.ok) {
    console.log("\n" + result.text + "\n");
    // Honesty check: a "0 blunders" headline is only meaningful with a denominator.
    const c = result.card;
    const clean = c.blunders === 0;
    const graded = c.scoredMoves > 0;
    console.log(
      `harness-trial: hybrid blunders=${c.blunders} over ${c.scoredMoves} graded moves ` +
        `(${graded ? "measured" : "NONE GRADED — result is vacuous"}); legality by construction (in-band).`,
    );
    exitCode = clean && graded ? 0 : 1;
    stamp(exitCode === 0 ? "PASS" : "FAIL (no graded moves or a blunder slipped the band)");
  } else {
    stamp(`FAIL — ${result.error}`);
  }
} catch (e) {
  console.error(`harness-trial: driver error — ${e}`);
} finally {
  await context.close();
  server.kill();
}
process.exit(exitCode);
