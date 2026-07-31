//! Wyrdle wiring test: the grid + on-screen keyboard render and play over the
//! binding, typing a legal guess reveals a scored row, a non-word is rejected
//! by the core (shake, nothing changes), the committed winnable fixture solves
//! to a verifiable record whose emoji grid is spoiler-free and whose `?r=` share
//! round-trips + re-verifies. Axe + narrow-phone fit guard the identity.

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function ready(page: Page): Promise<void> {
  await expect(page.locator(".wy-grid")).toBeVisible();
  await page.waitForFunction(() => Boolean(window.__wyrdle));
}

async function typeWord(page: Page, word: string): Promise<void> {
  for (const ch of word) await page.locator(`.wy-key[data-key="${ch}"]`).click();
  await page.locator('.wy-key[data-key="enter"]').click();
}

test("the grid, keyboard, and HUD render", async ({ page }) => {
  await page.goto("/wyrdle/?seed=7");
  await ready(page);
  await expect(page.locator(".wy-grid")).toBeVisible();
  await expect(page.locator(".wy-keyboard")).toBeVisible();
  await expect(page.locator('.wy-key[data-key="enter"]')).toBeVisible();
  await expect(page.locator(".wy-hud")).toContainText(/guesses left/i);
  // A full 6x5 grid of tiles.
  await expect(page.locator(".wy-tile")).toHaveCount(30);
});

test("typing a legal guess on the keyboard reveals a scored row", async ({ page }) => {
  await page.goto("/wyrdle/?seed=7");
  await ready(page);
  await typeWord(page, "crane");
  // The first row is now scored: five tiles carrying a state class.
  const scored = page.locator(".wy-row").first().locator(".wy-correct, .wy-present, .wy-absent");
  await expect(scored).toHaveCount(5);
  const count = await page.evaluate(() => window.__wyrdle!.game.board().guesses.length);
  expect(count).toBe(1);
});

test("a non-word is rejected by the core — shake, nothing changes", async ({ page }) => {
  await page.goto("/wyrdle/?seed=7");
  await ready(page);
  const before = await page.evaluate(() => window.__wyrdle!.game.board().guesses.length);
  await typeWord(page, "qwxzj"); // not in the allowed list
  // A prominent toast (above the board) reports the rejection, not just a
  // status line below the keyboard.
  const toast = page.locator(".wy-toast.show");
  await expect(toast).toBeVisible();
  await expect(toast).toContainText(/not in word list/i);
  const after = await page.evaluate(() => window.__wyrdle!.game.board().guesses.length);
  expect(after).toBe(before); // the core decided; the guess was not recorded
});

test("solving with the committed fixture is a verifiable win; shares work", async ({ page }) => {
  const res = await page.request.get("/wyrdle-daily-pack.json");
  const env = (await res.json()) as {
    payload: { fixture: { seed: number; moves: string[] } };
  };
  const fixture = env.payload.fixture;
  await page.goto(`/wyrdle/?seed=${fixture.seed}`);
  await ready(page);

  await page.evaluate((moves) => {
    for (const m of moves) window.__wyrdle!.submitGuess(m);
  }, fixture.moves);

  const result = page.locator(".sol-result");
  await expect(result).toBeVisible();
  await expect(result.locator(".sol-verify-badge.ok")).toBeVisible();
  await expect(result).toContainText(/solved/i);

  // The emoji grid is spoiler-free: only 🟩🟨⬛, never the answer letters.
  const grid = await result.locator(".wy-emoji-grid").textContent();
  expect(grid).toMatch(/^[🟩🟨⬛\n]+$/u);

  // The verifiable ?r= share round-trips and re-verifies on open.
  const shareHref = await result.locator(".sol-share").getAttribute("href");
  expect(shareHref).toContain("?r=");
  const shared = await page.context().newPage();
  await shared.goto(shareHref!);
  await expect(shared.locator(".sol-result")).toBeVisible();
  await expect(shared.locator(".sol-verify-badge.ok")).toBeVisible();
  await shared.close();
});

test("with hints off, 'I'm done' ends the round", async ({ page }) => {
  await page.goto("/wyrdle/?seed=7");
  await ready(page);
  await page.locator(".sol-settings summary").click();
  await page.locator(".sol-set-hints").uncheck();
  await page.locator(".sol-stuck").click();
  await expect(page.locator(".sol-result")).toBeVisible();
});

test("the board has no axe violations in light and dark", async ({ page }) => {
  await page.goto("/wyrdle/?seed=7");
  await ready(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: /toggle light or dark theme/i }).click();
  await ready(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("the board fits a narrow phone with no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("/wyrdle/?seed=7");
  await ready(page);
  const noOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
  expect(noOverflow).toBe(true);
});
