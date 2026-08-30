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

/**
 * A one-of-several setting shown as a radio group. Added for the appearance
 * picker (M5): a family or a layout is a choice among named options, which
 * neither a toggle nor a range can express. Rendered as real radios inside a
 * `<fieldset>` so the group is announced as a group and arrow keys work.
 */
export interface ChoiceRow {
  kind: "choice";
  id: string;
  label: string;
  hint?: string;
  value: string;
  options: ReadonlyArray<{ readonly value: string; readonly label: string; readonly hint?: string; readonly disabled?: boolean }>;
  onChange(value: string): void;
}

export type SettingRow = ToggleRow | RangeRow | ChoiceRow;

/** A headed group of rows. The frame uses it for "Every game" and the game's own section. */
export interface SettingsSection {
  readonly label: string;
  readonly rows: readonly SettingRow[];
}

export interface SettingsSheetSpec {
  intro?: string;
  rows: SettingRow[];
  /** Rendered after `rows`, each under an `<h3 class="sheet-section">`; a section with no rows is skipped. */
  sections?: readonly SettingsSection[];
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

function renderChoiceRow(row: ChoiceRow): HTMLElement {
  const wrap = el("fieldset", { class: "sheet-row sheet-choice", "data-setting": row.id });
  wrap.append(el("legend", { class: "sheet-choice-label" }, row.label));
  if (row.hint) wrap.append(el("p", { class: "sheet-hint" }, row.hint));
  for (const opt of row.options) {
    const input = el("input", {
      type: "radio",
      name: `sheet-${row.id}`,
      value: opt.value,
      class: "sheet-choice-input",
    }) as HTMLInputElement;
    input.checked = opt.value === row.value;
    if (opt.disabled) input.disabled = true;
    input.addEventListener("change", () => {
      if (input.checked) row.onChange(opt.value);
    });
    const label = el("label", { class: "sheet-choice-opt" }, input, el("span", {}, opt.label));
    if (opt.hint) label.append(el("small", { class: "sheet-choice-hint" }, opt.hint));
    wrap.append(label);
  }
  return wrap;
}

/** Build a settings sheet from a spec. The returned node is a plain container;
 *  the caller places it wherever it likes (e.g. inside a `<details>`). */
export function renderSettingsSheet(spec: SettingsSheetSpec): HTMLElement {
  const sheet = el("div", { class: "sheet" });
  if (spec.intro) sheet.append(el("p", { class: "sheet-intro" }, spec.intro));
  const renderRow = (row: SettingRow): HTMLElement =>
    row.kind === "toggle" ? renderToggleRow(row) : row.kind === "range" ? renderRangeRow(row) : renderChoiceRow(row);
  for (const row of spec.rows) sheet.append(renderRow(row));
  for (const section of spec.sections ?? []) {
    if (section.rows.length === 0) continue;
    sheet.append(el("h3", { class: "sheet-section" }, section.label));
    for (const row of section.rows) sheet.append(renderRow(row));
  }
  return sheet;
}
