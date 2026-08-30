//! The game frame — the structure every game page shares.
//!
//! Five bands, four of them fixed-height: the shelf bar (the chrome's), the game
//! bar, the meter row, the stage, the dock. A game declares a `GameFrameSpec`
//! once and calls `update()` as its model changes; it never touches the chrome.
//! The rule the frame exists for: **nothing above the board changes height while
//! you play.** Text swaps inside slots that already have the room (a seat's
//! sub-label is always present, even when empty), the meter count is fixed for
//! the life of the frame, and anything transient overlays the stage.
//!
//! Plan: `plans/2026-08-30-plan-game-frame.md`. Mocks: `mocks/d-game-frame.html`.

import type { SettingRow } from "./settings-sheet.js";

/** A seat in a versus game: who, their glyph, their score, and what they are doing. */
export interface SeatMeter {
  readonly kind: "seat";
  readonly id: string;
  readonly name: string;
  readonly glyph: string;
  readonly score: string | number;
  /** The 12px line under the name — "your move", "thinking…" — or nothing. */
  readonly sub?: string;
  readonly state?: "idle" | "active" | "thinking";
}

/** A number with a label: moves, score, lives. */
export interface StatMeter {
  readonly kind: "stat";
  readonly id: string;
  readonly value: string | number;
  readonly label: string;
}

export type Meter = SeatMeter | StatMeter;

/** An action on the game in progress. At most five; the dock has room for no more. */
export interface Verb {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  readonly primary?: boolean;
  readonly disabled?: boolean;
  onPress(): void;
}

/** Everything a game tells the frame. */
export interface GameFrameSpec {
  readonly title: string;
  /** A short chip beside the title: "Medium", "Today's deal", "Campaign · 3 of 6". */
  readonly mode?: string;
  /** The one line under the name on the start screen. */
  readonly pitch?: string;
  readonly meters: readonly Meter[];
  readonly verbs: readonly Verb[];
  /** The New game card. Shown on the start screen; read-only in the rail. */
  readonly setup?: readonly SettingRow[];
  /** The game's own section of the settings sheet. */
  readonly preferences?: readonly SettingRow[];
}

/** An item in the game bar's ⋯ menu. */
export interface MenuItem {
  readonly label: string;
  readonly href: string;
  readonly newTab?: boolean;
}

/** Options the chrome hands the frame. */
export interface GameFrameOptions {
  /** Used for the game bar when there is no spec yet (an unmigrated game). */
  readonly title?: string;
  readonly menu?: readonly MenuItem[];
}

/** A mounted frame. */
export interface GameFrame {
  readonly root: HTMLElement;
  /** Where the game renders. Fills whatever height the bands leave. */
  readonly stage: HTMLElement;
  update(spec: GameFrameSpec): void;
  destroy(): void;
}

/** The dock has room for five labelled 44px targets at 390px. */
export const MAX_VERBS = 5;

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

function assertVerbs(spec: GameFrameSpec): void {
  if (spec.verbs.length > MAX_VERBS) {
    throw new Error(
      `[frame] ${spec.title} declares ${spec.verbs.length} verbs; the dock holds ${MAX_VERBS}: ` +
        spec.verbs.map((v) => v.id).join(", "),
    );
  }
}

function renderSeat(m: SeatMeter): HTMLElement {
  const seat = el(
    "div",
    { class: "gf-seat", "data-meter": m.id, "data-state": m.state ?? "idle" },
    el("span", { class: "gf-seat-glyph", "aria-hidden": "true" }, m.glyph),
    el(
      "span",
      { class: "gf-seat-who" },
      el("span", { class: "gf-seat-name" }, m.name),
      el("span", { class: "gf-sub" }, m.sub ?? ""),
    ),
    el("span", { class: "gf-seat-score" }, String(m.score)),
  );
  return seat;
}

function renderStat(m: StatMeter): HTMLElement {
  return el(
    "div",
    { class: "gf-stat", "data-meter": m.id },
    el("b", { class: "gf-stat-value" }, String(m.value)),
    el("span", { class: "gf-stat-label" }, m.label),
  );
}

function renderMeter(m: Meter): HTMLElement {
  return m.kind === "seat" ? renderSeat(m) : renderStat(m);
}

/** Swap a meter's text in place. Same kind, same slot — the element is reused. */
function patchMeter(slot: HTMLElement, m: Meter): void {
  if (m.kind === "seat") {
    slot.dataset.state = m.state ?? "idle";
    slot.querySelector(".gf-seat-name")!.textContent = m.name;
    slot.querySelector(".gf-sub")!.textContent = m.sub ?? "";
    slot.querySelector(".gf-seat-score")!.textContent = String(m.score);
    slot.querySelector(".gf-seat-glyph")!.textContent = m.glyph;
  } else {
    slot.querySelector(".gf-stat-value")!.textContent = String(m.value);
    slot.querySelector(".gf-stat-label")!.textContent = m.label;
  }
}

