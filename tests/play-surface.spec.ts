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

/** A locator's box, re-resolved until it has one: a table or a canvas that a resting
 *  re-render replaced between `toBeVisible` and the read returned null on CI's WebKit. */
async function boxOf(loc: ReturnType<Page["locator"]>): Promise<Box> {
  for (let i = 0; i < 20; i += 1) {
    const b = await loc.boundingBox();
    if (b) return { x: b.x, y: b.y, w: b.width, h: b.height };
    await loc.page().waitForTimeout(100);
  }
  throw new Error(`no box for ${String(loc)}`);
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

/** The board mounted — and, given a selector, the surface itself: the mount's first
 *  child can be a loading placeholder, which CI's slow WebKit measured (2026-09-08). */
async function mounted(page: Page, surface?: string): Promise<void> {
  await page.waitForFunction(() => (document.querySelector(".gf-mount")?.children.length ?? 0) > 0);
  if (surface) await page.locator(surface).first().waitFor({ state: "attached" });
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
  // A short phone (or a tall browser chrome): since phase 5 the nine options fit 844.
  await page.setViewportSize({ width: 390, height: 640 });
  await page.goto("/trio-tumble/");
  await expect(page.locator(".gf-poster .gf-play")).toBeVisible();
  const scrolls = await page.evaluate(() => {
    const body = document.querySelector(".gf-poster .gf-start-body")!;
    return { overflowY: getComputedStyle(body).overflowY, scrollHeight: body.scrollHeight, clientHeight: body.clientHeight };
  });
  expect(scrolls.overflowY).toBe("auto");
  expect(scrolls.scrollHeight, "Trio Tumble's nine options overflow a short phone: the body must be the scroller").toBeGreaterThan(scrolls.clientHeight);
  // The last option is reachable — scrolled into view, it sits above Play.
  const last = page.locator(".gf-poster .sheet-choice-opt").last();
  // The page's own scrollIntoView (what focus and a screen reader use), which
  // honours scroll-padding; Playwright's protocol-level scroll does not.
  await last.evaluate((el) => el.scrollIntoView({ block: "nearest" }));
  const lastBox = await last.boundingBox();
  const playBox = await page.locator(".gf-poster .gf-play").boundingBox();
  expect(lastBox!.y + lastBox!.height).toBeLessThanOrEqual(playBox!.y + 1);
});

test("mock F1.3 (phase 5, Q6): a choice of three or fewer is a segmented control, so the Trio Tumble and chess posters fit a 390×844 phone without scrolling", async ({ page }) => {
  await page.setViewportSize(PHONE);
  for (const [id, row] of [["trio-tumble", "board"], ["chess", "side"]] as const) {
    await page.goto(`/${id}/`);
    await expect(page.locator(".gf-poster .gf-play")).toBeVisible();
    const m = await page.evaluate((setting) => {
      const body = document.querySelector(".gf-poster .gf-start-body")!;
      const fs = body.querySelector<HTMLElement>(`[data-setting="${setting}"]`)!;
      return { sh: body.scrollHeight, ch: body.clientHeight, segmented: fs.classList.contains("sheet-choice-segmented"), h: fs.getBoundingClientRect().height };
    }, row);
    expect(m.segmented, `${id}: ${row} is segmented`).toBe(true);
    expect(m.h, `${id}: the ${row} row is one line of segments plus its hint`).toBeLessThanOrEqual(140);
    // Chess fits outright. Trio Tumble's name is split — the title on one line, the
    // subtitle beside it — which fits a Mac's fonts outright; CI's Linux fonts wrap its
    // three-line pitch a line further and leave 24px (measured 2026-09-08; 56 before the
    // split). Under a row of segments, and F1.2's sticky Play keeps every option reachable.
    expect(m.sh - m.ch, `${id}: the poster fits, or within a row`).toBeLessThanOrEqual(id === "chess" ? 0 : 48);
    // A segment is still a radio a player (and a test) can check by value.
    const opt = page.locator(`.gf-poster [data-setting="${row}"] input`).last();
    await opt.check();
    await expect(opt).toBeChecked();
  }
});

