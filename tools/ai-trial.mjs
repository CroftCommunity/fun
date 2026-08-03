// The WebLLM trial driver — a STANDALONE script (not a Playwright project, so it
// never runs on the CI gate or under bundled Chromium). It serves the built app,
// launches **system Chrome** (channel:"chrome") against a real same-origin page
// (WebGPU needs a real secure origin — an opaque about:blank hides navigator.gpu),
// and validates the embedded WebLLM path. Two modes, both with a STAGED diagnostic
// so a failing trial is diagnosable from the transcript alone (no debugger):
//
//   npm run ai:trial            # "generate": import /vendor/webllm.js, one structured gen
//   AI_TRIAL_MODE=hybrid npm run ai:trial   # drive the real /drop4/ hybrid opponent
//   AI_TRIAL_MODEL=Qwen2.5-0.5B-Instruct-q4f16_1-MLC ...   # a faster model
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
const MODE = process.env.AI_TRIAL_MODE ?? "generate";
const MODEL = process.env.AI_TRIAL_MODEL ?? "Qwen2.5-0.5B-Instruct-q4f16_1-MLC";
const cacheDir = join(root, ".webllm-cache"); // persists the model across runs (gitignored)

if (!existsSync(join(dist, "vendor", "webllm.js"))) {
  console.error("ai-trial: dist/vendor/webllm.js missing — run `node build.mjs` first.");
  process.exit(1);
}
mkdirSync(cacheDir, { recursive: true });

const GPU_ARGS = ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--use-angle=metal", "--ignore-gpu-blocklist"];

function printStages(stages) {
  for (const s of stages) {
    console.log(`  ${s.ok ? "PASS" : "FAIL"}  ${s.name}  ${s.ms}ms${s.detail ? ` · ${s.detail}` : ""}`);
  }
}

// Mode "generate": import the EMBEDDED bundle directly and run one structured gen.
async function runGenerate(page) {
  await page.goto(`${origin}/`, { waitUntil: "domcontentloaded" });
  return page.evaluate(async (model) => {
    const now = () => performance.now();
    const out = { stages: [], parsed: null, raw: null };
    const add = (name, ok, ms, detail) => out.stages.push({ name, ok, ms: Math.round(ms), detail });

    let t0 = now();
    if (!("gpu" in navigator)) { add("gpu-adapter", false, now() - t0, "navigator.gpu absent (opaque origin?)"); return out; }
    const adapter = await navigator.gpu.requestAdapter();
    const info = adapter ? (adapter.info ?? {}) : {};
    add("gpu-adapter", Boolean(adapter), now() - t0, adapter ? `${info.vendor ?? "?"}/${info.architecture ?? "?"}` : "no adapter");
    if (!adapter) return out;

    t0 = now();
    let CreateMLCEngine;
    try { ({ CreateMLCEngine } = await import("/vendor/webllm.js")); }
    catch (e) { add("model-load", false, now() - t0, `import /vendor/webllm.js failed: ${e}`); return out; }
    let engine;
    try { engine = await CreateMLCEngine(model, { initProgressCallback: (p) => { globalThis.__p = p.text; } }); }
    catch (e) { add("model-load", false, now() - t0, `${e}`); return out; }
    add("model-load", true, now() - t0, `${model} (embedded)`);

    const legal = [0, 1, 2, 3, 4, 5, 6];
    const schema = { type: "object", properties: { move: { type: "integer", enum: legal }, reason: { type: "string" } }, required: ["move", "reason"], additionalProperties: false };
    t0 = now();
    try {
      const reply = await engine.chat.completions.create({
        messages: [
          { role: "system", content: 'You are a Connect-4 player. Reply ONLY with JSON {"move","reason"}.' },
          { role: "user", content: `Legal columns: ${legal.join(", ")}. Pick your move.` },
        ],
        response_format: { type: "json_object", schema: JSON.stringify(schema) },
        max_tokens: 128, temperature: 0,
      });
      out.raw = reply.choices?.[0]?.message?.content ?? null;
      add("generate", out.raw != null, now() - t0, null);
    } catch (e) { add("generate", false, now() - t0, `${e}`); return out; }

    try {
      const parsed = JSON.parse(out.raw);
      const ok = legal.includes(parsed.move) && typeof parsed.reason === "string";
      out.parsed = ok ? parsed : null;
      add("schema-validate", ok, 0, ok ? `move=${parsed.move}` : `rejected raw: ${out.raw}`);
    } catch { add("schema-validate", false, 0, `parse failed on raw: ${out.raw}`); }
    return out;
  }, MODEL);
}

