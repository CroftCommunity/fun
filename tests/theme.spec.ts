//! Phase E wiring test: the chrome and the solitaire board wear the token
//! palette, the header toggle flips light/dark and actually changes computed
//! styles, and axe finds no contrast violations in EITHER theme (the edges, not
//! one happy-path theme).

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function toggleTheme(page: Page): Promise<void> {
  await page.getByRole("button", { name: /toggle light or dark theme/i }).click();
}

async function themeAttr(page: Page): Promise<string | null> {
  return page.evaluate(() => document.documentElement.getAttribute("data-theme"));
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

  const before = await themeAttr(page);
  expect(before === "light" || before === "dark").toBe(true);
  const bodyBgBefore = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  await toggleTheme(page);

  const after = await themeAttr(page);
  expect(after).not.toBe(before);
  const bodyBgAfter = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bodyBgAfter).not.toBe(bodyBgBefore);
});

test("home page has no axe violations in light AND dark themes", async ({ page }) => {
  await page.goto("/");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await toggleTheme(page);
  expect(await themeAttr(page)).toBe("dark");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("solitaire board has no axe violations in light AND dark themes", async ({ page }) => {
  await page.goto("/solitaire/?seed=0");
  await expect(page.locator(".sol-board")).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await toggleTheme(page);
  await expect(page.locator(".sol-board")).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
