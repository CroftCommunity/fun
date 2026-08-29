# Golden-vector corpus (P1)

Each `*.json` is one deterministic scenario. Inputs and the step-0 expectations are **hand-authored and
hand-computable**; `final_state_hash` is a **recorded** regression + cross-build-determinism anchor (locked
once the engine is green — by construction it cannot be hand-derived, since it covers RNG-driven refill).

## Schema

```jsonc
{
  "name": "human label",
  "seed": 42,              // u64 seed for the ChaCha20 refill stream
  "colors": 6,             // gem colours, drawn as 0..colors
  "board": [               // initial settled board, one string per row (row 0 = top)
    "001 0 2"              // '.'=Empty  '0'-'9'=Gem(digit)  'A'-'Z'=Blocker(layers = letter-'A'+1)
  ],
  "moves": [ [fr, fc, tr, tc] ],   // each move swaps (fr,fc) <-> (tr,tc)
  "expect": {
    "move_legal":    [true],            // per move: was the swap legal?
    "step0_cleared": [ [[0,0],[0,1]] ], // per move: cells cleared in cascade step 0 (sorted)
    "step0_score":   [30],              // per move: score gained in step 0
    "final_state_hash": null            // recorded SHA-256 of final state; null until locked
  }
}
```

Char encoding is `Board::from_rows` / `to_rows` (see `src/board.rs`). Step 0 is the cascade step triggered
directly by the swap, before any refill randomness — so it is fully hand-computable. Scoring (RULES.md T2):
`+10` per gem cleared, `+20` per blocker layer removed.

**Pre-placed specials (optional `special` grid):** a vector may carry a parallel `special` grid (same shape
as `board`, chars `.`/`H`/`V`/`W`/`C`/`F`) to start with a special candy on the board — used by activation
vectors. `Board::from_rows_with_specials` parses it. Activation (B1): a matched striped clears its whole
row/column at step 0, so `step0_cleared` lists the blasted line (see `08`/`09`). Activation (B2, wrapped): a
matched wrapped fires the canon **double 3×3** — `step0_cleared` lists the **first** blast (the 3×3 ring
*minus* the wrapped's own centre, which survives), and the surviving wrapped re-blasts (consuming its centre)
on the *next* cascade step (see `10-wrapped-activate`; `11-wrapped-chain` chains a striped row into a wrapped).
Activation (B3, colour bomb): swapping a colour bomb with a gem detonates that gem's **colour** — `step0_cleared`
lists every cell holding that colour plus the bomb's own cell (see `12`/`13` for the swap-activation shape).
Creation (B4, fish): a **2×2 square** is a match; a *pure* 2×2 makes a `Fish` (char `F`) — `step0_cleared` lists
the three cleared cells (the survivor becomes the fish), see `14-fish-from-2x2`. Fish activation is B4.2.
Combos (B5, RULES T1d): swapping **two** pre-placed specials (both non-fish) combines them — `step0_cleared`
lists the combined blast centred on the destination cell. See `15-combo-striped-cross` (full row ∪ column),
`16-combo-striped-wrapped` (3-wide thick cross), `17-combo-wrapped-5x5` (a 5×5 block). Colour-bomb combos (B5.2):
`18-combo-bomb-striped` (every partner-colour cell's row+column), `19-combo-bomb-wrapped` (each partner-colour
cell's 3×3), `20-combo-bomb-bomb` (the entire board). Fish combos (B5.4) spawn N=3 fish that draw distinct
**seeded** targets, so their `step0_cleared` is a **recorded** set (like B4 fish activation): `21-combo-fish-fish`
(3 targets eaten), `22-combo-fish-striped` (a line per target), `23-combo-fish-bomb` (a colour clear, no RNG).
Ingredients (Track D): the `*` char authors an `Ingredient` cell (a falling non-gem); `24-ingredient-drop`
clears a vertical 3 beneath an ingredient so it falls a row (the drop-to-bottom objective's core loop).

**Specials (B0):** when a move forms a line-4 / L-T / line-5, one matched cell becomes a special candy
(RULES.md T1b) instead of clearing, so `step0_cleared` lists the *cleared* cells (the special's cell is
excluded) and `step0_score` counts only those. The created special is part of `final_state_hash` (the hash's
special section). Initial boards carry no specials, but `Board::from_rows_with_specials(rows, special_rows)`
can author them (`.`/`H`/`V`/`W`/`C`) if a vector ever needs a pre-placed special.
