//! Othello wiring test: the 8×8 board plays over the binding inside the game
//! frame; the seats name both sides and whose move it is; legal squares glow
//! (core-decided) and a tap places-and-flips; the engine replies with a visible
//! last-move ring; forced passes auto-advance; a full game plays to a terminal
//! result whose verification-forward end screen shows the final board and a
//! re-verifying `?r=` share; the New game sheet's difficulty persists. And — the
//! frame's rule — the board's top edge does not move: across the engine's reply,
//! a pass, the sheets, the tutor and the banter. Axe + narrow-phone fit guard the
//! identity. (Plan 2026-08-30 Phase 6: the versus archetype.)

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { boardTopStable } from "./helpers/board-top.js";

async function ready(page: Page): Promise<void> {
  await expect(page.locator(".othello-board")).toBeVisible();
  await page.waitForFunction(() => Boolean(window.__othello));
}

/** The human's side value (1 black by default). */
const HUMAN = 1;

/** Discs on the board (both sides). */
const filled = (page: Page): Promise<number> =>
  page.evaluate(() =>
    window.__othello!.game.board().cells.flat().filter((v: number) => v !== 0).length,
  );

/** Wait until it is the human's turn with a legal move, or the match is over. */
const waitHumanOrOver = (page: Page): Promise<unknown> =>
  page.waitForFunction((human) => {
    const b = window.__othello!.game.board();
    return b.result !== -1 || (b.toMove === human && b.legal.length > 0);
  }, HUMAN);

/** The frame's seats, by the game's own ids. */
const seat = (page: Page, id: "you" | "engine") => page.locator(`.gf-seat[data-meter="${id}"]`);

test("the board, the seats, and the frame's verbs render", { tag: "@smoke" }, async ({ page }) => {
  await page.goto("/othello/?seed=7");
  await ready(page);
  // 64 squares; the standard opening shows 4 discs and 4 legal targets.
  await expect(page.locator(".othello-cell")).toHaveCount(64);
  expect(await filled(page)).toBe(4);
  await expect(page.locator(".othello-cell.legal")).toHaveCount(4);
  // The seats name You and The Engine, with scores, and say whose move it is.
  await expect(seat(page, "you")).toContainText(/you/i);
  await expect(seat(page, "you").locator(".gf-seat-score")).toHaveText("2");
  await expect(seat(page, "you")).toHaveAttribute("data-state", "active");
  await expect(seat(page, "you").locator(".gf-sub")).toHaveText(/your move/i);
  await expect(seat(page, "engine")).toContainText(/the engine/i);
  // The first-move hint is a toast over the stage, not a banner in flow.
  await expect(page.locator(".gf-toast")).toContainText(/tap a glowing square/i);
  await expect(page.locator(".othello-banner")).toHaveCount(0);
  // Verbs: New game… and the frame's Settings — no Difficulty select beside the board.
  const verbs = await page.locator(".gf-dock .gf-verb").evaluateAll((els) => els.map((e) => e.getAttribute("data-verb")));
  expect(verbs).toEqual(["new", "settings"]);
  await expect(page.locator(".othello-level")).toHaveCount(0);
});

test("the New game sheet offers four levels, topped by Expert, and its choice persists", async ({ page }) => {
  await page.goto("/othello/?seed=7");
  await ready(page);
  await page.locator('.gf-verb[data-verb="new"]').click();
  const sheet = page.locator(".gf-sheet");
  await expect(sheet).toBeVisible();
  const level = sheet.locator('[data-setting="level"]');
  // Othello is unsolved — there is no "Perfect" level.
  const labels = await level.locator(".sheet-choice-opt").allTextContents();
  expect(labels).toEqual(["Easy", "Medium", "Hard", "Expert"]);
  await level.locator('input[value="Hard"]').check();
  expect(await page.evaluate(() => localStorage.getItem("fun-othello-level"))).toBe("Hard");
  await sheet.locator(".gf-sheet-start").click();
  await expect(sheet).toBeHidden();
  await expect(page.locator(".gf-mode")).toHaveText("Hard");
});

