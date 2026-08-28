//! The appearance picker in a real browser (M5).

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

async function openPicker(page: import("@playwright/test").Page): Promise<void> {
  await page.getByRole("button", { name: /appearance settings/i }).click();
  await expect(page.locator("#appearance-panel")).toBeVisible();
}

test("the picker lists families, never the four skins", async ({ page }) => {
  await page.goto("/");
  await openPicker(page);
  const styles = page.locator('[data-setting="style"] .sheet-choice-opt');
  await expect(styles).toHaveCount(2);
  await expect(styles.first()).toContainText("Gallery of Worlds");
  await expect(styles.nth(1)).toContainText("The Pond");
});

test("choosing a style repaints without changing which side you are on", async ({ page }) => {
  await page.goto("/");
  await openPicker(page);
  await page.getByRole("button", { name: /toggle light or dark theme/i }).click();
  const before = await page.locator("html").getAttribute("data-skin");
  expect(before).toContain("-dark");

  await page.locator('[data-setting="style"] input[value="pond"]').check();
  await expect(page.locator("html")).toHaveAttribute("data-skin", "pond-dark");
});

test("choosing a home layout overrides the style's suggestion, and can be handed back", async ({
  page,
}) => {
  await page.goto("/");
  await openPicker(page);
  // Gallery of Worlds prefers today-first.
  await expect(page.locator('.home[data-layout="today-first"]')).toBeVisible();

  await page.locator('[data-setting="layout"] input[value="shelf"]').check();
  await expect(page.locator('.home[data-layout="shelf"]')).toBeVisible();

  await page.locator('[data-setting="layout"] input[value=""]').check();
  await expect(page.locator('.home[data-layout="today-first"]')).toBeVisible();
});

test("switching to The Pond brings its preferred layout with it", async ({ page }) => {
  await page.goto("/");
  await openPicker(page);
  await page.locator('[data-setting="style"] input[value="pond"]').check();
  // The Pond prefers the shelf index — and nothing was stored, so the
  // suggestion applies rather than being overridden.
  await expect(page.locator('.home[data-layout="shelf"]')).toBeVisible();
});

test("the picker has no axe violations", async ({ page }) => {
  await page.goto("/");
  await openPicker(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
