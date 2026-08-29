# Match-3 — gameplay feel, onboarding, campaign, and narrative scaffold (phase plan)

**Status:** 🟢 **APPROVED — executing (owner OK 2026-08-02).** Branch
`claude/match3-gameplay-feel-7pvabq`. Makes `/trio-tumble/` *feel* like a modern
match-3 (Candy-Crush-class tactility): swipe-to-swap, big glossy pieces on a
receding board, clears that register, burst/flair on multi-cascades — then adds
onboarding (easy scripted opening levels + a first-move nudge), a numbered level
campaign with saved progress + mid-board resume, and a **narrative scaffold** (a
skippable video-overlay + game-event bus + a story bible) that later phases fill
with a real story. All while keeping the shelf's verifiable
`(seed, moves) → state_hash` outcome intact and every change TDD-first.

## Problem Statement

`/trio-tumble/` is mechanically deep (specials, jelly, blockers, ingredients, orders,
obstacles) but **doesn't feel good to play**:

1. **Swapping is taps, not swipes.** Tap-select works and there's a desktop-only
   HTML5 `draggable` path, but no real **swipe/drag flow** — the gesture that
   makes the genre feel alive. Consistent swipes build flow; taps don't.
2. **Pieces are abstract and small.** Gems are colored Unicode glyphs
   (`●▲■◆★✚`) on visible bordered cells — the **boxes dominate, the pieces
   recede**, the opposite of the reference (big glossy candy, board almost
   invisible).
3. **Clears are too fast to read** (uniform `FRAME_MS = 80`) with almost **no
   burst/flair**, especially for satisfying multi-cascade sequences.
4. **No onboarding** — no scripted stupid-easy opening levels, no first-move
   nudge — and **no persistence** of progress or the in-progress board.
5. **No narrative** — no reason to care, no reward moments, no story.

## Owner decisions (2026-08-02)

- **Scope this pass:** feel + onboarding first; **persist the whole cohesive
  vision**, execute through Phase 2.
- **Persistence:** numbered **level campaign + autosave** (mid-board resume).
- **Gem visuals:** **glossy CSS gems** (pure CSS, deterministic, no assets);
  board recedes to a faint grid.
- **Narrative:** **scaffold + story bible** — a story-concept doc, an event
  taxonomy, and a skippable video-overlay component + event bus wired to real
  gameplay events, with placeholder beats; real videos deferred.
- Star grading stays a **front-end reinterpretation of the verifiable record**
  (no Rust core budget change); the campaign is a presentational wrapper over real
  core seeds. Desktop HTML5 drag is **replaced** by pointer-swipe. Gem glyphs are
  **kept faintly inside** the glossy shape as redundancy. A first-time visitor
  **lands in the campaign at Level 1**.

## The cohesive roadmap (all phases)

- **Phase 1 — Tactile feel (this pass).** Swipe-to-swap; glossy CSS gems on a
  receding board; clear timing that registers (~0.25s); burst particles +
  escalating multi-cascade celebration via a game-event bus. Reduced-motion safe,
  axe-clean.
- **Phase 2 — Onboarding + campaign + autosave + narrative scaffold (this pass).**
  Numbered campaign over verifiable seeds with saved progress; scripted easy
  first 1–2 levels with an obvious multi-line opening; first-load first-move glow
  on Level 1; autosave/resume; the event bus feeds a skippable placeholder-beat
  overlay.
- **Phase 3 — Narrative build (deferred).** The dog character + story arc: per-beat
  copy, the character overlay (CSS/SVG), real side-quest clips in the Phase-2
  overlay slots, skip-with-flow polish. See `docs/TRIO-TUMBLE-STORY.md`.
- **Phase 4 — Depth & polish (deferred).** Richer specials/combos flair, more
  levels + curve tuning, per-level objective variety woven into the story,
  meta-progression (star bank / map). Optional Rust: phase-tagged trace frames and
  core-baked per-level budgets.

## Execution log

- **Docs (`855e378`):** this plan + `docs/TRIO-TUMBLE-STORY.md` (Biscuit + event taxonomy).
- **P1.1 swipe (`57f462d`):** pointer-swipe replaces HTML5 drag; delegated on the
  board, direction from the pointer delta, `suppressClick` guard, `touch-action`;
  tap/keyboard stay the floor. `dragTo` e2e → an engine-agnostic swipe test.
- **P1.2 glossy gems (`df7da8e`):** candy shape on an inner `.m3-shape` (glows stay
  on the button, unclipped); distinct silhouette per type; receding board;
  `renderFrame` updated in lockstep.
- **P1.4 FX + bus (`4da55ed`):** `analyzeCascade` frame-diff drives per-phase timing
  (clear held ~260ms), particle bursts, and an escalating Nice/Sweet/Divine, all
  off a game-scoped `match3-events` bus. Softened the per-frame drop-in.
- **P2 campaign (`12d4176`):** `trio-tumble-campaign` + `campaign-pack.json` (build.mjs
  copy); real seeds → verifiable, front-end star reinterpretation; landing +
  `?level=N` + level nav + Next-level + progress. Levels 1–2 curated easy openers
  (seed 341 → depth-6 cascade).
- **P2 autosave (`2c2311f`):** move-list resume (replayed into a fresh core), Restart.
- **P2 tutorial glow (`3afde56`):** Level 1 first-load opening-move nudge, once,
  non-penalising.
- **P2 narrative scaffold (`656b6b3`):** `match3-story` (event→beat, once-ever +
  once-per-board) → skippable `match3-overlay` beat card, gated to campaign.
