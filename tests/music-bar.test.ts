//! The music transport: four controls in the header and a track list under the
//! name. The pure parts (which track starts, stepping, the coupling default) are
//! asserted first; the player and the bar are driven with `Audio` stubbed,
//! because jsdom does not play sound and the tests must not depend on it.

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  COUPLE_KEY,
  MUSIC_KEY,
  SHELF_TRACK,
  TRACKS,
  TRACK_KEY,
  resolveCouple,
  startMusic,
  startingTrack,
  stepTrack,
  trackFor,
  trackUrl,
} from "../src/music.js";
import { boot } from "../src/chrome.js";

// --- a fake Audio: records what was constructed, lets a test end a track ---

class FakeAudio {
  static made: FakeAudio[] = [];
  loop = false;
  volume = 1;
  paused = true;
  private listeners: Record<string, (() => void)[]> = {};
  constructor(public src: string) {
    FakeAudio.made.push(this);
  }
  play(): Promise<void> {
    this.paused = false;
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
  addEventListener(name: string, fn: () => void): void {
    (this.listeners[name] ??= []).push(fn);
  }
  end(): void {
    for (const fn of this.listeners["ended"] ?? []) fn();
  }
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  localStorage.clear();
  FakeAudio.made = [];
  vi.stubGlobal("Audio", FakeAudio);
  document.body.innerHTML = "";
  delete document.body.dataset.game;
  document.body.className = "";
});

describe("coupling tracks to games (pure)", () => {
  it("is coupled unless explicitly turned off — the shelf's existing behaviour is the default", () => {
    expect(resolveCouple(null)).toBe(true);
    expect(resolveCouple("on")).toBe(true);
    expect(resolveCouple("off")).toBe(false);
    expect(resolveCouple("nonsense")).toBe(true);
  });

  it("coupled: a game starts its own track, whatever was picked before", () => {
    expect(startingTrack({ gameId: "solitaire", coupled: true, stored: "morning-grid" })).toBe(
      trackFor("solitaire"),
    );
    expect(startingTrack({ gameId: null, coupled: true, stored: "morning-grid" })).toBe(SHELF_TRACK);
  });

  it("uncoupled: the last pick plays everywhere", () => {
    expect(startingTrack({ gameId: "solitaire", coupled: false, stored: "morning-grid" })).toBe(
      "morning-grid",
    );
  });

  it("uncoupled with no pick, or an unknown pick, falls back to the page's track", () => {
    expect(startingTrack({ gameId: "solitaire", coupled: false, stored: null })).toBe(
      trackFor("solitaire"),
    );
    expect(startingTrack({ gameId: "solitaire", coupled: false, stored: "deleted-track" })).toBe(
      trackFor("solitaire"),
    );
  });

  it("steps through the library in order and wraps at both ends", () => {
    const first = TRACKS[0]!.id;
    const second = TRACKS[1]!.id;
    const last = TRACKS[TRACKS.length - 1]!.id;
    expect(stepTrack(first, 1)).toBe(second);
    expect(stepTrack(second, -1)).toBe(first);
    expect(stepTrack(last, 1)).toBe(first);
    expect(stepTrack(first, -1)).toBe(last);
  });

  it("steps from an unknown track to the start of the list rather than nowhere", () => {
    expect(stepTrack("deleted-track", 1)).toBe(TRACKS[0]!.id);
  });
});

