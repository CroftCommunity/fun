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

import { renderSettingsSheet, type SettingRow } from "./settings-sheet.js";
import type { Progress } from "./progress.js";

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
  /** `button` is the verb's own element — pass it to `openSheet` so focus returns there. */
  onPress(button: HTMLButtonElement): void;
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
  /** Called by the setup sheet's Start button, after the setup rows' own onChange handlers. */
  onStart?(): void;
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
  /**
   * The "Every game" rows of the settings sheet — hints, declare assistance, sound,
   * controls on the left. A factory, so the values are read when the sheet opens.
   */
  readonly common?: () => readonly SettingRow[];
  /** Which side the controls sit on: the rail's column, the dock's verb order. Default right. */
  readonly side?: "left" | "right";
  /** Called after every `update()` — the chrome snapshots the game into the store here. */
  onUpdate?(): void;
}

/** What the start screen needs. */
export interface StartOptions {
  readonly id: string;
  readonly title: string;
  readonly pitch?: string;
  /** The poster's setup card (the entry's `setup` factory), if the game has one. */
  readonly setup?: readonly SettingRow[];
  /** A record in the store, if any — decides poster vs continue card. */
  readonly progress: Progress | null;
  onPlay(): void;
  onResume(progress: Progress): void;
  /** New game from the continue card: the chrome clears the store and shows the poster. */
  onNewGame(): void;
}

/** Which sheet to open. */
export type SheetKind = "settings" | "setup";

/** A mounted frame. */
export interface GameFrame {
  readonly root: HTMLElement;
  /** The band that owns the board area and its overlays (toasts). */
  readonly stage: HTMLElement;
  /** Where the game renders — a child of the stage, so a game's replaceChildren never wipes a toast. */
  readonly mount: HTMLElement;
  update(spec: GameFrameSpec): void;
  /** Open the settings or the New game sheet (a dialog on a phone; on desktop settings are inline).
   *  `from` is the control to return focus to on close. */
  openSheet(kind: SheetKind, from?: HTMLElement): void;
  closeSheet(): void;
  /** Flip the controls' side live — the mirror preference's onChange calls this. */
  setSide(side: "left" | "right"): void;
  /**
   * The start screen, over the stage: the poster (no record) or the continue card
   * (a record). Removed by Play / Continue; New game swaps the card for the poster.
   */
  renderStart(opts: StartOptions): void;
  /** Remove the start screen if it is showing. */
  clearStart(): void;
  /**
   * A transient line over the stage — the first-move hint, the AI's banter — that is
   * never in flow and so never moves the board. Replaces any toast showing; gone after
   * `ms` (default 4000). Announced politely.
   */
  toast(text: string, ms?: number): void;
  destroy(): void;
}

/** The dock has room for five labelled 44px targets at 390px — four of the game's, plus Settings. */
export const MAX_VERBS = 5;
/** What a game may declare; the frame appends its own Settings verb. */
export const MAX_GAME_VERBS = MAX_VERBS - 1;
/** The dock-or-rail breakpoint (plan D2: the 280px rail holds at 900 with margin). */
export const RAIL_MIN_WIDTH = 900;

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
  if (spec.verbs.length > MAX_GAME_VERBS) {
    throw new Error(
      `[frame] ${spec.title} declares ${spec.verbs.length} verbs; the dock holds ${MAX_VERBS} and Settings is the frame's: ` +
        spec.verbs.map((v) => v.id).join(", "),
    );
  }
  if (spec.verbs.some((v) => v.id === "settings")) {
    throw new Error(`[frame] ${spec.title} declares a 'settings' verb; Settings is the frame's own verb`);
  }
}

/** How a setup row reads in the rail's read-only "This game" panel. */
function describeRow(row: SettingRow): string {
  if (row.kind === "toggle") return row.value ? "On" : "Off";
  if (row.kind === "range") return row.format ? row.format(row.value) : String(row.value);
  return row.options.find((o) => o.value === row.value)?.label ?? row.value;
}

