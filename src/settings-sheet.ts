//! A reusable, demo-driven settings sheet — the shelf's legible pattern for a
//! menu of tunable preferences. `renderSettingsSheet(spec)` lays out a panel of
//! rows (a toggle **or** a range with a live value readout), each with an
//! optional one-line hint and an **in-place demo** that reacts as you move the
//! control, so you can feel what you're setting before you commit. Pure DOM, no
//! game-specific logic and no persistence — the caller wires `onChange` to its
//! own storage and its own live surface. Built once; any game can pass a spec.

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

/** A live demo widget for a setting: its node, plus an `update(value)` the sheet
 *  calls once with the initial value and again on every change. */
export interface DemoHandle<T> {
  el: HTMLElement;
  update(value: T): void;
}

/** Builds a demo when the row is rendered (deferred so demos only exist when the
 *  sheet is opened). */
export type DemoFactory<T> = () => DemoHandle<T>;

/** A boolean setting shown as a switch. */
export interface ToggleRow {
  kind: "toggle";
  id: string;
  label: string;
  hint?: string;
  value: boolean;
  onChange(value: boolean): void;
  demo?: DemoFactory<boolean>;
}

/** A numeric setting shown as a slider with a live value readout. */
export interface RangeRow {
  kind: "range";
  id: string;
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Formats the value readout (default `${value}`). */
  format?(value: number): string;
  onChange(value: number): void;
  demo?: DemoFactory<number>;
}

export type SettingRow = ToggleRow | RangeRow;

export interface SettingsSheetSpec {
  intro?: string;
  rows: SettingRow[];
}

function renderToggleRow(row: ToggleRow): HTMLElement {
  const wrap = el("div", { class: "sheet-row", "data-setting": row.id });
  const box = el("input", { type: "checkbox", class: "sheet-toggle-input" }) as HTMLInputElement;
  box.checked = row.value;

  const demo = row.demo?.();
  box.addEventListener("change", () => {
    row.onChange(box.checked);
    demo?.update(box.checked);
  });

  const control = el(
    "label",
    { class: "sheet-toggle" },
    box,
    el("span", { class: "sheet-toggle-track", "aria-hidden": "true" }),
    el("span", { class: "sheet-toggle-label" }, row.label),
  );
  wrap.append(el("div", { class: "sheet-row-head" }, control));
  if (row.hint) wrap.append(el("p", { class: "sheet-hint" }, row.hint));
  if (demo) {
    wrap.append(el("div", { class: "sheet-demo" }, demo.el));
    demo.update(row.value);
  }
  return wrap;
}

function renderRangeRow(row: RangeRow): HTMLElement {
  const wrap = el("div", { class: "sheet-row", "data-setting": row.id });
  const fmt = row.format ?? ((v: number): string => String(v));
  const range = el("input", {
    type: "range",
    class: "sheet-range",
    min: String(row.min),
    max: String(row.max),
    step: String(row.step ?? 1),
    value: String(row.value),
    "aria-label": row.label,
  }) as HTMLInputElement;
  const value = el("output", { class: "sheet-value" }, fmt(row.value));

  const demo = row.demo?.();
  range.addEventListener("input", () => {
    const v = Number(range.value);
    value.textContent = fmt(v);
    row.onChange(v);
    demo?.update(v);
  });

  wrap.append(
    el(
      "div",
      { class: "sheet-row-head" },
      el("span", { class: "sheet-range-label" }, row.label),
      range,
      value,
    ),
  );
  if (row.hint) wrap.append(el("p", { class: "sheet-hint" }, row.hint));
  if (demo) {
    wrap.append(el("div", { class: "sheet-demo" }, demo.el));
    demo.update(row.value);
  }
  return wrap;
}

/** Build a settings sheet from a spec. The returned node is a plain container;
 *  the caller places it wherever it likes (e.g. inside a `<details>`). */
export function renderSettingsSheet(spec: SettingsSheetSpec): HTMLElement {
  const sheet = el("div", { class: "sheet" });
  if (spec.intro) sheet.append(el("p", { class: "sheet-intro" }, spec.intro));
  for (const row of spec.rows) {
    sheet.append(row.kind === "toggle" ? renderToggleRow(row) : renderRangeRow(row));
  }
  return sheet;
}
