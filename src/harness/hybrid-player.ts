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
  /**
   * The game's own one-line reason this move is reasonable, if it has one better
   * than the generic fallback below — Othello's "takes a corner", checkers'
   * "takes 2 pieces". Optional: a game whose facts are already the shared ones
   * (Drop 4) omits it and gets the default.
   *
   * It exists because the engine computes these facts and [`ideaFor`] then throws
   * them away: it only knows `immediateWin` / `blocksOpponentWin`, so every band
   * move in every other game degraded to "your strongest line" or "stays safe".
   * The band is what the model picks from and narrates, so that loss lands
   * exactly where the personality is supposed to come from.
   *
   * It is a **label, not a licence**: the band still excludes blunders, so an
   * enthusiastic idea cannot promote an unsafe move.
   */
  readonly idea?: string;
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
    .map((m) => ({ col: m.col, value: m.value, idea: m.idea ?? ideaFor(m) }));
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
/**
 * Why a fallback fired. A fallback is always *safe* — the engine's own
 * top-of-band move is played — so this is a UX diagnostic, not an error path.
 *
 * It exists because the aggregate rate alone is not actionable: dots measured
 * 1.2% and furrow 10.9% on the same model and the same rig, and "which of the
 * three paths" is the whole difference between a prompt problem, a decoding
 * problem, and a model problem.
 */
export interface FallbackTally {
  /** The runtime threw or timed out. */
  runtime: number;
  /** The reply did not parse into `{move, reason}`, on **both** attempts. */
  malformed: number;
  /** A first attempt was malformed and the retry rescued it. */
  rescuedByRetry: number;
  /** The reply parsed but named a move outside the band. Should be unreachable
   *  while the runtime honours the `enum` schema — if this is non-zero, it does
   *  not. */
  outOfBand: number;
  /** The first few malformed replies, verbatim and truncated. A count says a
   *  reply did not parse; only the text says *why*, and the difference between
   *  "the model wrote prose" and "the reply was cut off mid-string" is the
   *  difference between a prompt fix and a token-budget fix. */
  samples: string[];
}

export class HybridPlayer {
  readonly #runtime: AIRuntime;
  readonly #maxTokens: number;
  /** Live tally of why fallbacks fired; purely diagnostic. */
  readonly fallbacks: FallbackTally = {
    runtime: 0,
    malformed: 0,
    rescuedByRetry: 0,
    outOfBand: 0,
    samples: [],
  };
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

    // Two attempts, and the second one is not defensive padding — it is aimed at
    // a measured failure. The live trial (2026-08-10) put furrow's fallback rate
    // at 10-20% with **every single one** malformed: zero runtime errors, zero
    // out-of-band. The captured replies show why — the model emits `{` and then
    // hundreds of newlines until the token budget is gone:
    //
    //     "{   \n\n\n\n\n\n\n\n  \n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n ..."
    //
    // That is grammar-constrained decoding wandering: JSON permits arbitrary
    // whitespace after `{`, so the grammar always allows another newline, and a
    // small model sampling at non-zero temperature can get stuck emitting them.
    // Raising `maxTokens` would only buy more newlines. It is a *sampling
    // accident*, independent per call, so one resample clears most of them.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let raw: string;
      try {
        raw = await this.#runtime.generate(ctx.prompt, {
          schema,
          greedy: false,
          maxTokens: this.#maxTokens,
          system: ctx.system,
        });
      } catch {
        this.fallbacks.runtime += 1;
        return fallback; // runtime error → engine top-of-band, no retry
      }

      const parsed = parsePick(raw);
      if (!parsed) {
        if (this.fallbacks.samples.length < 3) {
          this.fallbacks.samples.push(raw.slice(0, 220));
        }
        continue; // malformed → resample once, then fall back
      }
      if (!legal.includes(parsed.move)) {
        this.fallbacks.outOfBand += 1;
        return fallback; // out-of-band → membership guard, no retry
      }
      if (attempt > 0) {
        this.fallbacks.rescuedByRetry += 1;
      }
      return { move: parsed.move, reason: parsed.reason, source: "llm" };
    }
    this.fallbacks.malformed += 1;
    return fallback;
  }
}
