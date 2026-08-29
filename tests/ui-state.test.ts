//! Preserving the state a re-render has no right to throw away.
//!
//! Every game's `render()` is `container.replaceChildren(…)` — it rebuilds the
//! whole subtree from the game model. That is simple and correct for everything
//! the model owns, and wrong for the handful of things the PLAYER owns: whether
//! they opened the settings panel, and where their focus was. Losing those is
//! what made `dots.spec.ts:191` hang on CI: an async WebGPU probe re-rendered
//! mid-interaction, the open panel came back closed, and the checkbox inside it
//! was present but invisible for the rest of the test.
//!
//! This module is the "fix once rather than per game" half.

import { beforeEach, describe, expect, it } from "vitest";

import { captureUiState, restoreUiState } from "../src/ui-state.js";

/** Rebuild `root`'s children the way a game's render() does. */
function rerender(root: HTMLElement, html: string): void {
  const next = document.createElement("div");
  next.innerHTML = html;
  root.replaceChildren(...next.childNodes);
}

const SETTINGS = `
  <details class="sol-settings dots-settings">
    <summary>Settings</summary>
    <label><input type="checkbox" class="dots-set-tutor" /> Show tutor</label>
  </details>`;

let root: HTMLElement;
beforeEach(() => {
  document.body.replaceChildren();
  root = document.createElement("div");
  document.body.append(root);
});

describe("open panels", () => {
  it("an open <details> is still open after a re-render", () => {
    rerender(root, SETTINGS);
    root.querySelector("details")!.open = true;

    const state = captureUiState(root);
    rerender(root, SETTINGS); // the rebuild comes back closed, as the game builds it
    expect(root.querySelector("details")!.open).toBe(false);
    restoreUiState(root, state);

    expect(root.querySelector("details")!.open).toBe(true);
  });

  it("a closed <details> stays closed — restoring is not the same as opening", () => {
    rerender(root, SETTINGS);
    const state = captureUiState(root);
    rerender(root, SETTINGS);
    restoreUiState(root, state);
    expect(root.querySelector("details")!.open).toBe(false);
  });

  it("two panels sharing a class restore to the right one, by position", () => {
    const two = `<details class="p"><summary>a</summary></details>
                 <details class="p"><summary>b</summary></details>`;
    rerender(root, two);
    root.querySelectorAll("details")[1]!.open = true;

    const state = captureUiState(root);
    rerender(root, two);
    restoreUiState(root, state);

    const after = root.querySelectorAll("details");
    expect([after[0]!.open, after[1]!.open]).toEqual([false, true]);
  });

  it("ignores a panel that no longer exists, rather than throwing", () => {
    rerender(root, SETTINGS);
    root.querySelector("details")!.open = true;
    const state = captureUiState(root);

    rerender(root, `<p>the game replaced the panel with something else</p>`);
    expect(() => restoreUiState(root, state)).not.toThrow();
  });
});

describe("focus", () => {
  it("returns focus to the matching control, so a re-render does not dump the player at the top", () => {
    rerender(root, SETTINGS);
    const before = root.querySelector<HTMLInputElement>(".dots-set-tutor")!;
    before.focus();
    expect(document.activeElement).toBe(before);

    const state = captureUiState(root);
    rerender(root, SETTINGS);
    expect(document.activeElement).not.toBe(root.querySelector(".dots-set-tutor"));
    restoreUiState(root, state);

    expect(document.activeElement).toBe(root.querySelector(".dots-set-tutor"));
  });

  it("does not steal focus that has since moved outside the container", () => {
    rerender(root, SETTINGS);
    root.querySelector<HTMLInputElement>(".dots-set-tutor")!.focus();
    const state = captureUiState(root);

    const outside = document.createElement("input");
    document.body.append(outside);
    rerender(root, SETTINGS);
    outside.focus();

    restoreUiState(root, state);
    expect(document.activeElement).toBe(outside);
  });

  it("keeps the caret where it was in a text field", () => {
    const form = `<input type="text" class="seed" value="hello world" />`;
    rerender(root, form);
    const before = root.querySelector<HTMLInputElement>(".seed")!;
    before.focus();
    before.setSelectionRange(3, 7);

    const state = captureUiState(root);
    rerender(root, form);
    restoreUiState(root, state);

    const after = root.querySelector<HTMLInputElement>(".seed")!;
    expect([after.selectionStart, after.selectionEnd]).toEqual([3, 7]);
  });

  it("captures nothing when focus was never inside the container", () => {
    const outside = document.createElement("input");
    document.body.append(outside);
    outside.focus();
    rerender(root, SETTINGS);

    const state = captureUiState(root);
    rerender(root, SETTINGS);
    restoreUiState(root, state);

    expect(document.activeElement).toBe(outside);
  });
});
