//! The music transport in a real browser: the four controls, the list under
//! the name, coupling across a navigation, and the phone-width collapse.

import { expect, test, type Page } from "@playwright/test";

import { COUPLE_KEY, TRACK_KEY } from "../src/music.js";

const name = (page: Page) => page.locator(".chrome-header .music-name");

test("the name drops the list; picking a track renames the bar", { tag: "@smoke" }, async ({ page }) => {
  await page.goto("/");
  await expect(name(page)).toContainText("Morning Miles");
  await name(page).click();
  const list = page.locator("#music-list");
  await expect(list).toBeVisible();
  await expect(list.getByRole("checkbox", { name: /couple tracks to games/i })).toBeChecked();
  await list.locator('.music-track[data-track="morning-grid"]').click();
  await expect(list).toBeHidden();
  await expect(name(page)).toContainText("Morning Grid");
});

test("coupled: opening a game starts that game's track, not the pick", async ({ page }) => {
  await page.goto("/");
  await name(page).click();
  await page.locator('.music-track[data-track="morning-grid"]').click();
  await page.goto("/solitaire/");
  await expect(name(page)).toContainText("Sunset at the Harbor");
});

test("uncoupled: the pick follows you into a game", async ({ page }) => {
  await page.goto("/");
  await name(page).click();
  await page.getByRole("checkbox", { name: /couple tracks to games/i }).uncheck();
  await page.locator('.music-track[data-track="morning-grid"]').click();
  expect(await page.evaluate(([c, t]) => [localStorage.getItem(c!), localStorage.getItem(t!)], [COUPLE_KEY, TRACK_KEY])).toEqual(["off", "morning-grid"]);
  await page.goto("/solitaire/");
  await expect(name(page)).toContainText("Morning Grid");
});

test("play/pause in the bar is the sheet's Music toggle", async ({ page }) => {
  await page.goto("/");
  const play = page.getByRole("button", { name: /play music/i });
  await play.click();
  await expect(page.getByRole("button", { name: /pause music/i })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: /appearance settings/i }).click();
  await expect(page.locator('[data-setting="music"] input')).toBeChecked();
});

test("prev/next sit in the bar on a desktop and in the list on a phone", async ({ page, isMobile }) => {
  await page.goto("/");
  const inBar = page.locator(".chrome-header .music-bar > .music-next");
  const inList = page.locator("#music-list .music-next");
  if (isMobile) {
    await expect(inBar).toBeHidden();
    await name(page).click();
    await expect(inList).toBeVisible();
    await inList.click();
  } else {
    await expect(inBar).toBeVisible();
    await inBar.click();
  }
  await expect(name(page)).toContainText("Porch Light Nocturne");
});

test("the header never scrolls sideways with the bar in it", async ({ page }) => {
  await page.goto("/solitaire/");
  const overflow = await page.evaluate(() => {
    const h = document.querySelector(".chrome-header")!;
    return h.scrollWidth - h.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(0);
});
