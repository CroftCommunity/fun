# Plan — Chess: six painted piece sets, cut from boards

**Status:** **DONE — built, tested and landed on `claude/chess-piece-extraction-themes-q5uj92`,
2026-09-10.** Plan filename carries no ordinal per `CroftC/.claude/TRACKING.md` § "Plan files".
One open question for the owner (Q1, the Arcade set's characters) is recorded below and does
not block the branch; the set is one directory entry and one registry row to remove.

## Problem Statement

The owner supplied six painted chess boards in the starting position — a fairy garden, a
pixel-art arcade cast, an Egyptian court against an Aztec one, the Wild West, the sea, and a
fast-food diner — and asked for the pieces to be cut out and offered as themed sets in the
chess game. (Two further screenshots in the same message show the shipped Emoji pack and were
reference, not sources.)

What the game has today, read from the code:

- **A pack is a preference, and a glyph table.** `ChessPack` (`src/settings.ts`) is
  `classic | bold | emoji`, stored under `fun-chess-pack`, resolved by a pure function that
  lands on Classic for anything unknown. `chess-pieces.ts` maps a pack to six glyphs; the
  piece node is a `<span>` with the glyph as text and the side as a class, and the board
  carries `data-pack` so `styles.css` can restyle per pack (Bold's stroke, Emoji's token).
- **The pack never reaches the core.** Rendering only. The rules, the move list and the
  `state_hash` behind `?r=` do not see it — a constraint this plan keeps to the letter.
- **A game's art lives with the game.** `src/games/<id>/assets/` is served at
  `/<id>/assets/` (`build.mjs`; `tests/art.test.ts` asserts the icon claim both ways).
- **The how-to's shots are the default board.** `tools/stale-shots.sh` names any game whose
  `src/games/<id>` changed without a shot; the escape hatch is a `Shots-Unchanged:` trailer.

The boards are painted on the shelf's own square colours (`--chs-light` `#f0e2c0`,
`--chs-dark` `#b58863` — measured within a few levels on every board), which is what makes a
clean cut feasible: the background to remove is known.

## Approach

**A painted pack is a sprite sheet, and the board carries it as a custom property.**

1. **The cut is a tool, not a build step.** `tools/chess-packs/extract.py` (Pillow + numpy,
   run by hand) reads `tools/chess-packs/boards/<pack>.jpg`, finds the grid from the two
   square colours, cuts the 32 starting squares, keys each square's own colour out by a
   flood fill from the crop's border, and writes `src/games/chess/assets/packs/<pack>.png`:
   six kinds across (pawn, knight, bishop, rook, queen, king) over two rows (White, Black).
   The boards are committed beside the script so the cut can be redone.
2. **The pack table grows by six, and knows which packs are sheets.** `ChessPack` gains
   `garden | arcade | ancients | frontier | tides | diner`; `CHESS_PACKS` lists them after
   the three glyph packs with a label and a hint each; `resolveChessPack` now derives from
   the list instead of repeating it. `chess-pieces.ts` adds `IMAGE_PACKS` and `packSheet()`,
   and a painted pack's glyph row is empty — the sheet is the piece.
3. **The board places a piece by kind and side.** The piece node carries `data-kind`; a
   board under a painted pack carries `data-art="sheet"` and `--chs-sheet: url(...)`. The
   CSS sizes the piece to 96 % of the cell, sets `background-size: 600% 200%` and picks the
   cell with `background-position` in fifths (kind) and halves (side). A background on a
   rule that matches nothing never loads, so a sheet is fetched only once its pack is chosen.
4. **`tools/serve.mjs` learns `.png`.** The dev server's MIME table had no PNG because the
   shelf had never served one; the browser test's content-type check found it.

## Reasoning

- **Sheet over twelve files.** One request per pack, and the CSS placement is arithmetic on
  two attributes the node already had reason to carry. Twelve `<img>`s would need a src per
  node and twelve fetches on first paint.
