//! The games-drawer chrome: a slide-out drawer that switches games over a
//! persistent play area, plus full-screen and open-in-new-tab affordances.
//! Built once; every game mounts into it via the module contract. Game
//! selection is a real navigation to the game's own URL (`/<id>/`), so each
//! game is addressable and "open in new tab" works with no client router.

import type { GameModule, PresentationMode } from "./contract.js";
import { findGame, REGISTRY } from "./registry.js";
import { applySkin, currentSkin, isDark, setSkin, siblingOf, togglePalette } from "./skins.js";
import { renderHome } from "./home.js";
import { appearanceSpec } from "./appearance.js";
import { startMusic } from "./music.js";
import { renderSettingsSheet } from "./settings-sheet.js";
import {
  LAYOUT_KEY,
  buildShelfModel,
  noteOpened,
  prefersLayoutFor,
  resolveLayout,
  type ShelfState,
} from "./shelf.js";

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


const SHELF_STATE_KEY = "fun-shelf-state";

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** The shelf's own record of what it has seen opened. Never a game's progress. */
function readShelfState(): ShelfState {
  try {
    const raw = localStorage.getItem(SHELF_STATE_KEY);
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    // Storage is user-writable and survives releases; keep only string values
    // rather than trusting the shape a previous version happened to write.
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(([, v]) => typeof v === "string"),
    ) as ShelfState;
  } catch {
    return {};
  }
}

