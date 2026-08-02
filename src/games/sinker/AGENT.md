# Sinker — agent handoff

A dig-a-path physics puzzle for **fun.croft.ing**. You carve tunnels through
sand with your finger; a **ping pong ball** falls under gravity; you win by
landing it **in** a red party cup or balancing it **on** a shot glass. This
doc is the map for whoever picks the game up next — what it is, how it works,
why it's built the way it is, and where the sharp edges are.

Deliverable is a **single self-contained file**: [`sinker.html`](./sinker.html).
No dependencies, no build step. It is intended to be uploaded to a static site
as-is. It is **not** currently wired into the shelf drawer / `build.mjs`
`GAME_PAGES` (see "Status & next steps").

## The pitch

Homage to the "dig a path to the cup" genre. Backyard-party skin: sandy dirt
with a grass lip, plywood boards, a red cup with a white rim, a shot glass.
Party-toned but plain copy: **SUNK!** (cup), **BALANCED!** (shot),
**NICE HANDS** (finish all levels). Do **not** reference the genre's
best-known commercial title, its art, or its level designs anywhere in code or
comments (there is an acceptance check for the literal string).

## Architecture (one screen)

Everything lives in `sinker.html` between `<script>…</script>`. Two synchronized
representations of the world:

- **Visual terrain** — an offscreen 480×960 canvas (`terrain`/`tctx`). Sand is
  painted from `skyY` down: wavy strata bands + speckles clipped with
  `source-atop`, then a grass fringe when `skyY > 0`.
- **Collision grid** — `solid = Uint8Array(480*960)`, `1` = sand.
  `isSolid(x,y)` is a grid lookup; **out of bounds counts as solid**.

`carve(x,y,r)` erases a circle from **both** (canvas via `destination-out`,
grid via a bounding-box loop). Dig radius is **24**. Pointer drags interpolate
stamps every **6 px** so fast swipes leave no gaps. Digging uses pointer
capture and is disabled while the win overlay is up.

Logical playfield is **480×960**, uniformly scaled/letterboxed to the viewport;
**all game math is in logical units**. `toGame(e)` maps client → logical via the
canvas rect and `scale`. Render order each frame: sky fill → terrain (with a
soft drop shadow so tunnels look carved) → boards → cup/glass → rocks → ball →
confetti. HUD is DOM on top.

## Physics — the important part

Fixed-substep integration: **3 substeps/frame**, `dt` capped at `1/30`.
`stepBody(b, dt)` does gravity, air drag, a max-speed clamp, integration,
playfield-wall bounces, then collisions.

- `G = 2300`, `MAXV = 1500`.
- **Air drag**: each substep `v *= (1 - 0.35*h)`. Ping pong balls visibly slow
  in air; this also tames runaway speed.
- **Per-body restitution** (`b.rest`), not a global constant: **ball 0.42**,
  **rock 0.10**. Rocks are `mass 6` (barely move when the light ball hits them).
- **Terrain collision** (`collideTerrain`): 20-point circle sampling against the
  grid, averaged push-out normal, `1 + b.rest` restitution, light rolling
  friction (`*0.992`). Fully-buried balls get pushed up.
- **Segment colliders** (`collideSeg`): closest-point on a segment, restitution
  passed per call — **boards 0.55**, **party cup walls 0.15**, **shot rim posts
  0.05** (the rim barely bounces so the ball settles and self-centers).

Tuning target (verify by feel, not by matching constants): a **300 px drop onto
flat sand bounces 2–3 times** before settling.

### ⚠️ Engine quirks you must design around

These are load-bearing facts about this collision model. Ignore them and your
levels will be unwinnable.

1. **Balls do not slide down board slopes — they rest on them.** The velocity
   damping in `collideSeg` acts like static friction, so a ball placed on an
   angled *board* comes to rest instead of sliding to the far end. Never design
   a level that needs the ball to *ride a board* to reach a gap/goal.
2. **A ball will not traverse horizontally along a flat board top.** No
   horizontal drive exists; it perches near the board edge and stops just short
   of a distant gap. (This is why the original flat-shelf "Switchback" layout
   broke under the bouncier retune.)
3. **Segment endpoints are sticky.** A slow ball near a board's *end* gets
   pushed radially back onto the board and oscillates rather than launching off.
   Don't rely on a ball cleanly flying off a ramp tip.
4. **What *does* move a ball sideways reliably:** (a) **falling through a
   down-sloped *sand* channel** the player carves, and (b) **an angled board
   deflecting a *falling* ball** toward a gap/corner (the "funnel" — the ball is
   always moving, never resting). L2/L4/L7 all use the funnel; L3/L8 use sloped
   sand channels.

## Cups and win rules

Exactly one goal per level: `cup: { type, x, y }`.

