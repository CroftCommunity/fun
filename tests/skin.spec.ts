//! Wiring test: the chrome and the solitaire board wear the token palette, the
//! header control swaps to the family's other palette and actually changes
//! computed styles, and axe finds no contrast violations in EITHER palette (the
//! edges, not one happy-path side).
//!
//! Since M2, light and dark are not an axis — they are SKINS, stamped as
//! `[data-skin]`. The control's aria-label is unchanged ("toggle light or dark
//! theme") because it still describes what the user does, and nineteen other
//! specs address it by that name.

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function toggleTheme(page: Page): Promise<void> {
  await page.getByRole("button", { name: /toggle light or dark theme/i }).click();
}

async function skinAttr(page: Page): Promise<string | null> {
  return page.evaluate(() => document.documentElement.getAttribute("data-skin"));
}

async function bodyBg(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.body).backgroundColor);
}

test("the chrome and the board consume the token palette", async ({ page }) => {
  await page.goto("/solitaire/?seed=0");
  await expect(page.locator(".sol-board")).toBeVisible();

  const styles = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const body = getComputedStyle(document.body);
    const board = getComputedStyle(document.querySelector(".sol-board")!);
    const header = getComputedStyle(document.querySelector(".chrome-header")!);
    return {
      feltToken: root.getPropertyValue("--felt").trim(),
      bodyBg: body.backgroundColor,
      boardBg: board.backgroundColor,
      headerBg: header.backgroundColor,
    };
  });
  // Tokens are loaded, and the board's felt background is a real, opaque colour.
  expect(styles.feltToken).not.toBe("");
  expect(styles.boardBg).not.toBe("rgba(0, 0, 0, 0)");
  expect(styles.headerBg).not.toBe("rgba(0, 0, 0, 0)");
  expect(styles.boardBg).not.toBe(styles.bodyBg); // the felt reads distinct from the page
});

test("the header toggle flips the theme and changes computed styles", async ({ page }) => {
  await page.goto("/solitaire/?seed=0");
  await expect(page.locator(".sol-board")).toBeVisible();

  const before = await skinAttr(page);
  expect(before, "no skin stamped pre-paint").toBeTruthy();
  const bodyBgBefore = await bodyBg(page);

  await toggleTheme(page);

  const after = await skinAttr(page);
  expect(after).not.toBe(before);
  expect(await bodyBg(page)).not.toBe(bodyBgBefore);
});

test("home page has no axe violations in BOTH of the family's palettes", async ({ page }) => {
  await page.goto("/");
  const first = await skinAttr(page);
  const firstBg = await bodyBg(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await toggleTheme(page);

  // Assert we are genuinely scanning a DIFFERENT palette and not the same one
  // twice — the id changing is necessary, the rendered background changing is
  // what proves it took effect.
  expect(await skinAttr(page)).not.toBe(first);
  expect(await bodyBg(page)).not.toBe(firstBg);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("solitaire board has no axe violations in BOTH of the family's palettes", async ({ page }) => {
  await page.goto("/solitaire/?seed=0");
  await expect(page.locator(".sol-board")).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await toggleTheme(page);
  await expect(page.locator(".sol-board")).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
