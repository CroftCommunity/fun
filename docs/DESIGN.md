# fun.croft.ing — design system

The games pond's own **playful identity**, built on the same token architecture
as croft-pwa (see that repo's `docs/DESIGN.md`) so the two read as one family.
Front-plan Phase 2 / delivery-plan Phase E.

## Two identities, one app (since M4)

The shelf ships **two families**, chosen from Settings, with the ☾/☀ control
picking the side within whichever is active:

- **Gallery of Worlds** (default) — a near-black gallery ground so the boards and
  the art are the only lit things on screen. Prefers the *today-first* home.
- **The Pond** — warm paper, hairline rules, an umber accent and a serif display
  face; the chrome contributes no colour of its own. Prefers the *shelf* home.

`prefersLayout` is a **suggestion**, not a lock: the reader's explicit choice wins
in both directions (`src/shelf.ts`). And a skin reaches **chrome roles only** —
board surfaces and every per-game palette are game-owned and untouchable
(`docs/adr/0001-chrome-and-game-tokens.md`), so a board looks the same under
every skin and is graded once rather than four times.

The card-table description below is the **origin** of the token roles and is kept
because the roles still mean what it says they mean. It is no longer the only
identity the shelf wears.

## The idea it started from: a card table in the Croft family

Croft's core identity is a "tectonic" stone palette (schist, granite, oatmeal,
ruddy orange, moss). The games pond keeps the *roles* but re-casts them as a
**card table**:

- a green **felt** play surface — kin to Croft's Dark Moss, saturated so it
  reads as a table;
- warm **ivory cards** (the oatmeal canvas), with classic **red/black suits**;
- a **brass-gold** accent for actions and legal-move highlighting;
- a brighter **moss** for the verifiable win / success;
- a **rust** for a failed verification.

The whole thing has a light and a dark theme — "the same table by a sunny
window" and "the same table at night."

## Token discipline

`tokens.css` is the **only** file allowed to contain raw hex. Components
(`styles.css`) and app code reference the semantic custom properties via
`var()`, never a literal colour. Enforced by `tests/tokens.test.ts`
(`no raw hex in styles.css`). New colours are added to `tokens.css` **with a
recorded WCAG contrast ratio**, never invented inline.

Every text/UI pair below clears **WCAG AA** — ≥4.5:1 for body text, ≥3:1 for
large text and UI indicators — in **both** themes. The ratios are recomputed
from `tokens.css` by `tests/tokens.test.ts`, so a future colour tweak that
breaks a floor fails the gate rather than shipping an illegible surface, and
`tests/theme.spec.ts` runs axe against the live home page and the solitaire
board in **both** themes.

### Semantic roles

| Token | Role |
|-------|------|
| `--bg` / `--surface` | page background / raised UI panels (header, drawer, buttons, result card) |
| `--ink` / `--ink-muted` | primary text / captions, the move counter, status |
| `--accent` / `--accent-ink` | brass-gold primary-action fill; legal-target glow; card-back weave |
| `--active` / `--active-ink` | moss — the verifiable win, the "Verified ✓" badge |
| `--danger` / `--danger-ink` | rust — a failed verification |
| `--link` | body-text link (moss) |
| `--felt` / `--felt-ink` | the board play surface and its on-felt labels/hints |
| `--card` / `--suit-red` / `--suit-black` | playing-card face and its two suit colours |
| `--focus` | keyboard focus ring |
| `--border` | hairline dividers (decorative, non-text) |

### Recorded contrast (all four skins must clear the floor)

Since M4 the columns are **skins**, not themes. Two families — Gallery of Worlds
and The Pond — each ship both palettes as first-class, so the ☾/☀ control is
never a dead button. `tests/tokens.test.ts` iterates the registry, so a new skin
is graded the moment it is added.

