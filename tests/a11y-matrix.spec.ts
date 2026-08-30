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
  // No exclusion. There used to be one for Tier-2's sandboxed iframe — markup
  // that was not ours to fix — and it outlived the tier by a day. An exclusion
  // that excludes nothing is dead weight at best, and at worst a hole waiting
  // for something to fall into it: the next iframe on the shelf would have been
  // silently ungraded. Every surface here is ours now and answers for itself.
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
}

// --- the shared surfaces: chrome, both home layouts, how-to, the picker -------
for (const skin of ALL_SKINS) {
  test(`${skin}: both home layouts are clean`, { tag: "@smoke" }, async ({ page }) => {
    for (const layout of ["today-first", "shelf"]) {
      await withSkin(page, skin, [LAYOUT_KEY, layout]);
      await page.goto("/");
      await expect(page.locator(`.home[data-layout="${layout}"]`)).toBeVisible();
      await scan(page);
    }
  });

  test(`${skin}: the drawer, the picker and how-to are clean`, { tag: "@smoke" }, async ({ page }) => {
    await withSkin(page, skin);
    await page.goto("/");
    await page.getByRole("button", { name: /open games drawer/i }).click();
    await scan(page);
    // The toggle relabels itself to "Close games drawer" when open, so the
    // accessible name matches two elements. Address the drawer's own control.
    await page.locator(".drawer-close").click();
    await page.getByRole("button", { name: /appearance settings/i }).click();
    await scan(page);
    // The music list, open: seventeen buttons and a checkbox the closed state
    // hides from axe entirely — the same lesson as the drawer.
    await page.getByRole("button", { name: /appearance settings/i }).click();
    await page.getByRole("button", { name: /choose a track/i }).filter({ visible: true }).click();
    await expect(page.locator("#music-list")).toBeVisible();
    await scan(page);
    await page.goto("/how-to/?game=solitaire");
    await scan(page);
  });
}

// --- every game's entry state, under every skin -------------------------------
const PLAYABLE = REGISTRY.filter((g) => g.status === "playable").map((g) => g.id);

// ONE TEST PER GAME, not one per skin. Same coverage — every playable game under
// every skin — regrouped along the axis that is useful when it breaks.
//
// As one test per skin, the whole shelf ran inside a single 30s budget: 9.1s
// locally on mobile-webkit, and past 30s on a CI runner, which kept `main` red
// and the site unpublished. Per game it is four scans a test, it parallelises
// across workers instead of four ways, and a failure names the GAME — which is
// the axis an axe violation actually belongs to, since the skins are shared
// chrome and the boards are not.
for (const id of PLAYABLE) {
  test(`${id}: entry state is clean under every skin`, { tag: "@smoke" }, async ({ page }) => {
    for (const skin of ALL_SKINS) {
      await withSkin(page, skin);
      await page.goto(`/${id}/`);
      await expect(page.locator("#play-area")).toBeVisible();
      await scan(page);
    }
  });
}

// The frame's own states the per-game entry scan cannot reach: the settings sheet
// open on a phone, and the rail with its inline rows on desktop. Scanned on the
// placeholder — the frame is shared chrome, so one page grades it for all.
test("placeholder: the settings sheet and the rail are clean under every skin", { tag: "@smoke" }, async ({ page }) => {
  for (const skin of ALL_SKINS) {
    await withSkin(page, skin);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/placeholder/");
    await page.locator('.gf-verb[data-verb="settings"]').click();
    await expect(page.locator(".gf-sheet")).toBeVisible();
    await scan(page);
    await page.setViewportSize({ width: 1000, height: 680 });
    await page.goto("/placeholder/");
    await expect(page.locator(".gf-extra")).toBeVisible();
    await scan(page);
  }
});
