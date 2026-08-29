//! The cribbage board: a real one, drawn as SVG. Three streets of forty holes
//! in groups of five, down and back and down again, a start hole before the
//! first street and one game hole (121) past the last. Two lanes — the engine's
//! above, yours below — and two pegs a side that leapfrog: a score lifts the
//! back peg over the front one, so the front peg is the score and the back peg
//! is what it was.
//!
//! Everything here is pure geometry and DOM; the animation that walks a peg
//! hole by hole lives with the game (it needs the game's beats), and it repaints
//! through `paintPegs` so a re-render mid-walk just swaps the nodes under it.

/** One seat's two pegs, by hole (0 = the start hole, 121 = the game hole). */
export interface Pegs {
  readonly back: number;
  readonly front: number;
}

/** A score change during a deal, for the recap. */
export interface ScoreEvent {
  readonly seat: 1 | 2;
  readonly from: number;
  readonly to: number;
}

const GAME_HOLE = 121;
const STREETS = 3;
const PER_STREET = 40;
const PITCH = 10;
const GROUP_GAP = 6;
const LANE_GAP = 12;
const STREET_GAP = 40;
const X0 = 60;
const Y0 = 22;
const STREET_LEN = (PER_STREET - 1) * PITCH + (PER_STREET / 5 - 1) * GROUP_GAP;
const END_GAP = 16;

/** The drawing's size in viewBox units; the SVG scales to its container. */
export const BOARD = {
  width: X0 + STREET_LEN + END_GAP + 44,
  height: Y0 + (STREETS - 1) * STREET_GAP + LANE_GAP + 22,
  holeRadius: 2.4,
  pegRadius: 3.6,
} as const;

/** Where a hole sits, for a lane (0 = the top lane, 1 = the bottom). */
export function holePoint(hole: number, lane: 0 | 1): { x: number; y: number } {
  const laneY = (street: number, l: number): number => Y0 + street * STREET_GAP + l * LANE_GAP;
  if (hole <= 0) return { x: X0 - END_GAP, y: laneY(0, lane) };
  if (hole >= GAME_HOLE) {
    return { x: X0 + STREET_LEN + END_GAP, y: laneY(STREETS - 1, 0) + LANE_GAP / 2 };
  }
  const street = Math.floor((hole - 1) / PER_STREET);
  const idx = (hole - 1) % PER_STREET;
  const along = idx * PITCH + Math.floor(idx / 5) * GROUP_GAP;
  const x = street % 2 === 0 ? X0 + along : X0 + STREET_LEN - along;
  return { x, y: laneY(street, lane) };
}

/** Move the front peg to `score`, the back peg to where the front one was. */
export function advancePegs(pegs: Pegs, score: number): Pegs {
  const to = Math.min(score, GAME_HOLE);
  if (to <= pegs.front) return pegs;
  return { back: pegs.front, front: to };
}

/** The holes a peg passes through walking from `from` to `to`, ending at the game hole at most. */
export function pegSteps(from: number, to: number): number[] {
  const end = Math.min(to, GAME_HOLE);
  const steps: number[] = [];
  for (let h = from + 1; h <= end; h += 1) steps.push(h);
  return steps;
}

/** What changed between two score pairs, one event per seat that scored. */
export function scoreEvents(prev: readonly [number, number], next: readonly [number, number]): ScoreEvent[] {
  const events: ScoreEvent[] = [];
  if (next[0] > prev[0]) events.push({ seat: 1, from: prev[0], to: next[0] });
  if (next[1] > prev[1]) events.push({ seat: 2, from: prev[1], to: next[1] });
  return events;
}

const SVG_NS = "http://www.w3.org/2000/svg";
function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string> = {}): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

/** Which lane a seat pegs on: the engine above, you below. */
const laneOf = (seat: 1 | 2): 0 | 1 => (seat === 2 ? 0 : 1);

export interface BoardOpts {
  /** Each seat's pegs at rest. */
  pegs: { readonly 1: Pegs; readonly 2: Pegs };
  /** Where each front peg is drawn right now — behind `pegs[seat].front` mid-walk. */
  shown: { readonly 1: number; readonly 2: number };
  names: { readonly 1: string; readonly 2: string };
}

/**
 * Draw the board. Pegs and the score labels carry `data-seat`, so `paintPegs`
 * can move them in place as a walk proceeds without redrawing the holes.
 */