function renderVerb(v: Verb): HTMLButtonElement {
  const btn = el(
    "button",
    { class: v.primary ? "gf-verb primary" : "gf-verb", type: "button", "data-verb": v.id },
    el("i", { class: "gf-verb-icon", "aria-hidden": "true" }, v.icon),
    el("span", { class: "gf-verb-label" }, v.label),
  );
  btn.disabled = v.disabled === true;
  btn.addEventListener("click", () => v.onPress());
  return btn;
}

/**
 * Mount the frame into `host`. With a spec, all four bands the frame owns; without
 * one (an unmigrated game), the game bar and the stage only — the game keeps
 * rendering its own controls inside the stage until it migrates.
 */
export function renderGameFrame(host: HTMLElement, spec?: GameFrameSpec, opts: GameFrameOptions = {}): GameFrame {
  if (spec) assertVerbs(spec);
  const title = spec?.title ?? opts.title ?? "";

  const titleEl = el("span", { class: "gf-title" }, title);
  const modeEl = el("span", { class: "gf-mode" });
  const more = el("button", { class: "gf-more", type: "button", "aria-expanded": "false", "aria-label": "More" }, "⋯");
  const menu = el("div", { class: "gf-menu", hidden: "" });
  for (const item of opts.menu ?? []) {
    const a = el("a", { href: item.href }, item.label);
    if (item.newTab) {
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener");
    }
    menu.append(a);
  }
  const setMenu = (open: boolean): void => {
    menu.hidden = !open;
    more.setAttribute("aria-expanded", String(open));
  };
  more.addEventListener("click", () => setMenu(menu.hidden));
  // Escape closes; a click anywhere outside the menu and its button closes. Both
  // listeners are removed with the frame so a destroyed frame leaks nothing.
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape" && !menu.hidden) setMenu(false);
  };
  const onDocClick = (e: MouseEvent): void => {
    if (menu.hidden) return;
    const t = e.target as Node;
    if (!menu.contains(t) && !more.contains(t)) setMenu(false);
  };
  document.addEventListener("keydown", onKey);
  document.addEventListener("click", onDocClick);
  const bar = el(
    "div",
    { class: "gf-game-bar" },
    el("a", { class: "gf-back", href: "/", "aria-label": "Back to the shelf" }, "‹"),
    titleEl,
    el("span", { class: "gf-spacer" }),
    more,
    menu,
  );
  const setMode = (mode: string | undefined): void => {
    if (mode) {
      modeEl.textContent = mode;
      if (!modeEl.isConnected) titleEl.after(modeEl);
    } else {
      modeEl.remove();
    }
  };
  setMode(spec?.mode);

  const stage = el("div", { class: "gf-stage" });
  const root = el("div", { class: "gf" }, bar);

  // Undeclared until a spec arrives: mounted by the chrome for an unmigrated game,
  // the frame shows the game bar and the stage only. The first update() is the
  // declaration; from then on the meter count is fixed.
  let declared = spec !== undefined;
  let meters: HTMLElement | null = null;
  let meterCount = spec?.meters.length ?? 0;
  const declareMeters = (list: readonly Meter[]): void => {
    meterCount = list.length;
    if (list.length === 0) return;
    meters = el("div", { class: "gf-meters" }, ...list.map(renderMeter));
    stage.before(meters);
  };
  root.append(stage);
  if (spec) declareMeters(spec.meters);

  let dock: HTMLElement | null = null;
  const renderDock = (verbs: readonly Verb[]): void => {
    if (verbs.length === 0) {
      dock?.remove();
      dock = null;
      return;
    }
    const next = el("div", { class: "gf-dock" }, ...verbs.map(renderVerb));
    if (dock) dock.replaceWith(next);
    else root.append(next);
    dock = next;
  };
  if (spec) renderDock(spec.verbs);

  host.append(root);
  console.debug(`[frame] mount title=${title} verbs=${spec?.verbs.length ?? 0} meters=${meterCount}`);

  let destroyed = false;
  return {
    root,
    stage,
    update(next: GameFrameSpec): void {
      assertVerbs(next);
      if (!declared) {
        declared = true;
        declareMeters(next.meters);
        console.debug(`[frame] declare title=${next.title} verbs=${next.verbs.length} meters=${next.meters.length}`);
      }
      if (next.meters.length !== meterCount) {
        throw new Error(
          `[frame] ${next.title} changed its meters mid-game (mounted ${meterCount}, update has ${next.meters.length}); slots are fixed`,
        );
      }
      titleEl.textContent = next.title;
      setMode(next.mode);
      if (meters) {
        const slots = [...meters.children] as HTMLElement[];
        next.meters.forEach((m, i) => patchMeter(slots[i]!, m));
      }
      renderDock(next.verbs);
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onDocClick);
      root.remove();
    },
  };
}
