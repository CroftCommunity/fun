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

async function ready(page: Page): Promise<void> {
  await expect(page.locator(".orch-canvas")).toBeVisible();
  await page.waitForFunction(() => Boolean(window.__orchard));
}

test("the crate renders natively — no iframe, no wrapped-game banner", async ({ page }) => {
  await page.goto("/orchard-drop/?seed=7");
  await ready(page);

  // The wrap is gone, not hidden.
  await expect(page.locator("iframe")).toHaveCount(0);
  await expect(page.locator(".wrapped-banner")).toHaveCount(0);
  await expect(page.getByText(/no verifiable record/i)).toHaveCount(0);

  // ... and the native surface is here.
  await expect(page.locator(".orch-canvas")).toBeVisible();
  await expect(page.locator(".orch-hud")).toContainText(/score/i);
  await expect(page.locator(".orch-hud")).toContainText(/next/i);
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
