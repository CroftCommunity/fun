//! The dot lattice the board draws, as a pure function of the box dimensions.
//!
//! This is the UI's **only** piece of board arithmetic, and it exists because a
//! Dots and Boxes board is drawn on a grid the core does not describe: dots and
//! boxes are scenery, and only the edges are moves. The numbering it encodes is
//! the core's own (`crates/dots-core/RULES.md`):
//!
//! ```text
//! horizontal  H(r,c) = r*cols + c              r in 0..=rows, c in 0..cols
//! vertical    V(r,c) = hEdges + r*(cols+1) + c r in 0..rows,  c in 0..=cols
//! ```
//!
//! Keeping it here — pure, and pinned by a unit test against that diagram — means
//! the module never re-derives an edge index inline, where an off-by-one would
//! draw a legal move in the wrong place while every rules test stayed green.

/** What occupies one cell of the drawn grid. */
export type LatticeKind = "dot" | "h" | "v" | "box";

/** One cell of the drawn grid: a dot, a horizontal or vertical edge, or a box. */
export interface LatticeCell {
  readonly kind: LatticeKind;
  /** The edge index for `h`/`v`, the box index for `box`, the dot ordinal for `dot`. */
  readonly index: number;
}

/**
 * The `(2*rows+1) x (2*cols+1)` grid cells, in row-major reading order — the
 * order they are appended to a CSS grid.
 *
 * Even grid rows interleave dots with horizontal edges; odd grid rows interleave
 * vertical edges with boxes.
 */
export function latticeCells(rows: number, cols: number): LatticeCell[] {
  const hEdges = (rows + 1) * cols;
  const cells: LatticeCell[] = [];
  let dot = 0;
  for (let gr = 0; gr < 2 * rows + 1; gr += 1) {
    for (let gc = 0; gc < 2 * cols + 1; gc += 1) {
      const r = gr >> 1;
      const c = gc >> 1;
      if (gr % 2 === 0) {
        cells.push(
          gc % 2 === 0
            ? { kind: "dot", index: dot++ }
            : { kind: "h", index: r * cols + c },
        );
      } else {
        cells.push(
          gc % 2 === 0
            ? { kind: "v", index: hEdges + r * (cols + 1) + c }
            : { kind: "box", index: r * cols + c },
        );
      }
    }
  }
  return cells;
}
