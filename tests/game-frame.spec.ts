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
  await page.goto("/placeholder/?play=1");
  await ready(page);
  await expect(page.locator(".gf-game-bar .gf-title")).toHaveText("Placeholder");
  // the placeholder's one verb, plus the frame's own Settings
  await expect(page.locator(".gf-dock .gf-verb")).toHaveCount(2);
  await expect(page.locator(".gf-meters .gf-stat")).toHaveCount(1);
});

test("the bands are the reserved heights, to the pixel, on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/placeholder/?play=1");
  await ready(page);
  const h = async (sel: string): Promise<number> => (await page.locator(sel).boundingBox())!.height;
  expect(await h(".gf-game-bar")).toBe(48);
  expect(await h(".gf-meters")).toBe(56);
  expect(await h(".gf-dock")).toBe(72);
});

test("pressing a verb that changes a meter moves the stage by zero pixels", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/placeholder/?play=1");
  await ready(page);
  const before = await top(page, ".gf-stage");
  const gameBefore = await top(page, ".placeholder-game");
  await page.locator('.gf-verb[data-verb="poke"]').click();
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
    await page.goto(`/${id}/?play=1`);
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
  await page.goto("/othello/?play=1");
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

// --- Phase 2b: the tab reads the game's name, not its slug ---

test("a game page's title is the game's display name", { tag: "@smoke" }, async ({ page }) => {
  await page.goto("/trio-tumble/");
  await expect(page).toHaveTitle("Croft · fun — Trio Tumble: Jewel Drop");
  await page.goto("/color-sort/");
  await expect(page).toHaveTitle("Croft · fun — Color Sort");
});

// --- Phase 3a: dock ↔ rail, and the sheets ---

test("at 1000 wide the frame is a rail beside the board; at 899 it is a dock under it", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 680 });
  await page.goto("/placeholder/?play=1");
  await ready(page);
  await expect(page.locator(".gf")).toHaveAttribute("data-gf-shape", "rail");
  const stage = (await page.locator(".gf-stage").boundingBox())!;
  const dock = (await page.locator(".gf-dock").boundingBox())!;
  expect(dock.x).toBeGreaterThan(stage.x + stage.width - 1); // beside, to the right
  await expect(page.locator(".gf-extra")).toBeVisible();
  await expect(page.locator('.gf-verb[data-verb="settings"]')).toBeHidden();

  await page.setViewportSize({ width: 899, height: 680 });
  await expect(page.locator(".gf")).toHaveAttribute("data-gf-shape", "dock");
  const stage2 = (await page.locator(".gf-stage").boundingBox())!;
  const dock2 = (await page.locator(".gf-dock").boundingBox())!;
  expect(dock2.y).toBeGreaterThan(stage2.y + stage2.height - 1); // under
  await expect(page.locator(".gf-extra")).toBeHidden();
  await expect(page.locator('.gf-verb[data-verb="settings"]')).toBeVisible();
});

test("on a phone Settings opens a bottom sheet dialog; Escape and the scrim close it and return focus", { tag: "@smoke" }, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/placeholder/?play=1");
  await ready(page);
  const settings = page.locator('.gf-verb[data-verb="settings"]');
  await settings.click();
  const sheet = page.locator(".gf-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveAttribute("role", "dialog");
  await expect(sheet).toHaveAttribute("aria-modal", "true");
  await expect(sheet.locator(".sheet-section").first()).toHaveText("Every game");
  await expect(sheet.locator('[data-setting="hints"]')).toBeVisible();
  await expect(sheet.locator('[data-setting="sound"]')).toBeVisible();
  // focus moved inside
  expect(await page.evaluate(() => document.activeElement?.closest(".gf-sheet") !== null)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  expect(await page.evaluate(() => document.activeElement?.getAttribute("data-verb"))).toBe("settings");
  await settings.click();
  await expect(sheet).toBeVisible();
  await page.locator(".gf-scrim").click({ position: { x: 10, y: 10 } });
  await expect(sheet).toBeHidden();
  expect(await page.evaluate(() => document.activeElement?.getAttribute("data-verb"))).toBe("settings");
});

test("on desktop the same rows are inline in the rail and no scrim exists", { tag: "@smoke" }, async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 680 });
  await page.goto("/placeholder/?play=1");
  await ready(page);
  await expect(page.locator('.gf-extra [data-setting="hints"]')).toBeVisible();
  await expect(page.locator('.gf-extra [data-setting="declare-assistance"]')).toBeVisible();
  await expect(page.locator(".gf-scrim")).toHaveCount(0);
  await expect(page.locator(".gf-sheet")).toHaveCount(0);
  // the sheet's toggle writes the shared setting: flip Hints and read it back
  await page.locator('.gf-extra [data-setting="hints"] .sheet-toggle-input').click({ force: true });
  expect(await page.evaluate(() => localStorage.getItem("fun-hints"))).toBe("off");
});

// --- Phase 3b: "Controls on the left" ---

