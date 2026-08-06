//! P6 Phase 4 — the browser entry the standalone trial driver imports. It is
//! bundled to a same-origin `/vendor/harness.js` (like `/vendor/webllm.js`) so
//! the driver can `import()` it into a real WebGPU page and run the full rig
//! against the **real** shipped players: the experimental `HybridAiPlayer`
//! (band + in-browser LLM over `WebLLMRuntime`) vs the classic `EnginePlayer`.
//!
//! This entry never ships in `app.js` — it exists only for the off-CI trial.

import { checkersOracle } from "../games/checkers/checkers-oracle.js";
import { Checkers } from "../games/checkers/checkers-wasm.js";
import { drop4Oracle } from "../games/drop4/drop4-oracle.js";
import { Drop4 } from "../games/drop4/drop4-wasm.js";
import { othelloOracle } from "../games/othello/othello-oracle.js";
import { Othello } from "../games/othello/othello-wasm.js";
import { WebLLMRuntime } from "./ai-runtime.js";
import { HybridPlayer } from "./hybrid-player.js";
import type { GameOracle, OracleLevel } from "./game-oracle.js";
import { EnginePlayer, HybridAiPlayer, type HybridPromptBuilder } from "./match-runner.js";
import { renderReport, runTournament, type Report } from "./tournament.js";

/** Which shelf game the trial grades. */
export type TrialGame = "drop4" | "othello" | "checkers";

/**
 * Per-game wiring for the trial: how to load the game as a `GameOracle`, and a
 * prompt that describes *that* game to the model. The rig itself needs none of
 * this — it is here because a trial that offered Othello cells to a model told
 * to play Connect Four would be measuring the wrong thing.
 */
const GAMES: Record<TrialGame, {
  load: () => Promise<GameOracle>;
  prompt: HybridPromptBuilder;
}> = {
  drop4: {
    load: async () => drop4Oracle(await Drop4.load("/drop4.wasm")),
    prompt: (game, band) => ({
      system:
        "You are a Connect-Four opponent. Choose exactly one of the offered columns and reply as JSON {move, reason}.",
      prompt: `Board (bottom row first):\n${game.renderText()}\nOffered columns: ${band
        .map((b) => `${b.col} (${b.idea})`)
        .join(", ")}\nPick one column and say why in one short sentence.`,
    }),
  },
  othello: {
    load: async () => othelloOracle(await Othello.load("/othello.wasm")),
    prompt: (game, band) => ({
      system:
        "You are an Othello (Reversi) opponent. Choose exactly one of the offered cells and reply as JSON {move, reason}.",
      prompt: `Board:\n${game.renderText()}\nOffered cells (0-63): ${band
        .map((b) => `${b.col} (${b.idea})`)
        .join(", ")}\nPick one cell and say why in one short sentence.`,
    }),
  },
  checkers: {
    load: async () => checkersOracle(await Checkers.load("/checkers.wasm")),
    prompt: (game, band) => ({
      system:
        "You are a checkers (English draughts) opponent. Choose exactly one of the offered move codes and reply as JSON {move, reason}.",
      // The offered codes are packed `(from, to, variant)` integers, not squares.
      // The model is never asked to decode them — it picks one of the numbers it
      // is given, which is what makes the band's never-throw guarantee hold.
      prompt: `Board:\n${game.renderText()}\nOffered moves (opaque codes): ${band
        .map((b) => `${b.col} (${b.idea})`)
        .join(", ")}\nPick one code and say why in one short sentence.`,
    }),
  },
};

/** Options for one hybrid-vs-engine trial run. */
export interface TrialOptions {
  /** The MLC model id for the hybrid opponent's `WebLLMRuntime`. */
  readonly model: string;
  /** Number of games. */
  readonly games: number;
  /** Which game to grade (default `drop4`, so the existing invocation is unchanged). */
  readonly game?: TrialGame;
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
  const wiring = GAMES[opts.game ?? "drop4"];
  const runtime = new WebLLMRuntime({ model: opts.model, onProgress: opts.onProgress });
  const hybrid = new HybridAiPlayer(new HybridPlayer(runtime), {
    label: `Hybrid(${opts.model})`,
    buildPrompt: wiring.prompt,
  });
  const engine = new EnginePlayer(opts.level ?? 3);

  const report = await runTournament(
    wiring.load,
    hybrid,
    engine,
    {
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