/** "2 hours ago" for the continue card's eyebrow; coarse on purpose. */
function ago(iso: string, now: Date): string {
  const ms = now.getTime() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const m = Math.round(ms / 60000);
  if (m < 2) return "just now";
  if (m < 60) return `${m} minutes ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

/** A focusable element inside `root`, in document order. */
function firstFocusable(root: ParentNode): HTMLElement | null {
  return root.querySelector<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
  );
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
  btn.addEventListener("click", () => v.onPress(btn));
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
    if (e.key !== "Escape") return;
    if (!menu.hidden) setMenu(false);
    else closeSheet();
  };
  const onDocClick = (e: MouseEvent): void => {
    if (menu.hidden) return;
    const t = e.target as Node;
    if (!menu.contains(t) && !more.contains(t)) setMenu(false);
  };
  document.addEventListener("keydown", onKey);
  document.addEventListener("click", onDocClick);
  // closeSheet is declared below; the listener is only ever invoked after mount.
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

  const mountEl = el("div", { class: "gf-mount" });
  const stage = el("div", { class: "gf-stage" }, mountEl);
  const root = el("div", { class: "gf" }, bar);

  // The shape is declared on the root so a test — and a game — can read it without
  // measuring. jsdom has no matchMedia; that is a dock.
  const media = typeof matchMedia === "function" ? matchMedia(`(min-width: ${RAIL_MIN_WIDTH}px)`) : null;
  const paintShape = (): void => {
    root.dataset.gfShape = media?.matches ? "rail" : "dock";
  };
  paintShape();
  media?.addEventListener("change", paintShape);
  const setSide = (side: "left" | "right"): void => {
    root.dataset.gfSide = side;
  };
  setSide(opts.side ?? "right");

  let current: GameFrameSpec | undefined = spec;

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

  // --- sheets: a dialog over the frame (phone), replaced never stacked -------
  let sheet: HTMLElement | null = null;
  let scrim: HTMLElement | null = null;
  let opener: HTMLElement | null = null;
  const closeSheet = (): void => {
    if (!sheet) return;
    sheet.remove();
    scrim?.remove();
    sheet = null;
    scrim = null;
    opener?.focus();
    opener = null;
  };
  const sectionsFor = (kind: SheetKind, s: GameFrameSpec): HTMLElement => {
    if (kind === "setup") {
      const body = renderSettingsSheet({ rows: [...(s.setup ?? [])] });
      const start = el("button", { class: "gf-start", type: "button" }, "▸ Start");
      start.addEventListener("click", () => {
        closeSheet();
        s.onStart?.();
      });
      body.append(el("div", { class: "gf-sheet-actions" }, start));
      return body;
    }
    return renderSettingsSheet({
      rows: [],
      sections: [
        { label: "Every game", rows: opts.common?.() ?? [] },
        { label: s.title, rows: s.preferences ?? [] },
      ],
    });
  };
  // `from` is the control that opened the sheet, so focus can return to it on
  // close. Passed explicitly because a touch tap does not focus a button on
  // WebKit — document.activeElement would be the body.
  const openSheet = (kind: SheetKind, from?: HTMLElement): void => {
    if (!current) return;
    closeSheet();
    opener = from ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    scrim = el("div", { class: "gf-scrim" });
    scrim.addEventListener("click", closeSheet);
    sheet = el(
      "div",
      { class: "gf-sheet", role: "dialog", "aria-modal": "true", "aria-label": kind === "setup" ? "New game" : "Settings" },
      el("div", { class: "gf-sheet-grip", "aria-hidden": "true" }),
      el("h2", { class: "gf-sheet-title" }, kind === "setup" ? "New game" : "Settings"),
      sectionsFor(kind, current),
    );
    root.append(scrim, sheet);
    console.debug(`[frame] sheet=${kind} open`);
    firstFocusable(sheet)?.focus();
  };

  // --- the rail's extra panel: setup read-only + preferences inline (desktop) --
  let extra: HTMLElement | null = null;
  const renderExtra = (s: GameFrameSpec): void => {
    const hasSetup = (s.setup?.length ?? 0) > 0;
    const hasPrefs = (s.preferences?.length ?? 0) > 0 || opts.common !== undefined;
    if (!hasSetup && !hasPrefs) {
      extra?.remove();
      extra = null;
      return;
    }
    const next = el("div", { class: "gf-extra" });
    if (hasSetup) {
      next.append(el("h2", { class: "gf-extra-head" }, "This game"));
      for (const row of s.setup ?? []) {
        next.append(
          el("div", { class: "gf-readonly" }, el("span", {}, row.label), el("span", { class: "gf-readonly-value" }, describeRow(row))),
        );
      }
    }
    if (hasPrefs) {
      next.append(
        el("h2", { class: "gf-extra-head" }, "Settings"),
        renderSettingsSheet({
          rows: [],
          sections: [
            { label: "Every game", rows: opts.common?.() ?? [] },
            { label: s.title, rows: s.preferences ?? [] },
          ],
        }),
      );
    }
    if (extra) extra.replaceWith(next);
    else root.append(next);
    extra = next;
  };

  // --- the start screen ---------------------------------------------------------
  let start: HTMLElement | null = null;
  const clearStart = (): void => {
    start?.remove();
    start = null;
  };
  const renderStart = (o: StartOptions): void => {
    clearStart();
    const p = o.progress;
    const kind = p ? "continue" : "poster";
    console.debug(`[frame] start=${kind} id=${o.id} progress=${p?.status ?? "none"}`);
    if (!p) {
      const play = el("button", { class: "gf-play", type: "button" }, "▸ Play");
      play.addEventListener("click", () => {
        clearStart();
        o.onPlay();
      });
      const body = el(
        "div",
        { class: "gf-start-body" },
        el("h2", { class: "gf-start-title" }, o.title),
      );
      if (o.pitch) body.append(el("p", { class: "gf-start-pitch" }, o.pitch));
      if (o.setup && o.setup.length > 0) {
        body.append(el("div", { class: "gf-start-setup" }, renderSettingsSheet({ rows: [...o.setup] })));
      }
      body.append(play);
      start = el(
        "section",
        { class: "gf-start gf-poster", "aria-label": `Start ${o.title}` },
        el("img", { class: "gf-start-art", src: `/${o.id}/assets/splash.jpg`, alt: "" }),
        el("div", { class: "gf-start-veil", "aria-hidden": "true" }),
        body,
      );
    } else {
      const finished = p.status === "finished";
      const eyebrow = `${finished ? "Finished" : "In progress"} · ${ago(p.updatedAt, new Date())}`;
      const newGame = el("button", { class: finished ? "gf-newgame primary" : "gf-newgame", type: "button" }, "New game…");
      newGame.addEventListener("click", () => o.onNewGame());
      const actions = el("div", { class: "gf-start-actions" });
      if (!finished) {
        const cont = el("button", { class: "gf-continue-btn primary", type: "button" }, "▸ Continue");
        cont.addEventListener("click", () => {
          clearStart();
          o.onResume(p);
        });
        actions.append(cont);
      }
      actions.append(newGame);
      start = el(
        "section",
        { class: "gf-start gf-continue", "aria-label": `Continue ${o.title}` },
        el(
          "div",
          { class: "gf-continue-card" },
          el("img", { class: "gf-continue-icon", src: `/${o.id}/assets/icon.jpg`, alt: "" }),
          el(
            "div",
            { class: "gf-continue-text" },
            el("span", { class: "gf-start-eyebrow" }, eyebrow),
            el("h2", { class: "gf-start-title" }, o.title),
            el("p", { class: "gf-start-line" }, p.summary.line),
            actions,
          ),
        ),
      );
    }
    // Over the WHOLE frame, not the stage: the bands under it are not declared
    // until the game mounts (a meter row appears at Play), and the poster hides
    // that layout entirely. Once the board is visible, nothing moves.
    root.append(start);
    firstFocusable(start)?.focus();
  };

  // --- toasts: absolutely positioned over the stage, one at a time ---------------
  let toastEl: HTMLElement | null = null;
  let toastTimer: number | null = null;
  const toast = (text: string, ms = 4000): void => {
    toastEl?.remove();
    if (toastTimer !== null) clearTimeout(toastTimer);
    toastEl = el("div", { class: "gf-toast", role: "status", "aria-live": "polite" }, text);
    stage.append(toastEl);
    toastTimer = window.setTimeout(() => {
      toastEl?.remove();
      toastEl = null;
      toastTimer = null;
    }, ms);
  };

  let dock: HTMLElement | null = null;
  const settingsButton = (): HTMLButtonElement => {
    const btn: HTMLButtonElement = renderVerb({
      id: "settings",
      label: "Settings",
      icon: "☰",
      onPress: (b) => openSheet("settings", b),
    });
    return btn;
  };
  const renderDock = (verbs: readonly Verb[]): void => {
    const next = el("div", { class: "gf-dock" }, ...verbs.map(renderVerb), settingsButton());
    if (dock) dock.replaceWith(next);
    else if (extra) extra.before(next);
    else root.append(next);
    dock = next;
  };
  if (spec) {
    renderDock(spec.verbs);
    renderExtra(spec);
  }

  host.append(root);
  console.debug(`[frame] mount title=${title} verbs=${spec?.verbs.length ?? 0} meters=${meterCount}`);

  let destroyed = false;
  return {
    root,
    stage,
    mount: mountEl,
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
      current = next;
      renderDock(next.verbs);
      renderExtra(next);
      opts.onUpdate?.();
    },
    openSheet,
    closeSheet,
    setSide,
    renderStart,
    clearStart,
    toast,
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onDocClick);
      media?.removeEventListener("change", paintShape);
      if (toastTimer !== null) clearTimeout(toastTimer);
      root.remove();
    },
  };
}
