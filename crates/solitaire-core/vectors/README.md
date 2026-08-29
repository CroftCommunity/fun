# Solitaire golden-vector corpus

Each `NN-name.json` is a `(seed, move list)` plus, once locked, the recorded
`final_state_hash` — a **cross-build determinism + regression anchor** (the
property master-plan Phase 2 asserts holds on native and wasm). Schema:

```json
{
  "name": "human label",
  "seed": 0,
  "moves": ["Draw", { "TableauToTableau": { "from": 0, "count": 1, "to": 1 } }],
  "final_state_hash": "<lowercase hex sha256, locked once the engine is green>",
  "notes": "what this vector exercises"
}
```

Move encoding (serde): unit variants are plain strings (`"Draw"`,
`"WasteToFoundation"`); struct variants are single-key objects
(`{"WasteToTableau":{"pile":2}}`, `{"TableauToFoundation":{"pile":3}}`,
`{"TableauToTableau":{"from":0,"count":2,"to":3}}`).

Unlike `trio-tumble-core`'s tiny hand-computable boards, a 52-card shuffled deal has
no practical hand-derived step-0 expectation, so the anchor is the recorded
final hash; the move list's intent is documented in `notes`. Every move in a
locked vector must replay legally (an illegal move = a regression).

Re-record after an intended rules change:
`cargo test -p solitaire-core --test golden_vectors print_hashes -- --ignored --nocapture`
