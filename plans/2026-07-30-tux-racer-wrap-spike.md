# Tux Racer wrap — a scoping spike (does a vendored arcade game belong on the shelf?)

**Status:** 📋 **DRAFT (Pass 1) 2026-07-30.** Not started. A **bounded spike**,
not a build. **Charter decision made by the owner 2026-07-30: widen the shelf to
two tiers** — Tier 1 Croft-native (build-fresh, determinism-first, verifiable)
and **Tier 2 opportunistic wrap/port** (already-packaged, ethical, static games,
taken as-is, with no verifiable record). So this spike is no longer "should we
widen?" — it is the **Tier-2 pathfinder**: TuxRacer.js (a WebGL rewrite of
Extreme Tux Racer) is the first Tier-2 candidate, and the spike (a) go/no-go
gates it on the Tier-2 inclusion filter — client-side/static, non-extractive,
redistribution-licensed, mountable, honestly represented — and (b) establishes
the wrap path + the honest-representation standard the tier needs. Its output is
a recommendation + evidence, not a shipped game. Origin: the client-side/static
games catalog
(`discovery/alpha/thinking/app/ponds/client-side-static-game-candidates.md`),
one of the two candidates the owner extracted (the other — the ungated
build-fresh bubble shooter — is `2026-07-30-bubble-shooter.md`). The charter
decision (widen to two tiers) is recorded as **COHESION §62** in discovery.

---

## Problem Statement

Every shipped shelf game satisfies the same charter (`docs/BUILDING-GAMES.md`):
determinism-first Rust core → wasm, a **verifiable outcome** via
move-list-replay → `state_hash`, tap-first with the core deciding legality, a
tiny bundle, non-extractive. The owner wants to consider pulling in a
**preexisting web game** (TuxRacer.js) and fitting it to our UI/UX — the "wrap"
integration path from the catalog.

TuxRacer.js does **not** satisfy that charter and cannot be made to without
rewriting it:

1. **No verifiable outcome.** It is real-time 3D physics; a run is not a small
   replayable move-list and its result is not a cross-build-stable `state_hash`.
   The pond's central property (a shared result is re-verified, not trusted)
   does not apply.
2. **Not tap-first / core-decides-legality.** Input is keyboard / touch-joystick
   steering; there is no "legal move glow" model.
3. **Bundle weight.** 3D models, textures, and audio are far larger than the
   shelf's "instant-start, tiny-bundle" bar.
4. **Third-party code + assets under their own license.** We would vendor and
   redistribute someone else's engine and art — license is a first-class gate in
   our games values and is currently **`[UNVERIFIED]`** for this port.

Wrapping TuxRacer.js is not a "next game" on the Tier-1 recipe — it is the
**first Tier-2 game**. The owner has decided the shelf admits Tier 2 (ethical
wraps/ports, taken as-is). What is still unknown is (a) whether *this* candidate
passes the Tier-2 inclusion filter — its license/redistribution status and
bundle weight are `[UNVERIFIED]` — and (b) how a non-verifiable wrapped game is
hosted and represented honestly on a shelf whose other games carry verifiable
records. This spike answers both before any full build, so the wrap path is
established deliberately rather than smuggled in under one game.

## Approach

A short, time-boxed investigation producing a written recommendation. It does
**not** ship a game and does **not** flip a registry entry to `playable`. It may
produce a throwaway proof-of-mount behind a `status: "experimental"` (or an
un-listed) entry purely to observe integration, discarded or left clearly marked.

```
   Spike questions                          Evidence produced
   ───────────────                          ─────────────────
1. License / assets  ────────────────────►  a LICENSE-FINDINGS note:
   (redistribution-safe?)                     engine + asset licenses, verified
                                              against the actual repo, not memory
2. Bundle weight     ────────────────────►  measured MB (code + assets), vs the
   (fits instant-start?)                      shelf budget; lazy-load feasibility
3. Containment +     ────────────────────►  a real-browser (Playwright) harness:
   legibility                                 stays in its mount, NO egress outside
   (proven, not                               an allowlist, no host bleed, clean
    assumed)                                   unmount; renders + reads as our game
                                              in all 3 chrome modes; no focus trap
4. Charter coherence ────────────────────►  how a non-verifiable game reads on a
   (mixed shelf?)                             verifiable-outcome shelf: registry
                                              representation, how-to, the "no
                                              verifiable record" honesty note
5. A11y / input      ────────────────────►  keyboard + touch reality; can it meet
                                              any of the a11y floor, or is it an
                                              explicit exception?
```

## Reasoning / decisions

- **A spike, not a build — because this candidate's gates and the tier's
  standard are unmade, even though the charter is.** The charter (admit Tier 2)
  is decided; what is not is whether TuxRacer.js clears the inclusion filter and
  what the wrap path/honest-representation standard is. Building first would
  smuggle both in under a feature. The honest order is: evidence + standard →
  *then* a full wrap plan if this candidate passes.
- **License is the first gate, and it is unverified.** Extreme Tux Racer (the C++
  original) is commonly GPL-2.0, but TuxRacer.js's own license and its bundled
  asset licenses are `[UNVERIFIED]` and Gemini-sourced (repo attributed as
  `ebbejan/tux-racer-js`, itch.io publisher `0x00EB` — both to be confirmed
  against the real repo). If redistribution is not clearly permitted, the spike
  ends here with a "no" and the rest is moot.
- **The drawer contract is probably sufficient to host it, and that is the
  interesting finding.** `GameModule` is deliberately chrome-agnostic
  (`mount(container)` / `unmount()`); a wrapped game can mount an iframe or its
  own canvas without the shelf knowing it is not verifiable. Confirming this
  cheaply is most of the integration answer — the hard part is not "can it
  mount" but "should a non-verifiable game share the shelf."
