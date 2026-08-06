//! P8 Phase 13 — the step-through jump-chain logic, tested as a pure function.
//!
//! This is the one place the checkers UI could accidentally re-implement rules.
//! `chainStep` may only ever **filter** the core's own chains by the prefix the
//! player has tapped; it never computes a jump. These tests pin that: every case
//! is driven by a fixture list of chains standing in for `legalMoveDetails()`,
//! and a chain the fixture does not contain can never be produced or committed.

import { describe, expect, it } from "vitest";

import { chainStep } from "../src/games/checkers/checkers.js";
import type { LegalMove } from "../src/games/checkers/checkers-wasm.js";

const mv = (
  code: number,
  from: number,
  path: number[],
  captures: number[] = [],
): LegalMove => ({ code, from, to: path[path.length - 1]!, path, captures, crowns: false });

// One man on 12 with two quiet moves, and a king on 20 with two capture chains
// that share their first landing — the case `(from, to)` alone cannot name.
const QUIET_A = mv(400, 12, [16]);
const QUIET_B = mv(401, 12, [17]);
const CHAIN_SHORT = mv(1000, 20, [29, 22], [24, 25]);
const CHAIN_LONG = mv(1001, 20, [29, 22, 15], [24, 25, 18]);
const MOVES: LegalMove[] = [QUIET_A, QUIET_B, CHAIN_SHORT, CHAIN_LONG];

describe("chainStep — the UI filters the core's chains, it never invents one", () => {
  it("offers only the landings of chains starting at the tapped piece", () => {
    expect(chainStep(MOVES, 12, []).targets.sort((a, b) => a - b)).toEqual([16, 17]);
    expect(chainStep(MOVES, 20, []).targets).toEqual([29]);
  });

  it("commits a one-landing move as soon as its landing is tapped", () => {
    const step = chainStep(MOVES, 12, [16]);
    expect(step.commit).toBe(400);
    expect(step.targets).toEqual([]);
  });

  it("does not commit a partial chain — it offers the next landings instead", () => {
    const step = chainStep(MOVES, 20, [29]);
    expect(step.commit).toBeNull();
    expect(step.targets).toEqual([22]);
  });

  it("commits the chain whose whole path was tapped, not a longer one sharing it", () => {
    // 20→29→22 is a complete chain, but 20→29→22→15 continues through it. A
    // partial path must never commit the longer chain by accident, so while a
    // continuation exists the step keeps offering it.
    const step = chainStep(MOVES, 20, [29, 22]);
    expect(step.targets).toEqual([15]);
    expect(step.commit).toBeNull();
    expect(chainStep(MOVES, 20, [29, 22, 15]).commit).toBe(1001);
  });

  it("offers nothing for a square with no chain, or a prefix no chain matches", () => {
    expect(chainStep(MOVES, 5, [])).toEqual({ targets: [], commit: null });
    expect(chainStep(MOVES, 20, [30])).toEqual({ targets: [], commit: null });
    expect(chainStep(MOVES, 12, [16, 23])).toEqual({ targets: [], commit: null });
  });

  it("de-duplicates a shared landing so a square is offered once", () => {
    expect(chainStep([CHAIN_SHORT, CHAIN_LONG], 20, []).targets).toEqual([29]);
  });
});
