# Bubble shooter — the shelf's build-fresh candidate for a fourth game

**Status:** 📋 **DRAFT (Pass 1) 2026-07-30.** Not started. A build slice for a
build-fresh, determinism-first bubble shooter (Puzzle Bobble / Bust-a-Move
mechanic; **Frozen Bubble** is the open-source homage, not a code dependency).
Scoped to slot in alongside/ahead of cribbage because it is **single-player and
ungated** — no P2P transport, no fair-reveal. Origin: the client-side/static
games catalog (`discovery/alpha/thinking/app/ponds/client-side-static-game-candidates.md`),
one of the two candidates the owner extracted (the other is the Tux Racer wrap
spike, `2026-07-30-tux-racer-wrap-spike.md`).

---

## Problem Statement

`fun.croft.ing` has two shipped games (solitaire, match-3) built on a proven
recipe: a determinism-first Rust core → wasm, a verifiable outcome via
move-list-replay → `state_hash`, tap-first input where the core decides
legality, WCAG-AA identity, a How-to guide. Cribbage is next on the shelf but is
**gated** on unbuilt infrastructure (P2P transport + a fair-reveal primitive),
so the shelf cannot grow again without either building that infrastructure or
finding an ungated game.

A **bubble shooter** is the cleanest ungated candidate: its mechanic is a member
of the match-family we already have a core discipline for, it is single-player,
and it produces a naturally verifiable outcome (a score / cleared-board reached
by replaying a sequence of shots). There is no shipped bubble-shooter core; the
board geometry (a staggered hex grid, aim-and-snap ballistics, connected-cluster
pop, floating-cluster drop) is new determinism-critical code.

Goal: `/bubble/` is a real, verifiable, accessible game meeting every standard in
`docs/BUILDING-GAMES.md`, built fresh so its license is clean.

## Approach

Follow the match-3 recipe end to end (`plans/2026-07-30-match3-playable.md` is
the closest reference), adapted to bubble-shooter geometry:

```
bubble-core (Rust)                        bubble-wasm (raw C-ABI + serde-JSON)
  ├─ hex grid (staggered rows)              holds Game + shot list
  ├─ deterministic deal(seed)               new_game · board_json · aim exports
  ├─ aim → snap-to-cell ballistics          shoot(cell) · current_hash · score
  ├─ connected same-colour pop (≥3)         moves_left · is_won · outcome_json
  ├─ floating-cluster drop                  never panics
  ├─ score + state_hash                            │
  └─ golden vectors + RULES.md                     ▼
                                          bubble.ts (typed TS wrapper)
                                                   │
                                          board UI (tap a target cell →
                                          core computes the shot; legal
                                          targets glow) → verifiable
                                          score/cleared record + ?r= share
```