- **Keep the shelf's honesty intact either way.** If a wrapped game ships, it
  must not *look* like it has a verifiable outcome when it does not. The spike
  proposes how the registry / game page / how-to signal "this is a wrapped
  arcade game, no verifiable record" so the pond property stays truthful.
- **This does not block the bubble shooter.** The two are independent; the
  bubble shooter is Tier-1, ungated, build-fresh, and proceeds regardless of
  this candidate's outcome.

## Spike tasks (time-boxed)

- **T1 — License + provenance.** Find the real TuxRacer.js repo; record the
  engine license and every bundled-asset license; determine whether we may
  vendor + redistribute (and under what attribution/copyleft obligations). Write
  `LICENSE-FINDINGS`. **Gate: if not redistribution-safe, stop — recommend "no."**
- **T2 — Bundle weight.** Build (or fetch) the static bundle; measure code +
  asset MB; assess lazy-load / on-demand-fetch feasibility against the shelf's
  instant-start bar. (Note the existing `croft-pwa/content-fetch` pattern as a
  possible lazy-asset precedent.)
- **T3 — Contract-fit + a real in-browser containment/legibility harness.** An
  off-the-shelf WASM bundle is **untrusted third-party code running in our
  chrome**, so contract-fit is not "does it mount" — it is *proven in a real
  browser* that it stays contained, coexists with our UI/UX, and is legible.
  Stand up a throwaway `GameModule` mounting TuxRacer.js (iframe-with-`sandbox`
  first; canvas only if containment holds) in the drawer, full-screen, and a
  standalone `/tux/`-style URL. Drive it with **Playwright** (the Chrome
  extension is disabled in this workspace — Playwright is the browser-driver, per
  the top-level `.claude` note) across three assertion dimensions:

  - **Containment** — it cannot escape its mount or affect the host. Assert: no
    top-window navigation / no breaking out of the iframe; **no unexpected
    network egress** (fail on any request outside an explicit allowlist — the
    webxdc Cure53 lesson: CSP alone does not contain a webview, so
    `iframe[sandbox]` + a request-interception allowlist, not trust); no
    `localStorage`/cookie writes to our origin; no global-scope or CSS bleed into
    our chrome (theme tokens, layout); console-error budget.
  - **Legibility** — it reads as *our* game. Assert: renders inside the drawer
    and full-screen without overflow at 360px and desktop; our header/back-chrome
    stays visible and usable; the game is visually distinguishable from our
    verifiable games (the honest-representation banner from T4 is present); axe on
    *our* surrounding chrome stays clean (the embedded canvas is exempt but the
    frame around it is not).
  - **Interaction + lifecycle** — input goes to the game without trapping the
    user. Assert: keyboard/pointer reach the game while focus can still return to
    our chrome (Esc/back works, no focus trap); and **`unmount()` fully tears
    down** — canvas removed, Web Audio context closed, `requestAnimationFrame`
    loops cancelled, event listeners and timers cleared (assert no leaked
    RAF/audio/listeners after unmount + re-mount N times without growth).

  Mark the entry `experimental` / unlisted; do **not** flip anything to
  `playable`. This harness is reusable for **every** Tier-2 candidate, not just
  TuxRacer.js — it is the containment/legibility gate the tier needs.
- **T4 — Charter-coherence proposal + the Tier-2 standard.** Write how a
  non-verifiable game is represented honestly on a verifiable shelf (registry
  field, game-page banner, how-to voice), and draft (not merge) the wrapped-game
  addendum to `BUILDING-GAMES.md` that codifies which Tier-1 standards become
  optional vs required for wraps — with the **T3 containment/legibility harness
  as a required gate** (every Tier-2 game must pass it) in place of the Tier-1
  verifiable-outcome + core-decides-legality standards.
- **T5 — Recommendation.** A short doc: adopt-as-wrap / adopt-with-conditions /
  reject / park *this candidate*, with the T1–T4 evidence. The charter is
  already decided (Tier 2 admitted, COHESION §62); T5 decides TuxRacer.js and
  ratifies the reusable Tier-2 wrap standard.

## Definition of done (of the spike)

A written recommendation with: confirmed license/redistribution status, measured
bundle weight, and a **green Playwright harness** demonstrating (on a throwaway
mount, all three chrome modes) that the game stays **contained** (no egress
outside allowlist, no host bleed, clean teardown), is **legible** in our chrome,
and does not trap the user — plus a concrete honest-representation proposal for a
non-verifiable game on a verifiable shelf. No `playable` registry entry; no
shipped game; nothing committed as a feature. The harness and the standard it
encodes are **reusable for every Tier-2 candidate**. The artifact gates
TuxRacer.js against the Tier-2 inclusion filter and ratifies the reusable Tier-2
wrap standard (charter already decided — COHESION §62).

## Explicitly out of scope

Shipping Tux Racer; a production wrap; multiplayer/versus; porting it to a
verifiable core (that would be a rewrite, not a wrap, and is not the ask); any
ROM/emulator-hosted game (bucket D in the catalog — off-ethic, separate
question).

## What a "yes" unlocks (not this spike)

If the owner widens the charter, a follow-on full wrap plan would cover: vendored
bundle + attribution, lazy asset loading, the honest registry/how-to
representation, the a11y-exception documentation, and the `BUILDING-GAMES.md`
wrapped-game addendum — and would make TuxRacer.js the reference implementation
for the wrap path (as solitaire is for build-fresh).
