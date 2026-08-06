//! The shared banter filter — what the experimental opponent is allowed to say.
//!
//! The persona is UX. The engine decides the move, and the model's line adds
//! character; it adds **nothing** to strength and must not sound like it does.
//! The three games each shipped an identical `cleanBanter` that checked only
//! length, so a small model was free to narrate the board — and did. These lines
//! are verbatim from the P8 Phase 14 WebGPU run on `/checkers/`:
//!
//! - "Capture on move to position 1, capturing the opponent's king with a move to 8."
//! - "This move creates a strategic opening by positioning the king on the starting position."
//!
//! There was no king on the board. A persona that invents board facts is a
//! quieter version of the dishonesty the `exact` flag exists to prevent: the
//! move is still engine-safe, but the player is being told something false about
//! their game by something that sounds like it knows.
//!
//! The rule is deliberately about *checkable positional claims* rather than about
//! vocabulary. "I'll be king soon" is trash talk; "the king on square 8" is a
//! claim, and it can be wrong.

import { describe, expect, it } from "vitest";

import { acceptBanter, speak } from "../src/harness/banter.js";

const CANNED = "Your move. I'm not worried yet.";

describe("acceptBanter — rejects claims about the board, keeps character", () => {
  it("rejects the lines the real model actually produced", () => {
    expect(
      acceptBanter("Capture on move to position 1, capturing the opponent's king with a move to 8."),
    ).toBeNull();
    expect(
      acceptBanter(
        "This move creates a strategic opening by positioning the king on the starting position.",
      ),
    ).toBeNull();
    expect(acceptBanter("To move w (white) into position b1.")).toBeNull();
  });

  it("rejects any coordinate or square reference, however phrased", () => {
    expect(acceptBanter("Taking b1 now.")).toBeNull(); // algebraic
    expect(acceptBanter("Row 3 is mine.")).toBeNull();
    expect(acceptBanter("I like column four.")).toBeNull(); // spelled out, still a claim
    expect(acceptBanter("That diagonal is trouble for you.")).toBeNull();
    expect(acceptBanter("Sliding into square seven.")).toBeNull();
  });

  it("keeps trash talk that makes no positional claim", () => {
    for (const line of [
      "Don't mind if I do.",
      "I'll be a king before you know it.",
      "Ooh, that opened up — thanks.",
      "Nice one. I'm just getting started.",
      "Jump's mandatory. Sorry about your man.",
    ]) {
      expect(acceptBanter(line), line).toBe(line);
    }
  });

  it("still rejects empty and overlong lines (the original rule)", () => {
    expect(acceptBanter("")).toBeNull();
    expect(acceptBanter("   ")).toBeNull();
    expect(acceptBanter("word ".repeat(40))).toBeNull();
    expect(acceptBanter("  trimmed  ")).toBe("trimmed");
  });
});

describe("speak — what the opponent says, and whose words they are", () => {
  it("uses the model's line when the model both chose and spoke acceptably", () => {
    expect(speak({ source: "llm", reason: "Don't mind if I do." }, CANNED)).toEqual({
      line: "Don't mind if I do.",
      words: "model",
    });
  });

  it("falls back to the canned line when the model's words are rejected", () => {
    // ...and reports `words: "canned"` — NOT that the engine chose the move. The
    // two were conflated before: a canned line was read off the screen as "the
    // hybrid fell back", which mis-measured checkers' fallback rate as 50% when
    // the move-level rate was 0%. Whose *move* it was lives in
    // `HybridDecision.source`, and is now counted by the harness.
    expect(speak({ source: "llm", reason: "Taking b1 now." }, CANNED)).toEqual({
      line: CANNED,
      words: "canned",
    });
  });

  it("uses the canned line when the engine chose the move", () => {
    expect(speak({ source: "fallback", reason: "(engine) stays safe" }, CANNED)).toEqual({
      line: CANNED,
      words: "canned",
    });
  });
});
