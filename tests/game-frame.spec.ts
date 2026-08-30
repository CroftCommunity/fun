//! The game frame in a real browser: the reserved heights are pixels here, not
//! class hooks. `plans/2026-08-30-plan-game-frame.md` Phase 1b onward.
//!
//! The placeholder is the frame's own exercise: it declares one meter and one
//! verb, and the verb changes the meter — the cheapest possible proof that a
//! change above the board moves nothing.

import { expect, test, type Page } from "@playwright/test";

import { REGISTRY } from "../src/registry.js";

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

// --- Phase 2a: the chrome mounts the frame for every game; the header is one row ---

const PLAYABLE = REGISTRY.filter((g) => g.status === "playable").map((g) => g.id);

test("the shelf header is one row on every game page at 390px", { tag: "@smoke" }, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const tall: string[] = [];
  for (const id of PLAYABLE) {
    await page.goto(`/${id}/`);
    await expect(page.locator(".gf-game-bar")).toBeVisible();
    const h = (await page.locator(".chrome-header").boundingBox())!.height;
    // One row is 64px plus a hairline (64.19 measured); two rows were 110 on every
    // game page before the frame (plan Phase 0). 66 separates them with margin.
    if (h > 66) tall.push(`${id}:${h}`);
  }
  // The whole list is in the failure so a regression names the page.
  expect(tall).toEqual([]);
});

test("the game bar's ⋯ menu holds How to play and open-in-new-tab, and behaves like a menu", async ({ page }) => {
  await page.goto("/othello/");
  const more = page.locator(".gf-more");
  const menu = page.locator(".gf-menu");
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await expect(menu).toBeHidden();
  await expect(page.locator(".chrome-header .how-to-link")).toHaveCount(0);

  await more.click();
  await expect(more).toHaveAttribute("aria-expanded", "true");
  await expect(menu.locator('a[href="/how-to/?game=othello"]')).toBeVisible();
  const newTab = menu.locator('a[href="/othello/"]');
  await expect(newTab).toHaveAttribute("target", "_blank");
  await expect(newTab).toHaveAttribute("rel", "noopener");

  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(more).toHaveAttribute("aria-expanded", "false");

  await more.focus();
  await page.keyboard.press("Enter");
  await expect(menu).toBeVisible();
  await page.locator(".gf-stage").click({ position: { x: 5, y: 5 } });
  await expect(menu).toBeHidden();
});
