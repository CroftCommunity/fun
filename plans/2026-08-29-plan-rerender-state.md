# Plan — a re-render must not discard what the player did

**Status:** Phases 0–4 COMPLETE (2026-08-29). Phase 5 (gate + land) in progress.
Worktree moved to `worktrees/rerender-state/fun` when the feature-workspace layout
landed mid-flight (`CroftC` 4d472bd).

Branch `claude/rerender-state`; claim `CroftC/.coordination/claims/fun--rerender-state.md`.
Owner asked for both halves in one pass, TDD first.

## Problem Statement

`main` has not deployed since 2026-08-27. `deploy` needs `e2e`, and `e2e` keeps failing
on one test. After splitting CI per browser engine (`224e976`) the failure is down to a
single, consistent name:

```
e2e (chromium)        success   259 passed
e2e (mobile-webkit)   FAILURE   259 passed, 1 failed
                                dots.spec.ts:191 — the tutor panel is off by
                                default and appears when enabled in settings
```

The test takes **0.36s locally and times out at 30s on CI** — an 80× gap, which is not
slowness. Playwright's call log says exactly what happens:

```
locator resolved to <input class="dots-set-tutor"/>
  element is not stable              → retry
  element was DETACHED from the DOM  → retry
locator resolved to <input …/>        (a different one)
  element is not visible  × many     → timeout
```

**The mechanism.** `src/games/dots/dots.ts:456` runs a WebGPU adapter probe and, when it
resolves, calls `render()`. `render()` is `container.replaceChildren(…)` — it rebuilds the
entire subtree, including the `<details class="dots-settings">` the player just opened.
The rebuilt `<details>` is closed, so the checkbox inside it is present but not visible.
Locally the probe resolves before the test opens settings; on CI's mobile-webkit it
resolves later, landing between the `summary` click and the `.check()`.

**This is a real bug, not a test artefact.** On any slow device, opening the settings
panel and having it snap shut when an unrelated async probe returns is what a player
sees.

**And it is one of two symptoms of the same root cause.** `TODO/dots.md:81` already
records the other from the opposite side:

> **The tutor panel's list resets on every re-render**, so playing a move clears the
> options it just explained. Othello and checkers behave the same way; it is a shared
> pattern worth fixing once rather than per game.

Both are the same sentence: **`render()` throws away state that belongs to the player
rather than to the game model.** The open/closed panel is one instance; the explained
move list is another.

## Approach

Two complementary fixes, because the discarded state is of two kinds.

**A — a shared preserver for state the DOM owns.** A pure module that captures the
player-owned bits of a subtree before it is replaced and re-applies them after:

```
          render()
             │
   captureUiState(container)   ── open <details> keyed by class
             │                    ── focused element + its selection
   container.replaceChildren(…)
             │
   restoreUiState(container, s)
```

Used by every game whose `render()` replaces its container. This is the "fix once"
artefact.

**B — hoist the tutor's result out of the DOM.** In all four adversarial games the tutor
writes its note and options straight into elements and keeps no record, so a rebuild has
nothing to render from. `coachMsg` in the same file is already held in a variable and
survives — the tutor report simply needs the same treatment, then
`renderTutorPanel()` renders from it.

A is shared code. B is a three-line change repeated identically in four files, because
the report type differs per game (an edge, a square, a pit) while the shape does not.

## Reasoning

**Why not just raise the timeout.** It was my first suggestion to the owner and it was
wrong. Two different problems wore the same costume: `othello.spec.ts:76` takes 19.4s
locally against a 30s ceiling and is genuinely marginal, while `dots.spec.ts:191` takes
0.36s and hangs. A bigger ceiling fixes the first and buries the second — shipping a real
UI bug behind a green tick. Splitting CI per engine already fixed the marginal one by
giving each project a whole runner; what is left is the actual defect.

**Why capture/restore rather than caching the panel nodes.** The obvious alternative is
to build the settings panel and tutor panel once and re-insert the same nodes, which
would preserve everything for free. It was rejected: those panels *read state at build
time* (`toggle(hints, …)`, `localAiAvailable`, `dotsTutorEnabled()`), so keeping the node
means adding an explicit update path for every one of those inputs — a much larger
refactor, in four games, with more ways to go wrong than the bug it fixes. Capture/restore
keeps the existing rebuild-everything model, which is simple and correct, and repairs only
the handful of things the model legitimately does not own.

**Why key `<details>` by class.** Every game's settings panel already carries a stable,
unique class (`dots-settings`, `othello-settings`, …) alongside the shared `sol-settings`.
That is a key that exists today and needs no new attribute threaded through markup. A
`data-ui-key` would be tidier in the abstract and is not worth editing thirteen games to
introduce.

**Why this is four games, not the three the backlog names.** `TODO/dots.md:81` says dots,
othello and checkers. **Furrow has the same probe and the same `render()`** — it shipped
after that note was written and inherited the pattern. Measured, not assumed:
`grep -n "localAiAvailable) render()"` returns four files. The backlog entry gets
corrected as part of this.

