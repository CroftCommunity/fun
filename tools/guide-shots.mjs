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
// E2E_PORT, as tools/serve.mjs: two sessions on one machine need two ports.
const PORT = Number(process.env.E2E_PORT ?? 4180);
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
      await page.click('.gf-verb[data-verb="hint"]');
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
    name: "trio-tumble-board",
    clip: ".m3-board",
    async run(page) {
      await page.goto(`${origin}/trio-tumble/?seed=7`, { waitUntil: "networkidle" });
      await page.waitForSelector(".m3-board");
    },
  },
  {
    name: "trio-tumble-select",
    clip: ".m3-board",
    async run(page) {
      await page.goto(`${origin}/trio-tumble/?seed=7`, { waitUntil: "networkidle" });
      await page.waitForSelector(".m3-board");
      await page.waitForFunction(() => Boolean(window.__trioTumble));
      const from = await page.evaluate(() => window.__trioTumble.game.legalMoves()[0]);
      await page.click(`.m3-gem[data-r="${from[0]}"][data-c="${from[1]}"]`);
      await page.waitForSelector(".legal-target");
    },
  },
  {
    name: "trio-tumble-win",
    clip: ".sol-result",
    async run(page) {
      await page.goto(`${origin}/trio-tumble/?seed=7`, { waitUntil: "networkidle" });
      await page.waitForSelector(".m3-board");
      await page.waitForFunction(() => Boolean(window.__trioTumble));
      await page.evaluate(() => {
        const h = window.__trioTumble;
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
      // Levels is the default: the level and score on the frame's meters, the HUD
      // (score->target progress and the "stack drops in" readout) plus the aim guide.
      await page.goto(`${origin}/bubble/?seed=7`, { waitUntil: "networkidle" });
      await page.waitForSelector(".bub-canvas");
      await page.waitForFunction(() => Boolean(window.__bubble));
      await page.waitForSelector(".bub-progress");
      // Aim an angled shot so the dotted trajectory guide + landing ring show.
      await page.evaluate(() => window.__bubble.setAim(115));
      await page.waitForTimeout(120);
    },
  },
  {
    name: "bubble-win",
    clip: ".sol-result",
    async run(page) {
      // Drive the levels run until the descending stack crosses the deadline, so
      // the shot shows the verifiable "reached level N" result.
      await page.goto(`${origin}/bubble/?seed=7`, { waitUntil: "networkidle" });
      await page.waitForSelector(".bub-canvas");
      await page.waitForFunction(() => Boolean(window.__bubble));
      await page.evaluate(() => {
        const g = window.__bubble.game;
        for (let i = 0; i < 500 && !g.levelIsLost(); i += 1) g.levelShoot(10 + ((i * 23) % 161));
        window.__bubble.refresh();
      });
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
      // End the round to reach the verifiable result screen: with hints off the
      // dock's verb is "I'm done".
      await page.evaluate(() => localStorage.setItem("fun-hints", "off"));
      await page.reload({ waitUntil: "networkidle" });
      await page.waitForFunction(() => Boolean(window.__t2048));
      await page.evaluate(() => {
        for (let i = 0; i < 20; i += 1) {
          const d = window.__t2048.game.hint();
          if (!d) break;
          window.__t2048.playDir(d);
        }
      });
      await page.click('.gf-verb[data-verb="done"]');
      await page.waitForSelector(".sol-result");
    },
  },
  {
    name: "drop4-board",
    clip: ".drop4-game",
    async run(page) {
      await page.goto(`${origin}/drop4/?seed=7`, { waitUntil: "networkidle" });
      await page.waitForSelector(".drop4-board");
      await page.waitForFunction(() => Boolean(window.__drop4));
      // Populate a lived-in mid-game board (both sides' discs) for the shot,
      // including the turn bar + drop-arrow headers.
      await page.evaluate(() => {
        const h = window.__drop4;
        for (const c of [3, 2, 4, 1, 3, 5]) h.game.play(c);
        h.refresh();
      });
      await page.waitForSelector(".drop4-cell.x");
    },
  },
  {
    name: "drop4-result",
    clip: ".sol-result",
    async run(page) {
      await page.goto(`${origin}/drop4/?seed=7`, { waitUntil: "networkidle" });
      await page.waitForSelector(".drop4-board");
      await page.waitForFunction(() => Boolean(window.__drop4));
      // Build a real ✕-vertical-win record, then open its self-verifying ?r=
      // link so the result screen shows the final board with the winning four
      // highlighted (deterministic; also exercises the shared-result path).
      const share = await page.evaluate(async () => {
        const h = window.__drop4;
        for (const c of [0, 1, 0, 1, 0, 1, 0]) h.game.play(c); // ✕ wins col 1
        const env = h.game.outcome(false);
        const json = new TextEncoder().encode(JSON.stringify(env));
        const cs = new CompressionStream("deflate-raw");
        const w = cs.writable.getWriter();
        void w.write(json);
        void w.close();
        const buf = new Uint8Array(await new Response(cs.readable).arrayBuffer());
        let bin = "";
        for (const b of buf) bin += String.fromCharCode(b);
        return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      });
      await page.goto(`${origin}/drop4/?r=${share}`, { waitUntil: "networkidle" });
      await page.waitForSelector(".sol-result .drop4-cell.win");
    },
  },
  {
    name: "drop4-tutor",
    clip: ".drop4-game",
    async run(page) {
      // The tutor is opt-in (off by default) — enable its setting for the shot.
      await page.addInitScript(() => localStorage.setItem("fun-drop4-tutor", "on"));
      await page.goto(`${origin}/drop4/?seed=7`, { waitUntil: "networkidle" });
      await page.waitForSelector(".drop4-board");
      await page.waitForFunction(() => Boolean(window.__drop4));
      // A lived-in mid-game board with the human to move, then reveal the tutor's
      // engine-grounded "Explain my options" list so the coaching panel reads.
      await page.evaluate(() => {
        const h = window.__drop4;
        for (const c of [3, 2, 4, 3]) h.game.play(c);
        h.refresh();
      });
      await page.click(".drop4-tutor-explain");
      await page.waitForSelector(".drop4-tutor-options li");
    },
  },
  {
    name: "othello-board",
    clip: ".othello-game",
    async run(page) {
      await page.goto(`${origin}/othello/?seed=7`, { waitUntil: "networkidle" });
      await page.waitForSelector(".othello-board");
      await page.waitForFunction(() => Boolean(window.__othello));
      // A lived-in mid-game board (both sides' discs), human to move so the gold
      // legal-move dots show.
      await page.evaluate(() => {
        const h = window.__othello;
        for (const idx of [19, 18, 20, 21]) {
          const b = h.game.board();
          if (b.result !== -1) break;
          if (b.legal.includes(idx)) h.game.play(idx);
          else if (b.legal.length) h.game.play(b.legal[0]);
        }
        h.refresh();
      });
      await page.waitForSelector(".othello-cell.white .othello-disc");
    },
  },
  {
    name: "othello-tutor",
    clip: ".othello-game",
    async run(page) {
      await page.addInitScript(() => localStorage.setItem("fun-othello-tutor", "on"));
      await page.goto(`${origin}/othello/?seed=7`, { waitUntil: "networkidle" });
      await page.waitForSelector(".othello-board");
      await page.waitForFunction(() => Boolean(window.__othello));
      await page.evaluate(() => {
        const h = window.__othello;
        // An even number of first-legal plies returns to Black (the human) to
        // move, mid-game, so "Explain my options" has options to list.
        for (let i = 0; i < 4; i += 1) {
          const b = h.game.board();
          if (b.result !== -1) break;
          if (b.legal.length === 0) h.game.pass();
          else h.game.play(b.legal[0]);
        }
        h.refresh();
      });
      await page.click(".othello-tutor-explain");
      await page.waitForSelector(".othello-tutor-options li");
    },
  },
  {
    name: "othello-result",
    clip: ".sol-result",
    async run(page) {
      await page.goto(`${origin}/othello/?seed=7`, { waitUntil: "networkidle" });
      await page.waitForSelector(".othello-board");
      await page.waitForFunction(() => Boolean(window.__othello));
      // Play a full first-legal game (passes included) to a terminal, then open
      // its self-verifying ?r= link so the result screen shows the final board.
      const share = await page.evaluate(async () => {
        const h = window.__othello;
        for (let i = 0; i < 200; i += 1) {
          const b = h.game.board();
          if (b.result !== -1) break;
          if (b.legal.length === 0) h.game.pass();
          else h.game.play(b.legal[0]);
        }
        const env = h.game.outcome(false);
        const json = new TextEncoder().encode(JSON.stringify(env));
        const cs = new CompressionStream("deflate-raw");
        const w = cs.writable.getWriter();
        void w.write(json);
        void w.close();
        const buf = new Uint8Array(await new Response(cs.readable).arrayBuffer());
        let bin = "";
        for (const b2 of buf) bin += String.fromCharCode(b2);
        return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      });
      await page.goto(`${origin}/othello/?r=${share}`, { waitUntil: "networkidle" });
      await page.waitForSelector(".sol-result .othello-board.othello-final");
    },
  },
  {
    name: "checkers-board",
    clip: ".checkers-game",
    async run(page) {
      await page.goto(`${origin}/checkers/?seed=7`, { waitUntil: "networkidle" });
      await page.waitForSelector(".checkers-board");
      await page.waitForFunction(() => Boolean(window.__checkers));
      // The opening, with a man picked up so the gold destination dots show —
      // deliberately a QUIET move, since capture is mandatory and a mid-game
      // position would show the jump instead (that is `checkers-capture`'s job).
      // Pick the man with two destinations so "dots" is literally true.
      const from = await page.evaluate(() => {
        const legal = window.__checkers.game.board().legal;
        const counts = new Map();
        for (const m of legal) counts.set(m.from, (counts.get(m.from) ?? 0) + 1);
        return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
      });
      await page.click(`.checkers-square[data-sq="${from}"]`);
      await page.waitForSelector(".checkers-square.target");
    },
  },
  {
    name: "checkers-capture",
    clip: ".checkers-game",
    async run(page) {
      await page.goto(`${origin}/checkers/?seed=3`, { waitUntil: "networkidle" });
      await page.waitForSelector(".checkers-board");
      await page.waitForFunction(() => Boolean(window.__checkers));
      // Play first-legal plies until the side to move has a jump — capture is
      // mandatory, so at that point the offered moves ARE the jumps.
      const from = await page.evaluate(() => {
        const h = window.__checkers;
        for (let i = 0; i < 80; i += 1) {
          const b = h.game.board();
          if (b.result !== -1 || b.legal.length === 0) break;
          const jump = b.legal.find((m) => m.captures.length > 0);
          // Stop on the human's (Side A's) jump, so the board is in the state the
          // caption describes rather than mid-engine-turn.
          if (jump && b.toMove === 1) { h.refresh(); return jump.from; }
          h.game.play(b.legal[0].code);
        }
        h.refresh();
        return null;
      });
      if (from === null) throw new Error("guide-shots: no Side-A jump found for checkers-capture");
      await page.click(`.checkers-square[data-sq="${from}"]`);
      await page.waitForSelector(".checkers-square.target");
    },
  },
  {
    name: "checkers-tutor",
    clip: ".checkers-game",
    async run(page) {
      await page.addInitScript(() => localStorage.setItem("fun-checkers-tutor", "on"));
      await page.goto(`${origin}/checkers/?seed=7`, { waitUntil: "networkidle" });
      await page.waitForSelector(".checkers-board");
      await page.waitForFunction(() => Boolean(window.__checkers));
      await page.evaluate(() => {
        const h = window.__checkers;
        // An even number of plies returns Black (the human) to move, mid-game,
        // so "Explain my options" has options to list.
        for (let i = 0; i < 6; i += 1) {
          const b = h.game.board();
          if (b.result !== -1 || b.legal.length === 0) break;
          h.game.play(b.legal[0].code);
        }
        h.refresh();
      });
      await page.click(".checkers-tutor-explain");
      await page.waitForSelector(".checkers-tutor-options li");
    },
  },
  {
    name: "checkers-result",
    clip: ".sol-result",
    async run(page) {
      await page.goto(`${origin}/checkers/?seed=7`, { waitUntil: "networkidle" });
      await page.waitForSelector(".checkers-board");
      await page.waitForFunction(() => Boolean(window.__checkers));
      // Play a full first-legal game to a terminal, then open its self-verifying
      // ?r= link so the result screen shows the final board.
      const share = await page.evaluate(async () => {
        const h = window.__checkers;
        for (let i = 0; i < 400; i += 1) {
          const b = h.game.board();
          if (b.result !== -1 || b.legal.length === 0) break;
          h.game.play(b.legal[0].code);
        }
        const env = h.game.outcome(false);
        const json = new TextEncoder().encode(JSON.stringify(env));
        const cs = new CompressionStream("deflate-raw");
        const w = cs.writable.getWriter();
        void w.write(json);
        void w.close();
        const buf = new Uint8Array(await new Response(cs.readable).arrayBuffer());
        let bin = "";
        for (const b2 of buf) bin += String.fromCharCode(b2);
        return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      });
      await page.goto(`${origin}/checkers/?r=${share}`, { waitUntil: "networkidle" });
      await page.waitForSelector(".sol-result .checkers-board.checkers-final");
    },
  },
  {
    name: "furrow-board",
    clip: ".furrow-game",
    async run(page) {
      await page.goto(`${origin}/furrow/?seed=7`, { waitUntil: "networkidle" });
      await page.waitForSelector(".furrow-board");
      await page.waitForFunction(() => Boolean(window.__furrow));
      // The human opens, so the board is the untouched position -- which is what
      // the caption claims. Wait only for the tappable rings to be painted.
      await page.waitForSelector(".furrow-pit.mine.legal");
    },
  },
  {
    name: "furrow-again",
    clip: ".furrow-game",
    async run(page) {
      await page.goto(`${origin}/furrow/?seed=7`, { waitUntil: "networkidle" });
      await page.waitForSelector(".furrow-board");
      await page.waitForFunction(() => Boolean(window.__furrow));
      await page.waitForSelector(".furrow-pit.mine.legal");
      // Pit 2 is four cells from the store and holds four seeds, so it is the
      // classic opening -- the one the caption is about. Take it through the UI
      // so the "go again" line is on screen for real.
      await page.click('.furrow-pit[data-pit="2"]');
      await page.waitForFunction(() => {
        const h = window.__furrow;
        return !h.busy() && h.game.board().keptTurn;
      });
    },
  },
  {
    name: "furrow-tutor",
    clip: ".furrow-game",
    async run(page) {
      await page.addInitScript(() => localStorage.setItem("fun-furrow-tutor", "on"));
      await page.goto(`${origin}/furrow/?seed=7`, { waitUntil: "networkidle" });
      await page.waitForSelector(".furrow-board");
      await page.waitForFunction(() => Boolean(window.__furrow));
      await page.waitForSelector(".furrow-pit.mine.legal");
      // Play a few real turns first. From the untouched opening the options are
      // nearly interchangeable, and a shot illustrating "the engine's reason for
      // each" must not show six lines that say the same thing -- the defect
      // dots' first tutor shot had.
      for (let i = 0; i < 3; i += 1) {
        await page.waitForFunction(() => {
          const h = window.__furrow;
          const b = h.game.board();
          return !h.busy() && (b.result !== -1 || (b.toMove === 1 && b.legal.length > 0));
        });
        // `result === -1` means the game is still running -- the inverted form of
        // this check made the loop click only once the game was over, so the shot
        // was the untouched opening with two interchangeable options in it.
        if (await page.evaluate(() => window.__furrow.game.board().result === -1)) {
          await page.click(".furrow-pit.mine.legal");
        }
      }
      await page.waitForFunction(() => {
        const h = window.__furrow;
        const b = h.game.board();
        return !h.busy() && b.result === -1 && b.toMove === 1 && b.legal.length > 0;
      });
      await page.click(".furrow-tutor-explain");
      await page.waitForSelector(".furrow-tutor-options li");
      // And the shot is only worth taking if the lines differ, which is the whole
      // point of the section it illustrates.
      const seen = await page.evaluate(() => {
        const items = [...document.querySelectorAll(".furrow-tutor-options li")];
        return { total: items.length, distinct: new Set(items.map((li) => li.textContent)).size };
      });
      // The section this illustrates is about the engine giving a *reason per
      // move*. A shot with one line, or with several identical ones, is truthful
      // and proves nothing -- the defect dots' first tutor shot had.
      if (seen.total < 3 || seen.distinct < 3) {
        throw new Error(
          `guide-shots: furrow-tutor needs 3+ distinct options, got ${seen.distinct} of ${seen.total}`,
        );
      }
    },
  },
  {
    name: "furrow-result",
    clip: ".sol-result",
    async run(page) {
      await page.goto(`${origin}/furrow/?seed=7`, { waitUntil: "networkidle" });
      await page.waitForSelector(".furrow-board");
      await page.waitForFunction(() => Boolean(window.__furrow));
      // Play the game out through the UI so the record is a real one -- and play
      // it competently, by tapping the pit the coach rates best each turn.
      // Always tapping the lowest legal pit is also a real game, but it loses
      // 35-13, and a guide whose closing image is a rout teaches the wrong thing
      // about the game rather than about the record. Reading `coach()` through
      // the test hook does not mark assistance, so the record still claims what
      // it should.
      for (let turn = 0; turn < 120; turn += 1) {
        await page.waitForFunction(() => {
          const h = window.__furrow;
          const b = h.game.board();
          return !h.busy() && (b.result !== -1 || (b.toMove === 1 && b.legal.length > 0));
        });
        if (await page.evaluate(() => window.__furrow.game.board().result !== -1)) break;
        const pit = await page.evaluate(() => {
          const h = window.__furrow;
          const best = h.game.coach().bestCol;
          return best !== null && h.game.board().legal.includes(best)
            ? best
            : h.game.board().legal[0];
        });
        await page.click(`.furrow-pit[data-pit="${pit}"]`);
      }
      await page.waitForSelector(".sol-result .sol-verify-badge.ok", { timeout: 60000 });
    },
  },
  {
    name: "dots-board",
    clip: ".dots-game",
    async run(page) {
      await page.goto(`${origin}/dots/?seed=7`, { waitUntil: "networkidle" });
      await page.waitForSelector(".dots-board");
      await page.waitForFunction(() => Boolean(window.__dots));
      // The human takes the second seat by default, so wait for the engine's
      // opening line to land before shooting -- an empty lattice would not show
      // what a drawn edge looks like.
      await page.waitForSelector(".dots-edge.just-drawn");
    },
  },
  {
    name: "dots-capture",
    clip: ".dots-game",
    async run(page) {
      await page.goto(`${origin}/dots/?seed=7`, { waitUntil: "networkidle" });
      await page.waitForSelector(".dots-board");
      await page.waitForFunction(() => Boolean(window.__dots));
      await page.waitForSelector(".dots-edge.just-drawn");
      // Drive the core to a position where the human (side 2) can close a box,
      // then take it through the UI so the "you go again" message is on screen.
      const edge = await page.evaluate(() => {
        const h = window.__dots;
        for (let i = 0; i < 24; i += 1) {
          const b = h.game.board();
          if (b.result !== -1) break;
          const closer = b.legal.find((e) => h.game.closesCount(e) > 0);
          if (closer !== undefined && b.toMove === 2) { h.refresh(); return closer; }
          const quiet = b.legal.find((e) => h.game.closesCount(e) === 0) ?? b.legal[0];
          if (quiet === undefined) break;
          h.game.play(quiet);
        }
        h.refresh();
        return null;
      });
      if (edge === null) throw new Error("guide-shots: no closing edge found for dots-capture");
      await page.click(`.dots-edge[data-edge="${edge}"]`);
      await page.waitForSelector(".dots-box.b");
    },
  },
  {
    name: "dots-tutor",
    clip: ".dots-game",
    async run(page) {
      await page.addInitScript(() => localStorage.setItem("fun-dots-tutor", "on"));
      await page.goto(`${origin}/dots/?seed=7`, { waitUntil: "networkidle" });
      await page.waitForSelector(".dots-board");
      await page.waitForFunction(() => Boolean(window.__dots));
      await page.waitForSelector(".dots-edge.just-drawn");
      // Deep enough that the safe lines are running out, so the options list
      // shows the distinction the guide is about -- safe versus handing a box
      // over -- rather than a column of identical "safe" lines. Then leave the
      // human (side 2) to move, or "Explain my options" has nothing to explain.
      await page.evaluate(() => {
        const h = window.__dots;
        for (let i = 0; i < 7; i += 1) {
          const b = h.game.board();
          if (b.result !== -1) break;
          const quiet = b.legal.find((e) => h.game.closesCount(e) === 0) ?? b.legal[0];
          if (quiet === undefined) break;
          h.game.play(quiet);
        }
        for (let i = 0; i < 4; i += 1) {
          const b = h.game.board();
          if (b.result !== -1 || b.toMove === 2 || b.legal[0] === undefined) break;
          h.game.play(b.legal[0]);
        }
        h.refresh();
      });
      await page.click(".dots-tutor-explain");
      await page.waitForSelector(".dots-tutor-options li");
    },
  },
  {
    name: "dots-result",
    clip: ".sol-result",
    async run(page) {
      await page.goto(`${origin}/dots/?seed=7`, { waitUntil: "networkidle" });
      await page.waitForSelector(".dots-board");
      await page.waitForFunction(() => Boolean(window.__dots));
      // Play the lattice out through the core, then open the self-verifying ?r=
      // link so the result screen shows the final board.
      const share = await page.evaluate(async () => {
        const h = window.__dots;
        for (let i = 0; i < 40; i += 1) {
          const b = h.game.board();
          if (b.result !== -1) break;
          const mv = h.game.liveMove("Perfect");
          if (mv === null) break;
          h.game.play(mv);
        }
        const env = h.game.outcome(false);
        const json = new TextEncoder().encode(JSON.stringify(env));
        const cs = new CompressionStream("deflate-raw");
        const w = cs.writable.getWriter();
        void w.write(json);
        void w.close();
        const buf = new Uint8Array(await new Response(cs.readable).arrayBuffer());
        let bin = "";
        for (const b2 of buf) bin += String.fromCharCode(b2);
        return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      });
      await page.goto(`${origin}/dots/?r=${share}`, { waitUntil: "networkidle" });
      await page.waitForSelector(".sol-result .dots-board.dots-final");
    },
  },
  {
    name: "align-board",
    clip: ".al-game",
    async run(page) {
      await page.goto(`${origin}/align/?seed=7`, { waitUntil: "networkidle" });
      await page.waitForSelector(".al-board");
      await page.waitForFunction(() => Boolean(window.__align));
      // Build a lived-in stack, then show a hint so the outlined placement reads.
      await page.evaluate(() => {
        const h = window.__align;
        const seq = ["ShiftL", "ShiftL", "HardDrop", "ShiftR", "ShiftR", "HardDrop",
          "RotCW", "HardDrop", "ShiftR", "HardDrop", "ShiftL", "RotCW", "HardDrop"];
        for (const a of seq) { h.input(a); h.tick(2); }
      });
      await page.click('.gf-verb[data-verb="hint"]');
      await page.waitForTimeout(120);
    },
  },
  {
    name: "align-result",
    clip: ".sol-result",
    async run(page) {
      await page.goto(`${origin}/align/?seed=7`, { waitUntil: "networkidle" });
      await page.waitForSelector(".al-board");
      await page.waitForFunction(() => Boolean(window.__align));
      // Hard-drop in place until the stack tops out — a real game-over result.
      await page.evaluate(() => {
        const h = window.__align;
        for (let i = 0; i < 400 && !h.board().over; i += 1) { h.input("HardDrop"); h.tick(1); }
      });
      await page.waitForSelector(".sol-result");
    },
  },
  {
    name: "wyrdle-win",
    clip: ".sol-result",
    async run(page) {
      // A bare URL is the start screen now (plan Q7); ?play=1 is a deep link to the board.
      await page.goto(`${origin}/wyrdle/?play=1`, { waitUntil: "networkidle" });
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
  {
    name: "blockdoku-board",
    clip: ".bdk-game",
    async run(page) {
      await page.goto(`${origin}/blockdoku/?seed=7`, { waitUntil: "networkidle" });
      await page.waitForSelector(".bdk-board");
      await page.waitForFunction(() => Boolean(window.__blockdoku));
      // Play a handful of first-legal moves so the shot shows a lived-in board.
      await page.evaluate(() => {
        const g = window.__blockdoku.game;
        for (let i = 0; i < 8 && !g.isOver(); i += 1) {
          const legal = g.legalMoves();
          if (!legal.length) break;
          g.playPlace(legal[0].slot, legal[0].row, legal[0].col);
        }
        window.__blockdoku.refresh();
      });
      await page.waitForSelector(".bdk-cell.bdk-filled");
    },
  },
  {
    name: "blockdoku-select",
    clip: ".bdk-game",
    async run(page) {
      await page.goto(`${origin}/blockdoku/?seed=7`, { waitUntil: "networkidle" });
      await page.waitForSelector(".bdk-board");
      await page.waitForFunction(() => Boolean(window.__blockdoku));
      // Fill the board in a bit first, so the preview reads against real blocks.
      await page.evaluate(() => {
        const g = window.__blockdoku.game;
        for (let i = 0; i < 7 && !g.isOver(); i += 1) {
          const legal = g.legalMoves();
          if (!legal.length) break;
          g.playPlace(legal[0].slot, legal[0].row, legal[0].col);
        }
        window.__blockdoku.refresh();
        // Hold a piece over a genuinely legal spot so the green preview shows
        // (hint() selects a placeable piece and anchors the preview there).
        window.__blockdoku.hint();
      });
      // The held piece previews its footprint in green where the shape fits.
      await page.waitForSelector(".bdk-cell.bdk-ghost");
    },
  },
  {
    name: "blockdoku-result",
    clip: ".sol-result",
    async run(page) {
      await page.goto(`${origin}/blockdoku/?seed=7`, { waitUntil: "networkidle" });
      await page.waitForSelector(".bdk-board");
      await page.waitForFunction(() => Boolean(window.__blockdoku));
      // Play to the natural game-over to reach the verifiable result screen.
      await page.evaluate(() => {
        const g = window.__blockdoku.game;
        for (let i = 0; i < 500 && !g.isOver(); i += 1) {
          const legal = g.legalMoves();
          if (!legal.length) break;
          g.playPlace(legal[0].slot, legal[0].row, legal[0].col);
        }
        window.__blockdoku.refresh();
      });
      await page.waitForSelector(".sol-result");
    },
  },
  {
    name: "looseends-home",
    clip: ".le-home",
    async run(page) {
      await page.goto(`${origin}/looseends/`, { waitUntil: "networkidle" });
      await page.waitForSelector(".le-home");
    },
  },
  {
    name: "looseends-board",
    clip: ".le-stage",
    async run(page) {
      await page.goto(`${origin}/looseends/`, { waitUntil: "networkidle" });
      await page.waitForFunction(() => Boolean(window.__looseends));
      // Open a small early level so the arrows read clearly, then let the
      // canvas fit-view + first paint settle.
      await page.evaluate(() => window.__looseends.openLevel(6));
      await page.waitForSelector(".le-canvas");
      await page.waitForTimeout(400);
    },
  },
  {
    name: "color-sort-board",
    clip: ".cs-board",
    async run(page) {
      await page.goto(`${origin}/color-sort/?seed=0`, { waitUntil: "networkidle" });
      await page.waitForSelector(".cs-board");
      await page.waitForFunction(() => Boolean(window.__colorSort));
    },
  },
  {
    name: "color-sort-select",
    clip: ".cs-board",
    async run(page) {
      await page.goto(`${origin}/color-sort/?seed=0`, { waitUntil: "networkidle" });
      await page.waitForSelector(".cs-board");
      await page.waitForFunction(() => Boolean(window.__colorSort));
      // Select a real source so its legal target tubes glow.
      await page.evaluate(() => {
        const from = window.__colorSort.game.board().moves[0].from;
        window.__colorSort.tapTube(from);
      });
      await page.waitForSelector(".cs-tube.legal");
    },
  },
  {
    name: "color-sort-win",
    clip: ".sol-result",
    async run(page) {
      // Endless level 1 (4 colours) solves quickly via the solver hint.
      await page.goto(`${origin}/color-sort/?level=1`, { waitUntil: "networkidle" });
      await page.waitForSelector(".cs-board");
      await page.waitForFunction(() => Boolean(window.__colorSort));
      await page.evaluate(() => {
        const h = window.__colorSort;
        for (let i = 0; i < 200 && !h.game.isWon(); i += 1) {
          const mv = h.game.hint();
          if (!mv) break;
          h.game.pour(mv.from, mv.to);
        }
        h.refresh();
      });
      await page.waitForSelector(".sol-result");
    },
  },
  {
    name: "orchard-crate",
    clip: ".orch-surface",
    async run(page) {
      // The native game, not the wrap: drive it through the same test hook the
      // e2e spec uses, so the shot shows the real core playing rather than a
      // gesture-timing approximation of it.
      await page.goto(`${origin}/orchard-drop/?seed=7`, { waitUntil: "networkidle" });
      await page.waitForSelector(".orch-canvas");
      await page.waitForFunction(() => Boolean(window.__orchard));
      await page.evaluate(() => {
        const o = window.__orchard;
        // A run of drops spread across the crate, so the shot shows a lived-in
        // pile with merges rather than an empty box.
        for (let i = 0; i < 22 && !o.over(); i += 1) {
          o.aim(60 + 320 * (((i * 7) % 10) / 10));
          o.release();
          o.fastForward(40);
        }
        o.fastForward(400); // let the pile settle and merges resolve
      });
      await page.waitForTimeout(300);
    },
  },
  {
    name: "cribbage-table",
    clip: ".crib-game",
    async run(page) {
      await page.goto(`${origin}/cribbage/?seed=7`, { waitUntil: "networkidle" });
      await page.waitForSelector(".crib-table");
      await page.waitForFunction(() => Boolean(window.__cribbage));
      // The human is to throw at seed 7 once the engine has (or first); wait for
      // the throw control, then select two cards so the shot shows a selection.
      await page.waitForFunction(() => {
        const h = window.__cribbage;
        return !h.busy() && h.game.view().phase === "discard" && h.game.view().toMove === 1;
      });
      const cards = page.locator(".crib-hand .crib-card");
      await cards.nth(1).click();
      await cards.nth(4).click();
      await page.waitForSelector(".crib-hand .crib-card.selected");
    },
  },
  {
    name: "cribbage-pegging",
    clip: ".crib-game",
    async run(page) {
      await page.goto(`${origin}/cribbage/?seed=7`, { waitUntil: "networkidle" });
      await page.waitForSelector(".crib-table");
      await page.waitForFunction(() => Boolean(window.__cribbage));
      const human = async () =>
        page.waitForFunction(() => {
          const h = window.__cribbage;
          const v = h.game.view();
          return !h.busy() && (v.result !== -1 || (v.toMove === 1 && v.legal.length > 0 && !v.phase.startsWith("show")));
        });
      await human();
      const cards = page.locator(".crib-hand .crib-card");
      await cards.nth(0).click();
      await cards.nth(1).click();
      await page.locator(".crib-throw").click();
      await human();
      // One play each, so the count and a played card are on the table.
      await page.locator(".crib-hand .crib-card.legal").first().click();
      await human();
      await page.waitForSelector(".crib-stack .crib-card");
    },
  },
  {
    name: "cribbage-show",
    clip: ".crib-game",
    async run(page) {
      // Manual counting holds the show still: with automatic counting each hand
      // is on the table for under a second, which is not a shot. Play to the
      // human's claim, submit the true count through the hook, and the graded
      // hand sits there with its breakdown.
      await page.addInitScript(() => localStorage.setItem("fun-cribbage-manual-count", "on"));
      await page.goto(`${origin}/cribbage/?seed=7`, { waitUntil: "networkidle" });
      await page.waitForSelector(".crib-table");
      await page.waitForFunction(() => Boolean(window.__cribbage));
      const human = async () =>
        page.waitForFunction(() => {
          const h = window.__cribbage;
          const v = h.game.view();
          return !h.busy() && (v.result !== -1 || (v.toMove === 1 && v.legal.length > 0));
        });
      for (let i = 0; i < 40; i += 1) {
        await human();
        const v = await page.evaluate(() => window.__cribbage.game.view());
        if (v.result !== -1 || v.phase.startsWith("show")) break;
        if (v.phase === "discard") {
          const cards = page.locator(".crib-hand .crib-card");
          await cards.nth(0).click();
          await page.waitForSelector(".crib-hand .crib-card.selected");
          await cards.nth(1).click();
          await page.waitForFunction(() => document.querySelectorAll(".crib-hand .crib-card.selected").length === 2);
          await page.locator(".crib-throw").click();
        } else if (v.legal.length === 1 && v.legal[0] === 20) {
          await page.locator(".crib-go").click();
        } else {
          await page.locator(".crib-hand .crib-card.legal").first().click();
        }
      }
      await page.evaluate(() => {
        const h = window.__cribbage;
        const claim = h.game.autoClaim();
        if (claim !== null) h.game.play(claim);
        h.refresh();
      });
      await page.waitForSelector(".crib-revealed.graded");
    },
  },
];

// Optional filter: `npm run guide:shots -- orchard` regenerates only the shots
// whose name contains "orchard". Without it every game's JPEG is rewritten, and
// unrelated re-encodes then have to be reverted by hand — which CLAUDE.md warns
// about and which is easy to get wrong at the `git add` step.
const only = process.argv[2] ?? "";
const selected = only ? SHOTS.filter((s) => s.name.includes(only)) : SHOTS;
if (only && selected.length === 0) {
  console.error(`guide-shots: no shot name contains "${only}"`);
  process.exit(1);
}

const server = spawn("node", [join(root, "tools", "serve.mjs")], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 700)); // let the server bind (fixed wait)

// `PLAYWRIGHT_EXECUTABLE_PATH` pins a specific Chromium binary (e.g. a
// sandbox/CI image whose pre-installed build differs from @playwright/test's
// pinned revision); unset = Playwright's default resolution.
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
    : {},
);
try {
  for (const shot of selected) {
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
