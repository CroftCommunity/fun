//! The games-drawer chrome: a slide-out drawer that switches games over a
//! persistent play area, plus full-screen and open-in-new-tab affordances.
//! Built once; every game mounts into it via the module contract. Game
//! selection is a real navigation to the game's own URL (`/<id>/`), so each
//! game is addressable and "open in new tab" works with no client router.

import type { GameModule, PresentationMode } from "./contract.js";
import { findGame, REGISTRY } from "./registry.js";
import { applyTheme, currentTheme, toggleTheme } from "./theme.js";

/** Test-facing handle to the running chrome. */
export interface Chrome {
  openDrawer(): void;
  closeDrawer(): void;
  toggleDrawer(): void;
  isDrawerOpen(): boolean;
  toggleFullscreen(): void;
  isFullscreen(): boolean;
  currentGameId(): string | null;
  mountedModule(): GameModule | null;
}

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

/** Boot the chrome into `root` (defaults to `document.body`). */
export function boot(root: HTMLElement = document.body): Chrome {
  const gameId = root.dataset.game ?? null;

  const toggle = el("button", {
    class: "drawer-toggle",
    "aria-expanded": "false",
    "aria-controls": "games-drawer",
    "aria-label": "Open games drawer",
  });
  toggle.textContent = "☰ Games";

  const drawer = el("nav", {
    id: "games-drawer",
    class: "drawer",
    "aria-label": "Games",
    hidden: "",
  });
  const list = el("ul", { class: "drawer-list" });
  for (const g of REGISTRY) {
    const link = el(
      "a",
      { href: `/${g.id}/`, class: "drawer-item", "data-game-id": g.id },
      `${g.icon} ${g.title}`,
    );
    if (g.status === "soon") {
      link.append(el("span", { class: "badge" }, "soon"));
      link.setAttribute("aria-disabled", "false"); // still linkable to its page
    }
    if (g.id === gameId) link.setAttribute("aria-current", "page");
    list.append(link);
  }
  drawer.append(list);

  const fullscreenBtn = el("button", {
    class: "fullscreen-toggle",
    "aria-pressed": "false",
    "aria-label": "Toggle full screen",
  });
  fullscreenBtn.textContent = "⤢";

  // Theme toggle (Phase E). Pre-paint set [data-theme]; sync the manifest colour
  // and reflect the current theme on the control.
  applyTheme(currentTheme());
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

  const heading = el(
    "h1",
    { class: "visually-hidden" },
    gameId ? `fun.croft.ing — ${gameId}` : "fun.croft.ing — games",
  );
  const header = el("header", { class: "chrome-header" }, heading, toggle, fullscreenBtn, themeBtn);
  if (gameId) {
    header.append(
      el("a", { href: `/how-to/?game=${gameId}`, class: "how-to-link" }, "How to play"),
      el(
        "a",
        { href: `/${gameId}/`, target: "_blank", rel: "noopener", class: "newtab", "aria-label": "Open this game in a new tab" },
        "↗",
      ),
    );
  }

  const playArea = el("main", { class: "play-area", id: "play-area" });

  root.prepend(header, drawer, playArea);

  // --- mount the current game / welcome ---
  let mounted: GameModule | null = null;
  const mode: PresentationMode = gameId ? "standalone" : "drawer";
  const entry = gameId ? findGame(gameId) : undefined;
  if (!gameId) {
    playArea.append(
      el("div", { class: "welcome" }, "Pick a game from the drawer to play."),
    );
  } else if (!entry) {
    playArea.append(el("div", { class: "welcome" }, "Unknown game."));
  } else if (entry.status === "soon" || !entry.load) {
    playArea.append(
      el("div", { class: "welcome" }, `${entry.title} is coming soon.`),
    );
  } else {
    mounted = entry.load();
    mounted.mount(playArea, { mode });
  }

  // --- drawer open/close + focus trap + ESC ---
  let open = false;
  const setOpen = (next: boolean): void => {
    open = next;
    drawer.hidden = !open;
    root.classList.toggle("drawer-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close games drawer" : "Open games drawer");
    if (open) {
      const first = drawer.querySelector<HTMLElement>("a, button");
      first?.focus();
    } else {
      toggle.focus();
    }
  };

  toggle.addEventListener("click", () => setOpen(!open));

  drawer.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (e.key !== "Tab") return;
    const focusables = [...drawer.querySelectorAll<HTMLElement>("a, button")];
    if (focusables.length === 0) return;
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  // --- full screen (chrome hidden; the game instance is NOT remounted) ---
  let full = false;
  const setFull = (next: boolean): void => {
    full = next;
    root.classList.toggle("fullscreen", full);
    fullscreenBtn.setAttribute("aria-pressed", String(full));
  };
  fullscreenBtn.addEventListener("click", () => setFull(!full));

  return {
    openDrawer: () => setOpen(true),
    closeDrawer: () => setOpen(false),
    toggleDrawer: () => setOpen(!open),
    isDrawerOpen: () => open,
    toggleFullscreen: () => setFull(!full),
    isFullscreen: () => full,
    currentGameId: () => gameId,
    mountedModule: () => mounted,
  };
}
