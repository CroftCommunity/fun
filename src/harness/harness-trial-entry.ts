//! P6 Phase 4 — the browser entry the standalone trial driver imports. It is
//! bundled to a same-origin `/vendor/harness.js` (like `/vendor/webllm.js`) so
//! the driver can `import()` it into a real WebGPU page and run the full rig
//! against the **real** shipped players: the experimental `HybridAiPlayer`
//! (band + in-browser LLM over `WebLLMRuntime`) vs the classic `EnginePlayer`.
//!
//! This entry never ships in `app.js` — it exists only for the off-CI trial.

import { Drop4 } from "../games/drop4/drop4-wasm.js";
import { WebLLMRuntime } from "./ai-runtime.js";
import { HybridPlayer } from "./hybrid-player.js";
import type { OracleLevel } from "./game-oracle.js";
import { EnginePlayer, HybridAiPlayer } from "./match-runner.js";
import { renderReport, runTournament, type Report } from "./tournament.js";

/** Options for one hybrid-vs-engine trial run. */
export interface TrialOptions {
  /** The MLC model id for the hybrid opponent's `WebLLMRuntime`. */
  readonly model: string;
  /** Number of games. */
  readonly games: number;
  /** Engine difficulty for the opponent under measurement (default `Perfect`). */
  readonly level?: OracleLevel;
  /** Base seed. */
  readonly baseSeed?: number;
  /** Model load-progress text (weights download / shader compile). */
  readonly onProgress?: (text: string) => void;
  /** Per-game staged progress: index, side-A W/D/L this game, ms/move. */
  readonly onGame?: (line: string) => void;
}

/** The trial result: the aggregate report and its one-block rendering. */
export interface TrialResult {
  readonly text: string;
  readonly report: Report;
}

/**
 * Run a Hybrid-vs-Engine tournament over the real WebGPU model + wasm, returning
 * the aggregate `Report`. The hybrid reuses the shipped `HybridAiPlayer` /
 * `HybridPlayer` / `WebLLMRuntime` unchanged.
 */
export async function runHybridTrial(opts: TrialOptions): Promise<TrialResult> {
  const runtime = new WebLLMRuntime({ model: opts.model, onProgress: opts.onProgress });
  const hybrid = new HybridAiPlayer(new HybridPlayer(runtime), { label: `Hybrid(${opts.model})` });
  const engine = new EnginePlayer(opts.level ?? 3);

  const report = await runTournament(() => Drop4.load("/drop4.wasm"), hybrid, engine, {
    games: opts.games,
    baseSeed: BigInt(opts.baseSeed ?? 0),
    onGame: (i, _record, card) => {
      const msPer = card.scoredMoves === 0 ? 0 : card.moveMsTotal / card.scoredMoves;
      opts.onGame?.(
        `game ${i}: A W-D-L ${card.wins}-${card.draws}-${card.losses} | graded ${card.scoredMoves} (skipped ${card.skippedEarly}) blunders ${card.blunders} | ${msPer.toFixed(0)}ms/move`,
      );
    },
  });
  return { text: renderReport(report), report };
}
