//! The bubble "Aim & controls" menu: the device-dependent aim tuning
//! (fire-on-release, snap step, swipe gain, release settle) presented through the
//! shared {@link renderSettingsSheet} scaffold, each row with an **in-place live
//! demo** so you can feel the setting before committing. Bubble-specific glue
//! only — the panel chrome and layout live in the reusable sheet; the physics
//! helpers (`snapAngle`) are the same the real slider uses, so a demo behaves
//! like the game.

import {
  AIM_GAIN_SPEC,
  AIM_SETTLE_SPEC,
  AIM_SNAP_SPEC,
  aimSettleMs,
  aimSnapStep,
  aimSwipeGain,
  fireOnReleaseEnabled,
  setAimSettleMs,
  setAimSnapStep,
  setAimSwipeGain,
  setFireOnRelease,
} from "../../settings.js";
import { renderSettingsSheet, type DemoHandle } from "../../settings-sheet.js";
import { snapAngle } from "./bubble-aim.js";
import type { Geom } from "./bubble-wasm.js";

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

// A demo of drag-and-let-go firing: drag the knob; releasing either fires (on)
// or waits for the Fire button (off), so the flow reads at a glance.
function fireDemo(): DemoHandle<boolean> {
  let on = false;
  const status = el("span", { class: "demo-status" }, "Drag the knob…");
  const knob = el("input", {
    type: "range",
    class: "demo-mini",
    min: "0",
    max: "100",
    value: "50",
    "aria-label": "Fire-on-release demo knob",
  }) as HTMLInputElement;
  const fireBtn = el("button", { type: "button", class: "demo-fire" }, "Fire");
  const flash = (msg: string): void => {
    status.textContent = msg;
    status.classList.remove("demo-flash");
    void status.offsetWidth; // restart the flash animation
    status.classList.add("demo-flash");
  };
  knob.addEventListener("pointerup", () => {
    if (on) flash("🔥 Fired on release!");
    else status.textContent = "Let go — now press Fire.";
  });
  fireBtn.addEventListener("click", () => flash("🔥 Fired!"));
  const root = el(
    "div",
    { class: "demo demo-fire-row" },
    knob,
    fireBtn,
    status,
  );
  return {
    el: root,
    update(next: boolean): void {
      on = next;
      fireBtn.hidden = on;
      status.textContent = on ? "Drag and let go to fire." : "Drag, then press Fire.";
    },
  };
}

// A snap demo: dragging a mini aim slider that snaps to the chosen step, so a
// coarser step visibly "clicks" between fewer angles.
function snapDemo(geom: Geom): DemoHandle<number> {
  let step = aimSnapStep();
  const status = el("span", { class: "demo-status" }, "90°");
  const caption = el("span", { class: "demo-caption" }, "");
  const knob = el("input", {
    type: "range",
    class: "demo-mini",
    min: "70",
    max: "110",
    step: "1",
    value: "90",
    "aria-label": "Snap-step demo aim",
  }) as HTMLInputElement;
  const apply = (): void => {
    const snapped = snapAngle(Number(knob.value), step, geom);
    knob.value = String(snapped);
    status.textContent = `${snapped}°`;
  };
  knob.addEventListener("input", apply);
  const root = el("div", { class: "demo" }, knob, status, caption);
  return {
    el: root,
    update(next: number): void {
      step = next;
      caption.textContent = next <= 1 ? "every 1° (finest)" : `snaps every ${next}°`;
      apply();
    },
  };
}

// A gain demo: a full sweep of the mini slider moves the shown angle by exactly
// the gain, so you feel "how much a swipe is worth".
function gainDemo(): DemoHandle<number> {
  let gain = aimSwipeGain();
  const status = el("span", { class: "demo-status" }, "90°");
  const caption = el("span", { class: "demo-caption" }, "");
  const knob = el("input", {
    type: "range",
    class: "demo-mini",
    min: "0",
    max: "100",
    value: "50",
    "aria-label": "Swipe-gain demo",
  }) as HTMLInputElement;
  const apply = (): void => {
    const pos = Number(knob.value) / 100; // 0..1 across the sweep
    const angle = Math.round(90 - gain / 2 + pos * gain);
    status.textContent = `${angle}°`;
  };
  knob.addEventListener("input", apply);
  const root = el("div", { class: "demo" }, knob, status, caption);
  return {
    el: root,
    update(next: number): void {
      gain = next;
      caption.textContent =
        next >= 160 ? "full swipe = whole fan" : `full swipe = ${next}° (finer)`;
      apply();
    },
  };
}