**Why the shared preserver is offered to all games, not only the four.** Thirteen games
build a settings `<details>` and fourteen call `container.replaceChildren`. Only the four
with the async probe can lose the panel *without the player doing anything*, but every one
of them loses it when the player toggles a setting that triggers a re-render — which is
the same bug, merely self-inflicted and therefore easier to mistake for intent.

## Verified assumptions

Measured on `224e976` before writing this.

- `dots.spec.ts:191` passes locally on mobile-webkit in **362ms**; the same test times out
  at 30s on CI. `othello.spec.ts:76` takes **19.4s** locally — a different problem, already
  addressed by the CI split.
- Four games call `render()` from the WebGPU probe: dots:456, othello:431, checkers:511,
  furrow:417.
- Thirteen games build a `sol-settings` `<details>`; fourteen call
  `container.replaceChildren`.
- ~~All four adversarial games write tutor output DOM-only.~~ **WRONG — corrected in
  Phase 4.** Three of them do. **Furrow already holds its reading in `tutorView`, keyed by
  `game.currentHash()`, and repaints it** — it shipped last and had already solved this.
  The check that produced the false claim was
  `grep -cE 'let (tutorReport|lastReport|tutorState)'`, which searched for the three names
  I expected rather than for the behaviour, and returned 0 for a file that implements it
  under a fourth name. A grep for invented identifiers confirms your vocabulary, not the
  code. The fix became "bring furrow's solution back to the other three", and dots now
  keys on `currentHash()` the way furrow already did rather than the board serialisation
  I had written for it.
- `coachMsg` in dots is already a variable and is already re-applied on rebuild
  (`if (coachMsg) coach.textContent = coachMsg;`) — the precedent this follows.

## Phases

RED first in every phase; each ends green with its own commit.

- **Phase 0 — survey + decisions.** ✅ This document.
- **Phase 1 — the failing test, before any fix.** A deterministic e2e that reproduces the
  bug without depending on probe timing: open the dots settings panel, toggle *Enable
  hints* (which calls `render()`), assert the panel is **still open**. It fails today, and
  it is the same defect the CI race trips over. **Gate:** watch it fail, and say so.
- **Phase 2 — `src/ui-state.ts`.** Unit tests first (jsdom): an open `<details>` survives
  a replace cycle; a closed one stays closed; an unknown key is ignored; focus returns to
  the matching element. Then the module. **Gate:** unit.
- **Phase 3 — wire it into the four games.** `capture` / `replaceChildren` / `restore` in
  dots, othello, checkers, furrow. Phase 1's test goes green. Add the equivalent e2e for
  the other three. **Gate:** unit + the four games' e2e, both projects.
- **Phase 4 — the tutor result survives a re-render.** RED per game: explain options, then
  cause a re-render, assert the list is still there. Then hoist the report into a variable
  and render from it. **Gate:** e2e, both projects.
- **Phase 5 — land.** Full `npm run gate`, then CI must show **both** e2e legs green and
  `deploy` no longer skipped — the point of the exercise is a published site, so the
  evidence is the deploy, not the local gate.

## What execution changed

- **The bug was never mobile-webkit's.** The Phase 1 test failed on **both** engines the
  moment it was deterministic. CI only ever caught it under mobile-webkit because that is
  where the WebGPU probe resolved late enough to land mid-interaction; chromium carried the
  same defect and never tripped over it.
- **A RED test that passes is worse than no test, and I wrote one.** The first version of
  the dots tutor test toggled *Declare assistance* — which writes a setting and does not
  re-render — so it passed against the unfixed code. It only became a real test once it
  used a toggle that actually calls `render()`, and then it failed as it should:
  `Expected: 6, Received: 0`.
- **Every test here was mutation-verified**, because three of the seven were written after
  the fix rather than before it. Disabling `restoreUiState` in the three sibling games
  turned all six panel tests red; disabling the tutor repaint turned all six tutor tests
  red, furrow's included. Each round committed first and restored with
  `git checkout HEAD --` against a `git status --porcelain` checked at that moment.

## Risks

- **Restoring focus can fight the player.** If a re-render happens while the player is
  typing, moving focus back is right; moving it somewhere merely similar is worse than
  doing nothing. Mitigation: restore focus only on an exact key match, and never steal it
  if focus has since moved outside the container.
- **Class keys are not unique if a game ships two `<details>` with the same class.**
  Mitigation: the capture keys on the full class attribute and, where two match, restores
  positionally among them; a unit test pins that case.
- **Phase 4 changes what the tutor shows after a move.** Today the list clears when the
  board changes, which is arguably correct — a list of "reasonable edges" is stale once an
  edge is drawn. Keeping a stale list would be a worse bug than losing a fresh one. So the
  report is held **with the board hash it was computed for**, and rendered only while that
  still matches; otherwise it clears deliberately rather than by accident.
