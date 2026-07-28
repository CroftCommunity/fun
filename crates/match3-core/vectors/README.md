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
