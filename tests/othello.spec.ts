//! Othello wiring test: the 8×8 board + turn bar + pickers render and play over
//! the binding; legal squares glow (core-decided) and a tap places-and-flips; the
//! engine replies with a visible last-move ring; forced passes auto-advance; a
//! full game plays to a terminal result whose verification-forward end screen
//! shows the final board and a re-verifying `?r=` share; the difficulty picker
//! persists. Axe + narrow-phone fit guard the identity.

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

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

test("the board, turn bar, and pickers render", async ({ page }) => {
  await page.goto("/othello/?seed=7");
  await ready(page);
  // 64 squares; the standard opening shows 4 discs and 4 legal targets.
  await expect(page.locator(".othello-cell")).toHaveCount(64);
  expect(await filled(page)).toBe(4);
  await expect(page.locator(".othello-cell.legal")).toHaveCount(4);
  // The banner explains the game; the turn bar names You and The Engine.
  await expect(page.locator(".othello-banner")).toContainText(/flip/i);
  await expect(page.locator(".othello-turnbar")).toContainText(/you/i);
  await expect(page.locator(".othello-turnbar")).toContainText(/the engine/i);
  // The difficulty picker offers four levels, topped by Expert (Othello is
  // unsolved — there is no "Perfect").
  await expect(page.locator(".othello-level option")).toHaveCount(4);
  await expect(page.locator(".othello-level")).toContainText("Expert");
  await expect(page.locator(".othello-level")).not.toContainText("Perfect");
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

test("no axe violations on the board", async ({ page }) => {
  await page.goto("/othello/?seed=7");
  await ready(page);
  const results = await new AxeBuilder({ page }).include(".othello-game").analyze();
  expect(results.violations).toEqual([]);
});

test("the difficulty picker persists the chosen level", async ({ page }) => {
  await page.goto("/othello/?seed=7");
  await ready(page);
  await page.locator(".othello-level").selectOption("Hard");
  expect(await page.evaluate(() => localStorage.getItem("fun-othello-level"))).toBe("Hard");
});

test("a full game plays to a terminal result; the final board shows; share re-verifies", async ({ page }) => {
  await page.goto("/othello/?seed=7");
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

  const shareHref = await result.locator(".sol-share").getAttribute("href");
  expect(shareHref).toContain("?r=");
  const shared = await page.context().newPage();
  await shared.goto(shareHref!);
  await expect(shared.locator(".sol-result")).toBeVisible();
  await expect(shared.locator(".sol-verify-badge.ok")).toBeVisible();
  await expect(shared.locator(".othello-board.othello-final")).toBeVisible();
  await shared.close();
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

test("the tutor panel is off by default and appears when enabled in settings", async ({ page }) => {
  await page.goto("/othello/?seed=7");
  await ready(page);
  await expect(page.locator(".othello-tutor")).toHaveCount(0);
  await page.locator(".othello-settings summary").click();
  await page.locator(".othello-set-tutor").check();
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
  await page.goto("/othello/?seed=7");
  await ready(page);
  await page.locator(".othello-settings summary").click();
  await expect(page.locator(".othello-ai-toggle-input")).toHaveCount(0);
});

test("the experimental local-AI toggle appears with a real adapter and discloses the download", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "gpu", {
      configurable: true,
      value: { requestAdapter: async () => ({ isFallbackAdapter: false }) },
    });
  });
  await page.goto("/othello/?seed=7");
  await ready(page);
  await page.locator(".othello-settings summary").click();
  const toggle = page.locator(".othello-ai-toggle-input");
  await expect(toggle).toHaveCount(1);
  await toggle.check();
  await expect(page.locator(".othello-ai-disclosure")).toContainText(/download|one[- ]time|GB|MB/i);
});