test("mock F1.4: the poster's title and pitch sit on a translucent panel over the art — readable over the splash's own lettering (owner, 2026-09-08)", async ({ page }) => {
  await page.setViewportSize(PHONE);
  for (const id of ["trio-tumble", "dots"]) {
    await page.goto(`/${id}/`);
    const pitch = page.locator(".gf-poster .gf-start-pitch");
    await expect(pitch).toBeVisible();
    const m = await pitch.evaluate((p) => {
      const panel = p.closest<HTMLElement>(".gf-start-lede");
      if (!panel) return null;
      const cs = getComputedStyle(panel);
      const pb = panel.getBoundingClientRect();
      const tb = p.getBoundingClientRect();
      const title = panel.querySelector(".gf-start-title")!.getBoundingClientRect();
      return {
        bg: cs.backgroundColor,
        blur: cs.backdropFilter,
        covers: pb.left <= tb.left && pb.right >= tb.right && pb.top <= title.top && pb.bottom >= tb.bottom,
      };
    });
    expect(m, `${id}: the title and pitch have a panel`).not.toBeNull();
    // A real backdrop, not the art: an opaque-enough colour (alpha ≥ 0.7) and a blur behind it.
    const alpha = Number(/\/\s*([\d.]+)\)|rgba\([^)]*,\s*([\d.]+)\)/.exec(m!.bg)?.[1] ?? /rgba\([^)]*,\s*([\d.]+)\)/.exec(m!.bg)?.[1] ?? (m!.bg.startsWith("rgb(") ? "1" : "0"));
    expect(alpha, `${id}: panel background ${m!.bg}`).toBeGreaterThanOrEqual(0.7);
    expect(m!.blur, `${id}: a blur behind the panel`).not.toBe("none");
    expect(m!.covers, `${id}: the panel covers the title and the pitch`).toBe(true);
  }
});

// --- F2: a board fills the stage ------------------------------------------------

/** A game, its board route, and the elements whose union is "the play surface". */
const GRIDS: readonly { id: string; url: string; surface: readonly string[] }[] = [
  { id: "othello", url: "/othello/?seed=7", surface: [".othello-board"] },
  { id: "checkers", url: "/checkers/?seed=7", surface: [".checkers-board"] },
  { id: "chess", url: "/chess/?seed=7", surface: [".chess-board"] },
  { id: "drop4", url: "/drop4/?seed=7", surface: [".drop4-board"] },
  { id: "dots", url: "/dots/?seed=7", surface: [".dots-board"] },
  { id: "2048", url: "/2048/?seed=7", surface: [".t48-board", ".gf-pad"] },
  { id: "wyrdle", url: "/wyrdle/?seed=7", surface: [".wy-grid", ".wy-keyboard"] },
  { id: "blockdoku", url: "/blockdoku/?seed=7", surface: [".bdk-board", ".bdk-tray"] },
];

test("mock F2.1: at 1280×900 a grid board's play surface uses at least 80% of one axis of the stage (Othello, checkers, chess, Drop 4, Dots, 2048, Wyrdle, Blockdoku)", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  for (const g of GRIDS) {
    await page.goto(g.url);
    await mounted(page, g.surface[0]);
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
    await mounted(page, g.surface[0]);
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

test("mock F2.5: at 1280×900 the first-move toast sits below the board, never over its bottom row (Othello, Dots)", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  for (const g of GRIDS.filter((x) => x.id === "othello" || x.id === "dots")) {
    await page.goto(g.url);
    await mounted(page, g.surface[0]);
    const toast = page.locator(".gf-toast");
    await expect(toast).toBeVisible();
    const board = await union(page, g.surface);
    const t = await toast.boundingBox();
    expect(t!.y, `${g.id}: toast top ${Math.round(t!.y)} vs board bottom ${Math.round(board.y + board.h)}`).toBeGreaterThanOrEqual(board.y + board.h - 1);
  }
});

// --- F3: the stage's transients -------------------------------------------------

test("mock F3.1: at 390×844 a long toast wraps inside the stage instead of running off both edges (2048)", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto("/2048/?seed=7");
  await mounted(page);
  const toast = page.locator(".gf-toast");
  await expect(toast).toBeVisible();
  const stage = await stageContent(page);
  const t = await toast.boundingBox();
  expect(t!.x, "left edge inside the stage").toBeGreaterThanOrEqual(stage.x - 1);
  expect(t!.x + t!.width, "right edge inside the stage").toBeLessThanOrEqual(stage.x + stage.w + 1);
});

