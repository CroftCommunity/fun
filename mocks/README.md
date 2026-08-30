# `mocks/` — the UI/UX design spike

Static mocks for a shelf-wide UI/UX makeover. **Not a build input.** `build.mjs`
copies only `assets/` and each Tier-2 `vendor/` directory, so nothing here is
compiled, bundled, deployed, or covered by `npm run gate`. Delete the directory
and the site is unchanged.

## Run it

```bash
node mocks/serve.mjs      # http://localhost:4190/mocks/
```

This is **not** `tools/serve.mjs` — that one serves `dist/` for the e2e suite and
local play and cannot see `mocks/` at all. This one is rooted at the repo root so
a mock can reference both `mocks/brand/…` and the repo's `assets/fonts/…`.
`file://` works too, except for audio in some browsers.

## What is here

| File | What it is |
|---|---|
| `index.html` | The hub: the diagnosis, the two axes, links to each direction, and a player for the four transcoded tracks |
| `b-worlds.html` | **Direction B — Gallery of Worlds.** Dark, luminous, one accent per game; today-first home |
| `c-pond.html` | **Direction C — The Pond.** Warm paper, hairline rules, a serif; shelf-index home |
| `d-game-frame.html` | **Direction D — The Game Frame** (2026-08-30). Not a look: the structure of every *game page* — five fixed-height bands, one control vocabulary (verbs / setup / preferences / meters), a start screen, a dock on phones that becomes a rail on desktop. Mocked on Othello, Solitaire and Trio Tumble, with the measured diagnosis (the 110px wrapped header, the named board-jump causes) and the open questions |
| `pwa.html` | Install invitation, OS sheet, phone home screen, launch splash, standalone chrome, music sheet, offline page |
| `harness.css`, `harness.js` | The chrome *around* the mocks — deliberately neutral so it is never mistaken for a direction. `harness.js` only flips `[data-theme]` on every `.screen` |
| `art/` | Board tiles cropped from `assets/guide/*.jpg` with `sips` |
| `brand/` | Icons, splashes, wide art and audio derived from the commissioned originals |

Frames render at true 390 × 844 and 1180 × 740, unscaled. Every direction carries
a light/dark switch, because the repo's axe suite tests both themes and a
direction that only survives one is not a direction.

## Where `brand/` came from

The originals are **not in this repo** — they live in `~/Downloads/fun_images/`
(19 files, 89 MB) and `~/Downloads/fun_audio/` (16 MP3s, 38 MB), the audio having
been separated out of the images folder. `brand/` holds derived, web-sized copies
only, ~3.4 MB total:

- `brand/icon/` — 512² JPEGs. Most come straight from square sources; the 2048 and
  Align icons are cropped out of portrait/landscape sources, because the `_icon` /
  `_splash` filenames do not match the actual aspect ratios. Trio Tumble's was
  re-shot square (1024²) with the 2026-08-28 rename art, so it is no longer cropped.
- `brand/splash/` — 1200px-tall portrait JPEGs.
- `brand/wide/` — the three landscape sources.
- `brand/audio/` — four tracks at 96 kbps via `afconvert` + `lame` (the installed
  `ffmpeg` is broken: missing `libx265.215.dylib`).

**Deciding where the originals should live is an open question**, not settled
here. They are too large to commit as-is, and the derived sizes above are tuned
for a mock rather than for production.

## Open questions these mocks do not answer

- ~~**The rename.**~~ **Settled 2026-08-28.** These mocks were drawn calling the game
  Ring Pop. It is not called that — RING POP is a live Topps / Bazooka Candy Brands
  mark, and the art applied it to a candy-matching game depicting a gem ring. The game
  is **Trio Tumble: Jewel Drop**, the mocks and their brand art were renamed with it,
  and the code rename is done (registry id, URL, crates, outcome kinds, pack kinds).
  Plan: `plans/2026-08-28-2-plan-trio-tumble-rename.md`.
- **Art coverage.** Ten of twenty games have commissioned art. Solitaire has a
  splash but no icon file (the mocks use its square splash as one). Checkers,
  Drop 4, Dots and Boxes, Furrow, Blockdoku and the four Tier-2 wraps have
  nothing.
- **Per-game installs.** `pwa.html` frame 3 is the claim
  `plans/2026-08-11-pwa-install-per-game-and-shelf.md` is gated on — whether
  distinct manifest `id` values really produce separate installs under nested
  scope. The plan's own answer is to ship **two** manifests and find out; these
  frames only show what "yes" looks like.
- **The tested contrast table.** Both directions re-base the palette, so
  `docs/DESIGN.md`'s recorded WCAG ratios and `tests/tokens.test.ts` would need
  re-deriving for whichever wins. Nothing here has been contrast-checked.
