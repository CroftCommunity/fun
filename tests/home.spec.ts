//! The home page (M3), in a real browser.
//!
//! Before this phase `/` rendered one sentence — "Pick a game from the drawer to
//! play." — over an empty page, with twenty games behind a hamburger. These
//! tests hold the front door to being an actual front door, in both layouts, and
//! pin the rule that a layout preference is a suggestion rather than a lock.

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { LAYOUT_KEY } from "../src/shelf.js";

async function homeWith(page: Page, layout?: string): Promise<void> {
  if (layout !== undefined) {
    await page.addInitScript(
      ([k, v]) => localStorage.setItem(k as string, v as string),
      [LAYOUT_KEY, layout],
    );
  }
  await page.goto("/");
  await expect(page.locator(".home")).toBeVisible();
}

test("the front door lists games instead of a sentence", { tag: "@smoke" }, async ({ page }) => {
  await homeWith(page);
  await expect(page.locator(".home")).toBeVisible();
  // Every playable game is reachable from the home page itself, not only from
  // the drawer — that is the whole point of the phase.
  const links = page.locator(".home a[data-game-id]");
  expect(await links.count()).toBeGreaterThanOrEqual(15);
  await expect(page.locator('.home a[data-game-id="solitaire"]')).toBeVisible();
});

test("the shelf layout argues in words; today-first does not", async ({ page }) => {
  await homeWith(page, "shelf");
  await expect(page.locator('.home[data-layout="shelf"]')).toBeVisible();
  await expect(page.locator(".home-blurb").first()).toBeVisible();

  await homeWith(page, "today-first");
  await expect(page.locator('.home[data-layout="today-first"]')).toBeVisible();
  await expect(page.locator(".home-blurb")).toHaveCount(0);
});

test("an explicit layout choice beats the family's preference", async ({ page }) => {
  // The Card table family prefers today-first. Choosing shelf must win — a
  // preference overridable only one way is a lock wearing a preference's name.
  await homeWith(page, "shelf");
  await expect(page.locator('.home[data-layout="shelf"]')).toBeVisible();
});

test("a stale layout id falls back rather than rendering an empty page", async ({ page }) => {
  await homeWith(page, "mosaic");
  await expect(page.locator('.home[data-layout="today-first"]')).toBeVisible();
});

test("opening a game makes it the one you jump back into", async ({ page }) => {
  await page.goto("/othello/");
  // Wait on the shared chrome rather than a game-specific board: the shelf
  // records the open at mount, and this test is about the shelf, not othello.
  await expect(page.locator("#play-area")).toBeVisible();
  await page.goto("/");
  await expect(page.locator(".home-resume")).toContainText("Othello");
});

test("today's boards are listed, and opening one marks it", async ({ page }) => {
  await homeWith(page);
  await expect(page.locator(".home-daily").first()).toBeVisible();
  await expect(page.locator(".home-daily.is-opened")).toHaveCount(0);

  await page.goto("/wyrdle/");
  await page.goto("/");
  await expect(page.locator(".home-daily.is-opened")).toHaveCount(1);
  await expect(page.locator(".home-daily.is-opened")).toContainText("Wyrdle");
});

for (const layout of ["today-first", "shelf"] as const) {
  test(`the ${layout} home has no axe violations in both palettes`, async ({ page }) => {
    await homeWith(page, layout);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.getByRole("button", { name: /toggle light or dark theme/i }).click();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
}

test("home's Continue shows where you were, from the progress store", { tag: "@smoke" }, async ({ page }) => {
  // Seeded, because no listed game snapshots yet (the placeholder does, but the home
  // page does not list it). The record is what Phase 6's Othello will write.
  await page.addInitScript(() => {
    if (localStorage.getItem("fun-progress-othello") !== null || sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    const now = new Date().toISOString();
    localStorage.setItem(
      "fun-progress-othello",
      JSON.stringify({ v: 1, status: "in-progress", startedAt: now, updatedAt: now, setup: { mode: "free" }, record: {}, summary: { line: "Move 14 · you lead 9–4" } }),
    );
  });
  await page.goto("/");
  const card = page.locator(".home-resume");
  await expect(card).toContainText("Othello");
  await expect(card.locator(".home-resume-line")).toHaveText("Move 14 · you lead 9–4");
  // New game from the continue card clears the store; home falls back to "last played"
  await page.goto("/othello/");
  await page.locator(".gf-continue .gf-newgame").click();
  await expect(page.locator(".gf-poster")).toBeVisible();
  await page.goto("/");
  await expect(page.locator(".home-resume")).toContainText("Othello");
  await expect(page.locator(".home-resume-line")).toHaveCount(0);
});
