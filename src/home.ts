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
//! Cover art: a game declaring `cover: true` renders
//! `/<id>/assets/cover.jpg`; the rest keep the registry emoji. Ten of twenty
//! have art today, so both paths are live at once and the fallback is a real
//! state rather than a theoretical one.

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

/** The cover image, or the emoji for a game that has no art yet. */
function art(game: { id: string; icon: string; cover?: true }, cls: string): HTMLElement {
  if (!game.cover) return el("span", { class: `${cls} is-emoji`, "aria-hidden": "true" }, game.icon);
  return el("img", {
    class: cls,
    src: `/${game.id}/assets/cover.jpg`,
    alt: "",
    loading: "lazy",
    decoding: "async",
    width: "512",
    height: "512",
  });
}

/** A game tile: cover art or emoji, title, and a link to the game's own URL. */
function tile(game: { id: string; title: string; icon: string; cover?: true }): HTMLElement {
  return el(
    "a",
    { href: `/${game.id}/`, class: "home-tile", "data-game-id": game.id },
    art(game, "home-tile-icon"),
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
        art(g, "home-row-icon"),
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
