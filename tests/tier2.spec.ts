//! Tier-2 wiring E2E: Astray, the pathfinder wrap, is reachable at its own URL,
//! honestly represented (banner + attribution), and actually runs inside the
//! contained sandboxed iframe. This drives the real entry point (`/astray/`),
//! so it proves the whole chain: registry -> chrome -> mountWrappedGame ->
//! vendored bundle. The reusable containment/legibility gate is a separate spec
//! (tier2-containment.spec.ts).

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("Astray loads at its own URL with the honest-representation banner", async ({ page }) => {
  await page.goto("/astray/");

  const banner = page.locator(".wrapped-banner");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText(/no verifiable record/i);
  // Attribution: author, license, and a source link to the upstream repo.
  await expect(banner).toContainText("wwwtyro");
  await expect(banner).toContainText("The Unlicense");
  const source = banner.getByRole("link", { name: /source/i });
  await expect(source).toHaveAttribute("href", "https://github.com/wwwtyro/Astray");
});

test("Astray mounts a contained sandboxed iframe and renders its canvas", async ({ page }) => {
  await page.goto("/astray/");

  const frame = page.locator("iframe.wrapped-game-frame");
  await expect(frame).toBeVisible();
  // Phase 0 containment level: opaque origin, no allow-same-origin.
  await expect(frame).toHaveAttribute("sandbox", "allow-scripts");
  await expect(frame).toHaveAttribute("src", "/astray/vendor/index.html");

  // The game actually runs: Three.js appends a WebGL canvas inside the frame.
  const canvas = page.frameLocator("iframe.wrapped-game-frame").locator("canvas").first();
  await expect(canvas).toBeAttached({ timeout: 15000 });
});

test("the chrome around a wrapped game is accessible (axe clean)", async ({ page }) => {
  await page.goto("/astray/");
  await expect(page.locator(".wrapped-banner")).toBeVisible();
  // The embedded game canvas is exempt; our surrounding chrome must be clean.
  const results = await new AxeBuilder({ page })
    .exclude("iframe.wrapped-game-frame")
    .analyze();
  expect(results.violations).toEqual([]);
});

test("a Tier-1 game shows no wrapped-game banner (honesty both ways)", async ({ page }) => {
  await page.goto("/solitaire/");
  await expect(page.locator(".wrapped-banner")).toHaveCount(0);
});
