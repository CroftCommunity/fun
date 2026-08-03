// The WebLLM trial driver — a STANDALONE script (not a Playwright project, so it
// never runs on the CI gate or under bundled Chromium). It serves the built app,
// launches **system Chrome** (channel:"chrome") against a real same-origin page
// (WebGPU needs a real secure origin — an opaque about:blank hides navigator.gpu),
// imports the EMBEDDED /vendor/webllm.js runtime, and runs one structured-output
// generation. It prints a STAGED diagnostic (gpu-adapter / model-load / generate /
// schema-validate) so a failing trial is diagnosable from the transcript alone —
// no debugger. A persistent cache dir means the ~GB model downloads only once.
//
//   npm run ai:trial                 # pinned model (Qwen2.5-1.5B)
//   AI_TRIAL_MODEL=Qwen2.5-0.5B-Instruct-q4f16_1-MLC npm run ai:trial   # faster
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, "dist");
const PORT = 4180;
const origin = `http://localhost:${PORT}`;
const MODEL = process.env.AI_TRIAL_MODEL ?? "Qwen2.5-1.5B-Instruct-q4f16_1-MLC";
const cacheDir = join(root, ".webllm-cache"); // persists the model across runs (gitignored)

if (!existsSync(join(dist, "vendor", "webllm.js"))) {
  console.error("ai-trial: dist/vendor/webllm.js missing — run `node build.mjs` first.");
  process.exit(1);
}
mkdirSync(cacheDir, { recursive: true });

const server = spawn("node", [join(root, "tools", "serve.mjs")], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 700));

console.log(`ai-trial: model=${MODEL}  origin=${origin}  (system Chrome, embedded /vendor/webllm.js)`);
const context = await chromium.launchPersistentContext(cacheDir, {
  channel: "chrome",
  headless: true,
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU", "--use-angle=metal", "--ignore-gpu-blocklist"],
});

let exitCode = 1;
try {
  const page = await context.newPage();
  page.on("console", (m) => {
    if (/error|webgpu|shader|fetch failed|Cannot/i.test(m.text())) console.log("    [page]", m.text().slice(0, 180));
  });
  await page.goto(`${origin}/`, { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async (model) => {
    const now = () => performance.now();
    const out = { stages: [], raw: null, parsed: null };
    const add = (name, ok, ms, detail) => out.stages.push({ name, ok, ms: Math.round(ms), detail });

    // 1. gpu-adapter
    let t0 = now();
    if (!("gpu" in navigator)) { add("gpu-adapter", false, now() - t0, "navigator.gpu absent (opaque origin?)"); return out; }
    const adapter = await navigator.gpu.requestAdapter();
    const info = adapter ? (adapter.info ?? {}) : {};
    add("gpu-adapter", Boolean(adapter), now() - t0, adapter ? `${info.vendor ?? "?"}/${info.architecture ?? "?"}` : "no adapter");
    if (!adapter) return out;

    // 2. model-load (import the EMBEDDED same-origin bundle, then create the engine)
    t0 = now();
    let CreateMLCEngine;
    try { ({ CreateMLCEngine } = await import("/vendor/webllm.js")); }
    catch (e) { add("model-load", false, now() - t0, `import /vendor/webllm.js failed: ${e}`); return out; }
    let engine;
    try { engine = await CreateMLCEngine(model, { initProgressCallback: (p) => { globalThis.__p = p.text; } }); }
    catch (e) { add("model-load", false, now() - t0, `${e}`); return out; }
    add("model-load", true, now() - t0, `${model} (embedded)`);

    // 3. generate (structured output — the exact WebLLMRuntime request shape)
    const legal = [0, 1, 2, 3, 4, 5, 6];
    const schema = {
      type: "object",
      properties: { move: { type: "integer", enum: legal }, reason: { type: "string" } },
      required: ["move", "reason"], additionalProperties: false,
    };
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

    // 4. schema-validate (parse + move∈enum; prints the rejected raw on failure)
    try {
      const parsed = JSON.parse(out.raw);
      const ok = legal.includes(parsed.move) && typeof parsed.reason === "string";
      out.parsed = ok ? parsed : null;
      add("schema-validate", ok, 0, ok ? `move=${parsed.move}` : `rejected raw: ${out.raw}`);
    } catch { add("schema-validate", false, 0, `parse failed on raw: ${out.raw}`); }
    return out;
  }, MODEL);

  for (const s of result.stages) {
    console.log(`  ${s.ok ? "PASS" : "FAIL"}  ${s.name}  ${s.ms}ms${s.detail ? ` · ${s.detail}` : ""}`);
  }
  if (result.parsed) console.log(`  object: ${JSON.stringify(result.parsed)}`);
  else if (result.raw) console.log(`  raw (rejected): ${result.raw}`);
  const allOk = result.stages.length > 0 && result.stages.every((s) => s.ok) && result.parsed != null;
  exitCode = allOk ? 0 : 1;
  console.log(allOk ? "\nai-trial: PASS" : "\nai-trial: FAIL");
} catch (e) {
  console.error(`ai-trial: driver error — ${e}`);
} finally {
  await context.close();
  server.kill();
}
process.exit(exitCode);
