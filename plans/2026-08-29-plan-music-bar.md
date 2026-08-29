# Plan — a music transport in the shelf header

**Status:** Phases 0–3 COMPLETE (2026-08-29); Phase 4 (gate + PR) in progress.

Branch `claude/music-bar`; worktree `CroftC/worktrees/music-bar/fun`.

## Problem Statement

Music is on or off, globally, from the appearance sheet — and that is all a player can
do with it. The library holds seventeen tracks; a game names one; the shelf has its bed.
Nothing lets a player hear a *different* one, skip the one playing, or pause without
opening a settings sheet. The owner's ask (verbatim, 2026-08-29): "a little just
basically four little control panel thing that is like previous track pause play name of
the track next when you click the name of the track it drops down the whole track list
and at the top of that track list is like a meta option that says couple tracks and
games."

## Approach

Four controls in the header: ⏮ · ⏯ · *track name* · ⏭. The name is a button; pressing
it drops down the track list. The list is headed by one toggle, **Couple tracks to
games**:

- **on** (the default — it is what the shelf does today): opening a game starts that
  game's named track, and the bar shows it. Picking a track from the list still works
  for this page view; the next game you open snaps back to its own track.
- **off**: the shelf plays whatever the player last picked, on every page, and the
  controls flip through the list.

The pause button IS the global music toggle — pause persists "off", play persists "on"
— so the sheet's toggle and the bar can never disagree. A piece that ends advances to
the next track when music is on (a transport with next/prev that stops dead at the end
of a piece would read as broken).

Mobile: the header already holds six controls. Under 40rem the bar keeps play/pause and
one ♪ button that opens the same panel; ⏮ · *name* · ⏭ become the panel's top row, and
the header wraps (it was at its limit before the bar arrived — "How to play" was
wrapping inside its own button on a 390px phone).

## Reasoning

- **Music stays lazy and best-effort.** Selecting a track with music off fetches
  nothing; the bar shows a name it has not downloaded. Every new path keeps the
  silent-failure rule `src/music.ts` documents.
- **One player, one truth.** The bar and the appearance sheet read the same
  `MusicPlayer`; the player publishes changes and both repaint. The sheet's hint names
  the track the player would actually play, not the game's default.
- **Two new preference keys** (`fun-music-track`, `fun-music-couple`), because a track
  choice and a coupling choice are separate facts: turning coupling back on must not
  forget the pick, and a pick must not silently turn coupling off.
- **Pure first.** `startingTrack`, `stepTrack`, `resolveCouple` are pure and unit-tested
  before the DOM exists; the bar is tested through `boot()` like the rest of the chrome.

## Verified assumptions

- `TRACKS` order is the list order (it is the intake order; no other order exists).
- jsdom's `Audio.play()` is unimplemented — tests stub `globalThis.Audio`.

## Phases

- **0** — plan (this file).
- **1** — pure model: `resolveCouple`, `startingTrack`, `stepTrack`; player API
  (`select`, `next`, `prev`, `setCoupled`, `subscribe`, auto-advance).
- **2** — the bar: `src/music-bar.ts`, mounted by `chrome.ts`; the sheet hint follows
  the player.
- **3** — styles: header placement, dropdown, the 40rem collapse; a11y (axe with the
  list open, both palettes).
- **4** — changelog, gate, PR.

## Review Log

- 2026-08-29 — opened.
- 2026-08-29 — Phase 3 changed the phone form after a screenshot: the first cut kept the
  name in the header and it collapsed under the ☾ button on a game page. Measured, not
  predicted — the e2e "prev/next in the list on a phone" test passed on the HOME page
  while the game page overlapped, because the game page carries two more header links.
  The a11y matrix also caught the panel needing to be a landmark (`region`), the same
  finding the appearance panel recorded.