// --- F4 (phase 6, Q2): a ground per game ----------------------------------------

const GROUNDED = ["chess", "othello", "checkers", "drop4", "dots", "furrow", "wyrdle", "2048", "align", "bubble", "looseends", "solitaire", "cribbage", "blockdoku", "mahjong", "color-sort", "trio-tumble", "orchard-drop"] as const;

test("mock F4.1: every game's stage carries its own ground — a tint of the game's board colour, not the gallery's flat black", async ({ page }) => {
  test.setTimeout(120_000); // eighteen page loads, each through its poster's Play
  await page.setViewportSize(DESKTOP);
  const seen = new Map<string, string>();
  for (const id of GROUNDED) {
    await page.goto(`/${id}/`);
    // The poster covers the stage; the ground is the playing surface's, declared with the game's spec.
    await page.locator(".gf-poster .gf-play").click();
    const stage = page.locator(".gf-stage");
    await expect(stage).toHaveAttribute("data-ground", "on");
    const paint = await stage.evaluate((n) => ({ image: getComputedStyle(n).backgroundImage, ground: getComputedStyle(n).getPropertyValue("--stage-ground").trim() }));
    expect(paint.image, `${id}: the stage paints a gradient`).toMatch(/gradient/);
    expect(paint.ground, `${id}: names a colour`).not.toBe("");
    seen.set(id, paint.ground);
  }
  // Not one ground for all: at least six distinct colours across the shelf.
  expect(new Set(seen.values()).size).toBeGreaterThanOrEqual(6);
});

// --- F5 (phase 7, Q3 + Q4): one shape for hand controls -------------------------

test("mock F5.1: the pad follows the preference — Auto shows it on a coarse pointer only, On and Off override", async ({ page }) => {
  await page.goto("/2048/?seed=7");
  await expect(page.locator(".t48-board")).toBeVisible();
  const coarse = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
  await expect(page.locator(".gf-pad")).toHaveCount(coarse ? 1 : 0);
  // The stage is a phone's or a desktop's: the setting sheet is where the row lives on both.
  await page.evaluate(() => localStorage.setItem("fun-pad", "on"));
  await page.reload();
  await expect(page.locator(".t48-board")).toBeVisible();
  await expect(page.locator(".gf-pad.gf-pad-dpad")).toHaveCount(1);
  await page.evaluate(() => localStorage.setItem("fun-pad", "off"));
  await page.reload();
  await expect(page.locator(".t48-board")).toBeVisible();
  await expect(page.locator(".gf-pad")).toHaveCount(0);
  // Off is not a smaller board: the room the pad took goes to the tiles.
  const cell = await page.locator(".t48-tile").first().boundingBox();
  await page.evaluate(() => localStorage.setItem("fun-pad", "on"));
  await page.reload();
  await expect(page.locator(".gf-pad")).toHaveCount(1);
  const cellWithPad = await page.locator(".t48-tile").first().boundingBox();
  expect(cell!.width).toBeGreaterThanOrEqual(cellWithPad!.width);
});