describe("the player's transport", () => {
  it("selecting a track with music off remembers it and fetches nothing", () => {
    const p = startMusic("solitaire");
    p.select("morning-grid");
    expect(p.current()).toBe("morning-grid");
    expect(localStorage.getItem(TRACK_KEY)).toBe("morning-grid");
    expect(FakeAudio.made).toHaveLength(0);
  });

  it("selecting a track with music on switches what is playing", async () => {
    localStorage.setItem(MUSIC_KEY, "on");
    const p = startMusic("solitaire");
    await flush();
    expect(FakeAudio.made.map((a) => a.src)).toEqual([trackUrl(trackFor("solitaire"))]);
    p.select("morning-grid");
    await flush();
    expect(FakeAudio.made[0]!.paused).toBe(true);
    expect(FakeAudio.made[1]!.src).toBe(trackUrl("morning-grid"));
    expect(FakeAudio.made[1]!.paused).toBe(false);
  });

  it("next and prev step the current track", () => {
    const p = startMusic(null);
    const start = p.current();
    p.next();
    expect(p.current()).toBe(stepTrack(start, 1));
    p.prev();
    p.prev();
    expect(p.current()).toBe(stepTrack(start, -1));
  });

  it("starts on the page's track when coupled, and on the last pick when not", () => {
    localStorage.setItem(TRACK_KEY, "morning-grid");
    expect(startMusic("solitaire").current()).toBe(trackFor("solitaire"));
    localStorage.setItem(COUPLE_KEY, "off");
    expect(startMusic("solitaire").current()).toBe("morning-grid");
  });

  it("turning coupling on snaps back to the page's track; turning it off keeps what is playing", () => {
    localStorage.setItem(COUPLE_KEY, "off");
    localStorage.setItem(TRACK_KEY, "morning-grid");
    const p = startMusic("solitaire");
    expect(p.isCoupled()).toBe(false);
    p.setCoupled(true);
    expect(p.current()).toBe(trackFor("solitaire"));
    expect(localStorage.getItem(COUPLE_KEY)).toBe("on");
    p.select("morning-grid");
    p.setCoupled(false);
    expect(p.current()).toBe("morning-grid");
    expect(localStorage.getItem(COUPLE_KEY)).toBe("off");
  });

  it("a piece that ends advances to the next track while music is on", async () => {
    localStorage.setItem(MUSIC_KEY, "on");
    const p = startMusic("solitaire"); // sunset-at-the-harbor, a piece
    await flush();
    const first = p.current();
    FakeAudio.made[0]!.end();
    await flush();
    expect(p.current()).toBe(stepTrack(first, 1));
    expect(FakeAudio.made[1]!.src).toBe(trackUrl(stepTrack(first, 1)));
  });

  it("publishes every change to subscribers, and a subscriber can leave", () => {
    const p = startMusic(null);
    const seen = vi.fn();
    const off = p.subscribe(seen);
    p.next();
    p.setEnabled(true);
    p.setCoupled(false);
    expect(seen).toHaveBeenCalledTimes(3);
    off();
    p.prev();
    expect(seen).toHaveBeenCalledTimes(3);
  });
});

