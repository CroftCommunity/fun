//! Tier-2 wiring E2E: a wrapped game is reachable at its own URL, honestly
//! represented (banner + attribution), and actually runs inside the contained
//! sandboxed iframe. Driving the real entry point proves the whole chain:
//! registry -> chrome -> mountWrappedGame -> vendored bundle.
//!
//! It ENUMERATES rather than naming a game. It used to hardcode Astray, which
//! was removed 2026-08-28; hardcoding the next one just moves the problem, and
//! pins a game that may be mid-rewrite. With no Tier-2 games the suite skips,
//! and the gate returns by itself when a wrap arrives.
//!
//! The reusable containment/legibility gate is a separate spec
//! (tier2-containment.spec.ts), which enumerates the same way.

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { REGISTRY } from "../src/registry.js";

function firstTier2(): string | null {
  const dir = join(process.cwd(), "src", "games");
  if (!existsSync(dir)) return null;
  for (const name of readdirSync(dir).sort()) {
    if (existsSync(join(dir, name, "tier2.meta.json"))) return name;
  }
  return null;
}

const GAME = firstTier2();

test.skip(GAME === null, "no Tier-2 wraps on the shelf");

test("a wrapped game loads at its own URL with the honest-representation banner", async ({ page }) => {
  await page.goto(`/${GAME}/`);

  // Assert against the game's OWN attribution rather than hardcoded strings.
  // The previous version pinned Astray's author and licence; when Astray went,
  // the literals stayed and pointed at a game that no longer existed.
  const entry = REGISTRY.find((g) => g.id === GAME);
  const attribution = entry && "attribution" in entry ? entry.attribution : undefined;

  const banner = page.locator(".wrapped-banner");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText(/no verifiable record/i);
  await expect(banner).toContainText(/with thanks/i);
  if (attribution) {
    await expect(banner).toContainText(attribution.author);
    await expect(banner).toContainText(attribution.license);
    const source = banner.getByRole("link", { name: /view the original/i });
    await expect(source).toHaveAttribute("href", attribution.upstreamUrl);
  }
});

test("a wrapped game mounts a contained sandboxed iframe and renders its canvas", async ({ page }) => {
  await page.goto(`/${GAME}/`);

  const frame = page.locator("iframe.wrapped-game-frame");
  await expect(frame).toBeVisible();
  // Phase 0 containment level: opaque origin, no allow-same-origin.
  await expect(frame).toHaveAttribute("sandbox", "allow-scripts");
  await expect(frame).toHaveAttribute("src", `/${GAME}/vendor/index.html`);

  // The game actually runs: Three.js appends a WebGL canvas inside the frame.
  const canvas = page.frameLocator("iframe.wrapped-game-frame").locator("canvas").first();
  await expect(canvas).toBeAttached({ timeout: 15000 });
});

test("the chrome around a wrapped game is accessible (axe clean)", async ({ page }) => {
  await page.goto(`/${GAME}/`);
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