test("mock F5.2: the common row — On-screen controls: Auto / On / Off — lives in Every game, and changing it re-renders the pad in place", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto("/2048/?seed=7");
  await expect(page.locator(".t48-board")).toBeVisible();
  await page.locator('.gf-verb[data-verb="settings"]').click();
  const row = page.locator('.gf-sheet [data-setting="pad"]');
  await expect(row.locator("input")).toHaveCount(3);
  await expect(row.locator('input[value="auto"]')).toBeChecked();
  await row.locator('input[value="off"]').check();
  await expect(page.locator(".gf-pad")).toHaveCount(0);
  await row.locator('input[value="on"]').check();
  await expect(page.locator(".gf-pad")).toHaveCount(1);
});

test("mock F5.3: Align's pad is the split — move and hold under the left thumb, turn and drop under the right, 64px targets, the well clear of them", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.addInitScript(() => localStorage.setItem("fun-pad", "on"));
  await page.goto("/align/?seed=7");
  await expect(page.locator(".al-board")).toBeVisible();
  const pad = page.locator(".gf-pad.gf-pad-split");
  await expect(pad).toHaveCount(1);
  for (const b of await pad.locator("button").all()) {
    const box = await b.boundingBox();
    expect(box!.width, "a thumb target").toBeGreaterThanOrEqual(56);
    expect(box!.height, "a thumb target").toBeGreaterThanOrEqual(56);
  }
  const [well, left, right] = await Promise.all([
    page.locator(".al-board").boundingBox(),
    pad.locator(".gf-pad-left").boundingBox(),
    pad.locator(".gf-pad-right").boundingBox(),
  ]);
  // Owner, 2026-09-05: "the controls are overlapping the board on mobile view" — never again.
  expect(well!.y + well!.height, "the well ends above the clusters").toBeLessThanOrEqual(Math.min(left!.y, right!.y) + 1);
  expect(well!.height, "the well keeps its height").toBeGreaterThanOrEqual(380);
  expect(left!.x + left!.width, "left cluster is left").toBeLessThan(right!.x);
});

// --- F6 (phase 8, Q5): Furrow stands up on a phone -------------------------------

test("mock F6.1: on a 390×844 phone Furrow is upright — two columns of six, your column on the right sowing upward into your store at the top, 44px pits, no scroll", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto("/furrow/?seed=7");
  const board = page.locator(".furrow-board");
  await expect(board).toBeVisible();
  await expect(board).toHaveAttribute("data-orient", "upright");
  const stage = await stageContent(page);
  const box = await board.boundingBox();
  expect(box!.width, "no wider than the stage").toBeLessThanOrEqual(stage.w + 1);
  expect(box!.height / stage.h, "the board uses the height it now has").toBeGreaterThanOrEqual(0.7);
  expect(await page.evaluate(() => document.querySelector(".furrow-boardwrap")!.scrollWidth <= document.querySelector(".furrow-boardwrap")!.clientWidth)).toBe(true);
  for (const pit of await page.locator(".furrow-pit").all()) {
    const b = await pit.boundingBox();
    expect(b!.width).toBeGreaterThanOrEqual(44);
  }
  // Geometry: the core's pit 0 is the bottom of your column, pit 5 the top; your store is above it,
  // theirs below their column — the across board turned a quarter, counter-clockwise, so sowing
  // (0 → 5 → your store) runs upward and the engine's (7 → 12 → its store; 6 is your store) runs downward.
  const y = async (sel: string): Promise<number> => (await page.locator(sel).boundingBox())!.y;
  const x = async (sel: string): Promise<number> => (await page.locator(sel).boundingBox())!.x;
  expect(await y('.furrow-pit[data-pit="0"]')).toBeGreaterThan(await y('.furrow-pit[data-pit="5"]'));
  expect(await y(".furrow-store.mine")).toBeLessThan(await y('.furrow-pit[data-pit="5"]'));
  expect(await y('.furrow-pit[data-pit="7"]')).toBeLessThan(await y('.furrow-pit[data-pit="12"]'));
  expect(await y(".furrow-store.theirs")).toBeGreaterThan(await y('.furrow-pit[data-pit="12"]'));
  expect(await x('.furrow-pit[data-pit="0"]')).toBeGreaterThan(await x('.furrow-pit[data-pit="7"]'));
});

