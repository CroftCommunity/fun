import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("home page lists the games and the drawer opens", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /open games drawer/i }).click();
  await expect(page.locator("#games-drawer")).toBeVisible();
  await expect(page.locator(".drawer-item")).toHaveCount(13);
});

test("the drawer recollapses via its close button and via clicking off", async ({
  page,
}) => {
  await page.goto("/");
  const openBtn = page.getByRole("button", { name: /open games drawer/i });
  const drawer = page.locator("#games-drawer");

  // Close button inside the drawer.
  await openBtn.click();
  await expect(drawer).toBeVisible();
  await drawer.getByRole("button", { name: /close games drawer/i }).click();
  await expect(drawer).toBeHidden();

  // Click-off: tapping the backdrop beside the drawer recollapses it. Click the
  // off-area to the right of the drawer (the drawer sits above the scrim, so a
  // tap over the drawer navigates instead — that is not "clicking off").
  await openBtn.click();
  await expect(drawer).toBeVisible();
  const scrim = page.locator(".drawer-scrim");
  const box = await scrim.boundingBox();
  expect(box).not.toBeNull();
  await scrim.click({ position: { x: box!.width - 12, y: 120 } });
  await expect(drawer).toBeHidden();
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
