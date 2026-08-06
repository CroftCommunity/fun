// Static build for fun.croft.ing (front-plan Phase 1): esbuild-bundle the
// vanilla-TS chrome into one app.js, then emit a per-game static entry page
// (`/<id>/index.html`) plus the home page (`/`). Per-game static pages give
// clean, shareable, new-tab-able URLs with no client router or Pages 404 hack.
// A second bundle (how-to.js) powers the shared "How to play" page (`/how-to/`).
import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, "dist");

// Game entry pages: "" is the home/drawer page (no game mounted); the rest carry
// <body data-game> so the chrome knows what to mount.
const GAME_PAGES = ["", "placeholder", "solitaire", "match3", "bubble", "wyrdle", "2048", "drop4", "othello", "checkers", "align", "blockdoku", "looseends", "color-sort", "astray", "hexgl", "clumsybird", "orchard-drop", "cribbage"];

// Tier-2 wrapped games: their vendored bundle ships under src/games/<id>/vendor/
// and is served at /<id>/vendor/ for the sandboxed iframe to load same-origin.
const TIER2_VENDORS = ["astray", "hexgl", "clumsybird", "orchard-drop"];

// Pre-paint theme resolution: set [data-theme] before first paint so the felt
// table never flashes the wrong theme. Same rule as src/theme.ts resolveTheme.
const THEME_INIT = `(function(){try{var s=localStorage.getItem('fun-theme');var d=(s==='light'||s==='dark')?s:(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.setAttribute('data-theme',d);}catch(e){}})();`;

