//! One shape for hand controls (phase 7 of the play-surface plan, mock F Q3 +
//! Q4). A game that needs on-screen buttons — 2048's slide, Align's move /
//! turn / drop — describes them and this module draws them, in one of two
//! layouts: a **d-pad** (up over left · down · right) or a **split** pair of
//! thumb clusters, left and right. Before this, 2048 and Align each built their
//! own pad with its own sizes, its own repeat logic and its own look; no two
//! games agreed, which is the drift the frame exists to end.
//!
//! Whether a pad shows at all is the player's, not the game's: the common
//! preference *On-screen controls: Auto / On / Off* (`settings.ts`), Auto
//! meaning "a coarse pointer" — a phone, a tablet. A game asks `padVisible()`
//! and renders the pad or not; the swipe and the keys always work.
//!
//! Every press routes through the game's `onPress(id)`; the pad knows nothing
//! about any core. A `repeat` button fires at once, waits `dasMs`, then fires at
//! `repeatMs()` until released (Align's move buttons — DAS/ARR, read at hold
//! start so a settings change applies to the next press).

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const c of children) node.append(c);
  return node;
}

/** One button on a pad. */
export interface PadButton {
  /** What `onPress` receives. Also `data-pad` on the button, so a test can find it. */
  readonly id: string;
  /** The glyph drawn on the button (aria-hidden; the label is the name). */
  readonly glyph: string;
  /** The accessible name. */
  readonly label: string;
  /** Auto-repeat while held. */
  readonly repeat?: boolean;
  /** An extra class for a game's own sizing hook. */
  readonly cls?: string;
}

interface PadBase {
  /** The group's accessible name. */
  readonly label: string;
  onPress(id: string): void;
  /** The hold-to-repeat cadence for a button, read at hold start. Default 60ms. */
  readonly repeatMs?: (id: string) => number;
  /** The wait before a held button starts repeating, so a tap is one step. Default 170ms. */
  readonly dasMs?: number;
  /** Called on every press — a game's haptic buzz. */
  readonly haptic?: () => void;
}

/** A d-pad: four buttons in reading order up, left, down, right. */
export interface DpadSpec extends PadBase {
  readonly layout: "dpad";
  readonly buttons: readonly PadButton[];
}

/** A split pad: a cluster under each thumb. */
export interface SplitSpec extends PadBase {
  readonly layout: "split";
  readonly left: readonly PadButton[];
  readonly right: readonly PadButton[];
}

export type PadSpec = DpadSpec | SplitSpec;

const DEFAULT_REPEAT_MS = 60;
const DEFAULT_DAS_MS = 170;

function renderButton(b: PadButton, spec: PadBase): HTMLButtonElement {
  const btn = el(
    "button",
    { type: "button", class: b.cls ? `gf-pad-btn ${b.cls}` : "gf-pad-btn", "data-pad": b.id, "aria-label": b.label },
    el("span", { "aria-hidden": "true" }, b.glyph),
  ) as HTMLButtonElement;
  let delay = 0;
  let timer = 0;
  const fire = (): void => spec.onPress(b.id);
  const stop = (): void => {
    if (delay) window.clearTimeout(delay);
    if (timer) window.clearInterval(timer);
    delay = 0;
    timer = 0;
  };
  btn.addEventListener("pointerdown", (e) => {
    e.preventDefault(); // no focus ring on a thumb, no text selection, no double-fire via click
    spec.haptic?.();
    fire();
    if (!b.repeat) return;
    const gap = spec.repeatMs?.(b.id) ?? DEFAULT_REPEAT_MS;
    delay = window.setTimeout(() => {
      fire();
      timer = window.setInterval(fire, gap);
    }, spec.dasMs ?? DEFAULT_DAS_MS);
  });
  btn.addEventListener("pointerup", stop);
  btn.addEventListener("pointerleave", stop);
  btn.addEventListener("pointercancel", stop);
  // A keyboard user's Enter/Space: the button's own click, once, no repeat.
  btn.addEventListener("click", (e) => {
    if (e.detail !== 0) return; // a pointer click already fired on pointerdown
    fire();
  });
  return btn;
}

/** Draw a pad. The caller mounts it; `padVisible()` says whether to. */
export function renderPad(spec: PadSpec): HTMLElement {
  if (spec.layout === "dpad") {
    return el(
      "div",
      { class: "gf-pad gf-pad-dpad", role: "group", "aria-label": spec.label },
      ...spec.buttons.map((b) => renderButton(b, spec)),
    );
  }
  return el(
    "div",
    { class: "gf-pad gf-pad-split", role: "group", "aria-label": spec.label },
    el("div", { class: "gf-pad-cluster gf-pad-left" }, ...spec.left.map((b) => renderButton(b, spec))),
    el("div", { class: "gf-pad-cluster gf-pad-right" }, ...spec.right.map((b) => renderButton(b, spec))),
  );
}
