//! Cribbage's pure UI helpers: how a card reads, how a scoring event is
//! narrated, what the end screen says (with the game's value), and where a
//! peg sits on the board. The rules themselves are the core's; these tests
//! cover only the words and numbers TypeScript adds on top.

import { describe, expect, it } from "vitest";

import {
  cardLabel,
  coachFor,
  outcomeLabel,
  pegPercent,
  scoredLine,
  turnLine,
} from "../src/games/cribbage/cribbage.js";
import type { LastEvent, UiView } from "../src/games/cribbage/cribbage-wasm.js";

const view = (over: Partial<UiView> = {}): UiView => ({
  dealer: 1,
  toMove: 1,
  phase: "discard",
  dealNo: 1,
  scores: [0, 0],
  hand: [],
  kept: [],
  cut: null,
  stack: [],
  count: 0,
  played: [],
  opponentCards: 6,
  cribCards: 0,
  revealed: [],
  last: null,
  legal: [],
  result: -1,
  value: 0,
  ...over,
});

describe("a card reads as rank and suit glyph", () => {
  it("names aces, faces and pips", () => {
    expect(cardLabel({ rank: 1, suit: 3, code: 39 })).toBe("A♠");
    expect(cardLabel({ rank: 11, suit: 2, code: 36 })).toBe("J♥");
    expect(cardLabel({ rank: 12, suit: 1, code: 24 })).toBe("Q♦");
    expect(cardLabel({ rank: 13, suit: 0, code: 12 })).toBe("K♣");
    expect(cardLabel({ rank: 10, suit: 0, code: 9 })).toBe("10♣");
  });
});

describe("the end screen states the score and the game's value", () => {
  it("a plain win is worth one game", () => {
    expect(outcomeLabel(view({ result: 1, value: 1, scores: [121, 98] }), null)).toBe(
      "You won 121–98 — worth 1 game",
    );
  });
  it("a skunk names itself and is worth two", () => {
    expect(outcomeLabel(view({ result: 2, value: 2, scores: [85, 121] }), null)).toBe(
      "The Engine skunked you 121–85 — worth 2 games",
    );
    expect(outcomeLabel(view({ result: 1, value: 3, scores: [122, 40] }), null)).toBe(
      "You double-skunked The Engine 122–40 — worth 3 games",
    );
  });
  it("an unfinished game reports that instead of a score nobody reached", () => {
    expect(outcomeLabel(view({ scores: [50, 60] }), "Ended early — deal 5 was in progress")).toBe(
      "Ended early — deal 5 was in progress",
    );
  });
});

describe("the turn line tells the player what to do now", () => {
  it("at the discard it says whose crib it is", () => {
    expect(turnLine(view({ dealer: 1, toMove: 1 }), "The Engine")).toMatch(/two cards.*your crib/i);
    expect(turnLine(view({ dealer: 2, toMove: 1 }), "The Engine")).toMatch(/two cards.*The Engine's crib/);
  });
  it("while pegging it names the count, and a go when that is the only move", () => {
    expect(turnLine(view({ phase: "peg", toMove: 1, count: 24, legal: [16] }), "The Engine")).toMatch(/24/);
    expect(turnLine(view({ phase: "peg", toMove: 1, count: 30, legal: [20] }), "The Engine")).toMatch(/go/i);
    expect(turnLine(view({ phase: "peg", toMove: 2, count: 10 }), "The Engine")).toMatch(/The Engine/);
  });
  it("at the show it says whose hand is being counted", () => {
    expect(turnLine(view({ phase: "showNonDealer", dealer: 2, toMove: 1 }), "The Engine")).toMatch(/your hand/i);
    expect(turnLine(view({ phase: "showCrib", dealer: 2, toMove: 2 }), "The Engine")).toMatch(/crib/i);
  });
});

describe("a scoring event is narrated from the breakdown", () => {
  const peg = (over: Partial<LastEvent>): LastEvent => ({
    seat: 1,
    kind: "peg",
    points: 0,
    fifteen: 0,
    thirtyOne: 0,
    pairs: 0,
    run: 0,
    claimed: null,
    actual: null,
    muggins: null,
    ...over,
  });
  it("pegging lists what scored", () => {
    expect(scoredLine(peg({ points: 5, fifteen: 2, run: 3 }), "The Engine")).toBe("You: fifteen 2, run of 3 — 5");
    expect(scoredLine(peg({ seat: 2, points: 2, pairs: 2 }), "The Engine")).toBe("The Engine: a pair 2 — 2");
    expect(scoredLine(peg({ points: 0 }), "The Engine")).toBeNull();
  });
  it("a go, the last card and his heels are one line each", () => {
    expect(scoredLine(peg({ kind: "go", points: 1 }), "The Engine")).toBe("You: 1 for the go");
    expect(scoredLine(peg({ seat: 2, kind: "lastCard", points: 1 }), "The Engine")).toBe("The Engine: 1 for last card");
    expect(scoredLine(peg({ seat: 2, kind: "heels", points: 2 }), "The Engine")).toBe("The Engine: 2 for his heels");
  });
  it("a claim states the count and any muggins", () => {
    const actual = { fifteens: 4, pairs: 2, runs: 3, flush: 0, nobs: 0, total: 9 };
    expect(scoredLine(peg({ kind: "claim", points: 9, claimed: 9, actual, muggins: 0 }), "The Engine")).toBe(
      "You counted 9: fifteens 4, pairs 2, runs 3",
    );
    expect(scoredLine(peg({ kind: "claim", points: 6, claimed: 6, actual, muggins: 3 }), "The Engine")).toBe(
      "You counted 6 of 9 — The Engine took 3 by muggins",
    );
    expect(scoredLine(peg({ kind: "claim", points: 9, claimed: 12, actual, muggins: 0 }), "The Engine")).toBe(
      "You claimed 12 but the hand is 9: fifteens 4, pairs 2, runs 3",
    );
  });
});

describe("the peg board", () => {
  it("places a peg by score out of 121 and clamps at the end", () => {
    expect(pegPercent(0)).toBe(0);
    expect(pegPercent(121)).toBe(100);
    expect(pegPercent(129)).toBe(100);
    expect(pegPercent(60.5)).toBeCloseTo(50, 0);
  });
});

describe("the coach adds only a pointer, hedged the same way as the engine's line", () => {
  it("states the better keep when exact, hedges when not", () => {
    const a = { code: 3, expected: 700, regret: 200, quality: "loose" as const, exact: true, line: "That gives up a point or two of expectation." };
    expect(coachFor(a, 7)).toBe("That gives up a point or two of expectation. Best keep: throw pair 7.");
    const b = { ...a, exact: false, line: "The engine would have played differently." };
    expect(coachFor(b, 17)).toBe("The engine would have played differently. It would have played card 2.");
    expect(coachFor({ ...a, regret: 0, quality: "best" as const, line: "That is the best keep." }, 3)).toBe("That is the best keep.");
  });
});
