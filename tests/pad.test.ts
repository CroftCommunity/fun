//! Phase 7 of the play-surface plan (mock F, Q3 + Q4): one shape for hand
//! controls. A common preference — On-screen controls: Auto / On / Off, Auto
//! meaning "a coarse pointer" — and one renderer, `src/pad.ts`, that draws a
//! d-pad (2048) or a split pair of thumb clusters (Align). A game never builds
//! its own pad again.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { padShown, resolvePadMode } from "../src/settings.js";
import { renderPad } from "../src/pad.js";

describe("the preference", () => {
  it("resolves to Auto unless On or Off is stored", () => {
    expect(resolvePadMode(null)).toBe("auto");
    expect(resolvePadMode("")).toBe("auto");
    expect(resolvePadMode("sometimes")).toBe("auto");
    expect(resolvePadMode("on")).toBe("on");
    expect(resolvePadMode("off")).toBe("off");
  });
  it("Auto shows the pad on a coarse pointer only; On and Off ignore the pointer", () => {
    expect(padShown("auto", true)).toBe(true);
    expect(padShown("auto", false)).toBe(false);
    expect(padShown("on", false)).toBe(true);
    expect(padShown("off", true)).toBe(false);
  });
});

const press = (b: Element, type = "pointerdown"): void => {
  b.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
};

describe("renderPad", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("d-pad: four buttons in the reading order up, left, down, right, each a labelled control", () => {
    const seen: string[] = [];
    const pad = renderPad({
      layout: "dpad",
      label: "Slide",
      buttons: [
        { id: "Up", glyph: "▲", label: "Slide up" },
        { id: "Left", glyph: "◀", label: "Slide left" },
        { id: "Down", glyph: "▼", label: "Slide down" },
        { id: "Right", glyph: "▶", label: "Slide right" },
      ],
      onPress: (id) => seen.push(id),
    });
    expect(pad.classList.contains("gf-pad")).toBe(true);
    expect(pad.classList.contains("gf-pad-dpad")).toBe(true);
    expect(pad.getAttribute("role")).toBe("group");
    expect(pad.getAttribute("aria-label")).toBe("Slide");
    const buttons = [...pad.querySelectorAll("button")];
    expect(buttons.map((b) => b.dataset.pad)).toEqual(["Up", "Left", "Down", "Right"]);
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual(["Slide up", "Slide left", "Slide down", "Slide right"]);
    press(buttons[3]!);
    expect(seen).toEqual(["Right"]);
  });

  it("split: two clusters, left and right, each holding its own buttons", () => {
    const pad = renderPad({
      layout: "split",
      label: "Controls",
      left: [{ id: "ShiftL", glyph: "◄", label: "Move left" }, { id: "ShiftR", glyph: "►", label: "Move right" }],
      right: [{ id: "RotCW", glyph: "⟳", label: "Rotate clockwise" }],
      onPress: () => {},
    });
    expect(pad.classList.contains("gf-pad-split")).toBe(true);
    expect([...pad.querySelectorAll<HTMLButtonElement>(".gf-pad-left button")].map((b) => b.dataset.pad)).toEqual(["ShiftL", "ShiftR"]);
    expect([...pad.querySelectorAll<HTMLButtonElement>(".gf-pad-right button")].map((b) => b.dataset.pad)).toEqual(["RotCW"]);
  });

  it("a held repeat button fires once at once, then again after the DAS wait and at its own cadence; release stops it", () => {
    const seen: string[] = [];
    const pad = renderPad({
      layout: "split",
      label: "Controls",
      left: [{ id: "ShiftL", glyph: "◄", label: "Move left", repeat: true }],
      right: [{ id: "RotCW", glyph: "⟳", label: "Rotate clockwise" }],
      repeatMs: () => 50,
      dasMs: 150,
      onPress: (id) => seen.push(id),
    });
    const [left, rot] = [...pad.querySelectorAll("button")];
    press(left!);
    expect(seen).toEqual(["ShiftL"]);
    vi.advanceTimersByTime(140);
    expect(seen).toHaveLength(1);
    vi.advanceTimersByTime(10);
    expect(seen).toHaveLength(2);
    vi.advanceTimersByTime(100);
    expect(seen).toHaveLength(4);
    press(left!, "pointerup");
    vi.advanceTimersByTime(500);
    expect(seen).toHaveLength(4);
    // A plain button fires once and never repeats, however long it is held.
    press(rot!);
    vi.advanceTimersByTime(1000);
    expect(seen.filter((s) => s === "RotCW")).toHaveLength(1);
  });

  it("a press buzzes when the game gives it a haptic", () => {
    const haptic = vi.fn();
    const pad = renderPad({ layout: "dpad", label: "Slide", buttons: [{ id: "Up", glyph: "▲", label: "Up" }], onPress: () => {}, haptic });
    press(pad.querySelector("button")!);
    expect(haptic).toHaveBeenCalledTimes(1);
  });
});
