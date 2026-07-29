//! The "How to play" page (`/how-to/?game=<id>`). A slim, standalone content
//! page: a header with a back-to-game link and the theme toggle, then the
//! game's guide rendered from pure data. Reused by every game.

import { renderGuide } from "./how-to.js";
import { findGuide } from "./how-to-registry.js";
import { applyTheme, currentTheme, toggleTheme } from "./theme.js";

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

const app = document.getElementById("app");
if (!app) throw new Error("how-to: #app not found");

applyTheme(currentTheme());

const gameId = new URLSearchParams(location.search).get("game");
const guide = findGuide(gameId);

// Header: back to the game (or the shelf), plus the theme toggle.
const header = el("header", { class: "chrome-header" });
const back = el(
  "a",
  { class: "newtab", href: gameId ? `/${gameId}/` : "/" },
  gameId ? "← Back to the game" : "← Games",
);
const themeBtn = el("button", {
  class: "theme-toggle",
  "aria-pressed": String(currentTheme() === "dark"),
  "aria-label": "Toggle light or dark theme",
});
const paintThemeBtn = (): void => {
  const dark = currentTheme() === "dark";
  themeBtn.textContent = dark ? "☀" : "☾";
  themeBtn.setAttribute("aria-pressed", String(dark));
};
paintThemeBtn();
themeBtn.addEventListener("click", () => {
  toggleTheme();
  paintThemeBtn();
});
header.append(back, themeBtn);

const main = el("main", { class: "play-area" });
if (guide) {
  document.title = `Croft · fun — ${guide.title}`;
  main.append(renderGuide(guide));
} else {
  main.append(
    el(
      "div",
      { class: "welcome" },
      gameId ? `No how-to-play guide for “${gameId}” yet.` : "Pick a game to see how to play it.",
    ),
  );
}

app.append(header, main);
