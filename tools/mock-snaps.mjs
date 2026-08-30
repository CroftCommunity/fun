// Captures TODAY's UI at the workspace's standard mock viewports, so a mock can
// stand its drawings next to real pixels and say what they were taken from.
// Per CroftC/.claude/MOCKS.md rules 2–3: a mock names its baseline
// (`fun@<sha>`), and the baseline is whatever this script ran against — HEAD of
// this checkout, refused if UI files are uncommitted.
//
//   npm run build:wasm && npm run build && node tools/mock-snaps.mjs <game-id>
//   -> mocks/snaps/<game-id>.<route>.<viewport>.png + mocks/snaps/manifest.json
//
// Hermetic: every route below is a deep link with a fixed seed, so the deal is
// the same for whoever runs it (the bare land would show TODAY's daily, which
// is a different picture every UTC day). Serves dist/ itself on a spare port so
// it never collides with the e2e webServer on 4180.
import { chromium } from "playwright-core";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "mocks", "snaps");
const PORT = 4187;
// The standard frames (MOCKS.md rule 3). fun's mocks draw desktop at 1180×740 —
// recorded there as variance; the CAPTURE uses the standard 1280×900.
const VIEWPORTS = { phone: { width: 390, height: 844 }, desktop: { width: 1280, height: 900 } };

// Routes per game: a fixed-seed board and a fixed-seed board with a source
// tube selected (the two states a sort-puzzle mock argues about).
const ROUTES = {
  "color-sort": [
    { route: "board", url: "/color-sort/?seed=4242", after: null },
    { route: "select", url: "/color-sort/?seed=4242", after: (page) => page.evaluate(() => window.__colorSort?.select(0)) },
    // Mid-pour, at Slow so the frame lands inside the stream phase (lift 210 + travel 350 + …).
    {
      route: "pour",
      url: "/color-sort/?level=3",
      before: (page) => page.evaluate(() => localStorage.setItem("fun-color-sort-pour-speed", "slow")),
      after: async (page) => {
        const mv = await page.evaluate(() => window.__colorSort.game.hint());
        await page.click(`.cs-tube[data-tube="${mv.from}"]`);
        await page.click(`.cs-tube[data-tube="${mv.to}"]`);
        await page.waitForTimeout(650);
      },
      settle: 0,
    },
  ],
};

const id = process.argv[2];
if (!id || !ROUTES[id]) {
  console.error(`usage: node tools/mock-snaps.mjs <${Object.keys(ROUTES).join("|")}>`);
  process.exit(2);
}
const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT }).toString().trim();
const dirty = execFileSync("git", ["status", "--porcelain", "--", "src", "styles.css", "tokens.css", "assets", "build.mjs"], { cwd: ROOT })
  .toString()
  .trim();
if (dirty) {
  console.error("refusing: UI files are uncommitted, so the sha would name a tree these pixels are not from:\n" + dirty);
  process.exit(2);
}
if (!existsSync(join(ROOT, "dist", id, "index.html"))) {
  console.error(`refusing: dist/${id}/ is not built — run npm run build:wasm && npm run build first`);
  process.exit(2);
}

const server = spawn(process.execPath, [join(ROOT, "tools", "serve.mjs")], { env: { ...process.env, E2E_PORT: String(PORT) }, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 400));
mkdirSync(OUT, { recursive: true });

const manifestPath = join(OUT, "manifest.json");
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : { files: [] };
manifest.baseline = `fun@${sha}`;
manifest.capturedAt = new Date().toLocaleDateString("sv-SE"); // local day, the shelf's "today"
manifest.population = "deep link, fixed seed (hermetic)";
manifest.files = manifest.files.filter((f) => f.game !== id);

const browser = await chromium.launch();
try {
  for (const [name, vp] of Object.entries(VIEWPORTS)) {
    const page = await browser.newPage({ viewport: vp, colorScheme: "dark" });
    for (const r of ROUTES[id]) {
      await page.goto(`http://localhost:${PORT}${r.url}`);
      await page.waitForFunction(() => Boolean(window.__colorSort), null, { timeout: 15000 });
      if (r.before) {
        await r.before(page);
        await page.reload();
        await page.waitForFunction(() => Boolean(window.__colorSort), null, { timeout: 15000 });
      }
      if (r.after) await r.after(page);
      await page.waitForTimeout(r.settle ?? 500); // let the selection transition settle
      const file = `${id}.${r.route}.${name}.png`;
      await page.screenshot({ path: join(OUT, file) });
      manifest.files.push({ file, game: id, route: r.route, url: r.url, viewport: name, ...vp });
    }
    await page.close();
  }
} finally {
  await browser.close();
  server.kill();
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`baseline fun@${sha} — ${manifest.files.filter((f) => f.game === id).length} snaps for ${id} in mocks/snaps/`);
