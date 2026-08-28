//! The accessibility matrix (M6): every surface, every skin.
//!
//! The workspace standard is one a11y bar — axe through Playwright, blocking on
//! serious+critical, **every page × every theme/skin**
//! (`croft-pwa/docs/ACCESSIBILITY.md`). Since M4 there are four skins rather than
//! two palettes, and each game page wears the shared chrome, so a skin that
//! degrades a control's contrast degrades it on twenty pages at once.
//!
//! This enumerates REGISTRY × SKINS in one place instead of scattering the
//! matrix across twenty specs. Each game's own spec keeps its existing
//! palette-pair scan for the states only it can reach (mid-game, result, tutor);
//! this covers the entry state of every page under every skin.
//!
//! Cost was MEASURED before it was adopted, not estimated — see the plan's D3.

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { REGISTRY } from "../src/registry.js";
import { SKINS } from "../src/skins.js";
import { LAYOUT_KEY } from "../src/shelf.js";

const ALL_SKINS = Object.keys(SKINS);

async function withSkin(page: Page, skin: string, extra?: [string, string]): Promise<void> {
  await page.addInitScript(
    (args) => {
      const [k, v, ek, ev] = args as string[];
      localStorage.setItem(k as string, v as string);
      if (ek) localStorage.setItem(ek, ev as string);
    },
    ["fun-skin", skin, extra?.[0] ?? "", extra?.[1] ?? ""],
  );
}

async function scan(page: Page): Promise<void> {
  // Tier-2 wraps are taken as-is and run in a sandboxed iframe; their internal
  // markup is not ours to fix and is not graded against our bar. This is the
  // repo's existing convention, not a new exclusion — tests/tier2.spec.ts and
  // tests/orchard-drop.spec.ts both scope their scans the same way. What IS
  // graded is our chrome around the frame, including the attribution banner.
  const results = await new AxeBuilder({ page }).exclude("iframe.wrapped-game-frame").analyze();
  expect(results.violations).toEqual([]);
}

// --- the shared surfaces: chrome, both home layouts, how-to, the picker -------
for (const skin of ALL_SKINS) {
  test(`${skin}: both home layouts are clean`, async ({ page }) => {
    for (const layout of ["today-first", "shelf"]) {
      await withSkin(page, skin, [LAYOUT_KEY, layout]);
      await page.goto("/");
      await expect(page.locator(`.home[data-layout="${layout}"]`)).toBeVisible();
      await scan(page);
    }
  });

  test(`${skin}: the drawer, the picker and how-to are clean`, async ({ page }) => {
    await withSkin(page, skin);
    await page.goto("/");
    await page.getByRole("button", { name: /open games drawer/i }).click();
    await scan(page);
    // The toggle relabels itself to "Close games drawer" when open, so the
    // accessible name matches two elements. Address the drawer's own control.
    await page.locator(".drawer-close").click();
    await page.getByRole("button", { name: /appearance settings/i }).click();
    await scan(page);
    await page.goto("/how-to/?game=solitaire");
    await scan(page);
  });
}

// --- every game's entry state, under every skin -------------------------------
const PLAYABLE = REGISTRY.filter((g) => g.status === "playable").map((g) => g.id);

for (const skin of ALL_SKINS) {
  test(`${skin}: every game's entry state is clean`, async ({ page }) => {
    for (const id of PLAYABLE) {
      await withSkin(page, skin);
      await page.goto(`/${id}/`);
      await expect(page.locator("#play-area")).toBeVisible();
      await scan(page);
    }
  });
}
