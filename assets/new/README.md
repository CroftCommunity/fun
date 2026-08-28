# `assets/new/` — the drop-off

Put raw art and audio here in whatever size and format it arrives in. Then run:

```bash
npm run intake          # see what would happen
npm run intake -- --go  # do it
```

`tools/intake.mjs` transforms each drop into the shape the shelf actually needs
and files it in the right place. It never overwrites without saying so, and it
prints exactly what it did.

## What goes where it goes

Name the file after the game id in `src/registry.ts` and the tool does the rest.

| Drop this | Becomes | Lands in |
|---|---|---|
| `<game>-cover` / `<game>_icon` | 512×512 JPEG, q82 | `src/games/<id>/assets/cover.jpg` |
| `<game>-cover@57.png` | same, cropped around 57% down | `src/games/<id>/assets/cover.jpg` |
| `<game>-splash` / `<game>_splash` | sized on its long edge, q80 | `src/games/<id>/assets/splash.jpg` |
| `<Any Track Name>.mp3\|wav\|m4a` | 64 kbps MP3 | `assets/audio/<any-track-name>.mp3` |

**Naming is forgiving on purpose.** `-`, `_`, a space or nothing at all separates
the game from the kind; case does not matter; `icon` is accepted for `cover`; and
the game may be named by its registry id **or by its title**. All of
`blockdoku_icon.png`, `Drop4Splash.jpeg` and `dots_and_boxes_icon.png` land
correctly — the last one on the game whose id is `dots`. A drop-off that rejects
the names a person actually types is a drop-off nobody uses.

**Per-game art lives with its game** (`src/games/<id>/assets/`), because that is
where a game's own assets belong — `CLAUDE.md` § "Game isolation". The build
copies each game's `assets/` to `/<id>/assets/`.

**Audio is shelf-level** (`assets/audio/`), because a track belongs to the shelf
even when a game claims one by default. The same piece can be the shelf's ambient
bed and another game's theme; filing it under one game would be a lie about what
it is.

## A PWA splash is not one image you supply

Worth knowing before commissioning more splash art, because it surprised us:

- **Android / Chrome composes the splash itself** from the manifest — the app
  name, `background_color`, and an icon of at least 512px. It accepts **no**
  splash image. The cover art is the input.
- **iOS wants `apple-touch-startup-image`** at *exact per-device pixel sizes*,
  portrait and landscape, one `<link>` per device class.

So `splash.jpg` here is **source art**, not a platform asset, and generating the
real ones is a build step that arrives with the manifest work
(`TODO/pwa.md` — the shelf has no manifest and no service worker yet). A
landscape source constrains what a portrait phone screen can be cut from it, so
portrait art gives that step more to work with. The tool prints which aspect it
saw.

## Cropping

A cover must be square and a splash portrait. If a drop is not, the tool crops
from the centre, biased for the aspect: a tall source is cropped around 40% down
(where a logo usually sits), a wide one dead centre.

Measured on the first real batch, that guess landed well for 8 of 10 — 2048's
hexagon was clipped and Ring Pop's tile sat too loose. So a drop may carry an
explicit vertical hint: **`2048-cover@57.png`** crops around 57% down. The tool
always prints the box it used, so a bad crop tells you what to pass.

## The masters do not enter git

Everything in this directory except this README is **git-ignored**. Drops are
inputs, not deliverables: the repo carries the derived, web-sized copies and
nothing else. Keep your masters wherever you keep masters — the current set came
from `~/Downloads/fun_images` (89 MB) and `~/Downloads/fun_audio` (38 MB), and
neither belongs in a repo that ships to GitHub Pages.

Drops are left in place after a run, so a re-run is safe and you can clear them
when you are satisfied.

**Always re-encode audio from the master, never from a file already in
`assets/audio/`** — re-encoding a lossy file is lossy twice. That is why masters
are worth keeping even though they never enter the repo: the library was re-cut
from 96 to 64 kbps on 2026-08-28 and went back to the originals to do it.