test("tapping a legal square places-and-flips and the engine replies", async ({ page }) => {
  await page.goto("/othello/?seed=7");
  await ready(page);
  expect(await filled(page)).toBe(4);
  await page.locator(".othello-cell.legal").first().click();
  // The human's placement flips ≥1 disc (so ≥6), then the engine replies.
  await waitHumanOrOver(page);
  expect(await filled(page)).toBeGreaterThanOrEqual(6);
  // The last placement is ringed so the move is visible.
  await expect(page.locator(".othello-cell.just-played")).toHaveCount(1);
});

test("thinking is a seat state: the engine's seat pulses and says so, and nothing is inserted", async ({ page }) => {
  await page.goto("/othello/?seed=7");
  await ready(page);
  const engine = seat(page, "engine");
  const before = await page.locator(".gf-meters").evaluate((e) => e.childElementCount);
  // The engine's think beat can be shorter than an assertion's retry, so watch the
  // seat's attribute from inside the page rather than sampling it from outside.
  await page.evaluate(() => {
    const el = document.querySelector('.gf-seat[data-meter="engine"]')!;
    const w = window as unknown as { __seen: { thinking: boolean; sub: string } };
    w.__seen = { thinking: false, sub: "" };
    new MutationObserver(() => {
      if (el.getAttribute("data-state") === "thinking") {
        w.__seen.thinking = true;
        w.__seen.sub = el.querySelector(".gf-sub")?.textContent ?? "";
      }
    }).observe(el, { attributes: true, subtree: true, childList: true, characterData: true });
  });
  await page.locator(".othello-cell.legal").first().click();
  await waitHumanOrOver(page);
  const seen = await page.evaluate(() => (window as unknown as { __seen: { thinking: boolean; sub: string } }).__seen);
  expect(seen.thinking).toBe(true);
  expect(seen.sub).toMatch(/thinking/i);
  await expect(engine).toHaveAttribute("data-state", "idle");
  await expect(engine.locator(".gf-sub")).toHaveText("");
  expect(await page.locator(".gf-meters").evaluate((e) => e.childElementCount)).toBe(before);
});

// --- the frame's rule, measured: the board's top edge across every trigger this game has ---

test("the board does not move while the engine replies", { tag: "@smoke" }, async ({ page }) => {
  await page.goto("/othello/?seed=7");
  await ready(page);
  const v = await boardTopStable(page, ".othello-board", async () => {
    await page.locator(".othello-cell.legal").first().click();
    await waitHumanOrOver(page);
  });
  expect(v.frames).toBeGreaterThan(5);
  expect(v, `board top moved ${v.delta}px over ${v.frames} frames`).toMatchObject({ stable: true });
});

test("the board does not move when Settings opens and closes, or the tutor is toggled", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/othello/?seed=7");
  await ready(page);
  const v = await boardTopStable(page, ".othello-board", async () => {
    await page.locator('.gf-verb[data-verb="settings"]').click();
    await expect(page.locator(".gf-sheet")).toBeVisible();
    await page.locator('.gf-sheet [data-setting="tutor"] .sheet-toggle-input').click({ force: true });
    await expect(page.locator(".othello-tutor")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".gf-sheet")).toBeHidden();
  });
  expect(v, `board top moved ${v.delta}px`).toMatchObject({ stable: true });
});

test("the board does not move across a forced pass", async ({ page }) => {
  // Play first-legal moves at fast speed until either side is forced to pass (the
  // "has no move — passing" sentence lands in the reserved-height status line);
  // stop there, before the game can end. Seed 6 passes at ply 16 under first-legal
  // play (probed over seeds 1–40: 4 @20, 6 @16, 8 @21); if that ever stops being
  // true the test says so rather than grading nothing.
  await page.goto("/othello/?seed=6&fast=1");
  await ready(page);
  let passed = false;
  const v = await boardTopStable(page, ".othello-board", async () => {
    for (let ply = 0; ply < 44; ply += 1) {
      await waitHumanOrOver(page);
      const state = await page.evaluate(() => ({ over: window.__othello!.game.board().result !== -1, passes: window.__othello!.passes() }));
      if (state.over) break;
      if (state.passes > 0) {
        passed = true;
        break;
      }
      await page.locator(".othello-cell.legal").first().click();
    }
  });
  test.skip(!passed, "no forced pass occurred within 44 plies of seed 6 — nothing to grade");
  expect(v, `board top moved ${v.delta}px over ${v.frames} frames`).toMatchObject({ stable: true });
});

