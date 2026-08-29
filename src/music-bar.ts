//! The music transport: four controls in the header — previous · play/pause ·
//! the track's name · next — and, under the name, the whole track list headed by
//! one toggle, "Couple tracks to games".
//!
//! The play button IS the global music preference (the one the appearance sheet
//! also shows): pausing persists "off", playing persists "on". One player, one
//! truth — the bar repaints from the player's own state, so a change made in the
//! sheet shows here and a change made here shows in the sheet.
//!
//! Pure DOM over a `MusicPlayer`; no storage of its own.

import { TRACKS, type MusicPlayer } from "./music.js";

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

/** The title for a track id; the id itself if the library no longer has it. */
export function titleOf(id: string): string {
  return TRACKS.find((t) => t.id === id)?.title ?? id;
}

/** The bar, mounted and live. `list` is the dropdown, for the caller to place. */
export interface MusicBar {
  readonly bar: HTMLElement;
  readonly list: HTMLElement;
  /** Repaint from the player. Called by the bar on every player change. */
  paint(): void;
}

/** Build the bar over a running player. */
export function renderMusicBar(player: MusicPlayer): MusicBar {
  const prev = el("button", { class: "music-prev", "aria-label": "Previous track" }, "⏮");
  const next = el("button", { class: "music-next", "aria-label": "Next track" }, "⏭");
  const play = el("button", { class: "music-play", "aria-pressed": "false" });
  const name = el("button", {
    class: "music-name",
    "aria-expanded": "false",
    "aria-controls": "music-list",
    "aria-haspopup": "true",
  });
  const nameText = el("span", { class: "music-name-text" });
  name.append(nameText, el("span", { class: "music-name-caret", "aria-hidden": "true" }, " ▾"));

  const list = el("div", { id: "music-list", class: "music-list", hidden: "" });

  // The mobile row: prev/next live here under 40rem, where the header has no
  // room for them beside the name. Duplicates of the bar's own, same handlers.
  const mobilePrev = el("button", { class: "music-prev", "aria-label": "Previous track" }, "⏮ Previous");
  const mobileNext = el("button", { class: "music-next", "aria-label": "Next track" }, "Next ⏭");
  const transport = el("div", { class: "music-list-transport" }, mobilePrev, mobileNext);

  const coupleInput = el("input", { type: "checkbox", id: "music-couple" });
  const couple = el(
    "label",
    { class: "music-couple", for: "music-couple" },
    coupleInput,
    el("span", {}, "Couple tracks to games"),
  );
  const tracks = el("ul", { class: "music-tracks", "aria-label": "Tracks" });
  const trackButtons = new Map<string, HTMLButtonElement>();
  for (const t of TRACKS) {
    const b = el("button", { class: "music-track", "data-track": t.id }, t.title);
    b.addEventListener("click", () => {
      player.select(t.id);
      setOpen(false);
    });
    trackButtons.set(t.id, b);
    tracks.append(el("li", {}, b));
  }
  list.append(transport, couple, tracks);

  let open = false;
  const setOpen = (o: boolean): void => {
    open = o;
    list.hidden = !open;
    name.setAttribute("aria-expanded", String(open));
  };

  const paint = (): void => {
    const on = player.isEnabled();
    play.textContent = on ? "⏸" : "▶";
    play.setAttribute("aria-pressed", String(on));
    play.setAttribute("aria-label", on ? "Pause music" : "Play music");
    const id = player.current();
    nameText.textContent = titleOf(id);
    name.setAttribute("aria-label", `Track: ${titleOf(id)}. Choose a track`);
    name.title = titleOf(id);
    coupleInput.checked = player.isCoupled();
    for (const [tid, b] of trackButtons) {
      if (tid === id) b.setAttribute("aria-current", "true");
      else b.removeAttribute("aria-current");
    }
  };

  prev.addEventListener("click", () => player.prev());
  mobilePrev.addEventListener("click", () => player.prev());
  next.addEventListener("click", () => player.next());
  mobileNext.addEventListener("click", () => player.next());
  play.addEventListener("click", () => player.setEnabled(!player.isEnabled()));
  name.addEventListener("click", () => setOpen(!open));
  coupleInput.addEventListener("change", () => player.setCoupled(coupleInput.checked));
  list.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    setOpen(false);
    name.focus();
  });
  // Click-off: anything outside the bar and its list closes the list.
  document.addEventListener("click", (e) => {
    if (!open) return;
    const t = e.target;
    if (t instanceof Node && (bar.contains(t) || list.contains(t))) return;
    setOpen(false);
  });

  const bar = el("div", { class: "music-bar", role: "group", "aria-label": "Music" }, prev, play, name, next);
  player.subscribe(paint);
  paint();
  return { bar, list, paint };
}
