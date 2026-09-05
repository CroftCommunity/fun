// Captures TODAY's UI at the workspace's standard mock viewports, so a mock can
// stand its drawings next to real pixels and say what they were taken from.
// Per CroftC/.claude/MOCKS.md rules 2–3: a mock names its baseline
// (`fun@<sha>`), and the baseline is whatever this script ran against — HEAD of
// this checkout, refused if UI files are uncommitted.
//
//   npm run build:wasm && npm run build && node tools/mock-snaps.mjs <game-id|all> [--out <slug>] [--tag <word>]
//   -> mocks/snaps/<slug>/<tag.>{game}.{route}.{viewport}.png + mocks/snaps/<slug>/manifest.json
//
// `--out` is the mock's own directory under mocks/snaps/ (MOCKS.md rule 3: route
// names are shared across mocks, so a shared directory lets one mock's capture
// overwrite another's evidence). `--tag` prefixes the files, so a mock can hold a
// `current.` set from main beside a `proposed.` set from its branch in one
// directory; the manifest records the baseline PER FILE and a run MERGES — it
// replaces the files it captured and leaves the rest.
//
// Hermetic: every route below is a deep link with a fixed seed, so the deal is
// the same for whoever runs it (the bare land would show TODAY's daily, which
// is a different picture every UTC day). The `poster` route IS the bare land: in
// a fresh browser context there is no progress record, so it is the poster with
// the setup card, which is the same for everyone. Serves dist/ itself on a spare
// port so it never collides with the e2e webServer on 4180.
import { chromium } from "playwright-core";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 4187;
// The standard frames (MOCKS.md rule 3). fun's mocks draw desktop at 1180×740 —
// recorded there as variance; the CAPTURE uses the standard 1280×900.
const VIEWPORTS = { phone: { width: 390, height: 844 }, desktop: { width: 1280, height: 900 } };

/** The board mounted — the frame's mount has a child and the game's hook is up. */
const mounted = (page) => page.waitForFunction(() => document.querySelector(".gf-mount")?.children.length > 0, null, { timeout: 15000 });
/** The poster showing, with its art decoded. */
const poster = (page) =>
  page.waitForFunction(
    () => {
      const img = document.querySelector(".gf-poster .gf-start-art");
      return img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0;
    },
    null,
    { timeout: 15000 },
  );

/** Every game's two hermetic routes: the front door, and a fixed-seed board. */
const generic = (id, seed) => [
  { route: "poster", url: `/${id}/`, ready: poster },
  { route: "board", url: `/${id}/?${seed}`, ready: mounted, settle: 1200 },
];

// Routes per game. Color Sort keeps its five (mock E's states); the rest take
// the generic pair with the seed their own browser spec uses.
const ROUTES = {
  "color-sort": [
    { route: "poster", url: "/color-sort/", ready: poster },
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
    // A solved level: the verifiable result with the sign-in offer beneath it.
    {
      route: "result",
      url: "/color-sort/?level=1",
      after: async (page) => {
        await page.evaluate(() => {
          const h = window.__colorSort;
          for (let i = 0; i < 300 && !h.game.isWon(); i++) {
            const mv = h.game.hint();
            if (!mv) break;
            h.game.pour(mv.from, mv.to);
          }
          h.refresh();
        });
        await page.waitForSelector(".sol-result");
      },
    },
    // The atmo-provider sheet, open.
    {
      route: "signin",
      url: "/color-sort/?level=1",
      after: async (page) => {
        await page.click("[data-signin-open]");
        await page.waitForSelector("dialog[data-signin-sheet][open]");
      },
    },
  ],
  solitaire: generic("solitaire", "seed=0"),
  "trio-tumble": generic("trio-tumble", "seed=7"),
  bubble: generic("bubble", "seed=7"),
  wyrdle: generic("wyrdle", "seed=7"),
  2048: generic("2048", "seed=7"),
  drop4: generic("drop4", "seed=7"),
  othello: generic("othello", "seed=7"),
  checkers: generic("checkers", "seed=7"),
  chess: generic("chess", "seed=7"),
  dots: generic("dots", "seed=7"),
  furrow: generic("furrow", "seed=7"),
  align: generic("align", "seed=7"),
  blockdoku: generic("blockdoku", "seed=7"),
  looseends: generic("looseends", "play=1"),
  mahjong: generic("mahjong", "level=1"),
  cribbage: generic("cribbage", "seed=7"),
  "orchard-drop": generic("orchard-drop", "seed=7"),
};

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1];
};
const id = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1]?.startsWith("--") !== true);
const outSlug = flag("--out");
const tag = flag("--tag");
const ids = id === "all" ? Object.keys(ROUTES) : [id];
if (!id || ids.some((g) => !ROUTES[g])) {
  console.error(`usage: node tools/mock-snaps.mjs <all|${Object.keys(ROUTES).join("|")}> [--out <slug>] [--tag <word>]`);
  process.exit(2);
}
const OUT = outSlug ? join(ROOT, "mocks", "snaps", outSlug) : join(ROOT, "mocks", "snaps");

