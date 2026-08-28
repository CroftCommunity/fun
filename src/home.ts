//! The two home layouts (M3). Both render the same `ShelfModel`; only
//! presentation differs, which is what makes them interchangeable at runtime.
//!
//! - **today-first** — opens on what you were last doing and what is waiting.
//!   A returning player is the common case.
//! - **shelf** — a browsable index that argues for the games in words, because
//!   "you can re-check the result yourself" is this shelf's real differentiator
//!   and no icon says it. This is the layout that renders the group blurbs.
//!
//! Both are FIRST-CLASS options the user can reach from settings. A skin family
//! only expresses a preference among them (`prefersLayout`), and the user's
//! explicit choice wins in both directions.
//!
//! COVER ART IS NOT WIRED YET, on purpose. The design mocks use commissioned
//! icons that are not in this repo, and the 40 shots in `assets/guide/` are
//! full-page screenshots that read badly as tiles. Both layouts render the
//! registry's emoji until proper per-game cover art lands — the structure is the
//! deliverable here, and shipping ugly tiles to fill the hole would be worse
//! than an honest placeholder. See `TODO/pwa.md` and the skin-layer plan.

import type { ShelfModel } from "./shelf.js";

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

/** A game tile: emoji, title, and a link to the game's own URL. */
function tile(game: { id: string; title: string; icon: string }): HTMLElement {
  return el(
    "a",
    { href: `/${game.id}/`, class: "home-tile", "data-game-id": game.id },
    el("span", { class: "home-tile-icon", "aria-hidden": "true" }, game.icon),
    el("span", { class: "home-tile-title" }, game.title),
  );
}

/** Renders the model as the today-first home. */
function renderTodayFirst(root: HTMLElement, model: ShelfModel): void {
  if (model.resume) {
    const card = el("a", { href: `/${model.resume.id}/`, class: "home-resume" });
    card.append(
      el("span", { class: "home-eyebrow" }, "Jump back in"),
      el("b", {}, model.resume.title),
      el("span", { class: "home-cta" }, "Play"),
    );
    root.append(card);
  }

  if (model.today.length > 0) {
    const opened = model.today.filter((t) => t.opened).length;
    const sec = el("section", { class: "home-sec" });
    sec.append(
      el(
        "h2",
        {},
        "Today",
        el("span", { class: "home-count" }, `${opened} of ${model.today.length} opened`),
      ),
      el("p", { class: "home-sub" }, "A fresh board every day. Everyone gets the same one."),
    );
    const strip = el("div", { class: "home-strip" });
    for (const t of model.today) {
      const a = el(
        "a",
        { href: `/${t.id}/`, class: `home-daily${t.opened ? " is-opened" : ""}` },
        el("span", { class: "home-daily-name" }, t.title),
      );
      if (t.opened) a.append(el("span", { class: "home-daily-mark" }, "opened"));
      strip.append(a);
    }
    sec.append(strip);
    root.append(sec);
  }

  for (const group of model.groups) {
    const sec = el("section", { class: "home-sec" });
    sec.append(el("h2", {}, group.headline, el("span", { class: "home-count" }, String(group.games.length))));
    const grid = el("div", { class: "home-grid" });
    for (const g of group.games) grid.append(tile(g));
    sec.append(grid);
    root.append(sec);
  }
}

/** Renders the model as the shelf index — the layout that argues in words. */
function renderShelf(root: HTMLElement, model: ShelfModel): void {
  if (model.resume) {
    const card = el("a", { href: `/${model.resume.id}/`, class: "home-resume is-quiet" });
    card.append(el("span", { class: "home-eyebrow" }, "Last played"), el("b", {}, model.resume.title));
    root.append(card);
  }

  for (const group of model.groups) {
    const sec = el("section", { class: "home-shelf" });
    sec.append(
      el("p", { class: "home-label" }, group.label),
      el("h2", {}, group.headline),
      el("p", { class: "home-blurb" }, group.blurb),
    );
    const list = el("ul", { class: "home-list" });
    for (const g of group.games) {
      const row = el("li", {});
      const a = el(
        "a",
        { href: `/${g.id}/`, class: "home-row", "data-game-id": g.id },
        el("span", { class: "home-row-icon", "aria-hidden": "true" }, g.icon),
        el("span", { class: "home-row-title" }, g.title),
      );
      const daily = model.today.find((t) => t.id === g.id);
      if (daily) {
        a.append(el("span", { class: "home-row-note" }, daily.opened ? "opened today" : "today's board"));
      }
      row.append(a);
      list.append(row);
    }
    sec.append(list);
    root.append(sec);
  }
}

const RENDERERS: Readonly<Record<string, (root: HTMLElement, model: ShelfModel) => void>> = {
  "today-first": renderTodayFirst,
  shelf: renderShelf,
};

/**
 * Render the home page in `layout`. Unknown layouts fall back rather than
 * rendering nothing — an empty front door is the bug this whole phase replaces.
 */
export function renderHome(root: HTMLElement, model: ShelfModel, layout: string): void {
  const home = el("div", { class: "home", "data-layout": layout });
  (RENDERERS[layout] ?? renderTodayFirst)(home, model);
  root.append(home);
}