- **Gate:** how-to copy (swipe + campaign) + match3 guide shots regenerated;
  README. `npm run test` green (195 unit); match3 e2e green (desktop + mobile).
  Known: the pre-existing `how-to.spec` solitaire shot-load test flakes in this
  sandbox's newer Chromium (lazy-loaded below-fold images the non-scrolling poll
  misses) — unrelated to this change (solitaire/how-to renderer untouched).

## Phase 1 — feel

- **1a. Swipe-to-swap (Pointer Events).** Delegated pointer layer on `.m3-board`:
  `pointerdown` on a `.m3-gem` records origin + start coords; `pointermove` past
  ~half the gem pitch (from the origin's `getBoundingClientRect`) in the dominant
  axis resolves the cardinal neighbor and swaps via the existing `swapBetween()` +
  `applySwap()` (core decides legality). Tap-select stays the accessible floor via
  the existing delegated `click` → `handleClick`; a completed swipe sets a
  `suppressClick` guard. Direction from the pointer **delta**, not
  `elementFromPoint` (robust to mid-cascade rebuilds). `touch-action:none` +
  `user-select:none` on gems only. Remove `draggable` + the drag block.
- **1b. Glossy CSS gems + receding board.** The candy shape lives on an **inner
  `<span class="m3-shape" aria-hidden>`** (NOT the button — `clip-path`/gloss clip
  `box-shadow`/`outline`, which carry the `.selected`/`.legal-target`/`.hint-*`
  glows). Distinct silhouette per gem (circle/triangle/rounded-square/diamond/
  star/cross) → shape+color, never color-only. Glyph kept as a faint inner mark.
  `renderFrame` updated in lockstep. Board recedes to a faint grid.
- **1c. Clear timing.** Per-phase durations by frame-diff inference: a snapshot
  whose hole-count *rose* is a **clear** phase → hold ~250ms; fall/refill snappy.
  (Tech-debt: phase-tagged frames from the core would be cleaner — Phase 4.)
- **1d. Burst + celebration + event bus.** `match3-fx.ts` burst layer (decorative,
  `aria-hidden`, reduced-motion-gated, `<span>`-only so `.m3-gem` stays ×64),
  positioned by grid math over the settled board. Cleared cells + cascade depth
  from the same frame-diff. Escalating "Nice/Sweet/Divine". Driven by a tiny
  game-scoped bus `match3-events.ts` (module-closure, not global).

## Phase 2 — onboarding + campaign + autosave + scaffold

- **2a. Campaign.** `games/trio-tumble/campaign-pack.json` (+ a `build.mjs` copy entry
  → `/trio-tumble-campaign-pack.json`): `levels:[{id,objective,seed,starRule,intro?}]`.
  Real core seeds → verifiable/shareable. Stars are a front-end reinterpretation of
  the verified record. Levels 1–2 use curated easy multi-line openings. UI: a
  Campaign mode + "Level N" header + "Next level" on win + persisted progress.
- **2b. First-move glow.** On Level 1 first load, glow a curated opening swap via
  the existing `applyGlow`/`hint-from`/`hint-to`, non-penalizing (no
  `markAssistance`), shown once.
- **2c. Autosave/resume.** `settings.ts` gains a save blob `{level,seed,objective,
  moves:Swap[],ts}` — the **move list**, not the board — replayed into a fresh core
  on load (deterministic + verifiable). URL params (`?r=`/`?seed=`/`?mode=`) win
  over the save. Hook exposes `level`.
- **2d. Narrative scaffold.** `match3-story.ts` (event taxonomy → beat map) +
  `match3-overlay.ts` (skippable placeholder beat card) subscribing to the Phase-1
  bus. One-tap skip, remembered, reduced-motion friendly. Placeholder beats only.

## Precedence (mount)

`?r=` (shared) > `?seed=` > `?mode=` > `?level=N` > autosave-resume >
campaign(Level 1) / daily. `window.__match3` keeps its existing keys (adds
`level`).

## TDD & tests (RED first)

- **Unit** (`tests/match3-unit.test.ts` + new): frame-diff → cleared-cells;
  cascade-depth → celebration tier; event-bus emit/on; campaign parsing + star
  grading; autosave move-list replay reconstructs identical `state_hash`; story
  taxonomy mapping.
- **E2e** (`tests/match3.spec.ts`): rewrite the desktop `draggable` test as a
  **swipe** test; tap-select still swaps; glossy gems keep `button.m3-gem` ×64 +
  axe-clean + 360px fit; `.m3-animating` still shows then settles; reduced-motion
  skips FX; Level 1 first-load glow; win → "Next level" advances + persists; resume
  restores state; a beat overlay appears and Skip dismisses it. All existing
  objective/verify/share tests stay green.

## Verification / definition of done

1. `npm run build:wasm && npm run test` green.
2. `npm run e2e` (Chromium + mobile/touch) green incl. new swipe/campaign + axe.
3. Manual `npm run serve`: swipe flows on touch+desktop; big glossy pieces,
   receding board; multi-cascade shows bursts + "Divine!"; Level 1 opens with a
   glow + easy multi-clear; reload resumes; a beat overlay skips cleanly; `?r=`
   still verifies.
4. `npm run build:wasm && npm run build && npm run guide:shots` — regenerate ONLY
   the match3 shots (`git add` match3, `git checkout --` the rest); update how-to
   copy (swipe replaces "tap to drag", new campaign/onboarding).
5. Commit at each green phase (`Co-Authored-By: Claude Opus 4.8`).
