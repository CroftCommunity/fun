// Minimal static build for the fun.croft.ing skeleton (master-plan Phase 1).
//
// Copies the static entry files into dist/. This is the honest minimal build:
// it produces a deployable static site with zero dependencies, so `npm run
// build` exits 0 before the toolchain is installed. The front-end plan
// (2026-07-28-games-drawer-solitaire-ui.md) Phase 1 replaces this with an
// esbuild pipeline (TS bundling, per-game entry pages, service worker) — same
// build.mjs entry point, real bundler.
import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, "dist");
const staticFiles = ["index.html", "styles.css"];

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
for (const file of staticFiles) {
  await cp(join(root, file), join(dist, file));
}
console.log(`built ${staticFiles.length} files -> dist/`);