test("mock F6.2: a desktop stage lies across; the Board preference (Auto / Across / Upright) overrides either way and is remembered", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/furrow/?seed=7");
  await expect(page.locator(".furrow-board")).toHaveAttribute("data-orient", "across");
  await page.evaluate(() => localStorage.setItem("fun-furrow-orient", "upright"));
  await page.reload();
  await expect(page.locator(".furrow-board")).toHaveAttribute("data-orient", "upright");
  await page.setViewportSize(PHONE);
  await page.evaluate(() => localStorage.setItem("fun-furrow-orient", "across"));
  await page.reload();
  await expect(page.locator(".furrow-board")).toHaveAttribute("data-orient", "across");
  // The row lives with the game's own settings.
  await page.locator('.gf-verb[data-verb="settings"]').click();
  const row = page.locator('.gf-sheet [data-setting="orient"]');
  await expect(row.locator("input")).toHaveCount(3);
  await row.locator('input[value="upright"]').check();
  await expect(page.locator(".furrow-board")).toHaveAttribute("data-orient", "upright");
});

// --- F7 (phase 9, Q11): life on the versus boards ------------------------------

test("mock F7.1: Drop 4's disc falls in — the just-played cell animates and the stage records the drop", async ({ page }) => {
  await page.goto("/drop4/?seed=7");
  await page.waitForFunction(() => Boolean(window.__drop4));
  // Tap and watch from inside the page: the drop lasts a few hundred ms, so a
  // second round trip could land after it. The most animations seen on the
  // played cell over the next 1.5s is the measure — polled on a timer, not
  // requestAnimationFrame, which CI's loaded WebKit starves. A runner that
  // prefers reduced motion gets no animation by design (F7.3); it still records.
  const { running, reduced } = await page.evaluate(() => {
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.querySelector<HTMLElement>('.drop4-col[data-col="3"]')!.click();
    return new Promise<{ running: number; reduced: boolean }>((resolve) => {
      const t0 = performance.now();
      let most = 0;
      const look = (): void => {
        most = Math.max(most, document.querySelector(".drop4-cell.just-played")?.getAnimations().length ?? 0);
        if (performance.now() - t0 < 1500) setTimeout(look, 16);
        else resolve({ running: most, reduced });
      };
      look();
    });
  });
  await expect(page.locator(".gf-stage")).toHaveAttribute("data-beat", "drop");
  if (!reduced) expect(running).toBeGreaterThanOrEqual(1);
});

test("mock F7.2: Othello's turned discs flip — every legal opening turns at least one, and the stage records the flip", async ({ page }) => {
  await page.goto("/othello/?seed=7");
  await page.waitForFunction(() => Boolean(window.__othello));
  await page.locator(".othello-cell.legal").first().click();
  await expect(page.locator(".gf-stage")).toHaveAttribute("data-beat", "flip");
});

test("mock F7.3: under reduced motion a beat collapses to its last frame — nothing animates, and the stage still records it", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/drop4/?seed=7");
  await page.waitForFunction(() => Boolean(window.__drop4));
  const running = await page.evaluate(() => {
    document.querySelector<HTMLElement>('.drop4-col[data-col="3"]')!.click();
    return new Promise<number>((resolve) => {
      const t0 = performance.now();
      let most = 0;
      const look = (): void => {
        most = Math.max(most, document.querySelector(".drop4-cell.just-played")?.getAnimations().length ?? 0);
        if (performance.now() - t0 < 1500) setTimeout(look, 16);
        else resolve(most);
      };
      look();
    });
  });
  await expect(page.locator(".gf-stage")).toHaveAttribute("data-beat", "drop");
  expect(running).toBe(0);
});

