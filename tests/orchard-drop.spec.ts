//! Orchard Drop wiring test — the NATIVE game, not the wrap it replaced.
//!
//! The negative assertions matter as much as the positive ones: no iframe, no
//! "no verifiable record" banner. Those are what prove the Tier-2 wrap is gone
//! rather than merely hidden behind something.
//!
//! Reachability is proven through the real `/orchard-drop/` URL, and the axe
//! scan runs across the skin registry with no exclusion — §9's
//! embedded-canvas exemption went with the iframe.

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { boardTopStable } from "./helpers/board-top.js";

async function ready(page: Page): Promise<void> {
  await expect(page.locator(".orch-canvas")).toBeVisible();
  // The hook is installed before the wasm binding has loaded, so `world()` is
  // null for a beat — long enough on a starved CI shard for the first evaluate
  // to land on it (main run 33279530068, mobile-webkit 3/3). Ready means a world.
  await page.waitForFunction(() => Boolean(window.__orchard?.world()));
}

test("the crate renders natively — no iframe, no borrowed chrome", { tag: "@smoke" }, async ({ page }) => {
  await page.goto("/orchard-drop/?seed=7");
  await ready(page);

  // The wrap is gone, not hidden. The `.wrapped-banner` assertion that used to
  // sit here was dropped when Tier 2 was purged: nothing can emit that class any
  // more, so the check could never fail and was no longer evidence of anything.
  await expect(page.locator("iframe")).toHaveCount(0);
  await expect(page.getByText(/no verifiable record/i)).toHaveCount(0);

  // ... and the native surface is here.
  await expect(page.locator(".orch-canvas")).toBeVisible();
  // Score, best and the next fruit are the frame's meters; the game's own HUD and
  // mode buttons are gone, and Daily/Free play is the New game card.
  await expect(page.locator('.gf-stat[data-meter="score"]')).toContainText(/score/i);
  await expect(page.locator('.gf-stat[data-meter="best"]')).toContainText(/best/i);
  await expect(page.locator('.gf-stat[data-meter="next"]')).toContainText(/next/i);
  await expect(page.locator('.gf-stat[data-meter="next"] .gf-stat-value')).toHaveText(/cherry|strawberry|grape|[a-z]+/);
  await expect(page.locator(".orch-hud, .orch-modes")).toHaveCount(0);
  await expect(page.locator(".gf-mode")).toHaveText(/free/i);
});

test("the New game card picks Daily or Free play, and the chip says which", async ({ page }) => {
  await page.goto("/orchard-drop/?seed=7");
  await ready(page);
  await page.locator('.gf-verb[data-verb="new"]').click();
  const sheet = page.locator(".gf-sheet");
  await expect(sheet.locator('[data-setting="mode"] .sheet-choice-opt')).toHaveText(["Daily", "Free play"]);
  await sheet.locator('[data-setting="mode"] input[value="daily"]').check();
  await sheet.locator(".gf-sheet-start").click();
  await ready(page);
  await expect(page.locator(".gf-mode")).toHaveText(/daily/i);
});

test("a drop does not move the crate, and neither does the settings sheet", { tag: "@smoke" }, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/orchard-drop/?seed=7");
  await ready(page);
  const v = await boardTopStable(page, ".orch-canvas", async () => {
    await page.evaluate(() => {
      const o = window.__orchard!;
      o.aim(120);
      o.release();
      o.fastForward(40);
    });
    // The fast-forward is instantaneous; give the sampler frames to watch the
    // settled crate before the sheet opens (the claim is about layout across both).
    await page.waitForTimeout(250);
    await page.locator('.gf-verb[data-verb="settings"]').click();
    await expect(page.locator(".gf-sheet")).toBeVisible();
    await page.keyboard.press("Escape");
  });
  expect(v.frames).toBeGreaterThan(5);
  expect(v, `crate top moved ${v.delta}px over ${v.frames} frames`).toMatchObject({ stable: true });
});

test("a drop puts fruit in the crate through the core", async ({ page }) => {
  await page.goto("/orchard-drop/?seed=7");
  await ready(page);

  expect(await page.evaluate(() => window.__orchard!.world()!.fruit.length)).toBe(0);
  await page.evaluate(() => {
    window.__orchard!.aim(220);
    window.__orchard!.release();
  });
  expect(await page.evaluate(() => window.__orchard!.world()!.fruit.length)).toBe(1);
});

test("the cooldown is the core's rule, not the UI's", async ({ page }) => {
  await page.goto("/orchard-drop/?seed=7");
  await ready(page);
  // Two drops back to back: the second is refused because the core says so.
  await page.evaluate(() => {
    window.__orchard!.aim(150);
    window.__orchard!.release();
    window.__orchard!.aim(300);
    window.__orchard!.release();
  });
  expect(await page.evaluate(() => window.__orchard!.world()!.fruit.length)).toBe(1);
  // After the cooldown elapses, the same gesture is accepted.
  await page.evaluate(() => {
    window.__orchard!.fastForward(40);
    window.__orchard!.aim(300);
    window.__orchard!.release();
  });
  expect(await page.evaluate(() => window.__orchard!.world()!.fruit.length)).toBe(2);
});

test("keyboard aims and drops, with a visible focus ring", async ({ page }) => {
  await page.goto("/orchard-drop/?seed=7");
  await ready(page);
  await page.locator(".orch-surface").focus();
  await expect(page.locator(".orch-surface")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Space");
  expect(await page.evaluate(() => window.__orchard!.world()!.fruit.length)).toBe(1);
});

test("the crate is described in text for anyone not looking at pixels", async ({ page }) => {
  // A canvas is opaque to assistive technology. The live region beside it is the
  // actual interface for a screen reader, so it has to say something true.
  await page.goto("/orchard-drop/?seed=7");
  await ready(page);
  await page.evaluate(() => {
    window.__orchard!.aim(220);
    window.__orchard!.release();
  });
  await expect(page.locator(".sol-status")).toContainText(/score/i);
  await expect(page.locator(".sol-status")).toContainText(
    /cherry|strawberry|grape|dekopon|persimmon/i,
  );
});

test("a finished run produces a record that re-verifies", async ({ page }) => {
  test.slow();
  await page.goto("/orchard-drop/?seed=5");
  await ready(page);
  // Play down one column until the crate overflows.
  await page.evaluate(() => {
    const o = window.__orchard!;
    for (let i = 0; i < 400 && !o.over(); i++) {
      o.aim(220);
      o.release();
      o.fastForward(40);
    }
  });
  expect(await page.evaluate(() => window.__orchard!.over())).toBe(true);
  await expect(page.locator(".sol-result")).toBeVisible();
  await expect(page.locator(".sol-result h2")).toContainText(/verified/i);

  // Re-verify through the UI: the button re-derives rather than trusting.
  await page.getByRole("button", { name: /re-verify/i }).click();
  await expect(page.locator(".sol-status")).toContainText(/re-verified/i);
});

test("no axe violations across the skin registry", async ({ page }) => {
  // No `.exclude()`. §9's embedded-canvas exemption left with the iframe, so the
  // whole surface is ours and answers for itself.
  await page.goto("/orchard-drop/?seed=7");
  await ready(page);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("the crate fits a narrow phone without sideways scroll", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 720 });
  await page.goto("/orchard-drop/?seed=7");
  await ready(page);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  // Mode buttons meet the 44px tap floor.
  for (const b of await page.locator(".orch-mode").all()) {
    const box = await b.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
});