export function renderBoard(opts: BoardOpts): SVGSVGElement {
  const root = svg("svg", {
    class: "crib-board",
    viewBox: `0 0 ${BOARD.width} ${BOARD.height}`,
    role: "group",
    "aria-label": "Peg board",
  });
  root.append(svg("rect", { class: "crib-board-wood", x: "0", y: "0", width: String(BOARD.width), height: String(BOARD.height), rx: "8" }));

  for (const seat of [2, 1] as const) {
    const lane = laneOf(seat);
    const track = svg("g", {
      class: `crib-track ${seat === 1 ? "you" : "them"}`,
      role: "img",
      "aria-label": `${opts.names[seat]}: ${opts.shown[seat]} of ${GAME_HOLE}`,
    });
    for (let h = 0; h <= 120; h += 1) {
      const p = holePoint(h, lane);
      track.append(svg("circle", { class: "crib-hole", cx: String(p.x), cy: String(p.y), r: String(BOARD.holeRadius) }));
    }
    // The skunk line: a loser still short of hole 91 is skunked.
    const s = holePoint(90, lane);
    const s2 = holePoint(91, lane);
    const sx = (s.x + s2.x) / 2;
    track.append(svg("line", { class: "crib-skunk", x1: String(sx), y1: String(s.y - 5), x2: String(sx), y2: String(s.y + 5) }));
    const back = holePoint(opts.pegs[seat].back, lane);
    const front = holePoint(opts.shown[seat], lane);
    track.append(
      svg("circle", { class: "crib-peg crib-peg-back", "data-seat": String(seat), "data-hole": String(opts.pegs[seat].back), cx: String(back.x), cy: String(back.y), r: String(BOARD.pegRadius) }),
      svg("circle", { class: "crib-peg crib-peg-front", "data-seat": String(seat), "data-hole": String(opts.shown[seat]), cx: String(front.x), cy: String(front.y), r: String(BOARD.pegRadius) }),
    );
    const name = svg("text", { class: "crib-board-name", x: String(X0 - END_GAP - 8), y: String(holePoint(1, lane).y + 3), "text-anchor": "end" });
    name.textContent = seat === 1 ? "You" : "Engine";
    const score = svg("text", {
      class: "crib-board-score",
      "data-seat": String(seat),
      x: String(X0 + STREET_LEN + END_GAP + 4),
      y: String(holePoint(1, lane).y + 3.5),
      "text-anchor": "start",
    });
    score.textContent = String(opts.shown[seat]);
    track.append(name, score);
    root.append(track);
  }
  // The game hole, shared, past the last street.
  const g = holePoint(GAME_HOLE, 0);
  root.append(svg("circle", { class: "crib-hole crib-game-hole", cx: String(g.x), cy: String(g.y), r: String(BOARD.holeRadius + 1) }));
  const skunkLabel = svg("text", {
    class: "crib-skunk-label",
    x: String((holePoint(90, 0).x + holePoint(91, 0).x) / 2),
    y: String(holePoint(91, 1).y + 14),
    "text-anchor": "middle",
  });
  skunkLabel.textContent = "skunk line";
  root.append(skunkLabel);
  return root;
}

/** Move a seat's pegs and its score label, on any board in `root`: the front peg to `hole`, the back peg to `back`. */
export function paintPegs(root: ParentNode, seat: 1 | 2, hole: number, back: number): void {
  const place = (peg: SVGCircleElement | null, at: number): void => {
    if (!peg) return;
    const p = holePoint(at, laneOf(seat));
    peg.setAttribute("cx", String(p.x));
    peg.setAttribute("cy", String(p.y));
    peg.setAttribute("data-hole", String(at));
  };
  place(root.querySelector<SVGCircleElement>(`.crib-peg-front[data-seat="${seat}"]`), hole);
  place(root.querySelector<SVGCircleElement>(`.crib-peg-back[data-seat="${seat}"]`), back);
  const score = root.querySelector(`.crib-board-score[data-seat="${seat}"]`);
  if (score) score.textContent = String(hole);
  const bar = root.querySelector<HTMLElement>(`.crib-bar-peg[data-seat="${seat}"]`);
  if (bar) {
    bar.style.left = `${(Math.min(hole, GAME_HOLE) / GAME_HOLE) * 100}%`;
    bar.setAttribute("data-hole", String(hole));
  }
}
