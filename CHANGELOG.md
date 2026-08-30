# Changelog — fun

What changed for a player at `fun.croft.ing`. The pond deploys from `main` (Pages), so
landing *is* releasing: sections are months, each entry dated by its landing. Per
`CroftC/.claude/CHANGELOGS.md`, the branch that changes something a player runs adds its
entry here before it lands. Contexts are the shelf's chrome and the individual games.

Contexts: shelf · looseends · color-sort · align · 2048 · bubble · checkers · wyrdle · trio-tumble · othello · cribbage · furrow · dots · drop4 · blockdoku · orchard · sinker · solitaire

Started 2026-08-29; the August entries below are the landings of that month, and everything
earlier is in `git log`.

## 2026-08

- 2026-08-30 **shelf:** ⤢ is the real thing. Full screen asks the browser's Fullscreen
  API — the frame stays, the shelf bar goes, and leaving by Esc or a gesture un-presses
  the toggle — and where a browser has no API for a page (iOS Safari; Playwright's WebKit)
  it says so in a toast instead of pretending: "Full screen isn't available in this
  browser — install the app for it." A feature-detect, not a try/catch: on those browsers
  the function simply is not there. (`plans/2026-08-30-plan-game-frame.md` Phase 22, D5)
- 2026-08-30 **shelf:** the control surfaces the games used to draw for themselves are
  gone from `styles.css` — the Solitaire-era control bar, mode buttons and settings
  disclosure, Drop 4's turn bar, Align's slider row, Color Sort's action row, the Tier-2
  wrapped-game residue (3.4 KB) — and a unit test keeps them out of `src/` and the
  stylesheet. Cribbage's `.crib-turnbar` survives as the final table's scoreline.
  (`plans/2026-08-30-plan-game-frame.md` Phase 22)
- 2026-08-30 **looseends:** inside the frame. The poster is the home now — its own home
  screen is gone — and the Levels card (the dock's one verb) offers the next unsolved
  level, the level grid or the daily calendar; the level and the solved tally are the
  meters; the overlay HUD (back, droplets, hint) stays on the board; the tagline is a
  toast. Back from the grid or the calendar returns to the board. The continue card
  reopens the level you were on (a level is a short run of taps; it restarts).
  (`plans/2026-08-30-plan-game-frame.md` Phase 21)
- 2026-08-30 **align:** the board's height is now set in pixels from the room the pad
  leaves (a ResizeObserver), not by CSS percentage. `height: 100%` of the flexed row
  never settled on CI's Linux WebKit — the pad moved every frame and no tap was
  "stable" — while macOS WebKit and Chromium were fine. Same sizes as before on both.
- 2026-08-30 **orchard-drop:** inside the frame. Score, best and the next fruit are the
  meters (told only when they change, not every frame); Daily or Free play is the New
  game card, and the chip says which; the rules sentence is a toast. A `?seed=` link is
  a free-play run of that seed, as on every other game. No continue card: the run is
  wall-clock physics, and the core hands out its record only at the end.
  (`plans/2026-08-30-plan-game-frame.md` Phase 20)
- 2026-08-30 **color-sort:** inside the frame. Moves and par are the meters and the chip
  says Daily or the level; Undo, Restart and Hint are dock verbs (Strict mode takes Undo
  away); Daily/Endless is the New game card; skin, fruit icons and Strict mode are in
  Settings; the rules and the no-moves-left notice are toasts. Leave mid-game and the
  continue card replays every pour. (`plans/2026-08-30-plan-game-frame.md` Phase 19)
- 2026-08-30 **shelf:** a choice in the settings sheet no longer loses its selection.
  The sheet's radios were named by row id, and the frame renders a game's preferences
  twice (the phone's sheet, and the rail's inline panel rebuilt on every update) — one
  radio group across both copies, so the hidden copy unchecked the visible one. Seen as a
  skin pick that "did not change its state" and as a CI-only unchecked peg-board mode on
  Cribbage. Each sheet render now has its own group.
- 2026-08-30 **align:** inside the frame. Score, level and lines are the meters (told only
  when they change, not every frame); Marathon (daily), a new Marathon or Sprint 40 is the
  New game card, and the chip says which; vibration and the left/right speed are in
  Settings; the rules sentence is a toast. The board gives up height on a short phone so
  the touch pad stays on screen — at 390×844 the column was 83px taller than the stage
  and a tap on the pad scrolled the board 46px — and keeps its aspect on both engines
  (WebKit squashed it under a plain max-height). No continue card yet: the core exposes
  its input log only at the end of a run. (`plans/2026-08-30-plan-game-frame.md` Phase 18)
- 2026-08-30 **2048:** inside the frame. Score and best tile are the meters; today's board
  or a fresh one is the New game card, and the chip says which; the rules sentence is a
  toast; the "+N" floats from the board's top edge. Leave mid-game and the continue card
  replays every slide. (`plans/2026-08-30-plan-game-frame.md` Phase 17)
- 2026-08-30 **bubble:** inside the frame. Three fixed meters — the level (or shots left),
  the score, and a clock slot that reads "—" until the practice timer is on (bubbles left,
  in Classic) — so toggling the timer moves nothing; Levels/Classic and Daily/New board
  are the New game card; the aim guide, the timer and the four aim tunables with their
  live demos are in Settings; the launcher chip, the progress bar and the drop countdown
  stay beside the board. Leave mid-game and the continue card replays every shot.
  (`plans/2026-08-30-plan-game-frame.md` Phase 16)
- 2026-08-30 **frame:** a game page is exactly one viewport tall, and the frame clips its
  own overflow. Measured at 390×844, Bubble's page was 893px — tapping Fire scrolled the
  page and the board jumped 123px; and at 1280×800 the rail's inline settings ran every
  game page past the viewport (240px on Bubble, 28px on Dots). Bubble's canvas now
  shrinks to the stage (floor 16rem) so the aim bar and Fire stay on screen.
  (`plans/2026-08-30-plan-game-frame.md` Phase 16)
- 2026-08-30 **cribbage:** inside the frame. Seats carry the scores and whose crib it is;
  Difficulty and which way the table faces are the New game card; the tutor, counting your
  own hands (muggins) and the peg-board mode are in Settings; the rules sentence is a
  toast; the status line under the table keeps its height. The phase verbs — throw, go,
  the count — stay on the table, where the cards are. Leave mid-game and the continue
  card replays every code both seats played.
  (`plans/2026-08-30-plan-game-frame.md` Phase 15)
- 2026-08-30 **shelf:** every game's start screen is the poster again — the splash art,
  the title, the pitch and Play over the whole frame. It had been rendering as a 46px
  bordered strip with the art cropped away in both palettes: the setup sheet's Start
  button and the start screen shared one CSS class, and the button's height won. The
  e2e now measures the poster's height rather than asserting it is visible.
- 2026-08-30 **shelf:** the Placeholder "game" is off the site — no `/placeholder/`
  page, not in the drawer, not in the bundle. It is the frame's test fixture and stays
  one: the unit and e2e runs build it in under `FUN_DEV_GAMES=1`.
- 2026-08-30 **furrow:** inside the frame. Seats carry the stores and say "go again" when a
  seed lands in a store; Difficulty is the New game card; the tutor and Millet, the local-AI
  opponent, are in Settings with the measured disclosure on the row; the rules sentence
  and the banter are toasts; the status line below the board keeps its height instead of
  collapsing. Leave mid-game and the continue card replays the sowing.
  (`plans/2026-08-30-plan-game-frame.md` Phase 14)
- 2026-08-30 **dots:** inside the frame. Seats carry the box counts, and "goes again" is
  said on the seat that keeps the turn rather than as a sentence that appeared under the
  lattice; Difficulty and your seat are the New game card; the tutor and the local-AI
  opponent are in Settings with the download disclosed on the row. Leave mid-game and
  the continue card replays the edges. (`plans/2026-08-30-plan-game-frame.md` Phase 13)
- 2026-08-30 **checkers:** inside the frame, the Othello shape: two seats with piece counts
  and whose move it is (The Engine’s pulses while it thinks), Difficulty and your men on
  the start screen and the New game sheet, the tutor and the local-AI opponent in
  Settings, the rules sentence and the banter as toasts, the fanfare under the final
  board. Leave mid-game and the continue card replays it.
  (`plans/2026-08-30-plan-game-frame.md` Phase 12)
- 2026-08-30 **drop4:** inside the frame. Two seats above the board say who is who and whose
  move it is — The Engine’s pulses while it thinks, instead of a "thinking…" word that
  wrapped the turn bar; Difficulty and your mark are the start screen’s card and the New
  game sheet; the tutor and the local-AI opponent are in Settings; the goal sentence and
  Chip’s banter are toasts. Leave mid-game and the continue card replays it.
  (`plans/2026-08-30-plan-game-frame.md` Phase 11)
- 2026-08-30 **blockdoku:** inside the frame. Score, best and streak are the meters; Undo,
  Hint (or I’m stuck) and New board are the buttons; today’s board versus a new one and
  the difficulty (which restarts, so it belongs there) are the New board card. The
  instruction banner that re-wrote itself above the board every time you picked a piece
  up is a one-time toast. Leave a board and the continue card replays your placements.
  (`plans/2026-08-30-plan-game-frame.md` Phase 10)
- 2026-08-30 **wyrdle:** inside the frame. Guesses left is the meter, Hint (or I’m done)
  and New word are the buttons under the keyboard, today’s word versus a new one is the
  start screen’s card — and "Not in word list" is a toast over the grid, not a bar that
  shoved it down for a second and a half. Leave mid-word and the continue card brings
  your guesses back. (`plans/2026-08-30-plan-game-frame.md` Phase 9)
- 2026-08-30 **trio-tumble:** inside the frame — thirteen pills in four rows above the board
  are now one chip ("Campaign · 3 of 6", "Clear jelly · Today’s"), three meters, and
  Hint, Restart (in the campaign) and New board under the board. Board, objective and
  level are chosen on the start screen or the New board card; locked levels show as
  locked. Leave any board and come back to the bare URL to continue it.
  (`plans/2026-08-30-plan-game-frame.md` Phase 8)
- 2026-08-30 **solitaire:** inside the frame. Moves, cards in stock and cards home are the
  meters above the felt; Undo, Hint (or I’m stuck) and New deal are the buttons under it;
  Today’s deal versus a new deal is chosen on the start screen or the New deal sheet;
  Auto-play is in Settings. Leave a deal and come back to the bare URL: the continue card
  says "7 moves · 3 of 52 home" and Continue replays it, assistance and all.
  (`plans/2026-08-30-plan-game-frame.md` Phase 7)
- 2026-08-30 **othello:** the first game inside the frame. Two seats above the board say
  who is who, the score, and whose move it is — The Engine's seat pulses while it thinks
  instead of a line of text appearing; Difficulty and which disc you play moved to the
  start screen and the New game sheet; the tutor and the local-AI opponent are in
  Settings; the opening hint is a passing toast. Leave a game and come back to the bare
  URL and the continue card says "Move 14 · you lead 9–4" — Continue replays it. And the
  board no longer moves while you play: it did, by 24.8px, on every engine turn on a
  phone. (`plans/2026-08-30-plan-game-frame.md` Phase 6)
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
