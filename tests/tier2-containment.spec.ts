//! The reusable Tier-2 containment/legibility gate. Every wrapped game is
//! untrusted third-party code in our chrome, so — in a real browser — it must be
//! proven to stay contained, coexist legibly with our UI, and not trap the user.
//! This spec is PARAMETERIZED over every game that ships a `tier2.meta.json`, so
//! a new wrap is enrolled automatically. It asserts the game's *real* behavior
//! matches the *declared* posture in its meta (sandbox flags, same-origin egress).
//!
//! RED-capability for the egress assertion was demonstrated in Phase 0 (an
//! injected external tracker was caught); it is not re-run destructively here.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { parseTier2Meta, type Tier2Meta } from "../src/tier2-meta.js";

/** Discover Tier-2 games by their on-disk meta — no game-module imports needed. */
function tier2Games(): Tier2Meta[] {
  const gamesDir = join(process.cwd(), "src", "games");
  if (!existsSync(gamesDir)) return [];
  const metas: Tier2Meta[] = [];
  for (const name of readdirSync(gamesDir)) {
    const metaPath = join(gamesDir, name, "tier2.meta.json");
    if (!existsSync(metaPath)) continue;
    metas.push(parseTier2Meta(JSON.parse(readFileSync(metaPath, "utf8")), name));
  }
  return metas;
}

const GAMES = tier2Games();

// Attach an off-origin egress recorder + uncaught-error recorder to a page.
function watch(page: Page, origin: string): { egress: string[]; crashes: string[] } {
  const egress: string[] = [];
  const crashes: string[] = [];
  page.route("**", (route) => {
    const url = route.request().url();
    if (!url.startsWith(origin) && !url.startsWith("data:") && !url.startsWith("blob:")) {
      egress.push(url);
    }
    return route.continue();
  });
  page.on("pageerror", (e) => crashes.push(e.message));
  return { egress, crashes };
}

test.describe("Tier-2 containment/legibility gate", () => {
  test.skip(GAMES.length === 0, "no Tier-2 games are shipped yet");

  for (const meta of GAMES) {
    const id = meta.id;

    test(`${id}: stays contained (declared sandbox, same-origin egress, no breakout)`, async ({
      page,
      baseURL,
    }) => {
      const origin = new URL(baseURL ?? "http://localhost:4180").origin;
      const { egress, crashes } = watch(page, origin);

      await page.goto(`/${id}/`, { waitUntil: "networkidle" });
      const frame = page.locator("iframe.wrapped-game-frame");
      await expect(frame).toBeVisible();

      // Real sandbox attribute matches the declared posture (and never weakens it).
      await expect(frame).toHaveAttribute("sandbox", meta.posture.sandbox);
      expect(meta.posture.sandbox).not.toContain("allow-same-origin");

      // Let the game run a beat, then assert containment held.
      await page.waitForTimeout(2500);

      // Same-origin egress posture: nothing left our origin.
      expect(egress, `off-origin egress from ${id}: ${egress.join(", ")}`).toEqual([]);
      // No uncaught exceptions from the wrapped code bubbling into our page.
      expect(crashes, `uncaught errors from ${id}: ${crashes.join(" | ")}`).toEqual([]);
      // No top-window breakout: we are still on the game's own URL.
      expect(new URL(page.url()).pathname).toBe(`/${id}/`);
      // The opaque-origin frame cannot have written to OUR origin's storage.
      const ourStorage = await page.evaluate(() => window.localStorage.length);
      expect(ourStorage).toBe(0);
    });

    test(`${id}: is legible in our chrome at desktop and 360px`, async ({ page }) => {
      await page.goto(`/${id}/`, { waitUntil: "networkidle" });

      // The honest-representation banner is present and states the posture.
      const banner = page.locator(".wrapped-banner");
      await expect(banner).toBeVisible();
      await expect(banner).toContainText(/no verifiable record/i);
      // Our header chrome stays visible and usable (back-to-drawer + how-to).
      await expect(page.locator(".chrome-header")).toBeVisible();
      await expect(page.locator(".how-to-link")).toBeVisible();

      // No horizontal overflow at a narrow phone width.
      await page.setViewportSize({ width: 360, height: 720 });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `horizontal overflow at 360px: ${overflow}px`).toBeLessThanOrEqual(1);

      // Our surrounding chrome is accessible (the embedded game canvas is exempt).
      const results = await new AxeBuilder({ page })
        .exclude("iframe.wrapped-game-frame")
        .analyze();
      expect(results.violations).toEqual([]);
    });

    test(`${id}: takes input without trapping focus, and full-screen stays legible`, async ({
      page,
    }) => {
      await page.goto(`/${id}/`, { waitUntil: "networkidle" });
      const frame = page.locator("iframe.wrapped-game-frame");
      await expect(frame).toBeVisible();

      // The frame takes keyboard focus on its own (no manual focus() first) —
      // an opaque-origin sandbox otherwise leaves key events at the parent, so a
      // keyboard game never receives them. This is the regression guard for that.
      await expect(frame).toBeFocused();

      // Input reaches the game; the top window does not navigate away.
      await page.keyboard.press("ArrowUp");
      await page.waitForTimeout(200);
      expect(new URL(page.url()).pathname).toBe(`/${id}/`);

      // Focus can return to our chrome — no focus trap inside the frame.
      await page.locator(".drawer-toggle").focus();
      await expect(page.locator(".drawer-toggle")).toBeFocused();

      // Full-screen keeps the game mounted and the frame visible.
      await page.getByRole("button", { name: /toggle full screen/i }).click();
      await expect(page.locator("body")).toHaveClass(/fullscreen/);
      await expect(frame).toBeVisible();
    });
  }
});
