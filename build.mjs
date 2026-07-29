// Static build for fun.croft.ing (front-plan Phase 1): esbuild-bundle the
// vanilla-TS chrome into one app.js, then emit a per-game static entry page
// (`/<id>/index.html`) plus the home page (`/`). Per-game static pages give
// clean, shareable, new-tab-able URLs with no client router or Pages 404 hack.
import { build } from "esbuild";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, "dist");

// Pages: "" is the home/drawer page (no game mounted). The rest are per-game
// entry pages whose <body data-game> tells the chrome what to mount.
const PAGES = ["", "placeholder", "solitaire", "match3"];

function page(gameId) {
  const dataAttr = gameId ? ` data-game="${gameId}"` : "";
  const title = gameId ? `Croft · fun — ${gameId}` : "Croft · fun";
  const base = gameId ? "/" : "./"; // per-game pages live one dir deep
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <meta name="description" content="fun.croft.ing — the Croft games pond, a determinism-first local-first game shelf." />
    <link rel="stylesheet" href="${base}styles.css" />
  </head>
  <body${dataAttr}>
    <script type="module" src="${base}app.js"></script>
  </body>
</html>
`;
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

await build({
  entryPoints: [join(root, "src/main.ts")],
  bundle: true,
  format: "esm",
  target: "es2022",
  minify: true,
  sourcemap: true,
  outfile: join(dist, "app.js"),
});

await cp(join(root, "styles.css"), join(dist, "styles.css"));
if (await exists(join(root, "CNAME"))) await cp(join(root, "CNAME"), join(dist, "CNAME"));

// The solitaire wasm binding (built by `npm run build:wasm` with the rustup
// toolchain — see tools/build-wasm.sh). Copied to /solitaire.wasm for fetch.
const wasm = join(root, "target/wasm32-unknown-unknown/release/solitaire_wasm.wasm");
if (await exists(wasm)) await cp(wasm, join(dist, "solitaire.wasm"));
else console.warn("note: solitaire.wasm not built yet — run `npm run build:wasm` (Phase D needs it)");

// The winnable-daily pack (Phase S) — served static so the daily mode and the
// E2E win-path fixture can fetch it. `payload[0]` is the win-path fixture.
const pack = join(root, "games/solitaire/daily-pack.json");
if (await exists(pack)) await cp(pack, join(dist, "daily-pack.json"));
else console.warn("note: daily-pack.json missing — solitaire's daily mode needs it (Phase S)");

for (const id of PAGES) {
  const dir = id ? join(dist, id) : dist;
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "index.html"), page(id));
}

console.log(`built app.js + ${PAGES.length} pages -> dist/`);

async function exists(p) {
  const { access } = await import("node:fs/promises");
  return access(p).then(() => true).catch(() => false);
}
