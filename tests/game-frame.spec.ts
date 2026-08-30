//! The game frame in a real browser: the reserved heights are pixels here, not
//! class hooks. `plans/2026-08-30-plan-game-frame.md` Phase 1b onward.
//!
//! The placeholder is the frame's own exercise: it declares one meter and one
//! verb, and the verb changes the meter — the cheapest possible proof that a
//! change above the board moves nothing.

import { expect, test, type Page } from "@playwright/test";

async function ready(page: Page): Promise<void> {
  await expect(page.locator(".gf-stage .placeholder-game")).toBeVisible();
}

const top = async (page: Page, sel: string): Promise<number> => {
  const box = await page.locator(sel).boundingBox();
  if (!box) throw new Error(`${sel} has no box`);
  return box.y;
};

test("the placeholder mounts inside a frame", { tag: "@smoke" }, async ({ page }) => {
  await page.goto("/placeholder/");
  await ready(page);
  await expect(page.locator(".gf-game-bar .gf-title")).toHaveText("Placeholder");
  await expect(page.locator(".gf-dock .gf-verb")).toHaveCount(1);
  await expect(page.locator(".gf-meters .gf-stat")).toHaveCount(1);
});

test("the bands are the reserved heights, to the pixel, on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/placeholder/");
  await ready(page);
  const h = async (sel: string): Promise<number> => (await page.locator(sel).boundingBox())!.height;
  expect(await h(".gf-game-bar")).toBe(48);
  expect(await h(".gf-meters")).toBe(56);
  expect(await h(".gf-dock")).toBe(72);
});

test("pressing a verb that changes a meter moves the stage by zero pixels", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/placeholder/");
  await ready(page);
  const before = await top(page, ".gf-stage");
  const gameBefore = await top(page, ".placeholder-game");
  await page.locator(".gf-verb").click();
  await expect(page.locator(".gf-stat-value")).toHaveText("1");
  expect(await top(page, ".gf-stage")).toBe(before);
  expect(await top(page, ".placeholder-game")).toBe(gameBefore);
});