test("the mirror preference puts the rail left of the board and reverses the dock, live from the sheet", { tag: "@smoke" }, async ({ page }) => {
  // desktop: rail right by default, left with the preference on
  await page.setViewportSize({ width: 1000, height: 680 });
  await page.goto("/placeholder/?play=1");
  await ready(page);
  const railX = async (): Promise<number> => (await page.locator(".gf-dock").boundingBox())!.x;
  const stageX = async (): Promise<number> => (await page.locator(".gf-stage").boundingBox())!.x;
  expect(await railX()).toBeGreaterThan(await stageX());
  await page.locator('.gf-extra [data-setting="controls-left"] .sheet-toggle-input').click({ force: true });
  await expect(page.locator(".gf")).toHaveAttribute("data-gf-side", "left");
  expect(await railX()).toBeLessThan(await stageX()); // no reload
  expect(await page.evaluate(() => localStorage.getItem("fun-controls-left"))).toBe("on");

  // phone: the dock's verb order reverses — the first verb's x is the largest
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await ready(page);
  await expect(page.locator(".gf")).toHaveAttribute("data-gf-side", "left");
  const xs = await page.locator(".gf-dock .gf-verb").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().x));
  expect(xs[0]).toBeGreaterThan(xs[xs.length - 1]!);
  // and off again, from the phone sheet, without a reload
  await page.locator('.gf-verb[data-verb="settings"]').click();
  await page.locator('.gf-sheet [data-setting="controls-left"] .sheet-toggle-input').click({ force: true });
  await expect(page.locator(".gf")).toHaveAttribute("data-gf-side", "right");
});

// --- Phase 5a: the start screen ---

test("a bare game URL opens on the poster; Play mounts the board without moving the stage", { tag: "@smoke" }, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/placeholder/");
  const poster = page.locator(".gf-poster");
  await expect(poster).toBeVisible();
  await expect(poster.locator("img")).toHaveAttribute("src", "/placeholder/assets/splash.jpg");
  await expect(poster.locator(".gf-start-title")).toHaveText("Placeholder");
  await expect(page.locator(".placeholder-game")).toHaveCount(0);
  // The poster covers the whole frame (the bands under it are declared at mount),
  // so the transition is poster → laid-out board; from first paint on, the stage
  // does not move. "Covers" is measured: it once rendered as a 46px strip with
  // the art cropped to nothing, because `.gf-start` was also the setup sheet's
  // Start button and that rule's height won.
  const posterBox = await poster.boundingBox();
  const artBox = await poster.locator(".gf-start-art").boundingBox();
  expect(posterBox?.height ?? 0).toBeGreaterThan(400);
  expect(artBox?.height).toBe(posterBox?.height);
  await poster.locator(".gf-play").click();
  await expect(poster).toBeHidden();
  await ready(page);
  const stageTop = await top(page, ".gf-stage");
  await page.locator('.gf-verb[data-verb="poke"]').click();
  await expect(page.locator(".gf-stat-value")).toHaveText("1");
  expect(await top(page, ".gf-stage")).toBe(stageTop);
  expect(await page.evaluate(() => localStorage.getItem("fun-progress-placeholder"))).not.toBeNull();
});

test("leaving mid-game and coming back shows the continue card, and Continue restores the game", { tag: "@smoke" }, async ({ page }) => {
  await page.goto("/placeholder/");
  await page.locator(".gf-poster .gf-play").click();
  await ready(page);
  await page.locator('.gf-verb[data-verb="poke"]').click();
  await page.locator('.gf-verb[data-verb="poke"]').click();
  await expect(page.locator(".gf-stat-value")).toHaveText("2");
  await page.reload();
  const card = page.locator(".gf-continue");
  await expect(card).toBeVisible();
  await expect(card.locator(".gf-start-line")).toHaveText("2 pokes");
  await expect(card.locator("img")).toHaveAttribute("src", "/placeholder/assets/icon.jpg");
  await card.locator(".gf-continue-btn").click();
  await ready(page);
  await expect(page.locator(".gf-stat-value")).toHaveText("2"); // the card's number and the board's agree
  // New game from the board's own verb is the game's business; from the card it clears the store
  await page.reload();
  await page.locator(".gf-continue .gf-newgame").click();
  await expect(page.locator(".gf-poster")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("fun-progress-placeholder"))).toBeNull();
});

test("?r= and any other query is a deep link — no poster, the board mounts", async ({ page }) => {
  for (const q of ["?r=x", "?seed=7", "?fast=1"]) {
    await page.goto(`/placeholder/${q}`);
    await ready(page);
    await expect(page.locator(".gf-poster")).toHaveCount(0);
    await expect(page.locator(".gf-continue")).toHaveCount(0);
  }
});

test("storage denied → the poster, no error", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.addInitScript(() => {
    const deny = (): never => {
      throw new Error("denied");
    };
    Object.defineProperty(window, "localStorage", {
      value: { getItem: deny, setItem: deny, removeItem: deny, clear: deny, key: deny, length: 0 },
    });
  });
  await page.goto("/placeholder/");
  await expect(page.locator(".gf-poster")).toBeVisible();
  await page.locator(".gf-poster .gf-play").click();
  await ready(page);
  expect(errors).toEqual([]);
});