// A settle demo: press Release and watch the bar fill over the settle window
// before it "fires"; Grab cancels it — the accidental-fire guard, made tangible.
function settleDemo(): DemoHandle<number> {
  let ms = aimSettleMs();
  let raf = 0;
  let startedAt = 0;
  const fill = el("span", { class: "demo-bar-fill" });
  const bar = el("div", { class: "demo-bar", "aria-hidden": "true" }, fill);
  const status = el("span", { class: "demo-status" }, "");
  const caption = el("span", { class: "demo-caption" }, "");
  const releaseBtn = el("button", { type: "button", class: "demo-release" }, "Release");
  const grabBtn = el("button", { type: "button", class: "demo-grab" }, "Grab");

  const stop = (): void => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };
  const tick = (): void => {
    if (!fill.isConnected) return stop();
    const t = ms <= 0 ? 1 : Math.min(1, (performance.now() - startedAt) / ms);
    fill.style.width = `${t * 100}%`;
    if (t >= 1) {
      stop();
      status.textContent = "🔥 Fired!";
      return;
    }
    raf = requestAnimationFrame(tick);
  };
  releaseBtn.addEventListener("click", () => {
    stop();
    startedAt = performance.now();
    status.textContent = "settling…";
    fill.style.width = "0%";
    tick();
  });
  grabBtn.addEventListener("click", () => {
    stop();
    fill.style.width = "0%";
    status.textContent = "cancelled";
  });
  const root = el(
    "div",
    { class: "demo demo-settle" },
    el("div", { class: "demo-settle-btns" }, releaseBtn, grabBtn),
    bar,
    status,
    caption,
  );
  return {
    el: root,
    update(next: number): void {
      ms = next;
      caption.textContent = next <= 0 ? "fires immediately" : `waits ${next} ms after you let go`;
    },
  };
}

export interface AimSettingsHooks {
  geom: Geom;
  /** Re-snap the live aim to a changed step. */
  onSnapChange(step: number): void;
  /** Re-apply the slider band to a changed gain. */
  onGainChange(gain: number): void;
}

/** The "Aim & controls" disclosure: a summary + the demo-driven settings sheet,
 *  wired to persist each setting and nudge the live aim bar where needed. */
export function renderAimSettings(hooks: AimSettingsHooks): HTMLElement {
  const sheet = renderSettingsSheet({
    intro:
      "Aiming feel depends on your device — there's no perfect default. Tune these and try each demo.",
    rows: [
      {
        kind: "toggle",
        id: "fire-on-release",
        label: "Fire on release",
        hint: "Drag the aim slider and let go to fire — no button press. Off by default.",
        value: fireOnReleaseEnabled(),
        onChange: (on) => setFireOnRelease(on),
        demo: fireDemo,
      },
      {
        kind: "range",
        id: "snap",
        label: "Snap step",
        hint: "Snap the aim to whole-degree steps. A bigger step is easier to hold steady on a jittery screen.",
        value: aimSnapStep(),
        min: AIM_SNAP_SPEC.min,
        max: AIM_SNAP_SPEC.max,
        step: 1,
        format: (v) => `${v}°`,
        onChange: (v) => {
          setAimSnapStep(v);
          hooks.onSnapChange(v);
        },
        demo: () => snapDemo(hooks.geom),
      },
      {
        kind: "range",
        id: "gain",
        label: "Swipe gain",
        hint: "How far one full slider sweep moves the aim. Lower gives finer control over a narrower band.",
        value: aimSwipeGain(),
        min: AIM_GAIN_SPEC.min,
        max: AIM_GAIN_SPEC.max,
        step: 10,
        format: (v) => (v >= AIM_GAIN_SPEC.max ? `${v}° (full)` : `${v}°`),
        onChange: (v) => {
          setAimSwipeGain(v);
          hooks.onGainChange(v);
        },
        demo: gainDemo,
      },
      {
        kind: "range",
        id: "settle",
        label: "Release settle",
        hint: "With fire-on-release on: how long after you let go before it fires (re-grabbing cancels).",
        value: aimSettleMs(),
        min: AIM_SETTLE_SPEC.min,
        max: AIM_SETTLE_SPEC.max,
        step: 25,
        format: (v) => `${v} ms`,
        onChange: (v) => setAimSettleMs(v),
        demo: settleDemo,
      },
    ],
  });

  const details = el("details", { class: "bub-aim-settings" });
  details.append(el("summary", {}, "⚙ Aim & controls"), sheet);
  return details;
}
