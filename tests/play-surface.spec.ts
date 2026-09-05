//! The play surface ↔ mock F parity (mocks/f-play-surface.html). One test per
//! claim, titled as the claim names it, proving it the way its `kind` says —
//! measure by rects at the two standard frames (390×844, 1280×900).
//!
//! The two systemic findings of 2026-09-04, measured on `fun@c4db11a`:
//!   F1 — the poster's body clips: a setup card taller than the frame hides Play
//!        under `overflow: hidden` (Trio Tumble, Dots, chess on a phone).
//!   F2 — every grid board sizes its cell from the VIEWPORT WIDTH (`clamp(…, 9.5vw,
//!        2.6rem)`), so a 960px-wide, 796px-tall stage holds a 360px board.
//!        The rule the fix installs: a board sizes from the stage's short side.

import { expect, test, type Page } from "@playwright/test";

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The stage's CONTENT box — what a board can actually fill. */
async function stageContent(page: Page): Promise<Box> {
  return page.evaluate(() => {
    const s = document.querySelector(".gf-stage")!;
    const r = s.getBoundingClientRect();
    const cs = getComputedStyle(s);
    const pl = parseFloat(cs.paddingLeft);
    const pr = parseFloat(cs.paddingRight);
    const pt = parseFloat(cs.paddingTop);
    const pb = parseFloat(cs.paddingBottom);
    return { x: r.left + pl, y: r.top + pt, w: r.width - pl - pr, h: r.height - pt - pb };
  });
}

/** The union of the boxes of every element the selectors match. */
async function union(page: Page, selectors: readonly string[]): Promise<Box> {
  return page.evaluate((sels) => {
    const rects = sels.flatMap((s) => [...document.querySelectorAll(s)].map((e) => e.getBoundingClientRect()));
    if (rects.length === 0) throw new Error(`nothing matches ${sels.join(", ")}`);
    const left = Math.min(...rects.map((r) => r.left));
    const top = Math.min(...rects.map((r) => r.top));
    const right = Math.max(...rects.map((r) => r.right));
    const bottom = Math.max(...rects.map((r) => r.bottom));
    return { x: left, y: top, w: right - left, h: bottom - top };
  }, selectors);
}

async function mounted(page: Page): Promise<void> {
  await page.waitForFunction(() => (document.querySelector(".gf-mount")?.children.length ?? 0) > 0);
  await page.waitForTimeout(300);
}

// --- F1: the front door ------------------------------------------------------

const POSTERS = ["chess", "trio-tumble", "dots"] as const;

test("mock F1.1: Play sits inside the viewport on the chess, Trio Tumble and Dots posters at 390×844 and 1280×900", async ({ page }) => {
  for (const vp of [PHONE, DESKTOP]) {
    await page.setViewportSize(vp);
    for (const id of POSTERS) {
      await page.goto(`/${id}/`);
      const play = page.locator(".gf-poster .gf-play");
      await expect(play).toBeVisible();
      const box = await play.boundingBox();
      expect(box, `${id} @ ${vp.width}: Play has a box`).not.toBeNull();
      expect(box!.y, `${id} @ ${vp.width}: Play's top is on screen`).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height, `${id} @ ${vp.width}: Play's bottom is on screen (was clipped by overflow: hidden)`).toBeLessThanOrEqual(vp.height);
      expect(box!.height, `${id} @ ${vp.width}: Play is not squashed`).toBeGreaterThanOrEqual(44);
    }
  }
});

test("mock F1.2: a setup card taller than the poster scrolls inside the poster's body, so every option is reachable", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto("/trio-tumble/");
  await expect(page.locator(".gf-poster .gf-play")).toBeVisible();
  const scrolls = await page.evaluate(() => {
    const body = document.querySelector(".gf-poster .gf-start-body")!;
    return { overflowY: getComputedStyle(body).overflowY, scrollHeight: body.scrollHeight, clientHeight: body.clientHeight };
  });
  expect(scrolls.overflowY).toBe("auto");
  expect(scrolls.scrollHeight, "Trio Tumble's nine options overflow a phone: the body must be the scroller").toBeGreaterThan(scrolls.clientHeight);
  // The last option is reachable — scrolled into view, it sits above Play.
  const last = page.locator(".gf-poster .sheet-choice-opt").last();
  // The page's own scrollIntoView (what focus and a screen reader use), which
  // honours scroll-padding; Playwright's protocol-level scroll does not.
  await last.evaluate((el) => el.scrollIntoView({ block: "nearest" }));
  const lastBox = await last.boundingBox();
  const playBox = await page.locator(".gf-poster .gf-play").boundingBox();
  expect(lastBox!.y + lastBox!.height).toBeLessThanOrEqual(playBox!.y + 1);
});