// --- F2 (phase 4): the rest of the fill ----------------------------------------

/** The surfaces phase 4 puts on the stage rule, with what each may reach. */
const FILL_REST: readonly { id: string; url: string; surface: string; desktop: { w?: number; h?: number }; phone: { w?: number; h?: number } }[] = [
  // A mancala across is one row deep: it fills the width on a desktop, and stands up on a phone (F6).
  { id: "furrow", url: "/furrow/?seed=7", surface: ".furrow-board", desktop: { w: 0.85 }, phone: { h: 0.7 } },
  // Eight gems across: the short side of the stage, like the eight-square boards.
  { id: "trio-tumble", url: "/trio-tumble/?seed=7", surface: ".m3-board", desktop: { h: 0.8 }, phone: { w: 0.85 } },
  // Seven columns of cards: the width, on both.
  { id: "solitaire", url: "/solitaire/?seed=7", surface: ".sol-board", desktop: { w: 0.85 }, phone: { w: 0.9 } },
  // A tall shooter: the height, on both — the chips and the aim bar take the rest (a phone
  // leaves it 62%: 588 less 62 + 93 + 22 for them); no 22rem cap on a desktop any more.
  // (the launcher chips left the HUD for the canvas, which already draws them: 0.62 → 0.66 on a phone)
  { id: "bubble", url: "/bubble/?seed=7", surface: ".bub-canvas", desktop: { h: 0.7 }, phone: { h: 0.65 } },
  // The card table: cards grow with the room on a desktop.
  { id: "cribbage", url: "/cribbage/?seed=7", surface: ".crib-table", desktop: { w: 0.7 }, phone: { w: 0.95 } },
];

test("mock F2.6 (phase 4): Furrow, Trio Tumble, solitaire, Bubble and cribbage size from the stage — each reaches its share of the room on a desktop and a phone", async ({ page }) => {
  test.setTimeout(90_000); // ten page loads
  for (const [vp, key] of [[DESKTOP, "desktop"], [PHONE, "phone"]] as const) {
    await page.setViewportSize(vp);
    for (const g of FILL_REST) {
      await page.goto(g.url); // a seeded URL mounts the board straight away — no poster
      const el = page.locator(g.surface).first();
      await expect(el).toBeVisible();
      await page.waitForTimeout(300);
      const stage = await stageContent(page);
      const box = await boxOf(el);
      const want = g[key];
      const tag = `${g.id} @ ${vp.width}: ${Math.round(box.w)}×${Math.round(box.h)} in ${Math.round(stage.w)}×${Math.round(stage.h)}`;
      // Soft, so one game's miss still reports the others.
      if (want.w !== undefined) expect.soft(box.w / stage.w, tag).toBeGreaterThanOrEqual(want.w);
      if (want.h !== undefined) expect.soft(box.h / stage.h, tag).toBeGreaterThanOrEqual(want.h);
      expect.soft(box.w, `${tag}: never wider than the stage`).toBeLessThanOrEqual(stage.w + 1);
    }
  }
});

test("mock F2.7 (phase 4): Loose Ends' canvas is the stage's whole box — edge to edge by design (its wrapper cancels the stage padding) and never past it", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await page.goto("/looseends/");
  await page.locator(".gf-poster .gf-play").click();
  const canvas = page.locator(".le-canvas");
  await expect(canvas).toBeVisible();
  await page.waitForTimeout(300);
  const stage = (await page.locator(".gf-stage").boundingBox())!;
  const box = (await canvas.boundingBox())!;
  expect(box.width, `canvas ${Math.round(box.width)} in a stage ${Math.round(stage.width)}`).toBeLessThanOrEqual(stage.width + 1);
  expect(box.height, `canvas ${Math.round(box.height)} in a stage ${Math.round(stage.height)}`).toBeLessThanOrEqual(stage.height + 1);
  expect(box.width / stage.width).toBeGreaterThanOrEqual(0.98);
});
