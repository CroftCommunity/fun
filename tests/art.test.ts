//! Per-game art, and the claim that it exists.
//!
//! A game's own assets live with the game (`CLAUDE.md` § "Game isolation"), so
//! cover and splash art sit in `src/games/<id>/assets/` and the build serves
//! them at `/<id>/assets/`. Audio is deliberately NOT here: a track belongs to
//! the shelf even when a game claims one by default, so it lives in
//! `assets/audio/`.
//!
//! `cover: true` on a registry entry is a CLAIM. These assert it against the
//! filesystem in both directions, because a claim nothing checks is how a home
//! page ends up rendering a broken image — or, quieter and worse, silently
//! falling back to an emoji while the art sits there unused.

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { REGISTRY } from "../src/registry.js";

const gamesDir = join(process.cwd(), "src", "games");
const iconPath = (id: string): string => join(gamesDir, id, "assets", "icon.jpg");

describe("icon art: the registry and the filesystem agree", () => {
  it("every game claiming an icon has the file", () => {
    for (const g of REGISTRY.filter((x) => x.icon)) {
      expect(existsSync(iconPath(g.id)), `${g.id} claims icon: true but has no assets/icon.jpg`).toBe(true);
    }
  });

  it("every game with the file claims it", () => {
    const onDisk = readdirSync(gamesDir).filter((d) => existsSync(iconPath(d)));
    const claimed = REGISTRY.filter((g) => g.icon).map((g) => g.id);
    expect([...onDisk].sort()).toEqual([...claimed].sort());
  });
});

describe("the audio library is shelf-level, not per-game", () => {
  const audioDir = join(process.cwd(), "assets", "audio");

  it("ships tracks", () => {
    expect(readdirSync(audioDir).filter((f) => f.endsWith(".mp3")).length).toBeGreaterThan(0);
  });

  it("no game directory holds audio — a track is the shelf's, even when a game claims one", () => {
    const strays: string[] = [];
    for (const d of readdirSync(gamesDir)) {
      const dir = join(gamesDir, d, "assets");
      if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir)) {
        if (/\.(mp3|wav|m4a|ogg)$/i.test(f)) strays.push(`${d}/assets/${f}`);
      }
    }
    expect(strays).toEqual([]);
  });
});

describe("every track the code names is actually shipped", () => {
  it("the TRACKS registry matches assets/audio/ exactly", async () => {
    const { TRACKS } = await import("../src/music.js");
    const onDisk = readdirSync(join(process.cwd(), "assets", "audio"))
      .filter((f) => f.endsWith(".mp3"))
      .map((f) => f.replace(/\.mp3$/, ""))
      .sort();
    expect(TRACKS.map((t) => t.id).sort()).toEqual(onDisk);
  });
});