describe("the music bar in the header", () => {
  const bar = (): HTMLElement => document.querySelector<HTMLElement>(".chrome-header .music-bar")!;
  const name = (): HTMLButtonElement => bar().querySelector<HTMLButtonElement>(".music-name")!;
  const titleOf = (id: string): string => TRACKS.find((t) => t.id === id)!.title;

  it("shows four controls and names the page's track", () => {
    document.body.dataset.game = "solitaire";
    boot();
    expect(bar()).not.toBeNull();
    expect(bar().querySelector(".music-prev")).not.toBeNull();
    expect(bar().querySelector(".music-play")).not.toBeNull();
    expect(bar().querySelector(".music-next")).not.toBeNull();
    expect(name().textContent).toContain(titleOf(trackFor("solitaire")));
  });

  it("the name drops down the whole list, headed by the coupling toggle, and marks the current track", () => {
    boot();
    const list = document.getElementById("music-list")!;
    expect(list.hidden).toBe(true);
    expect(name().getAttribute("aria-expanded")).toBe("false");
    name().click();
    expect(list.hidden).toBe(false);
    expect(name().getAttribute("aria-expanded")).toBe("true");
    const couple = list.querySelector<HTMLInputElement>(".music-couple input")!;
    expect(couple.checked).toBe(true);
    expect(couple.labels?.[0]?.textContent).toMatch(/couple tracks to games/i);
    const items = list.querySelectorAll(".music-track");
    expect(items).toHaveLength(TRACKS.length);
    expect(list.querySelector('.music-track[aria-current="true"]')!.textContent).toContain(
      titleOf(SHELF_TRACK),
    );
  });

  it("picking a track renames the bar, closes the list, and is remembered", () => {
    boot();
    name().click();
    const pick = document.querySelector<HTMLButtonElement>('.music-track[data-track="morning-grid"]')!;
    pick.click();
    expect(name().textContent).toContain(titleOf("morning-grid"));
    expect(document.getElementById("music-list")!.hidden).toBe(true);
    expect(localStorage.getItem(TRACK_KEY)).toBe("morning-grid");
  });

  it("the coupling toggle persists and, when re-coupled, the bar snaps to the page's track", () => {
    document.body.dataset.game = "solitaire";
    boot();
    name().click();
    const couple = document.querySelector<HTMLInputElement>(".music-couple input")!;
    couple.click();
    expect(localStorage.getItem(COUPLE_KEY)).toBe("off");
    document.querySelector<HTMLButtonElement>('.music-track[data-track="morning-grid"]')!.click();
    name().click();
    document.querySelector<HTMLInputElement>(".music-couple input")!.click();
    expect(name().textContent).toContain(titleOf(trackFor("solitaire")));
  });

  it("play/pause is the global music toggle — the appearance sheet agrees", () => {
    boot();
    const play = bar().querySelector<HTMLButtonElement>(".music-play")!;
    expect(play.getAttribute("aria-pressed")).toBe("false");
    play.click();
    expect(play.getAttribute("aria-pressed")).toBe("true");
    expect(localStorage.getItem(MUSIC_KEY)).toBe("on");
    document.querySelector<HTMLButtonElement>(".appearance-toggle")!.click();
    const sheetToggle = document.querySelector<HTMLInputElement>('[data-setting="music"] input')!;
    expect(sheetToggle.checked).toBe(true);
    sheetToggle.click();
    expect(play.getAttribute("aria-pressed")).toBe("false");
    expect(localStorage.getItem(MUSIC_KEY)).toBe("off");
  });

  it("prev and next in the bar step the track", () => {
    boot();
    const start = SHELF_TRACK;
    bar().querySelector<HTMLButtonElement>(".music-next")!.click();
    expect(name().textContent).toContain(titleOf(stepTrack(start, 1)));
    bar().querySelector<HTMLButtonElement>(".music-prev")!.click();
    expect(name().textContent).toContain(titleOf(start));
  });

  it("the phone form: a ♪ button opens the same list, whose top row carries prev, the name, and next", () => {
    boot();
    const open = bar().querySelector<HTMLButtonElement>(".music-open")!;
    expect(open.getAttribute("aria-expanded")).toBe("false");
    open.click();
    const list = document.getElementById("music-list")!;
    expect(list.hidden).toBe(false);
    expect(open.getAttribute("aria-expanded")).toBe("true");
    expect(name().getAttribute("aria-expanded")).toBe("true");
    const row = list.querySelector(".music-list-transport")!;
    expect(row.querySelector(".music-prev")).not.toBeNull();
    expect(row.querySelector(".music-next")).not.toBeNull();
    expect(row.querySelector(".music-list-name")!.textContent).toContain(titleOf(SHELF_TRACK));
    row.querySelector<HTMLButtonElement>(".music-next")!.click();
    expect(row.querySelector(".music-list-name")!.textContent).toContain(titleOf(stepTrack(SHELF_TRACK, 1)));
    expect(list.hidden).toBe(false); // stepping does not close the list
  });

  it("Escape and a click elsewhere close the list", () => {
    boot();
    name().click();
    const list = document.getElementById("music-list")!;
    list.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(list.hidden).toBe(true);
    name().click();
    expect(list.hidden).toBe(false);
    document.body.click();
    expect(list.hidden).toBe(true);
  });

  it("the appearance hint names the track that would actually play", () => {
    localStorage.setItem(COUPLE_KEY, "off");
    localStorage.setItem(TRACK_KEY, "morning-grid");
    document.body.dataset.game = "solitaire";
    boot();
    document.querySelector<HTMLButtonElement>(".appearance-toggle")!.click();
    const hint = document.querySelector('[data-setting="music"]')!.textContent;
    expect(hint).toContain(titleOf("morning-grid"));
  });
});
