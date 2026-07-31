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
        h.game.newGame(BigInt(pack.payload.fixture.seed));
        for (const move of pack.payload.fixture.moves) h.game.play(move);
        h.refresh();
      });
      await page.waitForSelector(".sol-result");
    },
  },
  {
    name: "match3-board",
    clip: ".m3-board",
    async run(page) {
      await page.goto(`${origin}/match3/?seed=7`, { waitUntil: "networkidle" });
      await page.waitForSelector(".m3-board");
    },
  },
  {
    name: "match3-select",
    clip: ".m3-board",
    async run(page) {
      await page.goto(`${origin}/match3/?seed=7`, { waitUntil: "networkidle" });
      await page.waitForSelector(".m3-board");
      await page.waitForFunction(() => Boolean(window.__match3));
      const from = await page.evaluate(() => window.__match3.game.legalMoves()[0]);
      await page.click(`.m3-gem[data-r="${from[0]}"][data-c="${from[1]}"]`);
      await page.waitForSelector(".legal-target");
    },
  },
  {
    name: "match3-win",
    clip: ".sol-result",
    async run(page) {
      await page.goto(`${origin}/match3/?seed=7`, { waitUntil: "networkidle" });
      await page.waitForSelector(".m3-board");
      await page.waitForFunction(() => Boolean(window.__match3));
      await page.evaluate(() => {
        const h = window.__match3;
        for (let i = 0; i < 20; i += 1) {
          const m = h.game.legalMoves();
          if (m.length === 0) break;
          h.game.play(m[0]);
        }
        h.refresh();
      });
      await page.waitForSelector(".sol-result");
    },
  },
  {
    name: "bubble-board",
    clip: ".bub-game",
    async run(page) {
      await page.goto(`${origin}/bubble/?seed=7`, { waitUntil: "networkidle" });
      await page.waitForSelector(".bub-canvas");
      await page.waitForFunction(() => Boolean(window.__bubble));
      // Aim an angled shot so the dotted trajectory guide + landing ring show.
      await page.evaluate(() => window.__bubble.setAim(115));
      await page.waitForTimeout(120);
    },
  },
  {
    name: "bubble-win",
    clip: ".sol-result",
    async run(page) {
      await page.goto(`${origin}/bubble/`, { waitUntil: "networkidle" });
      await page.waitForSelector(".bub-canvas");
      await page.waitForFunction(() => Boolean(window.__bubble));
      const fixture = await (await fetch(`${origin}/bubble-daily-pack.json`)).json();
      await page.goto(`${origin}/bubble/?seed=${fixture.payload.fixture.seed}`, {
        waitUntil: "networkidle",
      });
      await page.waitForFunction(() => Boolean(window.__bubble));
      await page.evaluate((moves) => {
        const h = window.__bubble;
        for (const m of moves) h.game.shoot(m);
        h.refresh();
      }, fixture.payload.fixture.moves);
      await page.waitForSelector(".sol-result");
    },
  },
  {
    name: "wyrdle-board",
    clip: ".play-area",
    async run(page) {
      await page.goto(`${origin}/wyrdle/?seed=7`, { waitUntil: "networkidle" });
      await page.waitForSelector(".wy-grid");
      await page.waitForFunction(() => Boolean(window.__wyrdle));
      // Play one legal guess so the shot shows a scored row + coloured keys.
      await page.evaluate(() => window.__wyrdle.submitGuess("crane"));
      await page.waitForSelector(".wy-tile.wy-absent, .wy-tile.wy-present, .wy-tile.wy-correct");
    },
  },
  {
    name: "2048-board",
    clip: ".play-area",
    async run(page) {
      await page.goto(`${origin}/2048/?seed=7`, { waitUntil: "networkidle" });
      await page.waitForSelector(".t48-board");
      await page.waitForFunction(() => Boolean(window.__t2048));
      // Play a handful of hint moves so the shot shows a lived-in board.
      await page.evaluate(() => {
        for (let i = 0; i < 12; i += 1) {
          const d = window.__t2048.game.hint();
          if (!d) break;
          window.__t2048.playDir(d);
        }
      });
      await page.waitForSelector(".t48-tile.t48-mid, .t48-tile.t48-hi");
    },
  },
  {
    name: "2048-result",
    clip: ".sol-result",
    async run(page) {
      await page.goto(`${origin}/2048/?seed=7`, { waitUntil: "networkidle" });
      await page.waitForSelector(".t48-board");
      await page.waitForFunction(() => Boolean(window.__t2048));
      await page.evaluate(() => {
        for (let i = 0; i < 20; i += 1) {
          const d = window.__t2048.game.hint();
          if (!d) break;
          window.__t2048.playDir(d);
        }
      });
      // End the round to reach the verifiable result screen.
      await page.click(".sol-settings summary");
      await page.uncheck(".sol-set-hints");
      await page.click(".sol-stuck");
      await page.waitForSelector(".sol-result");
    },
  },
  {
    name: "wyrdle-win",
    clip: ".sol-result",
    async run(page) {
      await page.goto(`${origin}/wyrdle/`, { waitUntil: "networkidle" });
      await page.waitForSelector(".wy-grid");
      const fixture = await (await fetch(`${origin}/wyrdle-daily-pack.json`)).json();
      await page.goto(`${origin}/wyrdle/?seed=${fixture.payload.fixture.seed}`, {
        waitUntil: "networkidle",
      });
      await page.waitForFunction(() => Boolean(window.__wyrdle));
      await page.evaluate((moves) => {
        for (const m of moves) window.__wyrdle.submitGuess(m);
      }, fixture.payload.fixture.moves);
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
