# Tux Racer wrap spike — T1: license + provenance findings

**Task:** the go/no-go gate of `plans/2026-07-30-tux-racer-wrap-spike.md` — is
TuxRacer.js redistribution-safe, and does it clear the Tier-2 inclusion filter's
license leg? Verified 2026-07-30 against the actual repo (not the Gemini
catalog's claims).

## Provenance — CONFIRMED

- Repo **`github.com/ebbejan/tux-racer-js`** is real (the catalog's attribution
  holds). itch.io mirror: `0x00eb.itch.io/tux-racer` (publisher 0x00EB).
- Self-described as "a port / rewrite of *Extreme Tux Racer*, which itself is
  based on the original *Tux Racer* game." Credits the original ETR + Tux Racer
  teams and music/graphics contributors.

## License — GPL-2.0 (redistribution permitted, copyleft obligations)

- README states verbatim: "TuxRacer.js is licensed under the **GNU General
  Public License v2.0**." (Consistent with the ETR/Tux Racer GPL-2.0 lineage.)
- Assets (3D models, textures, audio) are **bundled** in `public/assets`; **no
  separate asset license is stated** in the repo — they inherit from the ETR
  data lineage, which must be confirmed (ETR data has historically been a mix of
  GPL-2.0 and Creative-Commons/free-art terms). **Open item for T2.**

## Fit against the Tier-2 inclusion filter

| Filter leg | Verdict | Note |
|---|---|---|
| 1. Client-side / static | **PASS** | Vite + TypeScript + GLSL; `npm run dev`; no backend server. Builds to static assets. |
| 2. Non-extractive | **LIKELY PASS** | OSS game, no accounts/ads/tracking evident; confirm no telemetry by inspecting the bundle (T2/T3). |
| 3. Redistribution-licensed | **PASS, with obligations** | GPL-2.0 permits redistribution but is **copyleft**: keep TuxRacer.js as a **separate, self-contained, attributed, source-available** vendored bundle (mere aggregation), not relicensed or statically linked into our Rust/wasm. |
| 4. Fits our chrome | **TBD** | T3 (mount in the `GameModule` contract). |
| 5. Honestly represented | **TBD** | T4 (a non-verifiable game on a verifiable shelf). |

## The copyleft wrinkle (flag, per the filter)

The `fun` workspace is **AGPL-3.0-only** (`Cargo.toml`), and TuxRacer.js is
**GPL-2.0-only**. GPL-2.0-only is **not** upward-compatible with GPL-3.0/AGPL-3.0,
so we cannot fold TuxRacer.js into our own copyleft as one combined licensed
work. The clean, honest handling is **aggregation**: vendor TuxRacer.js as its
own directory with its own `LICENSE` (GPL-2.0), a source/upstream pointer, and
preserved credits, served as a standalone artifact behind our chrome. It stays
GPL-2.0; our code stays AGPL-3.0. **Confirm this aggregation reading before any
production wrap** (it is the standard reading, but it is the load-bearing legal
call and belongs to the owner).

## Material NON-license finding — completeness risk

The README says the project is "**in an early development stage and far from
complete**. However, some courses are already functional enough to provide a fun
experience." A Tier-2 shelf game has to be a **good first impression** — an
incomplete port undercuts that. This does not fail T1, but it reshapes the
recommendation:

- **T1 verdict: CONDITIONAL GO.** License permits a redistribution as an
  aggregated GPL-2.0 bundle; nothing here is a hard stop.
- **But reconsider the exemplar.** For the *first* Tier-2 wrap (the one that
  sets the reference pattern), a **complete, permissively-licensed** game is a
  lower-risk pathfinder — e.g. **HexGL** (MIT, complete) or **Sandspiel**
  (Rust+WASM, kindred tech). Recommend continuing the spike (T2 bundle-weight,
  T3 contract-fit, T4 honest-representation) using TuxRacer.js as the *stress
  test* for the copyleft + non-verifiable path, while flagging that the first
  *shipped* Tier-2 game may be a more complete title. This is a candidate call
  for the owner at T5.

## Next in the spike

- **T2** — build the bundle, measure asset MB, resolve the `public/assets`
  license question, scan for any telemetry (filter leg 2).
- **T3** — the **Playwright containment/legibility harness** (owner-elevated to a
  first-class Tier-2 gate): throwaway `GameModule` mount (iframe+`sandbox` first),
  all three chrome modes, asserting no egress outside an allowlist, no host bleed,
  legible-in-our-chrome, no focus trap, and clean `unmount()` (no leaked
  RAF/audio/listeners across re-mounts). Reusable for every Tier-2 candidate.
- **T4** — the honest-representation standard for a non-verifiable Tier-2 game.
- **T5** — adopt/adopt-with-conditions/reject/park TuxRacer.js + ratify the
  reusable Tier-2 wrap standard.

**Sources:** [ebbejan/tux-racer-js](https://github.com/ebbejan/tux-racer-js) ·
[README](https://github.com/ebbejan/tux-racer-js/blob/main/README.md) ·
[TuxRacer.js on itch.io](https://0x00eb.itch.io/tux-racer)