| Pair | Floor | Worlds day | Worlds night | Pond day | Pond night |
|------|------|------|------|------|------|
| `ink` on `bg` | 4.5 | 15.02 | 17.68 | 15.69 | 15.76 |
| `ink-muted` on `bg` | 4.5 | 5.36 | 7.46 | 5.30 | 6.04 |
| `ink` on `surface` | 4.5 | 17.11 | 16.15 | 17.08 | 14.58 |
| `link` on `bg` | 4.5 | 5.57 | 10.92 | 5.73 | 10.39 |
| `accent-ink` on `accent` | 4.5 | 6.75 | 9.54 | 5.72 | 8.62 |
| `active-ink` on `active` | 4.5 | 5.94 | 9.39 | 6.14 | 8.11 |
| `danger-ink` on `danger` | 4.5 | 6.95 | 8.16 | 7.18 | 7.05 |
| `danger` on `surface` | 4.5 | 7.43 | 7.65 | 7.30 | 6.53 |
| `active` on `bg` | 4.5 | 5.57 | 9.39 | 5.73 | 8.11 |
| `active` on `surface` | 4.5 | 6.34 | 8.57 | 6.24 | 7.51 |
| `suit-red` on `card` | 4.5 | 6.41 | 5.92 | 6.41 | 5.92 |
| `suit-black` on `card` | 4.5 | 15.47 | 13.07 | 15.47 | 13.07 |
| `felt-ink` on `felt` | 3 | 6.91 | 9.58 | 6.91 | 9.58 |
| `focus` on `bg` | 3 | 5.57 | 9.78 | 5.34 | 8.62 |

(These are the asserted numbers; the exact values live in `tokens.css`.)

The last two rows arrived with the home page (M3) and are a caution worth
keeping: `--accent` was used the same way first — as a group label on the page —
and axe caught it at **2.13:1** in light. `--accent` is a **fill** role; its
recorded pair is `accent-ink` on `accent`, and nothing licensed it as text. A
colour that is legible in one palette and illegal in the other is exactly what
grading each palette on its own terms exists to catch.

Since M2 the columns are **skins**, not themes: light and dark are registry
entries (`src/skins.ts`), and `tests/tokens.test.ts` iterates the registry, so a
new skin is graded the moment it is added.

## Theme mechanics

- **Two states only** (light/dark), no "auto" — a one-tap toggle that silently
  matched the system read as a no-op (lesson carried from croft-pwa).
- `resolveTheme(stored, prefersDark)` (`src/theme.ts`) is a pure function: an
  explicit stored choice wins, otherwise follow the OS. Unit-tested.
- **No flash of the wrong theme:** a tiny inline `<head>` script (`build.mjs`
  `THEME_INIT`, byte-identical rule to `resolveTheme`) sets `[data-theme]` before
  the stylesheet loads and first paint.
- The **header toggle** (`☾`/`☀`) flips and persists via `toggleTheme()`, and
  keeps the browser/manifest `theme-color` in sync (the felt green).

## Cards, felt, and highlighting

- **Cards** are `--card` ivory with `--suit-red` / `--suit-black` glyphs; they
  stay light in both themes, as real playing cards do.
- **Card backs and a stacked stock** use a brass-on-felt diagonal weave; the
  stock's count rides a solid `--surface` chip so it stays legible over the
  weave.
- **Empty placeholders** (foundations, empty piles) are dashed `--felt-ink`
  outlines cut into the felt, with muted suit hints.
- **Legal targets glow** with a brass ring (`--accent`); the **selected** source
  carries a `--focus` outline. The glow is driven entirely by the core's
  `legalMoves()` — the palette only renders the decision.

## Type

Body/UI is the system UI stack. `--font-display` is **Fredoka** (SIL OFL),
**self-hosted** — a latin-subset `woff2` at `assets/fonts/fredoka-600.woff2`
(weight 600, `font-display: swap`, license in `assets/fonts/Fredoka-OFL.txt`),
so it stays offline and dependency-free with a system rounded fallback. Used for
the result-screen headline and the how-to guide headings. The mono stack carries
the verifiable `final_hash`.

## Not in this phase

- Match-3 / cribbage board styling (those games arrive later and reuse these
  tokens).
