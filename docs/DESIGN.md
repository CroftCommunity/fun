# fun.croft.ing — design system

The games pond's own **playful identity**, built on the same token architecture
as croft-pwa (see that repo's `docs/DESIGN.md`) so the two read as one family.
Front-plan Phase 2 / delivery-plan Phase E.

## The idea: a card table in the Croft family

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

### Recorded contrast (both must clear the floor)

| Pair | Floor | Light | Dark |
|------|------|-------|------|
| `ink` on `bg` | 4.5 | 14.38 | 16.16 |
| `ink-muted` on `bg` | 4.5 | 5.71 | 7.17 |
| `ink` on `surface` | 4.5 | 15.47 | 14.32 |
| `link` on `bg` | 4.5 | 5.52 | 9.31 |
| `accent-ink` on `accent` | 4.5 | 6.75 | 9.39 |
| `active-ink` on `active` | 4.5 | 5.94 | 5.49 |
| `danger-ink` on `danger` | 4.5 | 6.95 | 5.53 |
| `danger` on `surface` | 4.5 | 6.94 | 4.90 |
| `suit-red` on `card` | 4.5 | 6.41 | 5.92 |
| `suit-black` on `card` | 4.5 | 15.47 | 13.07 |
| `felt-ink` on `felt` | 3 | 6.91 | 9.58 |
| `focus` on `bg` | 3 | 5.52 | 9.39 |

(These are the asserted numbers; the exact values live in `tokens.css`.)

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

Body/UI is the system UI stack. `--font-display` names playful rounded faces
(Fredoka / Baloo 2) with a system fallback and is used for the result-screen
headline; a self-hosted display webfont is a future enhancement (kept out of
this phase to stay offline and dependency-free). The mono stack carries the
verifiable `final_hash`.

## Not in this phase

- A self-hosted display webfont (the wordmark/headline currently fall back to
  the system rounded face).
- A win **cascade** animation (front-plan polish).
- Match-3 / cribbage board styling (those games arrive later and reuse these
  tokens).