// Mode "hybrid": drive the REAL /drop4/ UI — enable the local-AI opponent, play a
// human move, and confirm the hybrid replies with a legal move + a spoken reason.
async function runHybrid(page) {
  await page.addInitScript((model) => { window.__DROP4_AI_MODEL = model; }, MODEL);
  const stages = [];
  const add = (name, ok, ms, detail) => { stages.push({ name, ok, ms: Math.round(ms), detail }); };
  const t = () => Date.now();

  await page.goto(`${origin}/drop4/?seed=7`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".drop4-board");
  await page.waitForFunction(() => Boolean(window.__drop4));

  // gpu-adapter → the local-AI toggle appears (the probe found a real adapter).
  let t0 = t();
  try {
    await page.waitForSelector(".drop4-ai-toggle-input", { timeout: 8000 });
    add("gpu-adapter", true, t() - t0, "local-AI toggle offered");
  } catch { add("gpu-adapter", false, t() - t0, "toggle never appeared — no real adapter?"); return { stages }; }

  await page.locator(".drop4-ai-toggle-input").check();

  // Play a human move; the opponent must be the hybrid now.
  const before = await page.evaluate(() => window.__drop4.game.board().cells.flat().filter((v) => v !== 0).length);
  await page.locator('.drop4-col[data-col="3"]').click();

  // model-load + ai-move: wait until two discs are down (human + AI reply) or over.
  t0 = t();
  try {
    await page.waitForFunction((n) => {
      const b = window.__drop4.game.board();
      const filled = b.cells.flat().filter((v) => v !== 0).length;
      return filled >= n + 2 || b.result !== -1;
    }, before, { timeout: 300000 });
    add("model-load+ai-move", true, t() - t0, "hybrid replied");
  } catch { add("model-load+ai-move", false, t() - t0, "no AI reply within timeout"); return { stages }; }

  // legality: the board advanced by the human + a legal AI move.
  const after = await page.evaluate(() => window.__drop4.game.board().cells.flat().filter((v) => v !== 0).length);
  add("legal-move", after >= before + 2, 0, `discs ${before}→${after}`);

  // reason: the opponent's spoken reason is shown (personality).
  t0 = t();
  try {
    await page.waitForSelector(".drop4-ai-say", { timeout: 5000 });
    const say = (await page.locator(".drop4-ai-say").textContent()) ?? "";
    add("spoken-reason", say.trim().length > 0, t() - t0, say.trim().slice(0, 80));
  } catch { add("spoken-reason", false, t() - t0, "no .drop4-ai-say shown"); }

  return { stages };
}

const server = spawn("node", [join(root, "tools", "serve.mjs")], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 700));

console.log(`ai-trial: mode=${MODE}  model=${MODEL}  origin=${origin}  (system Chrome, embedded /vendor/webllm.js)`);
const context = await chromium.launchPersistentContext(cacheDir, { channel: "chrome", headless: true, args: GPU_ARGS });

let exitCode = 1;
try {
  const page = await context.newPage();
  page.on("console", (m) => {
    if (/error|webgpu|shader|fetch failed|Cannot/i.test(m.text())) console.log("    [page]", m.text().slice(0, 180));
  });
  const result = MODE === "hybrid" ? await runHybrid(page) : await runGenerate(page);
  printStages(result.stages);
  if (result.parsed) console.log(`  object: ${JSON.stringify(result.parsed)}`);
  else if (result.raw) console.log(`  raw (rejected): ${result.raw}`);
  const allOk = result.stages.length > 0 && result.stages.every((s) => s.ok) && (MODE === "hybrid" || result.parsed != null);
  exitCode = allOk ? 0 : 1;
  console.log(allOk ? "\nai-trial: PASS" : "\nai-trial: FAIL");
} catch (e) {
  console.error(`ai-trial: driver error — ${e}`);
} finally {
  await context.close();
  server.kill();
}
process.exit(exitCode);
