//! Tier-2 wiring E2E: Orchard Drop, the fruit-merge wrap, is reachable at its own
//! URL, honestly represented (banner + attribution), and actually runs inside the
//! contained sandboxed iframe. This drives the real entry point (`/orchard-drop/`),
//! so it proves the whole chain: registry -> chrome -> mountWrappedGame ->
//! vendored bundle. The reusable containment/legibility gate is a separate spec
//! (tier2-containment.spec.ts), which enrols this game automatically from its meta.

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("Orchard Drop loads at its own URL with the honest-representation banner", async ({
  page,
}) => {
  await page.goto("/orchard-drop/");

  const banner = page.locator(".wrapped-banner");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText(/no verifiable record/i);
  // Attribution: credits Matter.js physics, notes the Suika homage, links source.
  await expect(banner).toContainText("@liabru");
  await expect(banner).toContainText(/homage to Suika Game/i);
  await expect(banner).toContainText(/with thanks/i);
  const source = banner.getByRole("link", { name: /view the original/i });
  await expect(source).toHaveAttribute("href", "https://github.com/CroftCommunity/fun");
});

test("Orchard Drop mounts a contained sandboxed iframe and renders its canvas", async ({
  page,
}) => {
  await page.goto("/orchard-drop/");

  const frame = page.locator("iframe.wrapped-game-frame");
  await expect(frame).toBeVisible();
  // Phase 0 containment level: opaque origin, no allow-same-origin.
  await expect(frame).toHaveAttribute("sandbox", "allow-scripts");
  await expect(frame).toHaveAttribute("src", "/orchard-drop/vendor/index.html");

  // The game actually runs: it draws the crate onto its canvas inside the frame.
  const canvas = page.frameLocator("iframe.wrapped-game-frame").locator("#gameCanvas");
  await expect(canvas).toBeAttached({ timeout: 15000 });
});

test("the chrome around Orchard Drop is accessible (axe clean)", async ({ page }) => {
  await page.goto("/orchard-drop/");
  await expect(page.locator(".wrapped-banner")).toBeVisible();
  // The embedded game canvas is exempt; our surrounding chrome must be clean.
  const results = await new AxeBuilder({ page })
    .exclude("iframe.wrapped-game-frame")
    .analyze();
  expect(results.violations).toEqual([]);
});