- **`party`** (red cup, ball falls IN): invisible colliders are two
  inward-slanting side walls + a base (`goalWalls`). Win: `|ball.x-cup.x| < 20`,
  ball.y within the basin band (`cup.y-22 … cup.y+14`), **speed < 300**, and no
  rock in the basin (`cupBlocked()` — rocks can plug a party cup and block the
  win while seated). The band's upper reach is `-22` (not `-16`) so a single
  centered channel that leaves the ball perched at the mouth still counts — the
  tutorial must be forgiving of one dig.
- **`shot`** (glass, ball settles ON TOP): a 32 px ball is wider than the ~30 px
  mouth, so it can't fall in. Colliders are two short vertical **rim posts**
  (`goalPosts`, at `x ± 15`, tops raised 4 px above `cup.y` so the ball nestles
  with its bottom right at rim height). Win: `|ball.x-cup.x| < 10`, ball bottom
  within 8 px of `cup.y`, and **speed < 40 held continuously for 600 ms**
  (`settleTimer`, in ms; any faster frame resets it). A near miss (at rest,
  below the rim, not seated) toasts `Missed the rim — tap ↺` **once** and does
  **not** auto-restart.

To seat on a shot glass the player must clear the sand **down to the rim** so
the posts protrude into air — stopping short leaves the ball resting on a sand
shelf above the glass.

## Level format & the 8 levels

```js
{ name, skyY,                 // skyY 0 = fully buried
  ball:[x,y], cup:{type,x,y},
  barriers:[[x1,y1,x2,y2],…], // plywood boards, undiggable
  pockets:[[x,y,r],…],        // pre-carved air bubbles
  rocks:[[x,y,r],…],
  tip }                       // one-line toast at level start
```

1. **First dig** — party. Tutorial straight drop.
2. **The funnel** — party. Two angled boards, drop through the gap.
3. **Sidestep** — party, buried. Through the gap, then a sloped sand channel back.
4. **Switchback** — party, buried. **Angled-board funnel** → long S into the
   bottom-left corner cup. (Reworked from the reference's flat shelves, which the
   retuned ball couldn't traverse — see quirks #1/#2.)
5. **Rock plug** — party + rock. The rock can plug the cup; dig around it.
6. **On the rocks** — first **shot glass** on a full-width board; gentle drop
   teaches the balance.
7. **Bank shot** — party. **Mirror of L4's funnel** to the bottom-right corner:
   straight down just lands the ball on the deflector, so you must bank off the
   boards. (Originally a ramp/overhang design; scrapped — quirks #1/#3.)
8. **Last call** — shot glass finale: gap on the left, glass centered on the
   floor board, plus a rock hazard.

**Winnability principle:** because the player controls the terrain, a level is
winnable iff a continuous *sand* path exists from ball to goal that respects the
undiggable boards, and the goal can be reached at the required speed. Keep gaps
≥ ~2.5 ball diameters (80 px) except where tightness is the puzzle.

## Verifying changes

There is no unit test harness for the canvas — validate behaviorally, headfully.
The environment has Chromium at
`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`; drive it with Playwright
(installed on demand via `npm install @playwright/test --no-save`). Useful moves:

- The `<script>` runs in classic global scope, so `ball`, `rocks`, `cup`,
  `carve()`, `checkWin()`, `cupBlocked()`, `loadLevel()`, `LEVELS`, `state`, and
  `settleTimer` are all reachable from `page.evaluate` — set state and call the
  win logic directly for deterministic rule checks.
- To prove a level winnable without a skilled solver, carve a clean wide
  corridor with the exposed `carve()` and drop the ball. **Route the ball with
  *steep* sloped sand or let boards deflect it — never expect it to ride/traverse
  a board** (quirks above), and for shot levels carve all the way down to the rim.
- Seed `localStorage['sinker.level']` and reload to jump to / resume a level.

**Acceptance checklist** (run before calling any change done): `node --check`
on the extracted script; no console errors; L1 winnable in <15 s with one
channel; a 300 px drop shows 2–3 bounces; the shot win needs the 600 ms settle
and a fast rim hit does not false-win; the L5 rock plugs the cup and blocks the
win; refresh resumes the saved level; and **no occurrence of the genre's
commercial title** anywhere in the file.

## Status & next steps

- **Standalone only.** Not registered in `build.mjs` `GAME_PAGES`, no
  `/sinker/` route, no drawer entry, no how-to guide/shots. Wiring it into the
  shelf (and adding how-to copy + `guide:shots`) is the obvious follow-up if the
  owner wants it on the pond rather than hosted on its own.
- **Deferred (intentionally, TODOs in the file):** falling wooden planks as free
  rigid bodies (needs rotation — consider planck.js and accept the dependency
  then); sound (dig scrape, boing, sink plunk); bounce-count par scoring + a
  level editor that exports the level JSON.
- **If you touch the physics feel or geometry:** re-run the whole acceptance
  checklist. The two shot levels (6, 8) and the two funnel levels (4, 7) are the
  most sensitive to restitution/drag changes — a retune that helps one class can
  silently break the other.