The determinism-critical decision is **making aiming tap-first and
core-decided**, not a free-aim analog drag. The player **taps a target cell**;
the core computes whether a shot from the launcher can reach that cell and what
it hits (the launcher colour is fixed for the turn). Legal target cells **glow**
(exactly the shelf's core-decides-legality floor). This keeps the move-list a
clean sequence of `(target_cell)` — or `(angle_bucket)` if we quantise aim into
a fixed set of discrete angles — so replay → `state_hash` is exact and the
native==wasm cross-build test holds. A free continuous aim would make the core
non-deterministic across builds and break verification; we do not do that.

**Objective (owner decision needed — see below):** the match-3 precedent is
target-score-in-N-moves graded to 0–3 stars with flat thresholds, avoiding a
solver. A bubble shooter can instead be **clear-the-board-in-N-shots** (a
finite, deal-shaped board, win = board empty, graded by shots-remaining), which
is the more native bubble-shooter objective and is also solver-free. Defaulting
to clear-the-board; flagged as the one balance decision to confirm.

## Reasoning / decisions

- **Build fresh, do not port Frozen Bubble.** Frozen Bubble's engine is
  GPL-lineage (Perl original; various ports) and its art (the penguin, the
  bubbles) is GPL / CC-BY-SA. Porting would entangle the shelf in those licenses
  and its outcome-record loop would be bolted on rather than native. Building
  fresh keeps the license clean and the verifiable outcome native — the same
  call we made for match-3. Frozen Bubble / Puzzle Bobble are **homage and
  reference**, credited, not dependencies.
- **Quantise aim so the core stays deterministic.** Continuous physics aiming is
  the enemy of a cross-build `state_hash`. Tap-a-target (or a discrete angle
  bucket) makes every shot a small integer, replayable exactly. This also *is*
  the tap-first accessibility floor, so the constraint and the standard agree.
- **Single-player, ungated.** No P2P, no fair-reveal, no winnable-pack solver.
  This is why it can proceed in parallel with other work — it reuses only what
  is already shipped (`pond-docformat`, `pond-outcome`, the drawer chrome, the
  settings + how-to standards).
- **Reuse `pond-outcome` as-is where possible.** match-3 already extended the
  record with optional `score`/`stars` and added `Outcome::Lost`. A
  clear-the-board objective needs win (board empty) + a shots-used count; that
  fits the existing additive fields. Confirm during M2 whether any new field is
  needed (aim: none).
- **Colour-blind-safe tokens.** match-3 established 6 shape+colour gem tokens in
  `tokens.css`. Bubbles reuse the same shape+colour discipline (a bubble carries
  both a hue and a glyph), AA in both themes.

## Phases (TDD-first; each phase red before green)

- **B1 — core: geometry + deal.** `bubble-core` crate + `RULES.md` +
  golden-vector corpus. Staggered hex grid; `deal(seed, rows, cols, colors) ->
  Board` (a settled starting board with a solvable-looking layout — v1 does not
  need a guaranteed-winnable solver, mirroring match-3's flat-threshold call);
  cell adjacency (6-neighbour). Red-first; a golden vector pins a seed's deal.
- **B2 — core: shot resolution + scoring.** `legal_targets(board, launcher)` (the
  cells a shot can reach), `shoot(board, target) -> Outcome` (place, then pop
  connected same-colour ≥3, then drop floating clusters), `score`, `state_hash`,
  `is_cleared`, `shots_left`. Golden vectors pin a full game's replay → hash.
  Native==wasm cross-build test (the `xbuild` pattern) green.
- **B3 — pond-outcome fit.** Confirm the clear-the-board outcome maps onto the
  existing `Record`/`Outcome` (win = cleared; `Outcome::Lost` = shots out,
  board not empty; `score`/`shots_used`). Extend **only if** a field is genuinely
  missing, additively, leaving solitaire + match-3 green. `verify` re-replays
  `(seed, shots)` and re-hashes — never trusts a stored field.
- **B4 — bubble-wasm binding + TS wrapper.** Raw C-ABI + serde-JSON holding Game
  + shot list: `new_game`, `board_json`, `legal_targets_json`, `shoot(cell)`,
  `score`, `shots_left`, `current_hash`, `is_cleared`, `outcome_json`. Never
  panics. `build:wasm` builds it; `build.mjs` serves `/bubble.wasm`. Typed
  `src/games/bubble-wasm.ts` wrapper; UI never re-implements rules.
- **B5 — board UI (`bubble.ts`).** Hex board render (bubble tokens, AA both
  themes), a launcher showing the current + next colour, **tap a target cell →
  core-driven legal-target glow → `shoot`**, pop/drop animation on re-render,
  score / shots-left HUD, board-cleared (or shots-out) → **verification-forward**
  result screen (record + re-verify + deflated `?r=` share that re-verifies on
  open), daily (date-seed) + free-play (`?seed=`), hints (point at a good legal
  target; counts as assistance) + shared settings; hints-off → "I'm stuck" ends
  + reports honestly.
- **B6 — guide, registry, tests, deploy.** `bubble-howto.ts` (pure-data blocks,
  lead with the tap-to-aim interaction model) + how-to registry + `guide:shots`;
  add a `bubble` registry entry, `status: "playable"`, `load` factory + own
  `/bubble/` URL; unit + e2e (shot mechanics, a clear-the-board win, illegal-tap
  = no change guardrail, share round-trip, axe both themes, 360px fit);
  README / BUILDING-GAMES / `TODO/bubble.md` updates; full gate + deploy.

## Definition of done

A stranger opens `/bubble/`, gets the daily deal, taps target cells to aim
(legal targets glow; the core decides reachability), pops connected clusters and
watches floating clusters drop, and on board-clear (or shots-out) sees a
**verifiable** record with re-verify + share. Free-play + `?seed=` + hints +
settings + a How-to-play guide all work. Gate green (Rust `cargo test
--workspace` + fmt + clippy; vitest + Playwright incl. axe both themes);
committed + pushed + deployed to `fun.croft.ing`.

## Owner decision to confirm before B1

- **Objective:** clear-the-board-in-N-shots (default, most native) **vs**
  target-score-in-N-shots-with-stars (match-3-consistent). This changes B3's
  outcome mapping and B5's HUD/result screen.

## Not in this slice

Free continuous aim / bank-shot-off-walls trajectory preview (a fast-follow that
must not break the quantised-aim `state_hash`); a guaranteed-winnable daily-pack
solver; multiplayer / versus (that is a P2P-pond item, gated like cribbage);
specials (bomb bubble, rainbow bubble); drag-to-aim (tap is the floor).
