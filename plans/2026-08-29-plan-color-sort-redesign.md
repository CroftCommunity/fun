# Plan — Color Sort: endless-first, a real pour, sign-in, and the game frame

**Status:** Phase A COMPLETE (2026-08-30) — B, C, D in progress. D1–D12 settled
(§ Decisions); mock `mocks/e-color-sort.html` v3, baseline `fun@bac0c55`.

Branch `claude/color-sort-redesign`; worktree `CroftC/worktrees/color-sort-redesign/fun`.

## Problem Statement

Color Sort shipped 2026-08-02 as a correct engine wearing a bare UI. Three things are wrong
for a player, in the owner's order of weight:

1. **The pour is not there.** A move re-renders the board; the landed units drop in from
   above (`cs-pour-in`, 360 ms) and the target bobs. The source tube never lifts, tilts, or
   streams. The genre's entire feel lives in that pour — a 2026 analysis of the leading app
   calls the pour "the single biggest first-impression driver" — and ours has none, so the
   game plays worse than its engine deserves.
2. **It opens on Daily, for everyone.** Daily is a fixed 12 tubes / 10 colours with par
   25–42 (median 32 across the pack). A first-time player lands on a 32-pour puzzle. The
   owner's rule: start on **Endless** (level 1 is 4 colours, 6 tubes) unless the player is
   signed in and has played at least a threshold of games.
