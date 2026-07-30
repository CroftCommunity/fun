//! Bubble-shooter wiring test: the hex board renders and plays over the binding,
//! the glowing landing cells are exactly the core's legal targets, tapping one
//! fires the launcher colour (an inert tap on a bubble does nothing), the
//! committed winnable fixture clears to a verifiable record, and the share link
//! round-trips. Axe + narrow-phone fit guard the identity.

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function ready(page: Page): Promise<void> {
  await expect(page.locator(".bub-board")).toBeVisible();
  await page.waitForFunction(() => Boolean(window.__bubble));
}

test("the board renders bubbles + a launcher and the HUD", async ({ page }) => {
  await page.goto("/bubble/?seed=7");
  await ready(page);
  await expect(page.locator(".bub-bubble").first()).toBeVisible();
  await expect(page.locator(".bub-launcher")).toContainText(/launcher/i);
  await expect(page.locator(".bub-hud")).toContainText(/score/i);
  await expect(page.locator(".bub-hud")).toContainText(/shots left/i);
});

test("the glowing cells are exactly the core's legal targets", async ({ page }) => {
  await page.goto("/bubble/?seed=7");
  await ready(page);
  const n = await page.evaluate(() => window.__bubble!.legalTargets().length);
  await expect(page.locator(".bub-target.legal-target")).toHaveCount(n);
});

test("tapping a legal target fires the launcher and spends a shot", async ({ page }) => {
  await page.goto("/bubble/?seed=7");
  await ready(page);
  const before = await page.evaluate(() => window.__bubble!.game.board().shotsLeft);
  const t = await page.evaluate(() => window.__bubble!.legalTargets()[0]!);
  await page.locator(`.bub-target[data-r="${t[0]}"][data-c="${t[1]}"]`).click();
  const after = await page.evaluate(() => window.__bubble!.game.board().shotsLeft);
  expect(after).toBe(before - 1);
});

test("a bubble is not a landing cell — tapping it does nothing (core decides)", async ({ page }) => {
  await page.goto("/bubble/?seed=7");
  await ready(page);
  const before = await page.evaluate(() => window.__bubble!.game.board().shotsLeft);
  // Bubbles render as inert spans, not buttons — a click on one is a no-op.
  await page.locator(".bub-bubble").first().click();
  const after = await page.evaluate(() => window.__bubble!.game.board().shotsLeft);
  expect(after).toBe(before);
});

test("clearing the board with the committed fixture is a verifiable win; share round-trips", async ({
  page,
}) => {
  // The winnable-daily pack's fixture: a seed + a shot line that clears the board
  // (fetched via the baseURL-relative request API, no page origin needed).
  const res = await page.request.get("/bubble-daily-pack.json");
  const env = (await res.json()) as {
    payload: { fixture: { seed: number; moves: [number, number][] } };
  };
  const fixture = env.payload.fixture;
  await page.goto(`/bubble/?seed=${fixture.seed}`);
  await ready(page);

  await page.evaluate((moves) => {
    const h = window.__bubble!;
    for (const m of moves) h.game.shoot(m);
    h.refresh();
  }, fixture.moves);

  const result = page.locator(".sol-result");
  await expect(result).toBeVisible();
  await expect(result.locator(".sol-verify-badge.ok")).toBeVisible();
  await expect(result).toContainText(/board cleared/i);
  await expect(result.locator(".sol-record")).toContainText(/score/i);

  const shareHref = await page.locator(".sol-share").getAttribute("href");
  expect(shareHref).toContain("?r=");
  const shared = await page.context().newPage();
  await shared.goto(shareHref!);
  await expect(shared.locator(".sol-result")).toBeVisible();
  await expect(shared.locator(".sol-verify-badge.ok")).toBeVisible();
  await shared.close();
});

test("with hints off, 'I'm done' ends the round", async ({ page }) => {
  await page.goto("/bubble/?seed=7");
  await ready(page);
  await page.locator(".sol-settings summary").click();
  await page.locator(".sol-set-hints").uncheck();
  await page.locator(".sol-stuck").click();
  await expect(page.locator(".sol-result")).toBeVisible();
});

test("the board has no axe violations in light and dark", async ({ page }) => {
  await page.goto("/bubble/?seed=7");
  await ready(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: /toggle light or dark theme/i }).click();
  await ready(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("the board fits a narrow phone with no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("/bubble/?seed=7");
  await ready(page);
  const noOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
  expect(noOverflow).toBe(true);
});