const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT }).toString().trim();
const dirty = execFileSync("git", ["status", "--porcelain", "--", "src", "styles.css", "tokens.css", "assets", "build.mjs"], { cwd: ROOT })
  .toString()
  .trim();
if (dirty) {
  console.error("refusing: UI files are uncommitted, so the sha would name a tree these pixels are not from:\n" + dirty);
  process.exit(2);
}
for (const g of ids) {
  if (!existsSync(join(ROOT, "dist", g, "index.html"))) {
    console.error(`refusing: dist/${g}/ is not built — run npm run build:wasm && npm run build first`);
    process.exit(2);
  }
}

const server = spawn(process.execPath, [join(ROOT, "tools", "serve.mjs")], { env: { ...process.env, E2E_PORT: String(PORT) }, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 400));
mkdirSync(OUT, { recursive: true });

const manifestPath = join(OUT, "manifest.json");
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : { files: [] };
manifest.baseline = `fun@${sha}`;
manifest.capturedAt = new Date().toLocaleDateString("sv-SE"); // local day, the shelf's "today"
manifest.population = "deep link, fixed seed (hermetic); the poster is the bare land in a fresh context";
const prefix = tag ? `${tag}.` : "";
const fileFor = (g, route, vp) => `${prefix}${g}.${route}.${vp}.png`;
const taken = new Set(ids.flatMap((g) => ROUTES[g].flatMap((r) => Object.keys(VIEWPORTS).map((vp) => fileFor(g, r.route, vp)))));
manifest.files = manifest.files.filter((f) => !taken.has(f.file));

const browser = await chromium.launch();
let count = 0;
try {
  for (const g of ids) {
    for (const [name, vp] of Object.entries(VIEWPORTS)) {
      const page = await browser.newPage({ viewport: vp, colorScheme: "dark" });
      for (const r of ROUTES[g]) {
        const ready = r.ready ?? ((p) => p.waitForFunction(() => Boolean(window.__colorSort), null, { timeout: 15000 }));
        await page.goto(`http://localhost:${PORT}${r.url}`);
        await ready(page);
        if (r.before) {
          await r.before(page);
          await page.reload();
          await ready(page);
        }
        if (r.after) await r.after(page);
        await page.waitForTimeout(r.settle ?? 500); // let the selection transition settle
        const file = fileFor(g, r.route, name);
        await page.screenshot({ path: join(OUT, file) });
        manifest.files.push({ file, game: g, route: r.route, url: r.url, viewport: name, ...vp, baseline: `fun@${sha}`, ...(tag ? { tag } : {}) });
        count += 1;
      }
      await page.close();
    }
  }
} finally {
  await browser.close();
  server.kill();
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`baseline fun@${sha} — ${count} snaps for ${ids.join(", ")} in ${OUT.replace(ROOT + "/", "")}/`);
