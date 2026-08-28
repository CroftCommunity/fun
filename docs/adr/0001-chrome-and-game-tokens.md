# ADR-0001: The token vocabulary splits — chrome roles are skinnable, game palettes are not

Tags: skins, tokens, accessibility, ip

Date: 2026-08-27
Status: accepted
Gates: M1 of `plans/2026-08-27-1-plan-skin-layer.md`

## Context

The shelf is gaining a skin layer so two visual identities can ship together
(`plans/2026-08-27-1-plan-skin-layer.md`). The model itself is **not decided
here** — it is forage's, recorded in `forage/docs/adr/0003-skins-subsume-themes.md`
and `forage/docs/SKINS.md`, and adopted by that plan's D4 ("share the contract,
not the code"). Restating it would create the second copy D4 exists to prevent.

What forage's rule does not answer is **which tokens a skin may assign here**,
because the two vocabularies are unrelated. Forage declares fifteen roles, all
of them chrome, lifted from the selectors real phpBB styles carry. `tokens.css`
in this repo declares 191 custom properties, and most are per-game:
`--al-*`, `--cs-*`, `--fur-*`, `--dots-*`, `--wy-*`, `--t48-*`, `--chk-*`,
`--oth-*`, `--gem-*`, plus the board surfaces `--felt`, `--card`, `--suit-*`.

Applying forage's rule literally — "a skin may assign any declared token" —
would put all of those within a skin's reach. Two things in this repo make that
unacceptable, and both are already written down next to the tokens themselves:

- **An IP guardrail.** `tokens.css` says of the Align palette: "Deliberately NOT
  the guideline shape-to-colour mapping (IP guardrail)." A skin able to assign
  `--al-i`…`--al-l` could restore the mapping that comment exists to avoid.
- **Colour-blind-safety commitments.** Wyrdle, Dots and Boxes, Furrow and Colour
  Sort each pair a hue with a distinguishing glyph or lightness, and
  `tests/tokens.test.ts` grades those pairs. The glyph carries the meaning and
  the hue is the second signal; a skin repainting the hue can break the pair the
  gate asserts, in a file the gate does not read.

## Decision

**`tokens.css` declares two regions, and a skin may assign only the first.**

- **SKINNABLE — chrome roles.** Page and surface, ink, accent, active, danger,
  link, border, focus, the type roles, the radii, and `--theme-color`.
- **GAME-OWNED.** Board surfaces and every per-game palette.

The split lives **in `tokens.css` itself**, as region markers, so there is one
home for the fact rather than an allowlist in code that drifts from the sheet.
`declaredTokenGroups()` in `src/skins.ts` reads it; `skinScan()` enforces it.

A skin assigning a game-owned token is its **own violation class**, distinct
from an undeclared one:

```
component property smuggled: display
undeclared token: --totally-made-up
game-owned token, not skinnable: --al-i
```

The third message exists because the author needs to know the token is real and
off-limits, not that they mistyped it.

## Consequences

**Good.**

- The guardrail and the colour-blind pairs become unreachable from a skin rather
  than defended by review.
- The test matrix collapses. Boards render identically under every skin, so each
  board is graded once rather than once per palette — which is what makes four
  palettes affordable at all.
- It matches the shelf's own premise that each game is its own world. A skin is
  the gallery lighting; it does not repaint the exhibits.
- `tests/skins.test.ts` asserts **no token is unclassified**, so a token added
  outside both regions fails the gate instead of silently defaulting to
  not-skinnable — a decision nobody would have made.

**Costs, accepted knowingly.**

- **A skin cannot restyle a board.** The Pond mock (`mocks/c-pond.html`) renders
  Othello on paper; that is now illegal and the mock over-reached. Pond's chrome
  is paper, Othello's board stays felt.
- **`tokens.css` gained an ordering constraint.** Chrome roles and game palettes
  are contiguous runs. Two declarations moved (the felt pair down, the type and
  radius tail up); the token multiset was asserted identical across the change.
- **A future genuinely-shared surface needs a decision, not a default.** If a
  board colour ever ought to follow the skin, it is promoted to a chrome role
  deliberately, with its contrast pairs re-graded.

## Alternatives rejected

- **Any declared token is skinnable** (forage's rule, applied literally). Cheapest
  and most expressive, and it puts the IP guardrail and the colour-blind pairs
  inside a skin's reach. Rejected on those two grounds alone.
- **Chrome plus board surfaces** (skins may assign `--felt`, `--dots-paper`, board
  frames — but never the piece colours). Genuinely tempting: it would make Pond's
  paper Othello legal. Rejected because every board would then need grading in
  four palettes, and the boundary between "surface" and "piece" is a judgement
  call re-litigated per game rather than a line in a file.
- **An allowlist in TypeScript rather than markers in the sheet.** Rejected by
  the one-home rule: the list and the sheet would drift, and the sheet is where
  someone adding a token is already looking.
