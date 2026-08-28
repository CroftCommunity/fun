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
| `<id>-cover.png\|jpg\|jpeg` | 512×512 JPEG, q82 | `src/games/<id>/assets/cover.jpg` |
| `<id>-cover@57.png` | same, cropped around 57% down | `src/games/<id>/assets/cover.jpg` |
| `<id>-splash.png\|jpg\|jpeg` | 1200px tall JPEG, q80 | `src/games/<id>/assets/splash.jpg` |
| `<Any Track Name>.mp3\|wav\|m4a` | 96 kbps MP3 | `assets/audio/<any-track-name>.mp3` |

**Per-game art lives with its game** (`src/games/<id>/assets/`), because that is
where a game's own assets belong — `CLAUDE.md` § "Game isolation". The build
copies each game's `assets/` to `/<id>/assets/`.

**Audio is shelf-level** (`assets/audio/`), because a track belongs to the shelf
even when a game claims one by default. The same piece can be the shelf's ambient
bed and another game's theme; filing it under one game would be a lie about what
it is.

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