// --- F2: a board fills the stage ------------------------------------------------

/** A game, its board route, and the elements whose union is "the play surface". */
const GRIDS: readonly { id: string; url: string; surface: readonly string[] }[] = [
  { id: "othello", url: "/othello/?seed=7", surface: [".othello-board"] },
  { id: "checkers", url: "/checkers/?seed=7", surface: [".checkers-board"] },
  { id: "chess", url: "/chess/?seed=7", surface: [".chess-board"] },
  { id: "drop4", url: "/drop4/?seed=7", surface: [".drop4-board"] },
  { id: "dots", url: "/dots/?seed=7", surface: [".dots-board"] },
  { id: "2048", url: "/2048/?seed=7", surface: [".t48-board", ".t48-pad"] },
  { id: "wyrdle", url: "/wyrdle/?seed=7", surface: [".wy-grid", ".wy-keyboard"] },
  { id: "blockdoku", url: "/blockdoku/?seed=7", surface: [".bdk-board", ".bdk-tray"] },
];

test("mock F2.1: at 1280×900 a grid board's play surface uses at least 80% of one axis of the stage (Othello, checkers, chess, Drop 4, Dots, 2048, Wyrdle, Blockdoku)", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  for (const g of GRIDS) {
    await page.goto(g.url);
    await mounted(page);
    const stage = await stageContent(page);
    const box = await union(page, g.surface);
    const fill = Math.max(box.w / stage.w, box.h / stage.h);
    expect(fill, `${g.id}: surface ${Math.round(box.w)}×${Math.round(box.h)} in a stage ${Math.round(stage.w)}×${Math.round(stage.h)}`).toBeGreaterThanOrEqual(0.8);
    expect(box.w, `${g.id}: never wider than the stage`).toBeLessThanOrEqual(stage.w + 1);
    expect(box.h, `${g.id}: never taller than the stage`).toBeLessThanOrEqual(stage.h + 1);
  }
});

test("mock F2.2: at 390×844 the same boards use at least 85% of the stage's width and none of them overflows it", async ({ page }) => {
  await page.setViewportSize(PHONE);
  for (const g of GRIDS) {
    await page.goto(g.url);
    await mounted(page);
    const stage = await stageContent(page);
    const box = await union(page, g.surface);
    expect(box.w / stage.w, `${g.id}: width ${Math.round(box.w)} of ${Math.round(stage.w)}`).toBeGreaterThanOrEqual(0.85);
    expect(box.w, `${g.id}: never wider than the stage`).toBeLessThanOrEqual(stage.w + 1);
    expect(box.h, `${g.id}: never taller than the stage`).toBeLessThanOrEqual(stage.h + 1);
  }
});

test("mock F2.3: at 1280×900 a Color Sort tube is at least 72px wide (it is 46px today, the phone's size)", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/color-sort/?seed=4242");
  await mounted(page);
  const tube = await page.locator(".cs-tube").first().boundingBox();
  expect(tube!.width).toBeGreaterThanOrEqual(72);
});

test("mock F2.4: at 1280×900 the Orchard Drop crate is centred in the stage and at least 80% of its height", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/orchard-drop/?seed=7");
  await mounted(page);
  const stage = await stageContent(page);
  const crate = await union(page, [".orch-canvas"]);
  const stageCentre = stage.x + stage.w / 2;
  const crateCentre = crate.x + crate.w / 2;
  expect(Math.abs(stageCentre - crateCentre), `crate centre ${Math.round(crateCentre)} vs stage centre ${Math.round(stageCentre)}`).toBeLessThan(24);
  expect(crate.h / stage.h, `crate ${Math.round(crate.h)} tall in a stage ${Math.round(stage.h)}`).toBeGreaterThanOrEqual(0.8);
});
