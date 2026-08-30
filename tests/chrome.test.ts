import { beforeEach, describe, expect, it, vi } from "vitest";

import { boot } from "../src/chrome.js";
import { placeholderMountCount } from "../src/games/placeholder.js";

/** A URL with a query is a deep link and mounts the board directly (plan Q7). */
function deepLink(id: string): void {
  window.history.replaceState({}, "", `/${id}/?play=1`);
}
/** A bare game URL is the front door: the start screen. */
function frontDoor(id: string): void {
  window.history.replaceState({}, "", `/${id}/`);
}

beforeEach(() => {
  document.body.innerHTML = "";
  delete document.body.dataset.game;
  document.body.className = "";
  localStorage.clear();
  window.history.replaceState({}, "", "/");
  vi.spyOn(console, "debug").mockImplementation(() => {});
});

describe("games drawer chrome", () => {
  it("mounts the current game into the play area", () => {
    document.body.dataset.game = "placeholder";
    deepLink("placeholder");
    const before = placeholderMountCount();
    const chrome = boot();
    expect(document.querySelector(".placeholder-game")).not.toBeNull();
    expect(chrome.mountedModule()).not.toBeNull();
    expect(placeholderMountCount()).toBe(before + 1);
  });

  it("mounts the game into the frame's stage, not the bare play area", () => {
    document.body.dataset.game = "placeholder";
    deepLink("placeholder");
    boot();
    const stage = document.querySelector(".play-area > .gf > .gf-stage");
    expect(stage).not.toBeNull();
    expect(stage!.querySelector(".placeholder-game")).not.toBeNull();
    expect(document.querySelector(".play-area > .placeholder-game")).toBeNull();
    expect(document.querySelectorAll(".gf")).toHaveLength(1); // one frame, not one per layer
    expect(document.querySelector(".gf-title")?.textContent).toBe("Placeholder");
  });

  it("on a game page the header has no how-to or new-tab links; the ⋯ menu holds them", () => {
    document.body.dataset.game = "othello";
    deepLink("othello");
    boot();
    expect(document.querySelector(".chrome-header .how-to-link")).toBeNull();
    expect(document.querySelector(".chrome-header .newtab")).toBeNull();
    const menu = document.querySelector(".gf-menu")!;
    expect(menu.querySelector('a[href="/how-to/?game=othello"]')).not.toBeNull();
    const tab = menu.querySelector('a[href="/othello/"]')!;
    expect(tab.getAttribute("target")).toBe("_blank");
    expect(tab.getAttribute("rel")).toBe("noopener");
    expect(document.querySelector(".gf-title")?.textContent).toBe("Othello");
  });

  it("the home page has no game bar and no frame", () => {
    boot();
    expect(document.querySelector(".gf")).toBeNull();
    expect(document.querySelector(".gf-game-bar")).toBeNull();
  });

  it("full-screen preserves the same mounted instance (no remount)", () => {
    document.body.dataset.game = "placeholder";
    deepLink("placeholder");
    const before = placeholderMountCount();
    const chrome = boot();
    expect(placeholderMountCount()).toBe(before + 1);
    chrome.toggleFullscreen();
    expect(chrome.isFullscreen()).toBe(true);
    expect(document.body.classList.contains("fullscreen")).toBe(true);
    expect(document.querySelector(".placeholder-game")).not.toBeNull();
    expect(placeholderMountCount()).toBe(before + 1); // not remounted
  });

  it("drawer opens, moves focus inside, and ESC closes it", () => {
    const chrome = boot(); // home page (no game)
    expect(chrome.isDrawerOpen()).toBe(false);
    chrome.openDrawer();
    expect(chrome.isDrawerOpen()).toBe(true);
    const drawer = document.getElementById("games-drawer");
    expect(drawer).not.toBeNull();
    expect(drawer!.hidden).toBe(false);
    expect(drawer!.contains(document.activeElement)).toBe(true);
    drawer!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(chrome.isDrawerOpen()).toBe(false);
  });

  it("a close button inside the drawer recollapses it", () => {
    const chrome = boot();
    chrome.openDrawer();
    expect(chrome.isDrawerOpen()).toBe(true);
    const closeBtn = document.querySelector<HTMLButtonElement>(
      "#games-drawer .drawer-close",
    );
    expect(closeBtn).not.toBeNull();
    closeBtn!.click();
    expect(chrome.isDrawerOpen()).toBe(false);
  });

  it("clicking the scrim off the drawer recollapses it", () => {
    const chrome = boot();
    const scrim = document.querySelector<HTMLElement>(".drawer-scrim");
    expect(scrim).not.toBeNull();
    expect(scrim!.hidden).toBe(true); // no scrim while closed
    chrome.openDrawer();
    expect(chrome.isDrawerOpen()).toBe(true);
    expect(scrim!.hidden).toBe(false);
    scrim!.click();
    expect(chrome.isDrawerOpen()).toBe(false);
    expect(scrim!.hidden).toBe(true);
  });

  it("lists every registry game as a link to its own URL", () => {
    boot();
    const ids = [...document.querySelectorAll(".drawer-item")].map((a) =>
      a.getAttribute("data-game-id"),
    );
    expect(ids).toEqual(["placeholder", "solitaire", "trio-tumble", "bubble", "wyrdle", "2048", "drop4", "othello", "checkers", "dots", "furrow", "align", "blockdoku", "looseends", "color-sort", "orchard-drop", "cribbage"]);
    expect(
      document.querySelector('[data-game-id="solitaire"]')?.getAttribute("href"),
    ).toBe("/solitaire/");
  });

  it("shows a coming-soon panel for a not-yet-playable game", async () => {
    // Every real entry is playable now (cribbage was the last "soon" tile until
    // 2026-08-29), so the branch is exercised against a registry with one
    // synthetic "soon" entry appended.
    vi.resetModules();
    const SOON = { id: "someday", title: "Someday", emoji: "🌱", status: "soon" as const };
    vi.doMock("../src/registry.js", async (importOriginal) => {
      const real = await importOriginal<typeof import("../src/registry.js")>();
      return {
        ...real,
        REGISTRY: [...real.REGISTRY, SOON],
        findGame: (id: string) => (id === SOON.id ? SOON : real.findGame(id)),
      };
    });
    const { boot: bootWithSoon } = await import("../src/chrome.js");
    document.body.dataset.game = "someday";
    deepLink("someday");
    const chrome = bootWithSoon();
    expect(chrome.mountedModule()).toBeNull();
    expect(document.querySelector(".welcome")?.textContent).toMatch(/coming soon/i);
    vi.doUnmock("../src/registry.js");
    vi.resetModules();
  });

  describe("the start screen (plan Phase 5a, Q7)", () => {
    it("a bare game URL shows the poster and does not mount the game", () => {
      document.body.dataset.game = "placeholder";
      frontDoor("placeholder");
      const chrome = boot();
      expect(chrome.mountedModule()).toBeNull();
      expect(document.querySelector(".placeholder-game")).toBeNull();
      const poster = document.querySelector(".gf-poster")!;
      expect(poster).not.toBeNull();
      expect(poster.querySelector("img")?.getAttribute("src")).toBe("/placeholder/assets/splash.jpg");
      expect(poster.querySelector(".gf-start-title")?.textContent).toBe("Placeholder");
      expect(poster.querySelector(".gf-start-pitch")?.textContent).toMatch(/prove/);
      expect(console.debug).toHaveBeenCalledWith("[frame] start=poster id=placeholder progress=none");
    });

    it("Play mounts the game, removes the poster, and writes the store", () => {
      document.body.dataset.game = "placeholder";
      frontDoor("placeholder");
      const chrome = boot();
      document.querySelector<HTMLButtonElement>(".gf-poster .gf-play")!.click();
      expect(chrome.mountedModule()).not.toBeNull();
      expect(document.querySelector(".gf-poster")).toBeNull();
      expect(document.querySelector(".gf-stage .placeholder-game")).not.toBeNull();
      expect(localStorage.getItem("fun-progress-placeholder")).not.toBeNull();
    });

    it("a record in the store shows the continue card; Continue mounts and resumes it", () => {
      document.body.dataset.game = "placeholder";
      frontDoor("placeholder");
      localStorage.setItem(
        "fun-progress-placeholder",
        JSON.stringify({
          v: 1,
          status: "in-progress",
          startedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          setup: { mode: "free" },
          record: { pokes: 3 },
          summary: { line: "3 pokes" },
        }),
      );
      const chrome = boot();
      expect(chrome.mountedModule()).toBeNull();
      const card = document.querySelector(".gf-continue")!;
      expect(card.querySelector(".gf-start-line")?.textContent).toBe("3 pokes");
      expect(card.querySelector("img")?.getAttribute("src")).toBe("/placeholder/assets/icon.jpg");
      expect(console.debug).toHaveBeenCalledWith("[frame] start=continue id=placeholder progress=in-progress");
      card.querySelector<HTMLButtonElement>(".gf-continue-btn")!.click();
      expect(document.querySelector(".gf-continue")).toBeNull();
      expect(document.querySelector(".gf-stat-value")?.textContent).toBe("3");
    });

    it("New game on the card clears the store and shows the poster", () => {
      document.body.dataset.game = "placeholder";
      frontDoor("placeholder");
      localStorage.setItem(
        "fun-progress-placeholder",
        JSON.stringify({ v: 1, status: "in-progress", startedAt: "2026-08-30T09:00:00Z", updatedAt: new Date().toISOString(), setup: { mode: "free" }, record: { pokes: 1 }, summary: { line: "1 poke" } }),
      );
      boot();
      document.querySelector<HTMLButtonElement>(".gf-continue .gf-newgame")!.click();
      expect(localStorage.getItem("fun-progress-placeholder")).toBeNull();
      expect(document.querySelector(".gf-continue")).toBeNull();
      expect(document.querySelector(".gf-poster")).not.toBeNull();
    });

    it("a finished record shows the card in its play-again form: New game is primary and there is no Continue", () => {
      document.body.dataset.game = "placeholder";
      frontDoor("placeholder");
      localStorage.setItem(
        "fun-progress-placeholder",
        JSON.stringify({ v: 1, status: "finished", startedAt: "2026-08-30T09:00:00Z", updatedAt: new Date().toISOString(), setup: { mode: "free" }, record: { pokes: 9 }, summary: { line: "9 pokes" } }),
      );
      boot();
      const card = document.querySelector(".gf-continue")!;
      expect(card.querySelector(".gf-continue-btn")).toBeNull();
      expect(card.querySelector(".gf-newgame")?.classList.contains("primary")).toBe(true);
      expect(card.querySelector(".gf-start-eyebrow")?.textContent).toMatch(/finished/i);
    });

    it("a URL with a query — ?r=, ?seed=, anything — is a deep link and mounts directly", () => {
      for (const q of ["?r=x", "?seed=7", "?fast=1", "?daily=2026-08-30"]) {
        document.body.innerHTML = "";
        document.body.dataset.game = "placeholder";
        window.history.replaceState({}, "", `/placeholder/${q}`);
        const chrome = boot();
        expect(chrome.mountedModule(), q).not.toBeNull();
        expect(document.querySelector(".gf-poster"), q).toBeNull();
      }
      expect(console.debug).toHaveBeenCalledWith("[frame] start=direct id=placeholder progress=none");
    });

    it("after a move the frame writes the store through the game's snapshot()", () => {
      document.body.dataset.game = "placeholder";
      deepLink("placeholder");
      boot();
      document.querySelector<HTMLButtonElement>('.gf-verb[data-verb="poke"]')!.click();
      const stored = JSON.parse(localStorage.getItem("fun-progress-placeholder")!) as { summary: { line: string } };
      expect(stored.summary.line).toBe("1 poke");
    });
  });
});
