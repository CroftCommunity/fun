// Regenerate the "How to play" screenshots from the *built* app, so a guide can
// never show a UI that no longer exists. Rerun after any visual change:
//
//   npm run build:wasm && npm run build && npm run guide:shots
//
// It serves dist/ with the repo's own static server, drives real Chrome, and
// writes assets/guide/<name>.jpg. Guides reference these by name; a unit test
// fails if a referenced shot is missing, and an e2e test fails if one 404s.
import { existsSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, "dist");
const outDir = join(root, "assets", "guide");
const PORT = 4180;
const origin = `http://localhost:${PORT}`;

if (!existsSync(join(dist, "index.html"))) {
  console.error("guide-shots: dist/ not found — run `npm run build:wasm && npm run build` first.");
  process.exit(1);
}
if (!existsSync(join(dist, "solitaire.wasm"))) {
  console.error("guide-shots: dist/solitaire.wasm missing — run `npm run build:wasm` first.");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

// Each shot drives the built game into the state the guide describes, then
// captures it. `clip` element-crops the shot so the highlight reads clearly;
// omit it for a full-page capture. Keep names in sync with the guides' `shot`s.
const SHOTS = [
  {
    name: "solitaire-board",
    clip: ".sol-board",
    async run(page) {
      await page.goto(`${origin}/solitaire/?seed=0`, { waitUntil: "networkidle" });
      await page.waitForSelector(".sol-board");
    },
  },
  {
    name: "solitaire-select",
    clip: ".sol-top",
    async run(page) {
      await page.goto(`${origin}/solitaire/?seed=0`, { waitUntil: "networkidle" });
      await page.waitForSelector(".sol-board");
      await page.click(".sol-stock"); // draw so the waste has a playable card (the Ace)
      await page.click('[data-el="waste"]'); // select it -> its legal foundation glows gold
      await page.waitForSelector(".legal-target");
    },
  },
  {
    name: "solitaire-hint",
    clip: ".sol-top",
    async run(page) {
      await page.goto(`${origin}/solitaire/?seed=0`, { waitUntil: "networkidle" });
      await page.waitForSelector(".sol-board");
      await page.click(".sol-stock"); // draw first, so the hint is a real move (Ace -> foundation)
      await page.click(".sol-hint");
      await page.waitForSelector(".hint-to");
    },
  },
  {
    name: "solitaire-win",
    clip: ".sol-result",
    async run(page) {
      await page.goto(`${origin}/solitaire/?seed=0`, { waitUntil: "networkidle" });
      await page.waitForSelector(".sol-board");
      await page.waitForFunction(() => Boolean(window.__solitaire));
      await page.evaluate(async () => {
        const pack = await (await fetch("/daily-pack.json")).json();
        const h = window.__solitaire;
        for (const move of pack.payload[0].moves) h.game.play(move);
        h.refresh();
      });
      await page.waitForSelector(".sol-result");
    },
  },
];

const server = spawn("node", [join(root, "tools", "serve.mjs")], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 700)); // let the server bind (fixed wait)

const browser = await chromium.launch();
try {
  for (const shot of SHOTS) {
    const context = await browser.newContext({
      viewport: { width: 900, height: 820 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    await shot.run(page);
    const target = shot.clip ? page.locator(shot.clip) : page;
    await target.screenshot({
      path: join(outDir, `${shot.name}.jpg`),
      type: "jpeg",
      quality: 82,
      ...(shot.clip ? {} : { fullPage: true }),
    });
    await context.close();
    console.log(`guide-shots: wrote assets/guide/${shot.name}.jpg`);
  }
} finally {
  await browser.close();
  server.kill();
}