- **No resampling.** Each sheet cell is the board's own cell size (80–85 px); the browser
  scales once, at draw time, to the 44–96 px the board gives a square. Upscaling to a
  round number first would blur the pixel-art set for nothing.
- **Per-cell background colour, not a global one.** A global light/dark estimate failed on
  Frontier, whose light squares near the top rank sit ~20 levels off the middle (a painted
  vignette). The median of the crop's own border ring is the square's colour wherever it is.
- **Key both colours in an edge band.** A crop's edge carries a pixel or two of the
  neighbouring square through JPEG blending; keying the *other* colour within six pixels of
  the edge removes that line without risking a piece's interior.
- **Queen-side instances by default.** Rooks, knights and bishops appear twice, pawns eight
  times; the a/b/c-file instance is used unless a board drew the two differently (`CHOICE`
  in the script is the one place to say so). Arcade's two bishops differ (a blue-robed and a
  grey-robed figure); the queen-side one is used.
- **No fallback glyph under a sheet.** A transparent glyph under the sprite would show
  through the sprite's own transparency; a hidden one is no fallback. The unit test proves
  the file exists and the browser test proves it decodes, which is the guarantee that matters.

## Verified Assumptions

- The six boards are 688 px wide with 79.5–84.5 px cells; the grid detector found seven
  file edges and the middle-band rank edges on every one (printed by the script).
- The square colours on every board are within tolerance of the shelf's tokens (measured:
  light 237–241 / 210–224 / 163–190, dark 173–179 / 116–133 / 78–97).
- Ancients' top rank runs past the image's top edge (`y0 = −5`): the obelisks and the
  pharaoh's headdress are cut flat in the source, and the sheet keeps that. Nothing to fix
  without a new board.
- `background-position: 100% 0%` on a `600% 200%` background puts the sixth cell of the
  first row in view (asserted by the browser test on the white king).
- A `background-image` on a rule that matches no element is not fetched — the reason a
  painted pack costs nothing until chosen.

## Documentation Impact

- `CHANGELOG.md` — the 2026-09-10 chess entry.
- `src/games/chess/chess-howto.ts` — one sentence naming Settings → Pieces. No shot changes:
  the guide's shots are the default (Classic) board, and the commit says so with
  `Shots-Unchanged: chess`.
- `tools/chess-packs/extract.py` — its docstring is the tool's documentation.

## Phases

1. **RED.** `tests/chess-pack.test.ts`: the nine packs in order, the resolver keeping each,
   `IMAGE_PACKS`/`packSheet`, a sheet per painted pack on disk whose PNG header reads three
   times as wide as tall, every sheet claimed, a board per pack under `tools/`, and no glyph
   for a painted pack. Watched fail (5 of 12). `tests/chess.spec.ts`: the pack row counts
   nine; a painted set is served as `image/png`, decodes 6×2, places the white king at
   `100% 0%` and a black pawn at `0% 100%`, is a visible box, is remembered, and Classic
   brings the glyphs back.
2. **GREEN.** Settings, the piece table, the board attributes, the CSS, the server's MIME row.
3. **The cut.** The script and the six boards; sheets reviewed by eye on both square colours
   and at 3× on the pale pieces over dark squares (the halos that remain are the paintings').
4. **Docs.** Changelog, how-to sentence, this plan.

## Open Questions

- **Q1 — the Arcade set.** Its figures are recognisable Nintendo characters (a plumber, a
  princess, a dinosaur, a turtle king, a mushroom retainer, a gorilla) and some cells look like
  the games' own sprites. The other five sets are original paintings. Shipping the Arcade set
  on a public site is the owner's call; it is `arcade.png`, one `CHESS_PACKS` row, one
  `ChessPack` member, one `IMAGE_PACKS` entry, one `PACK_GLYPHS` row and one board JPEG to
  remove, and the tests list the packs in one constant each.

## Review Log

- 2026-09-10 — plan written with the build, from the owner's six boards. Q1 raised, not
  decided; the set ships on the branch so the owner can see it and choose.
