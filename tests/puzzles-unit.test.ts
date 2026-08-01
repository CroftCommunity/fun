//! The Tatham puzzles collection module (Option A): one drawer entry whose
//! module renders an accessible picker over a set of vendored puzzles and mounts
//! the selected one through the shared wrapped-game iframe. Pure DOM, so the
//! picker + mount wiring is unit-testable without a browser; the live proof that
//! Net actually renders under the sandbox is the Playwright spec.

import { beforeEach, describe, expect, it } from "vitest";

import { PUZZLE_MANIFEST, initialPuzzle, puzzlesModule } from "../src/games/puzzles/puzzles.js";

describe("puzzle manifest", () => {
  it("includes Net with a vendored, same-origin entry and a blurb", () => {
    const net = PUZZLE_MANIFEST.find((p) => p.id === "net");
    expect(net).toBeTruthy();
    expect(net!.title).toBe("Net");
    expect(net!.entry).toBe("/puzzles/vendor/net.html");
    expect(net!.blurb.length).toBeGreaterThan(0);
  });
});

describe("initialPuzzle (?p=<id> deep-link)", () => {
  it("defaults to the first puzzle when there is no ?p", () => {
    expect(initialPuzzle("").id).toBe(PUZZLE_MANIFEST[0]!.id);
  });

  it("selects the puzzle named by a valid ?p", () => {
    expect(initialPuzzle("?p=net").id).toBe("net");
  });

  it("falls back to the first puzzle for an unknown ?p", () => {
    expect(initialPuzzle("?p=does-not-exist").id).toBe(PUZZLE_MANIFEST[0]!.id);
  });
});

describe("puzzlesModule mount", () => {
  let container: HTMLElement;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
  });

  it("renders an accessible picker with a control per puzzle", () => {
    puzzlesModule().mount(container, { mode: "standalone" });
    const group = container.querySelector('[role="group"]');
    expect(group).toBeTruthy();
    expect(group!.getAttribute("aria-label")?.toLowerCase()).toContain("puzzle");
    const controls = container.querySelectorAll("button[data-puzzle]");
    expect(controls.length).toBe(PUZZLE_MANIFEST.length);
  });

  it("mounts the initial puzzle in a contained wrapped-game iframe (opaque-origin sandbox)", () => {
    puzzlesModule().mount(container, { mode: "standalone" });
    const frame = container.querySelector<HTMLIFrameElement>("iframe.wrapped-game-frame");
    expect(frame).toBeTruthy();
    expect(frame!.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame!.getAttribute("sandbox")).not.toContain("allow-same-origin");
    expect(frame!.getAttribute("src")).toBe("/puzzles/vendor/net.html");
  });

  it("marks the current puzzle as pressed", () => {
    puzzlesModule().mount(container, { mode: "standalone" });
    const btn = container.querySelector('button[data-puzzle="net"]');
    expect(btn!.getAttribute("aria-pressed")).toBe("true");
  });

  it("tears the iframe down on unmount", () => {
    const mod = puzzlesModule();
    mod.mount(container, { mode: "standalone" });
    expect(container.querySelector("iframe.wrapped-game-frame")).toBeTruthy();
    mod.unmount();
    expect(container.querySelector("iframe.wrapped-game-frame")).toBeNull();
  });
});