function page({ title, dataAttr = "", base, script, appDiv = false }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <meta name="description" content="fun.croft.ing — the Croft games pond, a determinism-first local-first game shelf." />
    <meta name="theme-color" content="#1f5c3f" />
    <script>${THEME_INIT}</script>
    <link rel="stylesheet" href="${base}styles.css" />
  </head>
  <body${dataAttr}>
    ${appDiv ? '<div id="app"></div>\n    ' : ""}<script type="module" src="${base}${script}"></script>
  </body>
</html>
`;
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

await build({
  entryPoints: [join(root, "src/main.ts"), join(root, "src/how-to-page.ts")],
  bundle: true,
  format: "esm",
  target: "es2022",
  minify: true,
  sourcemap: true,
  outdir: dist,
  entryNames: "[name]",
});
// esbuild names outputs after their entry file; rename to the referenced names.
async function rename(from, to) {
  await cp(join(dist, from), join(dist, to));
  await rm(join(dist, from));
  if (await exists(join(dist, `${from}.map`))) {
    await cp(join(dist, `${from}.map`), join(dist, `${to}.map`));
    await rm(join(dist, `${from}.map`));
  }
}
await rename("main.js", "app.js");
await rename("how-to-page.js", "how-to.js");

// Embedded WebLLM runtime — a SEPARATE bundle at /vendor/webllm.js so the
// experimental local-AI opponent's library ships from our own origin (never a
// third-party CDN: offline-capable PWA + no CDN-served executable code).
// WebLLMRuntime dynamic-imports it by URL, lazily, only when the toggle fires —
// so it is NOT in app.js and non-AI games never load it.
await build({
  entryPoints: [join(root, "src/harness/webllm-vendor.ts")],
  bundle: true,
  format: "esm",
  target: "es2022",
  minify: true,
  sourcemap: false, // a third-party lib chunk — no need to ship its 6MB map
  platform: "browser",
  outfile: join(dist, "vendor", "webllm.js"),
});

// The browser AI-scoring harness (P6) — a SEPARATE bundle at /vendor/harness.js
// that the standalone trial driver (tools/harness-trial.mjs) imports into a real
// WebGPU page to measure the shipped hybrid vs the engine. Never in app.js.
await build({
  entryPoints: [join(root, "src/harness/harness-trial-entry.ts")],
  bundle: true,
  format: "esm",
  target: "es2022",
  minify: true,
  sourcemap: false,
  platform: "browser",
  outfile: join(dist, "vendor", "harness.js"),
});

// One stylesheet: tokens (the only hex) then components. The pre-paint script
// has already set [data-theme] by the time this loads.
const tokensCss = await readFile(join(root, "tokens.css"), "utf8");
const stylesCss = await readFile(join(root, "styles.css"), "utf8");
await writeFile(join(dist, "styles.css"), `${tokensCss}\n${stylesCss}`);
if (await exists(join(root, "CNAME"))) await cp(join(root, "CNAME"), join(dist, "CNAME"));

// The solitaire wasm binding (built by `npm run build:wasm` with the rustup
// toolchain — see tools/build-wasm.sh). Copied to /solitaire.wasm for fetch.
const wasm = join(root, "target/wasm32-unknown-unknown/release/solitaire_wasm.wasm");
if (await exists(wasm)) await cp(wasm, join(dist, "solitaire.wasm"));
else console.warn("note: solitaire.wasm not built yet — run `npm run build:wasm` (Phase D needs it)");

const m3wasm = join(root, "target/wasm32-unknown-unknown/release/match3_wasm.wasm");
if (await exists(m3wasm)) await cp(m3wasm, join(dist, "match3.wasm"));
else console.warn("note: match3.wasm not built yet — run `npm run build:wasm` (match-3 needs it)");

const bwasm = join(root, "target/wasm32-unknown-unknown/release/bubble_wasm.wasm");
if (await exists(bwasm)) await cp(bwasm, join(dist, "bubble.wasm"));
else console.warn("note: bubble.wasm not built yet — run `npm run build:wasm` (bubble needs it)");

const wywasm = join(root, "target/wasm32-unknown-unknown/release/wyrdle_wasm.wasm");
if (await exists(wywasm)) await cp(wywasm, join(dist, "wyrdle.wasm"));
else console.warn("note: wyrdle.wasm not built yet — run `npm run build:wasm` (wyrdle needs it)");

const t48wasm = join(root, "target/wasm32-unknown-unknown/release/twenty48_wasm.wasm");
if (await exists(t48wasm)) await cp(t48wasm, join(dist, "2048.wasm"));
else console.warn("note: 2048.wasm not built yet — run `npm run build:wasm` (2048 needs it)");

const d4wasm = join(root, "target/wasm32-unknown-unknown/release/drop4_wasm.wasm");
if (await exists(d4wasm)) await cp(d4wasm, join(dist, "drop4.wasm"));
else console.warn("note: drop4.wasm not built yet — run `npm run build:wasm` (drop4 needs it)");

const owasm = join(root, "target/wasm32-unknown-unknown/release/othello_wasm.wasm");
if (await exists(owasm)) await cp(owasm, join(dist, "othello.wasm"));
else console.warn("note: othello.wasm not built yet — run `npm run build:wasm` (othello needs it)");

const ckwasm = join(root, "target/wasm32-unknown-unknown/release/checkers_wasm.wasm");
if (await exists(ckwasm)) await cp(ckwasm, join(dist, "checkers.wasm"));
else console.warn("note: checkers.wasm not built yet — run `npm run build:wasm` (checkers needs it)");

const alwasm = join(root, "target/wasm32-unknown-unknown/release/align_wasm.wasm");
if (await exists(alwasm)) await cp(alwasm, join(dist, "align.wasm"));
else console.warn("note: align.wasm not built yet — run `npm run build:wasm` (align needs it)");

const bdwasm = join(root, "target/wasm32-unknown-unknown/release/blockdoku_wasm.wasm");
if (await exists(bdwasm)) await cp(bdwasm, join(dist, "blockdoku.wasm"));
else console.warn("note: blockdoku.wasm not built yet — run `npm run build:wasm` (blockdoku needs it)");

const lewasm = join(root, "target/wasm32-unknown-unknown/release/looseends_wasm.wasm");
if (await exists(lewasm)) await cp(lewasm, join(dist, "looseends.wasm"));
else console.warn("note: looseends.wasm not built yet — run `npm run build:wasm` (loose ends needs it)");

const cswasm = join(root, "target/wasm32-unknown-unknown/release/color_sort_wasm.wasm");
if (await exists(cswasm)) await cp(cswasm, join(dist, "color-sort.wasm"));
else console.warn("note: color-sort.wasm not built yet — run `npm run build:wasm` (color-sort needs it)");

// The winnable-daily pack (Phase S) — served static so the daily mode and the
// E2E win-path fixture can fetch it. `payload[0]` is the win-path fixture.
const pack = join(root, "games/solitaire/daily-pack.json");
if (await exists(pack)) await cp(pack, join(dist, "daily-pack.json"));
else console.warn("note: daily-pack.json missing — solitaire's daily mode needs it (Phase S)");

// The match-3 clear-the-blockers winnable-daily pack (served static so the
// blockers daily mode and its E2E win-path fixture can fetch it).
const m3pack = join(root, "games/match3/blockers-pack.json");
if (await exists(m3pack)) await cp(m3pack, join(dist, "match3-blockers-pack.json"));
else console.warn("note: match3-blockers-pack.json missing — match-3's clear-the-blockers daily needs it");

const m3jpack = join(root, "games/match3/jelly-pack.json");
if (await exists(m3jpack)) await cp(m3jpack, join(dist, "match3-jelly-pack.json"));
else console.warn("note: match3-jelly-pack.json missing — match-3's clear-the-jelly daily needs it");

const m3ipack = join(root, "games/match3/ingredients-pack.json");
if (await exists(m3ipack)) await cp(m3ipack, join(dist, "match3-ingredients-pack.json"));
else console.warn("note: match3-ingredients-pack.json missing — match-3's ingredients daily needs it");

const m3cpack = join(root, "games/match3/checklist-pack.json");
if (await exists(m3cpack)) await cp(m3cpack, join(dist, "match3-checklist-pack.json"));
else console.warn("note: match3-checklist-pack.json missing — match-3's checklist (orders) daily needs it");

const m3opack = join(root, "games/match3/obstacles-pack.json");
if (await exists(m3opack)) await cp(m3opack, join(dist, "match3-obstacles-pack.json"));
else console.warn("note: match3-obstacles-pack.json missing — match-3's clear-the-obstacles daily needs it");

// The match-3 campaign ladder (curated levels over verifiable seeds) — served
// static so the campaign mode and its E2E can fetch it.
const m3campaign = join(root, "games/match3/campaign-pack.json");
if (await exists(m3campaign)) await cp(m3campaign, join(dist, "match3-campaign-pack.json"));
else console.warn("note: match3-campaign-pack.json missing — match-3's campaign needs it");

// The bubble-shooter clear-the-board winnable-daily pack (served static so the
// daily mode and its E2E win-path fixture can fetch it).
const bpack = join(root, "games/bubble/daily-pack.json");
if (await exists(bpack)) await cp(bpack, join(dist, "bubble-daily-pack.json"));
else console.warn("note: bubble-daily-pack.json missing — bubble's daily mode needs it (B4)");

// The Wyrdle answer daily-pack (served static so the daily mode and the E2E
// win-path fixture can fetch it). `payload.fixture` is the win-path fixture.
const wypack = join(root, "games/wyrdle/daily-pack.json");
if (await exists(wypack)) await cp(wypack, join(dist, "wyrdle-daily-pack.json"));
else console.warn("note: wyrdle-daily-pack.json missing — wyrdle's daily mode needs it (W3)");

const t48pack = join(root, "games/2048/daily-pack.json");
if (await exists(t48pack)) await cp(t48pack, join(dist, "2048-daily-pack.json"));
else console.warn("note: 2048-daily-pack.json missing — 2048's daily mode needs it (T3)");

const bdpack = join(root, "games/blockdoku/daily-pack.json");
if (await exists(bdpack)) await cp(bdpack, join(dist, "blockdoku-daily-pack.json"));
else console.warn("note: blockdoku-daily-pack.json missing — blockdoku's daily mode needs it (B9)");

// Static assets: how-to screenshots (regenerated by `npm run guide:shots`) and
// the self-hosted display font.
const assets = join(root, "assets");
if (await exists(assets)) await cp(assets, join(dist, "assets"), { recursive: true });

// Tier-2 vendored bundles: copy src/games/<id>/vendor -> dist/<id>/vendor so the
// wrapped game's sandboxed iframe loads it same-origin (no runtime third-party
// fetch — every asset is ours, served from our origin).
for (const id of TIER2_VENDORS) {
  const vendor = join(root, "src", "games", id, "vendor");
  if (await exists(vendor)) {
    await mkdir(join(dist, id), { recursive: true });
    await cp(vendor, join(dist, id, "vendor"), { recursive: true });
  } else {
    console.warn(`note: ${id} vendor dir missing (src/games/${id}/vendor) — Tier-2 wrap needs it`);
  }
}

for (const id of GAME_PAGES) {
  const dir = id ? join(dist, id) : dist;
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "index.html"),
    page({
      title: id ? `Croft · fun — ${id}` : "Croft · fun",
      dataAttr: id ? ` data-game="${id}"` : "",
      base: id ? "/" : "./",
      script: "app.js",
    }),
  );
}

// The shared "How to play" page (reads ?game=<id>).
await mkdir(join(dist, "how-to"), { recursive: true });
await writeFile(
  join(dist, "how-to", "index.html"),
  page({ title: "Croft · fun — how to play", base: "/", script: "how-to.js", appDiv: true }),
);

console.log(`built app.js + how-to.js + ${GAME_PAGES.length + 1} pages -> dist/`);

async function exists(p) {
  const { access } = await import("node:fs/promises");
  return access(p).then(() => true).catch(() => false);
}