test("no axe violations on the board, and none with the New game sheet open", async ({ page }) => {
  await page.goto("/othello/?seed=7");
  await ready(page);
  expect((await new AxeBuilder({ page }).include(".gf").analyze()).violations).toEqual([]);
  await page.locator('.gf-verb[data-verb="new"]').click();
  await expect(page.locator(".gf-sheet")).toBeVisible();
  expect((await new AxeBuilder({ page }).include(".gf").analyze()).violations).toEqual([]);
});

test("a full game plays to a terminal result; the final board shows; share re-verifies", { tag: "@long" }, async ({ page }) => {
  await page.goto("/othello/?seed=7&fast=1");
  await ready(page);
  // Play a real game through the UI: each human turn, tap the first legal square
  // and let the engine (and any forced passes) auto-advance. ≤60 placements.
  for (let ply = 0; ply < 80; ply += 1) {
    await waitHumanOrOver(page);
    const over = await page.evaluate(() => window.__othello!.game.board().result !== -1);
    if (over) break;
    await page.locator(".othello-cell.legal").first().click();
  }
  const result = page.locator(".sol-result");
  await expect(result).toBeVisible();
  await expect(result.locator(".sol-verify-badge.ok")).toBeVisible();
  await expect(result.locator(".othello-board.othello-final")).toBeVisible();
  // The store marks the game finished, so the front door offers "play again".
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("fun-progress-othello")!) as { status: string });
  expect(stored.status).toBe("finished");

  const shareHref = await result.locator(".sol-share").getAttribute("href");
  expect(shareHref).toContain("?r=");
  const shared = await page.context().newPage();
  await shared.goto(shareHref!);
  await expect(shared.locator(".sol-result")).toBeVisible();
  await expect(shared.locator(".sol-verify-badge.ok")).toBeVisible();
  await expect(shared.locator(".othello-board.othello-final")).toBeVisible();
  await shared.close();
});

test("leaving mid-game and returning to the bare URL resumes the same position", async ({ page }) => {
  await page.goto("/othello/?seed=7");
  await ready(page);
  await page.locator(".othello-cell.legal").first().click();
  await waitHumanOrOver(page);
  const discs = await filled(page);
  const hash = await page.evaluate(() => window.__othello!.game.currentHash());
  await page.goto("/othello/");
  const card = page.locator(".gf-continue");
  await expect(card).toBeVisible();
  await expect(card.locator(".gf-start-line")).toContainText(/move/i);
  await card.locator(".gf-continue-btn").click();
  await ready(page);
  await waitHumanOrOver(page);
  expect(await filled(page)).toBe(discs);
  expect(await page.evaluate(() => window.__othello!.game.currentHash())).toBe(hash);
});

test("the board fits a narrow phone viewport (no horizontal overflow)", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 720 });
  await page.goto("/othello/?seed=7");
  await ready(page);
  const fits = await page.evaluate(() => {
    const b = document.querySelector(".othello-board");
    return b ? b.getBoundingClientRect().width <= window.innerWidth : false;
  });
  expect(fits).toBe(true);
});

// The tutor panel is opt-in (off by default); enable it via its setting.
async function enableTutor(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem("fun-othello-tutor", "on"));
}

test("the tutor panel is off by default and appears when enabled in the settings sheet", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); // Settings is a sheet on a phone; inline in the rail on desktop
  await page.goto("/othello/?seed=7");
  await ready(page);
  await expect(page.locator(".othello-tutor")).toHaveCount(0);
  await page.locator('.gf-verb[data-verb="settings"]').click();
  await page.locator('.gf-sheet [data-setting="tutor"] .sheet-toggle-input').click({ force: true });
  await expect(page.locator(".othello-tutor-explain")).toBeVisible();
});