function writeShelfState(state: ShelfState): void {
  try {
    localStorage.setItem(SHELF_STATE_KEY, JSON.stringify(state));
  } catch {
    // Storage denied: the shelf simply forgets. Never fail a launch for it.
  }
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
  const drawerClose = el("button", {
    class: "drawer-close",
    "aria-label": "Close games drawer",
  });
  drawerClose.textContent = "✕";
  drawer.append(el("div", { class: "drawer-head" }, drawerClose));
  const list = el("ul", { class: "drawer-list" });
  for (const g of REGISTRY) {
    const link = el(
      "a",
      { href: `/${g.id}/`, class: "drawer-item", "data-game-id": g.id },
      `${g.emoji} ${g.title}`,
    );
    if (g.status === "soon") {
      link.append(el("span", { class: "badge" }, "soon"));
      link.setAttribute("aria-disabled", "false"); // still linkable to its page
    }
    if (g.id === gameId) link.setAttribute("aria-current", "page");
    // A <ul> may only directly contain <li>. The links were appended straight to
    // the list, which axe's `list` rule fails — a real bug that shipped because
    // every existing scan ran with the drawer CLOSED (and therefore `hidden`,
    // so axe skipped it). Found by the M6 matrix, which opens it.
    list.append(el("li", {}, link));
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
  applySkin(currentSkin());
  const themeBtn = el("button", {
    class: "theme-toggle",
    "aria-pressed": String(isDark()),
    "aria-label": "Toggle light or dark theme",
  });
  const paintThemeBtn = (): void => {
    const dark = isDark();
    themeBtn.textContent = dark ? "☀" : "☾";
    themeBtn.setAttribute("aria-pressed", String(dark));
    // A family with one palette has nowhere to toggle to. Disable VISIBLY
    // rather than letting the control look live and do nothing — a silent
    // no-op from a working-looking button is the failure forage's ADR-003
    // calls out, and the reason the disabled state is deliberate.
    themeBtn.disabled = siblingOf(currentSkin()) === undefined;
  };
  paintThemeBtn();
  themeBtn.addEventListener("click", () => {
    togglePalette();
    paintThemeBtn();
    // The panel captures the running skin when it is painted, so a palette
    // change made while it is open leaves it describing the previous side —
    // and the next style choice would then land on the wrong palette.
    if (!appearancePanel.hidden) paintAppearance();
  });

  // Appearance: which identity the shelf wears, and what the home page opens on.
  // Lives in the header rather than a game's own settings because the skin is
  // shelf-wide — a per-game home for a global preference is where "I changed it
  // and it changed back" comes from.
  const appearanceBtn = el("button", {
    class: "appearance-toggle",
    "aria-expanded": "false",
    "aria-controls": "appearance-panel",
    "aria-label": "Appearance settings",
  });
  appearanceBtn.textContent = "\u2699";
  // A named landmark, not a bare div: axe's `region` rule fails page content
  // that belongs to no landmark, and this panel sits between the header and
  // <main>. Caught by the picker's own axe test.
  const appearancePanel = el("section", {
    id: "appearance-panel",
    class: "appearance-panel",
    "aria-label": "Appearance",
    hidden: "",
  });

  // Lazy by construction: startMusic fetches nothing unless the stored
  // preference is already "on". A visitor who never asks for sound pays no bytes.
  const music = startMusic(gameId);

  const paintAppearance = (): void => {
    appearancePanel.replaceChildren(
      renderSettingsSheet(
        appearanceSpec({
          skin: currentSkin(),
          layout: readStored(LAYOUT_KEY),
          gameId,
          music: music.isEnabled(),
          onMusic: (on) => {
            music.setEnabled(on);
            paintAppearance();
          },
          onSkin: (id) => {
            setSkin(id);
            paintThemeBtn();
            paintAppearance();
            repaintHome();
          },
          onLayout: (id) => {
            try {
              if (id) localStorage.setItem(LAYOUT_KEY, id);
              else localStorage.removeItem(LAYOUT_KEY);
            } catch {
              // Storage denied: the choice applies for this page view only.
            }
            paintAppearance();
            repaintHome();
          },
        }),
      ),
    );
  };
  appearanceBtn.addEventListener("click", () => {
    const open = appearancePanel.hidden;
    appearancePanel.hidden = !open;
    appearanceBtn.setAttribute("aria-expanded", String(open));
    if (open) paintAppearance();
  });

  const heading = el(
    "h1",
    { class: "visually-hidden" },
    gameId ? `fun.croft.ing — ${gameId}` : "fun.croft.ing — games",
  );
  const header = el("header", { class: "chrome-header" }, heading, toggle, fullscreenBtn, themeBtn, appearanceBtn);
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

  // Click-off backdrop: covers the page while the drawer is open so a click
  // anywhere outside the drawer recollapses it.
  const scrim = el("div", { class: "drawer-scrim", hidden: "" });

  const playArea = el("main", { class: "play-area", id: "play-area" });

  root.prepend(header, scrim, drawer, appearancePanel, playArea);

  /** Render (or re-render) the home page in the layout currently in force. */
  function repaintHome(): void {
    if (gameId) return;
    playArea.replaceChildren();
    renderHome(
      playArea,
      buildShelfModel({ games: REGISTRY, state: readShelfState(), now: new Date() }),
      resolveLayout(readStored(LAYOUT_KEY), prefersLayoutFor(currentSkin())),
    );
  }

  // --- mount the current game / welcome ---
  let mounted: GameModule | null = null;
  const mode: PresentationMode = gameId ? "standalone" : "drawer";
  const entry = gameId ? findGame(gameId) : undefined;
  if (!gameId) {
    // The home page. Was one sentence over an empty page; it is now the model
    // rendered in whichever layout is in force (M3).
    repaintHome();
  } else if (!entry) {
    playArea.append(el("div", { class: "welcome" }, "Unknown game."));
  } else if (entry.status === "soon" || !entry.load) {
    playArea.append(
      el("div", { class: "welcome" }, `${entry.title} is coming soon.`),
    );
  } else {
    mounted = entry.load();
    mounted.mount(playArea, { mode });
    writeShelfState(noteOpened(readShelfState(), entry.id, new Date()));
  }

  // --- drawer open/close + focus trap + ESC ---
  let open = false;
  const setOpen = (next: boolean): void => {
    open = next;
    drawer.hidden = !open;
    scrim.hidden = !open;
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
  drawerClose.addEventListener("click", () => setOpen(false));
  scrim.addEventListener("click", () => setOpen(false));

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
