//! The reusable, demo-driven settings sheet scaffold. A pure-DOM builder that
//! lays out a legible panel of setting rows (toggle or range), each with a live
//! value readout and an optional in-place demo that reacts as the control moves.
//! Portal-wide chrome — no game-specific logic lives here.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderSettingsSheet } from "../src/settings-sheet.js";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("renderSettingsSheet", () => {
  it("renders one row per setting with a title/intro", () => {
    const sheet = renderSettingsSheet({
      intro: "Tune the feel.",
      rows: [
        { kind: "toggle", id: "a", label: "A", value: false, onChange: () => {} },
        { kind: "range", id: "b", label: "B", value: 2, min: 1, max: 5, onChange: () => {} },
      ],
    });
    document.body.append(sheet);
    expect(sheet.querySelector(".sheet-intro")?.textContent).toContain("Tune the feel.");
    expect(sheet.querySelectorAll(".sheet-row")).toHaveLength(2);
    expect(sheet.querySelector('[data-setting="a"]')).not.toBeNull();
    expect(sheet.querySelector('[data-setting="b"]')).not.toBeNull();
  });

  it("two sheets carrying the same choice row keep separate radio groups", () => {
    // The frame renders a game's preferences twice: in the phone's sheet and in
    // the rail's inline panel, which is rebuilt on every update(). With one radio
    // `name` per row id the two copies were one group, so re-rendering the hidden
    // copy unchecked the visible sheet's radio (measured: a click that "did not
    // change its state", and a CI-only unchecked assertion on cribbage).
    const row = (onChange: (v: string) => void) => ({
      kind: "choice" as const,
      id: "skin",
      label: "Skin",
      value: "water",
      options: [
        { value: "water", label: "Water" },
        { value: "ball", label: "Ball" },
      ],
      onChange,
    });
    const a = renderSettingsSheet({ rows: [row(() => {})] });
    const b = renderSettingsSheet({ rows: [row(() => {})] });
    document.body.append(a, b);
    const radio = (sheet: HTMLElement, value: string): HTMLInputElement =>
      sheet.querySelector<HTMLInputElement>(`input[value="${value}"]`)!;
    expect(radio(a, "water").checked).toBe(true);
    radio(b, "ball").checked = true;
    expect(radio(b, "ball").checked).toBe(true);
    expect(radio(a, "water").checked).toBe(true);
    expect(radio(a, "ball").checked).toBe(false);
    expect(radio(a, "water").name).not.toBe(radio(b, "water").name);
  });

  it("reflects a toggle's value and reports changes", () => {
    const onChange = vi.fn();
    const sheet = renderSettingsSheet({
      rows: [{ kind: "toggle", id: "fire", label: "Fire on release", value: true, onChange }],
    });
    document.body.append(sheet);
    const box = sheet.querySelector<HTMLInputElement>('[data-setting="fire"] input[type="checkbox"]')!;
    expect(box.checked).toBe(true);
    box.checked = false;
    box.dispatchEvent(new Event("change"));
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("shows a range's formatted value and reports numeric changes", () => {
    const onChange = vi.fn();
    const sheet = renderSettingsSheet({
      rows: [
        {
          kind: "range",
          id: "snap",
          label: "Snap",
          value: 2,
          min: 1,
          max: 5,
          format: (v) => `${v} deg`,
          onChange,
        },
      ],
    });
    document.body.append(sheet);
    const range = sheet.querySelector<HTMLInputElement>('[data-setting="snap"] input[type="range"]')!;
    expect(range.value).toBe("2");
    expect(sheet.querySelector('[data-setting="snap"] .sheet-value')?.textContent).toBe("2 deg");
    range.value = "4";
    range.dispatchEvent(new Event("input"));
    expect(onChange).toHaveBeenCalledWith(4);
    expect(sheet.querySelector('[data-setting="snap"] .sheet-value')?.textContent).toBe("4 deg");
  });

  it("mounts a demo and updates it live (once initially, then on each change)", () => {
    const update = vi.fn();
    const demoEl = document.createElement("div");
    demoEl.className = "my-demo";
    const sheet = renderSettingsSheet({
      rows: [
        {
          kind: "range",
          id: "gain",
          label: "Gain",
          value: 3,
          min: 1,
          max: 9,
          onChange: () => {},
          demo: () => ({ el: demoEl, update }),
        },
      ],
    });
    document.body.append(sheet);
    // The demo node is mounted inside the row's demo slot.
    expect(sheet.querySelector(".sheet-demo .my-demo")).toBe(demoEl);
    // Seeded once with the initial value.
    expect(update).toHaveBeenCalledWith(3);
    const range = sheet.querySelector<HTMLInputElement>('[data-setting="gain"] input[type="range"]')!;
    range.value = "7";
    range.dispatchEvent(new Event("input"));
    expect(update).toHaveBeenLastCalledWith(7);
  });

  it("renders sections in order, each with a heading, after the bare rows", () => {
    const sheet = renderSettingsSheet({
      rows: [{ kind: "toggle", id: "bare", label: "Bare", value: true, onChange: () => {} }],
      sections: [
        { label: "Every game", rows: [{ kind: "toggle", id: "a", label: "A", value: false, onChange: () => {} }] },
        { label: "Othello", rows: [{ kind: "toggle", id: "b", label: "B", value: true, onChange: () => {} }] },
      ],
    });
    const heads = [...sheet.querySelectorAll(".sheet-section")].map((h) => h.textContent);
    expect(heads).toEqual(["Every game", "Othello"]);
    const order = [...sheet.querySelectorAll(".sheet-row, .sheet-section")].map(
      (n) => n.getAttribute("data-setting") ?? `#${n.textContent}`,
    );
    expect(order).toEqual(["bare", "#Every game", "a", "#Othello", "b"]);
  });

  it("a spec with no sections renders no heading at all — Bubble's caller must not grow an empty one", () => {
    const sheet = renderSettingsSheet({ rows: [{ kind: "toggle", id: "a", label: "A", value: false, onChange: () => {} }] });
    expect(sheet.querySelector(".sheet-section")).toBeNull();
  });

  it("a section with zero rows is not rendered", () => {
    const sheet = renderSettingsSheet({ rows: [], sections: [{ label: "Empty", rows: [] }] });
    expect(sheet.querySelector(".sheet-section")).toBeNull();
    expect(sheet.querySelectorAll(".sheet-row")).toHaveLength(0);
  });
});
