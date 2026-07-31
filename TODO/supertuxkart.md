# SuperTuxKart (Tier-2 wrap) — CUT / FAILED (2026-07-31)

**Status: CUT.** Owner scutted SuperTuxKart loose 2026-07-31 and called it
failed. It never shipped to the shelf — no shelf code, no registry entry, no
deploy — so this is a closed feasibility experiment, not a regression.

## Why it was cut
The local preview **never actually loads to play**. Traced end-to-end in a real
browser: the shell loads, the Start button enables, the ~130 MB `data_low`
chunks download and decompress fine (the reassembled `.tar.gz` is a valid 217 MB
`ustar` tar), but **asset extraction throws** inside the port's loader:

```
PAGEERROR: Error  at r.onmessage (…/js-untar@2.0.0/+esm)
```

So the game files never reach the emscripten FS and `run()` is never called —
the canvas stays black. Ruled out: IndexedDB quota (7.5 GB free), COOP/COEP
(headers correct), WebGL, and corrupt data. The failure is in the **upstream
port's loader** (`script.js` + the pinned, unmaintained `js-untar@2.0.0`),
plausibly aggravated by the tar being repacked on macOS (first entry `._.` —
AppleDouble cruft), which old `js-untar` is known to choke on. Fixing it means
patching someone else's emscripten port — out of proportion for the heaviest,
riskiest wrap on the candidate list.

## What was reclaimed
- `~/stk-build` (3.5 GB: emsdk + assets + engine) deleted.
- Branches `claude/supertuxkart-{todo,plan,phase0}` deleted (local + remote).
- The `:8000` preview server stopped.

## If Tier-2 is revisited
Start with **HexGL** instead — the candidates doc already flags it as "the
lowest-risk first Tier-2 exemplar" (MIT, self-contained, no 130 MB asset-untar
step). The reusable Tier-2 containment/legibility harness is still unbuilt; it
should land with whatever the first *shipping* Tier-2 game is, not with STK.
Reference: `plans/2026-07-31-supertuxkart-wrap.md` (marked FAILED),
`plans/2026-07-30-tux-racer-wrap-spike.md`,
`discovery/alpha/thinking/app/ponds/client-side-static-game-candidates.md`.