3. **There is no sign-in.** The shelf is "no account, no server" throughout, so "signed
   in" cannot be evaluated today. The owner wants the workspace's standard sign-in
   (croft-pwa's provider sheet + atproto OAuth) on fun, and the played-count read from the
   identity.

Plus, structurally: Color Sort has **not migrated onto the game frame** (plan
`2026-08-30-plan-game-frame.md`, item 19 — deadlock card → toast; skin/icons/strict →
preferences). Its controls are still thirteen-pill-style inline chrome, and its 12 tubes at
390px render at 2.7rem ≈ 43px wide, one pixel under the 44px tap floor.

## Approach

One feature, four parts, each its own phase group, in this order:

```
┌───────────────────────────────────────────────────────────────────────────┐
│ A. Frame migration   Color Sort declares a GameFrameSpec: meters (Moves,  │
│                      Par/Level), verbs (Undo · Hint · New game… + frame's │
│                      Settings), setup (Endless / Daily), preferences      │
│                      (skin, icons, strict, pour speed). Start screen =    │
│                      the splash + setup card.                             │
├───────────────────────────────────────────────────────────────────────────┤
│ B. The pour          DOM + Web Animations API, zero deps. Lift → travel + │
│                      tilt about the LIP → stream → per-unit level change  │
│                      (liquid counter-rotated, surface stays level) →       │
│                      return. Next tap accepted during the return. Reduced │
│                      motion = cross-fade + live-region sentence. Per-skin │
│                      variant: balls hop in an arc; nuts lift and thread.  │
│                      Tube-complete beat: cap drops on, tick, sound.       │
├───────────────────────────────────────────────────────────────────────────┤
│ C. Endless-first     Poster default = Endless L1 (or best level). Daily   │
│                      appears in setup once `played ≥ N`; a "Today's       │
│                      puzzle" chip on the poster once unlocked. `played`   │
│                      = local stats today; the signed-in record once D.    │
├───────────────────────────────────────────────────────────────────────────┤
│ D. Sign-in           Port croft-pwa's `src/signin/` (provider registry +  │
│                      <dialog> sheet) + `src/atproto/oauth/` (zero-dep    │
│                      client) into fun's shelf chrome — ONE sign-in for   │
│                      the shelf, not per game. Offered AFTER the first     │
│                      solve, never before (Wordle's sequence). Identity    │
│                      buys: the stats record lives at the DID, so the      │
│                      threshold and the streak follow the person.          │
└───────────────────────────────────────────────────────────────────────────┘
```

A is the vehicle for B and C (the poster, the setup card and the dock are all frame
surfaces). D is shelf-wide and is the only part that touches anything outside
`src/games/color-sort/`; it lands as its own PR.

## Reasoning

### Why the pour is DOM + WAAPI and not a library or a canvas

Researched 2026-08-29 (full report in § Research). Every library that would help — GSAP
(28 kB gz, and **not OSI**: Webflow's "no-charge" licence), anime.js (43 kB), PixiJS
(231 kB), Lottie/Rive (300–500 kB of wasm and a pre-authored pour that cannot follow an
arbitrary source→target) — buys nothing that `element.animate()` chained on `.finished`
does not already give, and each is a supply-chain decision (`SUPPLY-CHAIN.md`). WAAPI on
`transform`/`opacity` runs on the compositor; sequencing is `await`. The reference is the
one open-source clone that thought the pour through (Decanta): the tube rotates about its
**lip corner** so the spout stays over the target's mouth, the liquid is drawn level and
never rotates with the glass, travel is ~0.10–0.22 s linear, the pour sweep is
`max(0.24, 0.16 s × units)`, return 0.08–0.26 s ease-out, and a physically-honest small
tilt "reads as stuck", so the pour reserves a visibly large arc. A canvas would make the
tilted waterline exact, at the cost of two render targets (canvas + a parallel button DOM
for accessibility) and skins that become draw routines instead of CSS. The DOM version
keeps `<button aria-pressed>` per tube, the existing three skins as CSS, and the axe suite
unchanged.

### Why endless-first, and why the gate reads a record rather than a flag

The genre never tutorialises: level 1 is 3–6 tubes and 2–3 colours and "randomly pouring
works adequately". A daily is a Wordle convention, and Wordle's sequence is rules card →
first solve → stats → *then* the sign-in offer. Putting a par-32 puzzle first inverts that.
The gate is `played ≥ N`, and `played` must be a **record** (local `color-sort/stats`
today; the DID's record once signed in) so it is the same fact the streak reads — a second
"has seen daily" flag would be the one that drifts.

### Why sign-in is the shelf's and ports croft-pwa

`DECISIONS.md` § Prior-art router: atproto OAuth exists ~8× in the workspace; "do NOT write
a ninth". Two lineages, owner's call per project: the hand-rolled zero-dep client
(`croft-pwa/src/atproto/oauth/`, 675 lines, PAR + PKCE + DPoP, live-verified) or the
official `@atproto/oauth-client-browser` (forage, arecipe). The sign-in **surface** is
fixed either way: croft-pwa `docs/DESIGN.md` § "Choose your atmo provider" — a probed
provider registry, two panels split by posture, Create only where signups are open, the
handle field as the seam, "silence is success". fun has no `<meta>` CSP, so rule 7
(derive `connect-src` from the registry) has nothing to apply to yet — that is a finding,
not a shortcut: adding a CSP is a separate decision.

Identity has to *buy* something or it is a wall. What it buys here: the stats record moves
from `localStorage` to the person's repo, so the threshold, the streak and "Continue"
follow them across devices. That means a record type, which means `LEXICONS.md`'s four
acts — investigate (is there a `community.lexicon.*` game-progress type? what does
`ing.croft.*` already hold?), publish, socialise, validate on the way in.

### What we deliberately do not copy from the genre

Five-undo caps, ad-gated extra tubes, reshuffle-on-retry, the +1-bottle upsell at the fail
state, hidden-layer levels that are luck. The shelf already has unlimited undo, a
solver-certified deal that never reshuffles, and par. The one "hard mode" the research
found fair — hidden layers where a safe move exists across every permutation — is out of
scope and not precluded.

## Decisions (settled 2026-08-29 — owner's words in quotes)

| # | Decision | Settled |
|---|---|---|
| D1 | Pour technique | **DOM + WAAPI, zero deps**, liquid counter-rotated so the surface stays level. An inline-SVG waterline for the water skin is a later upgrade on the same skeleton, not a fork |
| D2 | Pour ambition | **"yes to variant, let's go all out"** — lift + tilt about the lip + stream + per-unit level change + return for water; balls **arc-hop** one at a time with a settle bounce; nuts **lift off the post, fly, and thread down** onto the target with a quarter-turn; the tube-complete beat (cap drops on, tick, sound) in every skin |
| D3 | Pour speed | a preference row **Slow / Normal / Fast / Off**; Off is the reduced-motion path; `prefers-reduced-motion: reduce` selects Off until the player overrides |
| D4 | Threshold `N` | **5 solved levels of any kind** (Endless levels and Dailies both count) — "agreed" |
| D5 | Daily before the gate | **visible, locked**: the setup card's Daily row reads "Unlocks after 5 solves · 2 to go"; a shared `?r=` daily still opens (a deep link is a deep link) |
| D6 | Daily after the gate | **poster stays Endless**; a "Today's puzzle · par 32" chip appears on the poster and the Daily row unlocks. The default never moves under the player |
| D7 | Endless L1 size | keep `colors_for` as is (4 colours, 6 tubes) |
| D8 | OAuth lineage | **"look at croft-pwa and standard dimension guidance"** → the croft-pwa port: `src/atproto/oauth/` hand-rolled zero-dep client (DECISIONS.md "documented port"; `croft-pwa/docs/ATPROTO.md`) and the `src/signin/` provider sheet exactly per `croft-pwa/docs/DESIGN.md` § "Choose your atmo provider" (all eight rules; rule 7 has no CSP to apply to on fun — recorded, not skipped) |
| D9 | What the record holds | **both** stats and the in-progress game — **"but keep the state local to the browser but shaped for a later lexicon if we so choose, see forage doing the same thing"**. So: one record shape carrying `$type` and lexicon-shaped fields, persisted by a **substrate seam** (forage's `js/substrates/{memory,atproto}.js` — the caller owns persistence; a substrate never reaches for `localStorage`), with only the local substrate built now. Signing in binds the record to a DID locally; publishing it to the PDS is a later substrate, and the lexicon itself stays at LEXICONS.md's "unpublished stage" until we choose |
| D10 | Sign-in placement | **shelf header**, one identity for every game |
| D11 | Sound | synthesised first, per-skin timbre (glug / clink / clack), under the existing Sound preference |
| D12 | Colourblind default | keep today's defaults |

### The record shape (D9) — local now, a lexicon later

```json
{
  "$type": "ing.croft.fun.progress",          // tentative NSID — LEXICONS act 1 before publishing
  "game": "color-sort",
  "did": null,                                 // bound on sign-in; null while anonymous
  "stats": { "solved": 7, "strictSolved": 2, "streak": 3, "maxStreak": 5, "lastDay": 20694,
             "bestLevel": 9, "played": 12 },
  "inProgress": { "mode": "endless", "level": 9, "seed": "…", "moves": [[3,11],[0,10]] },
  "updatedAt": "2026-08-29T23:10:00Z"
}
```

`played` is the D4 gate's input. The shape is one object per game per browser
(`localStorage` key `fun-record-<game>`), superseding the three ad-hoc keys Color Sort
keeps today (`color-sort/stats`, `color-sort/endless`, `color-sort/daily/<day>`) and
feeding the frame's progress store (`fun-progress-<id>`) rather than duplicating it —
resolved in phase C, not here.

## Does the build match the mock? — the parity contract

Owner, 2026-08-29: "sometimes our plans have not quite matched our mocks so let's build
in protections to verify it looks and behaves like the mock". The protection is three
documents bound by one test, so drift between them is a red board, not a feeling:

```
 mocks/e-color-sort.html ◀── mockVersion must equal ──┐
        │ states timings (120ms, 160ms …)              │
        ▼                                              │
 mocks/e-color-sort.claims.json ── every promise the drawing makes, as
        │   { id, proposal, phase, kind, claim, spec }   one claim naming the
        │                                                exact spec title
        ▼
 plans/…-color-sort-redesign.md **Status:** "Phases A–B COMPLETE"
        │
        ▼
 tests/mock-parity.test.ts  (unit, in the gate)
   · claims well-formed; ids and spec titles unique; spec title starts "mock <id>:"
   · every `NNNms` a claim quotes appears in the mock's own text
   · for every phase the Status line calls COMPLETE, each of its claims has a
     `test("<spec title>")` somewhere under tests/ — or the board is red
```

Watched red 2026-08-29: with Status edited to "Phases A–B COMPLETE" the test listed the
sixteen A/B claims that have no spec yet; restored, it is green with zero owed.

**Four kinds of claim, four kinds of proof** (the claim's `kind` says which):

| kind | proves it by | example |
|---|---|---|
| `structure` | DOM queries in the frame's bands: which verbs, which meters, which rows, in the mock's order | E2.1 dock = Undo · Hint · New game… · Restart · Settings |
| `measure` | `getBoundingClientRect()` at 390×844 and 1280×900 | E2.3 tube ≥ 44px; E2.2 board top pixel identical before/after |
| `behaviour` | drive the core, then read `document.getAnimations()` for durations, or the DOM for the outcome | E3.1 four animations, 120 / 200 / 160·n / 200 ms |
| `look` | a computed-style or capture assertion | E3.2 `transform-origin` at the lip; E9.1 a Shipped capture beside Proposed |

**Definition of done, per phase** (in addition to the repo's gate and the guide shots):

1. Every claim tagged with the phase has its spec, written RED first against the
   unmigrated page where the mock changes behaviour (the frame plan's Pass-3 recipe).
2. The plan's Status line names the phase COMPLETE — which is what makes the parity test
   demand those specs — and the Review Log pastes the test's line for that phase.
3. `node tools/mock-snaps.mjs color-sort` is re-run on the committed tree and the capture
   stands in the mock as a **Shipped** column beside Proposed (mock-version and
   mock-baseline bumped). The visual half is a human comparison; the claims are the
   checkable half. Neither replaces the other.

What this cannot catch: a spec that passes without proving its claim. That is review
(pr-reviewer reads claims.json next to the spec); the test only guarantees the spec exists,
is wired, and agrees with the mock's numbers.

**Owed to the workspace:** this is a candidate rule for `CroftC/.claude/MOCKS.md` (rule 6:
"a mock that will be built ships a claims file, and the plan's phases are gated on it").
Proposed after it has survived one game, not before — PATTERN.md's own sequencing.

## Research (2026-08-29, two sweeps; sources inline)

### Genre — what the leading apps do

- **Water Sort Puzzle (IEC Global)**, 4.7 / 324K ratings: tap-to-pour, "bright, smooth,
  relaxing animations", no daily, no timer. Economy: 5 undos then an ad; extra tube via
  ad. Boards cap at ~14 tubes past level ~1100; later difficulty is colour similarity and
  hidden layers (from ~L325), which players read as luck. Top feel-related complaint: a
  request for a **"reduce animation option to eliminate pouring duration"**; top a11y
  complaint: no colourblind toggle. https://apps.apple.com/us/app/water-sort-puzzle/id1514542157 ;
  https://www.complaintsboard.com/water-sort-puzzle-b149618 ; https://worldsapps.com/reviews-water-sort-puzzle
- **Magic Sort (Grand Games, 2025)**, 4.7 / 615K: the best-regarded pour ("the liquid
  swirls… every movement looks smooth"); praised for being fast enough to **queue the next
  move without waiting**; >$40M first year on IAP with the +1-bottle upsell at the fail
  state. https://apps.apple.com/us/app/magic-sort/id6499209744 ; https://www.gamigion.com/magic/ ;
  https://www.deconstructoroffun.com/blog/2026/2/6/sort-puzzles-how-a-new-subgenre-is-born
- **Ball Sort Puzzle**: same economy; a variant prints letters on balls for colourblind
  players. **Nuts and Bolts: Screw Sort**: ASMR click sounds; drag rather than tap.
  **Hexa Sort**: not a pour game (auto-sort/merge), L1 = 4 colours → L5 = 8, animated-hand
  onboarding. https://apps.apple.com/us/app/ball-sort-puzzle/id1494648714 ;
  https://apps.apple.com/us/app/nuts-and-bolts-screw-sort/id6612032640
- **The pour, assembled** (no public frame timings exist; open-source numbers below):
  select → tube lifts; travel + tilt so the mouth is over the target lip; a stream while
  the source level drops and the target rises in lockstep; return, with the next tap
  accepted mid-return; a glug; a per-tube completion tick/haptic.
- **Onboarding**: no tutorial is the norm; L1 is 3–6 tubes, 2–3 colours. Ramp: 8–10 tubes
  / 6 colours mid-game; an extra vial every ~5 levels in one clone; solver-rejected
  levels (DFS, 20k-move budget) in another. Timed modes are absent from the leaders
  ("no timers, no move limits" is marketing copy). https://www.coolmathgames.com/blog/how-to-play-lipuzz-water-sort ;
  https://github.com/BeytullahKalay/WaterSort
- **Daily / Wordle convention**: rules card on first launch; one puzzle a day with a reset
  timer; stats after the solve; **sign-in offered after the first solve** to sync the
  streak; spoiler-free share grid. https://www.androidpolice.com/wordle-beginners-guide/
- **Juice**: Jonasson & Purho, "Juice It or Lose It" (GDC 2012)
  https://www.gdcvault.com/play/1016487/Juice-It-or-Lose ; ease everything, hit-stop
  40–80 ms, input windows <150 ms https://egmatic.com/blog/how-to-make-your-game-feel-good ;
  undo that "skips instantly" reads as a bug — animate a short snap.
- **Accessibility**: WCAG 2.3.3 (AAA) — interaction-triggered motion must be
  disableable; reduce, don't remove: keep which/where/how many.
  https://w3c.github.io/wcag/understanding/animation-from-interactions ;
  https://ablegamers.org/unlockingaccessibilitypuzzlegames/ (shape/symbol per colour,
  never gated behind progression).
- **The math** (Ito et al., arXiv:2202.09495): ball-moves and water-moves are equivalent
  (Cor. 4 — why one engine serves three skins); NP-complete even with two colours (Thm 9);
  "solvable in ≤ t moves" NP-complete even for guaranteed-solvable instances (Cor. 12 —
  why par is a solver line, not a claim of optimality); with h=4, **k=3 empties do not
  guarantee solvability** (a no-instance at h=4, k=3, n=12) — our pack's solver
  certification is load-bearing. Kociemba's optimal solver: http://kociemba.org/themen/waterball/colorsort.html

### Technique — how a browser pour is built

- **FLIP + WAAPI, zero deps**: measure both tubes' rects, compute the delta to a docked
  position above the target mouth, animate `transform` only (`translate` + `rotate`),
  `transform-origin` at the lip corner; a stream element under the mouth grows via
  `scaleY` from `transform-origin: top`; per-unit level change via `scaleY`, never
  `height`. Sequence with `await el.animate(...).finished`. `will-change: transform` on the
  moving tube only, for the pour's duration. https://css-tricks.com/animating-layouts-with-the-flip-technique/ ;
  https://motion.dev/magazine/web-animation-performance-tier-list ;
  https://web.dev/articles/stick-to-compositor-only-properties-and-manage-layer-count
- **Level liquid in a tilted glass**: counter-rotate the liquid block by `-tilt` inside
  an `overflow: hidden` tube (cheap, approximate) — or Decanta's model: glass back →
  liquid in world space (never rotates) → glass front → stream. https://github.com/alliterhorst/decanta-water-sort/blob/main/src/render/scene.ts
- **Decanta's measured timings** (PixiJS + GSAP, the most thought-through open pour):
  travel 0.10–0.22 s linear (`APPROACH_ROT` 7.0 rad/s); pour sweep `max(0.24, 0.16 s ×
  units)` with volume transferring linearly; return 0.08–0.26 s `power2.out`; sound fires
  on the sweep start for `durPour + 0.1`; a rejected pour is an `elastic.out` wobble.
  "A physically pure overflow arc reads as stuck" — reserve ≥ 0.45 rad for the pour.
- **plo-0318's pure-DOM pour** (the best CSS-only reference): `--move-x/--move-y/--rotate`
  as custom properties, `pourLeft = from.x > to.x` with an off-screen flip, 0.5 s
  travel, a generated stream, per-unit `height` keyframes at 0.8 s (its weakness: layout
  animation, and the liquid rotates with the glass). https://github.com/plo-0318/water-sort-puzzle
- **View Transitions API** (Chrome 111+, Safari 18+, Firefox 144+; 90%): good for the
  *settle* / reduced-motion cross-fade, cannot express a tilt-over-target arc.
  https://caniuse.com/view-transitions
- **Sound**: Web Audio contexts start suspended until a gesture — `ctx.resume()` in the
  first pointer handler. A zero-byte synthesised pour: four 80 ms sine blips 200–500 Hz,
  50 ms apart, plus a 400→150 Hz "plop" over 150 ms. https://github.com/vinit-agr/water-sort-game/blob/main/src/hooks/useSound.ts ;
  https://developer.chrome.com/blog/web-audio-autoplay
- **Haptics**: `navigator.vibrate` — Chrome Android yes, **Safari iOS no** (through 26.x);
  feature-detect, treat as a bonus. https://caniuse.com/vibration
- **Reduced motion for a pour**: no lift/tilt/arc; the target outlines briefly; moved
  units cross-fade (≤150 ms); a live region says "Poured 2 blue into tube 7".
  https://web.dev/articles/prefers-reduced-motion ; https://www.smashingmagazine.com/2020/09/design-reduced-motion-sensitivities/
- **Libraries, measured 2026-08-29**: GSAP 3.15 27.8 kB gz, Webflow "no-charge" licence
  (not OSI) https://gsap.com/licensing/ ; anime.js 4.5 42.7 kB gz MIT; `motion/mini`
  2.3 kB MIT (a WAAPI wrapper — the only one small enough to ever justify); PixiJS 8
  231 kB gz; dotLottie 33 kB + 498 kB wasm; Rive 87 kB + 314 kB wasm. None needed.

## Verified assumptions (2026-08-29)

- Color Sort is **not** on the game frame: `src/games/color-sort/color-sort.ts` on
  `main@05a9177` renders `.sol-controls` inline and does not import `game-frame`; the
  `claude/game-frame` worktree carries no diff to it. Item 19 of the frame plan is open.
- The daily pack: 365 entries, n=10, k=2, par min/median/max = 25/32/42
  (`games/color-sort/daily-pack.json`).
- Endless ramp: `colors_for` L1–3 = 4 colours … L80+ = 12 (`crates/color-sort-core/src/lib.rs:43`).
- Local stats today: `color-sort/stats` = `{solved, strictSolved, streak, maxStreak,
  lastDay}` (dailies only) and `color-sort/endless.bestLevel`. No "levels solved" count
  exists yet — C adds it.
- No sign-in anywhere on the shelf: `grep -ri "oauth\|signin\|login" src/` is empty.
  `package.json` has one runtime dependency (`@mlc-ai/web-llm`); no CSP `<meta>` in
  `build.mjs`.
- croft-pwa reference sizes: `src/signin/` 217 lines (providers.json/ts + sheet.ts),
  `src/atproto/oauth/` 675 lines (client, dpop, jose, pkce, resolve).
- At 390px the board is `--cs-cols: 6; --cs-tw: 2.7rem` → 12 tubes in two rows at
  ≈43 px wide; `MOBILE-FIRST.md`'s tap floor is 44 px.

## Phases (sketch — filled in after the decision round)

- **P0** this doc → decisions settled → `mocks/e-color-sort.html` v1 (MOCKS.md: version
  meta, baseline sha, Current beside Proposed, phone 390×844 + desktop).
- **A1–A3** frame migration (RED: the stability spec on the deadlock trigger, measured
  on the unmigrated page first — the frame plan's Pass-3 recipe).
- **B1–B4** the pour: WAAPI sequence behind a `pour()` seam the e2e can collapse
  (`?fast=1`, as cribbage/othello do); per-skin variants; speed preference + reduced
  motion; sound.
- **C1–C2** `played` in the record; the setup card's Daily row and its gate; poster chip.
- **D1–D4** (own PR) provider registry + sheet in the shelf header; OAuth client; the
  `ing.croft.fun.*` lexicon investigation (LEXICONS.md act 1) → record; stats sync.
- Every phase: guide shots regenerated, `npm run gate`, CHANGELOG `[Unreleased]` entry.

## Review Log

- 2026-08-29 — drafted from two research sweeps + code reading; decisions D1–D12 open.
