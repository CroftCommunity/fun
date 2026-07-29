import { beforeEach, describe, expect, it } from "vitest";

import { boot } from "../src/chrome.js";
import { placeholderMountCount } from "../src/games/placeholder.js";

beforeEach(() => {
  document.body.innerHTML = "";
  delete document.body.dataset.game;
  document.body.className = "";
});

describe("games drawer chrome", () => {
  it("mounts the current game into the play area", () => {
    document.body.dataset.game = "placeholder";
    const before = placeholderMountCount();
    const chrome = boot();
    expect(document.querySelector(".placeholder-game")).not.toBeNull();
    expect(chrome.mountedModule()).not.toBeNull();
    expect(placeholderMountCount()).toBe(before + 1);
  });

  it("full-screen preserves the same mounted instance (no remount)", () => {
    document.body.dataset.game = "placeholder";
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

  it("lists every registry game as a link to its own URL", () => {
    boot();
    const ids = [...document.querySelectorAll(".drawer-item")].map((a) =>
      a.getAttribute("data-game-id"),
    );
    expect(ids).toEqual(["placeholder", "solitaire", "match3"]);
    expect(
      document.querySelector('[data-game-id="solitaire"]')?.getAttribute("href"),
    ).toBe("/solitaire/");
  });

  it("shows a coming-soon panel for a not-yet-playable game", () => {
    document.body.dataset.game = "solitaire";
    const chrome = boot();
    expect(chrome.mountedModule()).toBeNull();
    expect(document.querySelector(".welcome")?.textContent).toMatch(/coming soon/i);
  });
});
