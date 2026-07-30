import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("home page lists the games and the drawer opens", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /open games drawer/i }).click();
  await expect(page.locator("#games-drawer")).toBeVisible();
  await expect(page.locator(".drawer-item")).toHaveCount(4);
});

test("a game page mounts the module; full-screen preserves the same instance", async ({
  page,
}) => {
  await page.goto("/placeholder/");
  const game = page.locator(".placeholder-game");
  await expect(game).toBeVisible();
  await expect(game).toHaveAttribute("data-mount-count", "1");

  await page.getByRole("button", { name: /toggle full screen/i }).click();
  await expect(page.locator("body")).toHaveClass(/fullscreen/);
  await expect(game).toBeVisible();
  // Same instance: full-screen re-styles the chrome, it does not remount.
  await expect(game).toHaveAttribute("data-mount-count", "1");
});

test("a game page loads standalone at its own URL", async ({ page }) => {
  // Loading /placeholder/ directly (new-tab / shared link) mounts with no
  // dependency on having navigated through the drawer.
  await page.goto("/placeholder/");
  await expect(page.locator(".placeholder-game")).toBeVisible();
});

test("home page has no axe accessibility violations", async ({ page }) => {
  await page.goto("/");
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
