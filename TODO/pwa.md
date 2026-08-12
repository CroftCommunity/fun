# PWA / installability — backlog

Not a game — the shelf-wide installability and offline subsystem. Plan:
`plans/2026-08-11-pwa-install-per-game-and-shelf.md`. Standards anchor: none yet —
`croft-pwa/docs/PRACTICES.md` is the reference implementation but **its standards were never
scoped as travelling** (see the open item below).

**State: nothing built.** Verified 2026-08-09 — `fun` has **no manifest, no service worker, and no
registration** anywhere (`src/`, `build.mjs`, `dist/`). The shelf looks like an app and is not one.

## The gate that comes before everything

- [ ] **Verify that distinct `id` values actually produce separate installs under nested scope.**
  Ship exactly **two** manifests (shelf + solitaire), install both on Chromium, confirm two separate
  apps. This is the owner's stated condition ("nested scope is my preference **as long as it
  works**") and it is unverified: `id` resolves against the **origin**, unlike `start_url` and
  `scope` which resolve against the manifest URL — so the intuitive "each manifest gets its
  directory's identity" model may not hold.
  - **If it fails:** stop. Fall back to per-game subdomains (`solitaire.fun.croft.ing`) so no scope
    contains another, and re-plan — that changes DNS, deploy, and the share-URL story. **Do not roll
    out 20 manifests on a hope.**
  - Record the answer in `discovery/alpha/COHESION.md` §69 either way; the corpus has it open.

## Build

- [ ] **Service worker first, install second** (`src/sw.ts` + a pure, unit-tested routing function,
  croft-pwa's `sw-nav.ts` pattern). Chromium will not offer install without a fetch handler, so
  offline is the entry price, not a bonus. Registration failure must be swallowed — a SW bug must
  never blank the shelf.
- [ ] **One worker at `/sw.js`, not 20.** A worker's scope is capped by its own path, so per-game
  workers would mean 20 registrations and 20 caches for one shared `app.js`. Known asymmetry,
  recorded rather than discovered later: an installed *game* app then carries a worker whose scope is
  wider than its manifest scope. Legal; matters only if per-game cache eviction is ever wanted.
- [ ] **Icons at install sizes for all 20 games** (192/512 + maskable safe area). Twenty identical
  tiles on a home screen would make the whole feature pointless. Existing per-game art is
  **unverified** at these sizes — this is likely bigger than it looks, and is sequenced *after* the
  gate so it is not wasted work.
- [ ] Roll out to all 20 via the single `page()` template (`build.mjs:26`) driven by `GAME_PAGES`
  (`build.mjs:16`). Unit test: every entry gets a manifest with a **distinct `id`**. E2E: each page
  links exactly one manifest and it resolves 200. Makes "someone adds game 21 and forgets"
  impossible.
- [ ] Offline e2e: load a game, go offline, reload. Assert `?r=` share links and how-to pages survive
  install (same-origin navigations, so network-first should cover them — assert, don't assume).

## Decisions already made

- **Absolute paths (`scope: "/"`, `"/<game>/"`), matching the rest of the repo.** This is *not* a
  violation of croft-pwa's relative-path rule. That rule exists so one build runs at a domain root
  **and** under a subpath, because croft-pwa really deploys both ways (project page,
  `/pr-preview/pr-N/`). `fun` has neither — one workflow, no preview job, `CNAME fun.croft.ing` — and
  every page it emits already uses `base: "/"` (`build.mjs:243`). **Trigger to revisit:** if `fun`
  ever gains a subpath deploy, the existing absolute *asset* paths break first and the manifest is
  the least of it.
- **Nested scope accepted**, with eyes open: with the shelf installed and a game not, Chromium may
  open `/solitaire/` links in the shelf rather than capturing to the game. For a shelf that contains
  the games this is odd, not broken. It is **Chromium's deployment choice, not the spec** — Safari
  and Firefox have no install prompt or link capturing, so the either/or resolves by construction
  there.

## Open questions (defaults recorded; none blocking)

- [ ] App names — home screens truncate ~12 chars. Default: bare game name as `short_name`,
  `"<Game> · Croft fun"` as `name`.
- [ ] Shelf `start_url` — `/` or the drawer? Default `/` until someone actually uses it.
- [ ] `display` — default `standalone` everywhere; `fullscreen` hides chrome the shelf expects.

## Deliberately not in this subsystem

- **CSP + SRI injection.** croft-pwa does this; whether that standard travels to `fun` is undecided
  (`discovery/alpha/COHESION.md` §69). Not a PWA prerequisite.
- **Adopting relative paths repo-wide.** Bigger change, no current justification.
- **A TWA / any Android packaging.** It would make the shelf capture *all* links — the single choice
  that would actively break per-game install.

## Standing open item (wider than this repo)

- [ ] **Scope each croft-pwa standard as travelling or local.** croft-pwa publishes a chassis, brand
  tokens, mobile-fit, CSP/SRI and a service-worker recipe; `fun` follows none of them. The defect is
  not that `fun` is out of compliance — it is that **the standards never declared their reach**, the
  way the CI convention does. Relative-paths is now settled as **local** (its justification is
  subpath deploys, which only croft-pwa has). The SW and CSP/SRI recipes are **undecided**.
  Tracked in `discovery/alpha/COHESION.md` §69.
