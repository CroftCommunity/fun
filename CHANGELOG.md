# Changelog — fun

What changed for a player at `fun.croft.ing`. The pond deploys from `main` (Pages), so
landing *is* releasing: sections are months, each entry dated by its landing. Per
`CroftC/.claude/CHANGELOGS.md`, the branch that changes something a player runs adds its
entry here before it lands. Contexts are the shelf's chrome and the individual games.

Contexts: shelf · cribbage · furrow · dots · drop4 · blockdoku · orchard · sinker · solitaire

Started 2026-08-29; the August entries below are the landings of that month, and everything
earlier is in `git log`.

## 2026-08

- 2026-08-30 **shelf:** the game frame arrives — one structure for every game page, with
  fixed-height bands (game bar, meters, dock) around the board so nothing above it can
  move while you play. Every game page now renders inside it: the shelf header is one row
  again on a phone (it wrapped to two on every game page), and *How to play* / *open in a
  new tab* moved into the game bar's ⋯ menu. On a desktop window the frame's controls
  stand up as a rail beside the board — verbs, the game's setup read-only, and every
  setting inline; on a phone, Settings opens a bottom sheet with the shared rows (Hints,
  Declare assistance, Sound, and a new *Controls on the left* that moves the rail to the
  left of the board and reverses the dock's buttons) first and the game's own second. The
  games' own controls migrate one at a time. And every game now opens on a **start
  screen** — the game's splash, its name, one line, Play — or, if you left a game
  unfinished, a continue card with where you were; a shared `?r=` link and any other
  deep link still open straight onto the board. The home page's *Continue* reads the same
  record and says where you were ("Move 14 · you lead 9–4") instead of only naming the game. Also: a game page's tab now reads the game's name ("Trio Tumble: Jewel Drop")
  rather than its slug. (`plans/2026-08-30-plan-game-frame.md` Phases 1–2)
- 2026-08-30 **shelf:** three more pieces in the library — *Porcelain Afternoon*, *The
  Last Cab Home*, *Tuesday Night Rainfall* (each about three minutes, so they play out
  rather than loop). No game names them by default yet; they are in the track list.
- 2026-08-29 **shelf:** a music transport in the header — previous, play/pause, the
  track's name, next. The name drops down the whole list, headed by *Couple tracks to
  games*: on (the default), opening a game starts its own track; off, the shelf plays
  whatever you last picked, everywhere. Play/pause is the same switch as the appearance
  sheet's Music toggle. A piece that ends advances. On a phone prev/next move into the
  list and the name truncates. (`plans/2026-08-29-plan-music-bar.md`)
- 2026-08-29 **cribbage:** a real peg board — three streets of forty holes across the middle
  of the table, two pegs a side that leapfrog and walk hole by hole as the score ticks,
  the engine's hand above and yours below (Settings can swap them), and the whole table
  centred: a missing comment opener in the stylesheet had been swallowing the layout rule
  since the game shipped. Settings → Peg board also offers two compact bars, or no board
  during the deal and a replay of its pegging when the deal ends, for a phone's screen.
- 2026-08-29 **cribbage:** real art — the home tile shows the commissioned icon in place of
  the placeholder sketch, and portrait + landscape splash sources are filed for the
  launch-screen step when the manifest arrives (`TODO/pwa.md`).
- 2026-08-29 **cribbage:** a settings panel opened while the engine is still moving no
  longer snaps shut when its move lands — the same re-render defect Dots had, now covered
  by the shared fix. (`plans/2026-08-29-plan-cribbage-vs-engine.md`, post-landing)
- 2026-08-29 **cribbage:** the first hidden-information game, played against the engine —
  The Engine by default, a persona slot wired as in furrow; a game is worth 1, a skunk 2, a
  double skunk 3; manual counting is a setting and counting is a Claim move. Phase 4 closed
  the mutation survivors and split the browser suite at its fast seam.
- 2026-08-29 **shelf:** a re-render does not discard what the player did — the tutor's
  reading survives, the panel the player opened stays open.
- 2026-08-29 **shelf:** Tier 2 is purged — the tier, its machinery, and its last exclusion.
- 2026-08-29 **shelf:** the accessibility matrix is one test per game; the e2e split is one
  job per browser engine so a failure names the engine, and it is recorded why the split
  must not be consolidated for speed.
- 2026-08 **orchard:** the native game, the record, and the wrap retired; the crate covers
  itself, not just the boundary; the cross-build check runs — and it never did before.
- 2026-08 **shelf:** skins subsume themes — `data-theme` is gone, light and dark are registry
  entries, and a skin restyles chrome roles only (board surfaces and per-game palettes stay
  outside its reach: `docs/adr/0001-chrome-and-game-tokens.md`).
- 2026-08 **sinker:** a dig-a-path physics puzzle joins the shelf; Astray, HexGL and Clumsy
  Bird are removed, and the rest get portrait splashes.
