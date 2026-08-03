//! The experimental hybrid opponent: the engine builds a **never-throw band**
//! (moves that preserve the game-theoretic class), the LLM picks *within* it and
//! narrates a reason, and ANY failure falls back to the engine's top-of-band. The
//! LLM adds legality-by-construction + personality, never strength — so a broken
//! or adversarial model degrades to the engine, never to an illegal or losing move.
//!
//! Game-agnostic: it consumes a plain band + a prompt over an [`AIRuntime`], so it
//! unit-tests with `MockRuntime` and has no wasm/game dependency. The Drop 4 module
//! builds the band from `Drop4.tutor()` (whose move facts match [`TutorFactMove`]).

import type { AIRuntime } from "./ai-runtime.js";

/** A move's engine-grounded facts — structurally the wasm tutor's `MoveAssessment`. */
export interface TutorFactMove {
  readonly col: number;
  /** Value (higher = better for the side to move); the top-of-band fallback key. */
  readonly value: number;
  readonly quality: "optimal" | "resultPreserving" | "blunder";
  readonly immediateWin: boolean;
  readonly blocksOpponentWin: boolean;
}

/** A candidate move in the difficulty band, with a short engine-grounded idea. */
export interface BandMove {
  readonly col: number;
  readonly value: number;
  readonly idea: string;
}

/** The hybrid's decision, with its provenance for observability/honesty. */
export interface HybridDecision {
  readonly move: number;
  readonly reason: string;
  /** `"llm"` = the model's in-band pick; `"fallback"` = the engine's top-of-band. */
  readonly source: "llm" | "fallback";
}

/** A short, engine-grounded idea for why a band move is reasonable. */
function ideaFor(m: TutorFactMove): string {
  if (m.immediateWin) return "wins now";
  if (m.blocksOpponentWin) return "blocks their threat";
  return m.quality === "optimal" ? "your strongest line" : "stays safe";
}

/**
 * The class-preserving difficulty band: every move that does **not** drop the
 * win/draw/loss class (i.e. not a blunder) — so the LLM can only ever pick a move
 * that never throws the game. Best-value first.
 */
export function buildBand(moves: readonly TutorFactMove[]): BandMove[] {
  return moves
    .filter((m) => m.quality !== "blunder")
    .sort((a, b) => b.value - a.value)
    .map((m) => ({ col: m.col, value: m.value, idea: ideaFor(m) }));
}

interface PickReply {
  move: number;
  reason: string;
}

function parsePick(raw: string): PickReply | null {
  try {
    const v = JSON.parse(raw) as unknown;
    if (
      typeof v === "object" &&
      v !== null &&
      typeof (v as PickReply).move === "number" &&
      typeof (v as PickReply).reason === "string"
    ) {
      return v as PickReply;
    }
  } catch {
    // fall through — malformed JSON
  }
  return null;
}

/**
 * The hybrid opponent. Prompts the [`AIRuntime`] for a `{move, reason}` inside the
 * band (schema-constrained), and returns it only if the move is genuinely in the
 * band; otherwise — malformed output, wrong shape, or an out-of-band pick — it
 * falls back to the engine's top-of-band move. It never throws for a live band.
 */
export class HybridPlayer {
  readonly #runtime: AIRuntime;
  readonly #maxTokens: number;
  constructor(runtime: AIRuntime, opts?: { maxTokens?: number }) {
    this.#runtime = runtime;
    this.#maxTokens = opts?.maxTokens ?? 128;
  }

  async pick(band: readonly BandMove[], ctx: { prompt: string; system?: string }): Promise<HybridDecision> {
    const top = band[0]; // buildBand sorts best-first
    if (!top) {
      throw new Error("HybridPlayer.pick: empty band (the caller must pass a non-empty band)");
    }
    const fallback: HybridDecision = { move: top.col, reason: `(engine) ${top.idea}`, source: "fallback" };
    const legal = band.map((m) => m.col);
    const schema = {
      type: "object",
      properties: { move: { type: "integer", enum: legal }, reason: { type: "string" } },
      required: ["move", "reason"],
      additionalProperties: false,
    };

    let raw: string;
    try {
      raw = await this.#runtime.generate(ctx.prompt, {
        schema,
        greedy: false,
        maxTokens: this.#maxTokens,
        system: ctx.system,
      });
    } catch {
      return fallback; // runtime error → engine top-of-band
    }

    const parsed = parsePick(raw);
    if (!parsed) return fallback; // malformed / wrong shape → parse guard
    if (!legal.includes(parsed.move)) return fallback; // out-of-band → membership guard
    return { move: parsed.move, reason: parsed.reason, source: "llm" };
  }
}