test("'Explain my options' lists at least two band moves with an idea each", async ({ page }) => {
  await enableTutor(page);
  await page.goto("/othello/?seed=7");
  await ready(page);
  await page.locator(".othello-tutor-explain").click();
  const items = page.locator(".othello-tutor-options li");
  expect(await items.count()).toBeGreaterThanOrEqual(2);
  // Each option names a square and an idea (why it is reasonable).
  await expect(items.first()).toContainText(/row \d, column \d/i);
});

test("the experimental local-AI opponent is hidden with no real WebGPU adapter", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "gpu", {
      configurable: true,
      value: { requestAdapter: async () => null },
    });
  });
  await page.setViewportSize({ width: 390, height: 844 }); // Settings is a sheet on a phone; inline in the rail on desktop
  await page.goto("/othello/?seed=7");
  await ready(page);
  await page.locator('.gf-verb[data-verb="settings"]').click();
  await expect(page.locator('.gf-sheet [data-setting="local-ai"]')).toHaveCount(0);
});

test("the experimental local-AI toggle appears with a real adapter and discloses the download", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "gpu", {
      configurable: true,
      value: { requestAdapter: async () => ({ isFallbackAdapter: false }) },
    });
  });
  await page.setViewportSize({ width: 390, height: 844 }); // Settings is a sheet on a phone; inline in the rail on desktop
  await page.goto("/othello/?seed=7");
  await ready(page);
  await page.locator('.gf-verb[data-verb="settings"]').click();
  const row = page.locator('.gf-sheet [data-setting="local-ai"]');
  await expect(row).toHaveCount(1);
  await expect(row.locator(".sheet-hint")).toContainText(/download|one[- ]time|GB|MB/i);
});

test("the settings sheet stays open when something re-renders the board", async ({ page }) => {
  // The sheet is the frame's, outside the game's replaceChildren — a re-render
  // (here: toggling the tutor, which re-renders the board) cannot close it.
  await page.setViewportSize({ width: 390, height: 844 }); // Settings is a sheet on a phone; inline in the rail on desktop
  await page.goto("/othello/?seed=7");
  await ready(page);
  await page.locator('.gf-verb[data-verb="settings"]').click();
  const sheet = page.locator(".gf-sheet");
  await expect(sheet).toBeVisible();
  await page.locator('.gf-sheet [data-setting="tutor"] .sheet-toggle-input').click({ force: true });
  await expect(page.locator(".othello-tutor")).toBeVisible();
  await expect(sheet).toBeVisible();
});

test("the tutor's explained options survive a re-render on the same position", async ({ page }) => {
  // TODO/dots.md:81 — the reading used to live only in the DOM, so any render()
  // erased it. Hiding and re-showing the tutor is the board-neutral re-render
  // this game actually exposes: the panel is genuinely destroyed and rebuilt, and
  // the position has not changed, so the reading is still true and must come back.
  await page.addInitScript(() => localStorage.setItem("fun-othello-tutor", "on"));
  await page.setViewportSize({ width: 390, height: 844 }); // Settings is a sheet on a phone; inline in the rail on desktop
  await page.goto("/othello/?seed=7");
  await ready(page);
  await waitHumanOrOver(page);
  await page.locator(".othello-tutor-explain").click();
  const items = page.locator(".othello-tutor-options li");
  await expect(items.first()).toBeVisible();
  const before = await items.count();

  await page.locator('.gf-verb[data-verb="settings"]').click();
  const tutor = page.locator('.gf-sheet [data-setting="tutor"] .sheet-toggle-input');
  await tutor.click({ force: true }); // hide  -> render()
  await expect(page.locator(".othello-tutor")).toHaveCount(0);
  await tutor.click({ force: true }); // show  -> render()

  await expect(items).toHaveCount(before);
});
