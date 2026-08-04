//! Othello over the `othello-wasm` binding: a tap-to-play two-player game against
//! the shelf's classic engine. You pick your disc (● black opens, or ○ white) and
//! tap any highlighted square to place-and-flip; **The Engine** replies. When a
//! side has no legal move it passes (shown, then auto-advanced); the game ends
//! when neither side can move, and the majority of discs wins. The core decides
//! legality; a finished match is a verifiable `pond-outcome` record, shareable
//! via `?r=` (passes are encoded so it replays exactly).
//!
//! The opponent is the depth-capped heuristic engine (`liveMove`) with an exact
//! endgame — Othello is unsolved from the opening, so there is no "perfect"
//! level. Difficulty (Easy…Expert) and the chosen disc persist.

import type { GameModule } from "../../contract.js";
import { WebLLMRuntime } from "../../harness/ai-runtime.js";
import { buildBand, HybridPlayer, type BandMove } from "../../harness/hybrid-player.js";
import {
  othelloDisc,
  othelloLevel,
  othelloTutorEnabled,
  setOthelloDisc,
  setOthelloLevel,
  setOthelloTutor,
  type OthelloDisc,
  type OthelloLevel,
} from "../../settings.js";
import {
  decodeRecord,
  encodeRecord,
  verifyRecord,
  type OthelloEnvelope,
  type VerifyResult,
} from "./othello-outcome.js";
import { Othello, type BoardView, type Level, type MoveAssessment } from "./othello-wasm.js";

declare global {
  interface Window {
    /** E2E hook: the live binding + a re-render, so tests drive the core. */
    __othello?: {
      game: Othello;
      refresh: () => void;
      seed: bigint;
    };
    /** Test seam: override the local-AI model id (a smaller/faster model). */
    __OTHELLO_AI_MODEL?: string;
  }
}

/** The opponent's identity — honest: it is the shelf's classic engine. */
const OPPONENT = { name: "The Engine", avatar: "🤖" } as const;

const LOCAL_AI = "local-ai";
/** A small, fast model — the local-AI opponent is UX (banter), not strength. */
const LOCAL_AI_MODEL = "Qwen2.5-0.5B-Instruct-q4f16_1-MLC";
/** The experimental local-AI opponent's persona. (A selectable roster of
 *  temperaments — managed as external prompt files — is a tracked follow-on;
 *  today there is one persona, kept small and in one place.) */
const LOCAL_AI_PERSONA = { name: "Rowan", avatar: "🌿" } as const;
const HYBRID_SYSTEM = [
  "You are Rowan, a friendly but competitive Othello opponent.",
  "You always pick from the offered squares (they are safe by construction).",
  "You add a short, in-character line of banter — never analysis, never move lists.",
].join(" ");

/** A human-readable cell label, e.g. cell 19 -> "row 3, column 4" (1-based). */
const cellLabel = (idx: number): string => `row ${Math.floor(idx / 8) + 1}, column ${(idx % 8) + 1}`;

/** A short, engine-grounded idea for why a placement is reasonable (tutor copy). */
export const ideaFor = (m: MoveAssessment): string =>
  m.takesCorner
    ? "takes a corner"
    : m.quality === "optimal"
      ? "your strongest line"
      : "stays safe";

/**
 * Coaching for a just-tapped placement, or null if it does not warrant a note.
 * Honest about certainty: only when the facts are provably `exact` (deep
 * endgame) does it say the move *threw* the game; a horizon-approximate
 * (heuristic) verdict can never claim a class drop, so it softens to "looks
 * risky" and only for a move the heuristic clearly dislikes (a negative value
 * while a positive one was on offer). Othello is unsolved early, so this is the
 * only honest split. (Pinned by the `coachFor` unit test — the Pass 3 gate.)
 */
export const coachFor = (
  verdict: MoveAssessment | null,
  bestCol: number | null,
  exact: boolean,
): string | null => {
  if (!verdict || bestCol === null) return null;
  if (exact) {
    return verdict.quality === "blunder"
      ? `That threw the game — ${cellLabel(bestCol)} held it.`
      : null;
  }
  // Heuristic (not proven): flag only a clearly weak move, and hedge.
  return verdict.value < 0 && verdict.bestValue > 0
    ? `That looks risky — ${cellLabel(bestCol)} may be stronger.`
    : null;
};

const THINK_MS = 450;
const PASS_MS = 950;
const FANFARE_MS = 1200;
const LEVELS: readonly OthelloLevel[] = ["Easy", "Medium", "Hard", "Expert"];
const LEVEL_LABELS: Record<OthelloLevel, string> = {
  Easy: "Easy",
  Medium: "Medium",
  Hard: "Hard",
  Expert: "Expert",
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const c of children) node.append(c);
  return node;
}

/** The disc glyph for a cell value (1 = black/A, 2 = white/B). */
const glyphFor = (v: number): string => (v === 1 ? "●" : v === 2 ? "○" : "");

/** Count discs of a side value on the board. */
function discCount(cells: number[][], v: number): number {
  let n = 0;
  for (const row of cells) for (const cell of row) if (cell === v) n += 1;
  return n;
}

// ---------- the result screen (pure DOM) ----------

interface ResultScreenOpts {
  label: string;
  finalBoard: HTMLElement;
  shareUrl?: string;
  onReverify?: () => void;
  onPlayAgain?: () => void;
  shared?: boolean;
}

/** Build the Othello result screen: outcome headline, verification badge, the
 *  final board, the record, and controls. Reuses the shared `sol-*` styling. */
function renderResultScreen(
  env: OthelloEnvelope,
  verification: VerifyResult,
  opts: ResultScreenOpts,
): HTMLElement {
  const rec = env.payload;
  const section = el("section", { class: "sol-result", role: "region", "aria-label": "Result" });
  section.append(
    el(
      "h2",
      { class: "sol-headline" },
      verification.ok
        ? `${opts.label} — verifiable`
        : "Verification FAILED — this result does not check out",
    ),
  );

  const badge = el("p", {
    class: `sol-verify-badge ${verification.ok ? "ok" : "fail"}`,
    role: "status",
  });
  badge.textContent = verification.ok
    ? "Verified ✓ — re-checked by replaying every move against the core."
    : `Verification failed — expected hash ${verification.expected}, replay produced ${verification.actual}.`;
  section.append(badge);

  section.append(opts.finalBoard);

  const dl = el("dl", { class: "sol-record" });
  const row = (term: string, value: string, cls = ""): void => {
    dl.append(el("dt", {}, term), el("dd", cls ? { class: cls } : {}, value));
  };
  row("Result", opts.label);
  row("Moves", String(rec.move_count));
  row("Seed", String(rec.seed));
  row("Final hash", rec.final_hash, "sol-hash");
  section.append(dl);

  const controls = el("div", { class: "sol-result-controls" });
  if (opts.onReverify) {
    const b = el("button", { type: "button", class: "sol-reverify" }, "Re-verify");
    b.addEventListener("click", opts.onReverify);
    controls.append(b);
  }
  if (opts.shareUrl) {
    controls.append(
      el(
        "a",
        { class: "sol-share", href: opts.shareUrl, "data-share": opts.shareUrl },
        "Share this result",
      ),
    );
  }
  if (opts.onPlayAgain) {
    const b = el(
      "button",
      { type: "button", class: "sol-again" },
      opts.shared ? "Play a game" : "Play again",
    );
    b.addEventListener("click", opts.onPlayAgain);
    controls.append(b);
  }
  if (controls.childNodes.length) section.append(controls);
  return section;
}

// ---------- the game module ----------

/** Construct a fresh Othello module (the registry `load`). */
export function othelloModule(): GameModule {
  let game: Othello | null = null;
  let verifier: Othello | null = null;
  let container: HTMLElement | null = null;
  let disposed = false;
  let thinking = false;
  let ending = false;
  let seed = 0n;
  let level: OthelloLevel = othelloLevel();
  let disc: OthelloDisc = othelloDisc();
  let lastMove: number | null = null;
  // Engine-grounded coaching for the human's last move, surfaced after the
  // engine replies (so it does not spoil the reply). Cleared each human turn.
  let coachMsg: string | null = null;
  let pendingCoach: string | null = null;

  // --- experimental local-AI opponent (hybrid: engine band + LLM in-band pick) ---
  // Offered only when a real WebGPU adapter is present; the classic engine is the
  // default. All LLM code is lazy — no model download unless the toggle is on and
  // a move is played. Reuses the game-agnostic hybrid harness unchanged.
  let localAiAvailable = false;
  let opponentKind: "engine" | typeof LOCAL_AI = "engine";
  let runtime: WebLLMRuntime | null = null;
  let hybrid: HybridPlayer | null = null;
  let aiSay: string | null = null;
  let lastHumanQuality: "optimal" | "resultPreserving" | "blunder" | null = null;

  /** The side value the human plays: 1 (black, opens) or 2 (white). */
  const humanSide = (): 1 | 2 => (disc === "black" ? 1 : 2);
  const opponentIdentity = (): { name: string; avatar: string } =>
    opponentKind === LOCAL_AI ? LOCAL_AI_PERSONA : OPPONENT;

  const statusEl = el("p", { class: "sol-status", role: "status", "aria-live": "polite" });
  const setStatus = (msg: string): void => {
    statusEl.textContent = msg;
  };

  const randomSeed = (): bigint => {
    const buf = new Uint32Array(2);
    crypto.getRandomValues(buf);
    return (BigInt(buf[0]!) << 16n) ^ BigInt(buf[1]! & 0xffff);
  };

  const shareUrlFor = async (env: OthelloEnvelope): Promise<string> =>
    `${location.origin}${location.pathname}?r=${await encodeRecord(env)}`;
  const verify = (env: OthelloEnvelope): VerifyResult => verifyRecord(verifier!, env);

  const gameOver = (): boolean => (game ? game.board().result !== -1 : false);
  const humanToMove = (): boolean => (game ? game.board().toMove === humanSide() : false);

  const applyMove = (idx: number): boolean => {
    if (!game || game.play(idx) !== "applied") return false;
    lastMove = idx;
    return true;
  };

  // --- turn loop: after any move, advance auto-turns (passes + the engine)
  // until it is the human's turn to place, or the game ends. ---
  const step = (): void => {
    if (disposed || !game || !container) return;
    if (gameOver()) {
      finish();
      return;
    }
    const b = game.board();
    if (b.toMove === humanSide()) {
      if (b.mustPass) {
        thinking = true; // block input during the pass beat
        setStatus("You have no legal move — passing.");
        render();
        window.setTimeout(() => {
          if (disposed || !game) return;
          game.pass();
          thinking = false;
          lastMove = null;
          step();
        }, PASS_MS);
        return;
      }
      thinking = false;
      setStatus("");
      render(); // wait for the human's tap
      return;
    }
    // The opponent's turn (place or forced pass), after a brief beat.
    const who = opponentIdentity().name;
    thinking = true;
    setStatus(b.mustPass ? `${who} has no move — passing.` : `${who} is thinking…`);
    render();
    window.setTimeout(() => {
      void (async () => {
        if (disposed || !game) return;
        if (b.mustPass) {
          game.pass();
          lastMove = null;
        } else {
          const mv = opponentKind === LOCAL_AI ? await hybridMove() : game.liveMove(level as Level);
          if (disposed || !game) return;
          if (mv === "pass") game.pass();
          else if (typeof mv === "number") applyMove(mv);
        }
        thinking = false;
        // Surface any coaching for the human's move now the reply is in.
        if (pendingCoach !== null) {
          coachMsg = pendingCoach;
          pendingCoach = null;
        }
        step();
      })();
    }, b.mustPass ? PASS_MS : THINK_MS);
  };

  const playCell = (idx: number): void => {
    if (!game || thinking || ending || gameOver() || !humanToMove()) return;
    if (!game.board().legal.includes(idx)) return; // the core decides legality
    coachMsg = null; // clear last turn's coaching
    // Assess the tapped move at the *current* position (before it is applied) —
    // drives the opt-in tutor coach AND the local-AI opponent's reaction.
    const report = game.tutor();
    const verdict = report.moves.find((m) => m.col === idx) ?? null;
    lastHumanQuality = verdict?.quality ?? null;
    const pending = othelloTutorEnabled() ? coachFor(verdict, report.bestCol, report.exact) : null;
    if (!applyMove(idx)) return;
    setStatus("");
    if (gameOver()) {
      coachMsg = pending; // a game-ending blunder is still explained (tutor on)
      step();
      return;
    }
    pendingCoach = pending;
    step();
  };

  // What just happened, in one word — drives the persona prompt + the fallback
  // line, so the banter is reactive, not generic.
  type Situation = "corner" | "blundered" | "solid" | "neutral";
  const readSituation = (band: readonly BandMove[]): Situation => {
    if (band.some((m) => m.idea === "takes a corner")) return "corner";
    if (lastHumanQuality === "blunder") return "blundered";
    if (lastHumanQuality === "optimal") return "solid";
    return "neutral";
  };
  const SITUATION_HINT: Record<Situation, string> = {
    corner: "A corner is on offer — claim it with a little flourish.",
    blundered: "The player just slipped — tease taking advantage.",
    solid: "The player made a solid move — give a little credit, stay competitive.",
    neutral: "Nothing decisive yet — a light competitive jab.",
  };
  const FALLBACK_LINE: Record<Situation, string> = {
    corner: "A corner? Don't mind if I do.",
    blundered: "Ooh, that opened up — thanks.",
    solid: "Nice one. I'm just getting started.",
    neutral: "Your move. I'm not worried yet.",
  };

  const hybridPrompt = (g: Othello, band: readonly BandMove[], sit: Situation): string => {
    const legal = band.map((m) => m.col).join(", ");
    return [
      `Board (you play as your discs):\n${g.renderText()}`,
      SITUATION_HINT[sit],
      `Place on ONE of these cell indices: ${legal}.`,
      `Reply ONLY with JSON {"move": <one of ${legal}>, "reason": "<your one-line quip, under 12 words>"}.`,
    ].join("\n");
  };

  const cleanBanter = (reason: string, sit: Situation): string => {
    const r = reason.trim();
    return r.length > 0 && r.length <= 90 ? r : FALLBACK_LINE[sit];
  };

  // The hybrid opponent's move: the engine builds a never-throw band, the LLM
  // picks within it and quips; any failure falls back to the engine. Reuses the
  // shipped buildBand/HybridPlayer unchanged (the generality proof).
  const hybridMove = async (): Promise<number | "pass" | null> => {
    if (!game) return null;
    try {
      if (!runtime || !hybrid) {
        setStatus(`${LOCAL_AI_PERSONA.name}: warming up the model (one-time download)…`);
        render();
        runtime = new WebLLMRuntime({
          model: window.__OTHELLO_AI_MODEL ?? LOCAL_AI_MODEL,
          onProgress: (t) => setStatus(`${LOCAL_AI_PERSONA.name}: ${t}`),
        });
        hybrid = new HybridPlayer(runtime);
      }
      const band = buildBand(game.tutor().moves);
      if (band.length === 0) return game.liveMove(level as Level); // no band → classic safety
      const sit = readSituation(band);
      const decision = await hybrid.pick(band, { prompt: hybridPrompt(game, band, sit), system: HYBRID_SYSTEM });
      aiSay = decision.source === "llm" ? cleanBanter(decision.reason, sit) : FALLBACK_LINE[sit];
      return decision.move;
    } catch {
      aiSay = null;
      return game.liveMove(level as Level); // never break the game on an AI failure
    }
  };

  // A real WebGPU adapter is required for the local-AI opponent; probe once on
  // mount and offer the toggle only if it passes (classic engine otherwise).
  const probeLocalAi = async (): Promise<void> => {
    try {
      const gpu = (
        navigator as Navigator & {
          gpu?: { requestAdapter(): Promise<{ isFallbackAdapter?: boolean } | null> };
        }
      ).gpu;
      const adapter = gpu ? await gpu.requestAdapter() : null;
      localAiAvailable = Boolean(adapter) && adapter?.isFallbackAdapter !== true;
    } catch {
      localAiAvailable = false;
    }
    if (!disposed && localAiAvailable) render();
  };

  // --- the tutor panel (engine-grounded coaching; opt-in, no GPU) ---
  const renderTutorPanel = (): HTMLElement => {
    const panel = el("section", { class: "othello-tutor", "aria-label": "Tutor" });
    const explain = el("button", { type: "button", class: "othello-tutor-explain" }, "Explain my options");
    const note = el("p", { class: "othello-tutor-note", "aria-live": "polite" });
    const optionsEl = el("ul", { class: "othello-tutor-options", "aria-label": "Reasonable moves" });
    explain.addEventListener("click", () => {
      if (!game || thinking || ending || gameOver() || !humanToMove()) return;
      const report = game.tutor();
      const band = report.moves.filter((m) => m.quality !== "blunder").sort((a, b) => b.value - a.value);
      note.textContent = report.exact ? "" : "Reading ahead (not yet certain):";
      optionsEl.replaceChildren(
        ...band.slice(0, 6).map((m) => el("li", {}, `${cellLabel(m.col)} — ${ideaFor(m)}`)),
      );
    });
    const coach = el("p", { class: "othello-tutor-coach", role: "status", "aria-live": "polite" });
    if (coachMsg) coach.textContent = coachMsg;
    panel.append(explain, note, optionsEl, coach);
    return panel;
  };

  const buildBoard = (board: BoardView, interactive: boolean): HTMLElement => {
    const boardEl = el("div", {
      class: `othello-board${interactive ? "" : " othello-final"}`,
      role: "group",
      "aria-label": interactive ? "Othello board" : "Final board",
    });
    const canPlay = interactive && !thinking && !ending && !gameOver() && humanToMove();
    for (let r = 0; r < board.size; r += 1) {
      for (let c = 0; c < board.size; c += 1) {
        const idx = r * board.size + c;
        const v = board.cells[r]![c]!;
        const owner = v === 1 ? "black" : v === 2 ? "white" : "empty";
        const legal = interactive && canPlay && board.legal.includes(idx);
        const just = interactive && lastMove === idx;
        const label = `Row ${r + 1}, column ${c + 1}: ${owner}`;
        if (legal) {
          const btn = el("button", {
            type: "button",
            class: "othello-cell legal",
            "data-idx": String(idx),
            "aria-label": `Play ${label.replace(": empty", "")}`,
          });
          boardEl.append(btn);
        } else {
          boardEl.append(
            el(
              "div",
              {
                class: `othello-cell${v ? ` ${owner}` : ""}${just ? " just-played" : ""}`,
                role: "img",
                "aria-label": label,
              },
              v ? el("span", { class: "othello-disc", "aria-hidden": "true" }, glyphFor(v)) : "",
            ),
          );
        }
      }
    }
    if (interactive) {
      boardEl.addEventListener("click", (e) => {
        const cell = (e.target as HTMLElement).closest<HTMLElement>(".othello-cell.legal");
        if (cell?.dataset.idx) playCell(Number(cell.dataset.idx));
      });
    }
    return boardEl;
  };

  const renderTurnbar = (board: BoardView): HTMLElement => {
    const themSide = humanSide() === 1 ? 2 : 1;
    const you = discCount(board.cells, humanSide());
    const them = discCount(board.cells, themSide);
    const opp = opponentIdentity();
    const turn =
      board.result !== -1
        ? ""
        : board.toMove === humanSide()
          ? "Your move"
          : `${opp.name} to move`;
    return el(
      "div",
      { class: "othello-turnbar" },
      el("span", { class: "othello-score you" }, `You ${glyphFor(humanSide())} ${you}`),
      el(
        "span",
        { class: "othello-score them" },
        `${opp.name} ${opp.avatar} ${glyphFor(themSide)} ${them}`,
      ),
      el("span", { class: "othello-turn", role: "status", "aria-live": "polite" }, turn),
    );
  };

  const renderControls = (): HTMLElement => {
    const bar = el("div", { class: "sol-controls othello-controls" });

    const levelSel = el("select", { class: "othello-level", "aria-label": "Difficulty" });
    for (const l of LEVELS) {
      const opt = el("option", { value: l }, LEVEL_LABELS[l]);
      if (l === level) opt.setAttribute("selected", "");
      levelSel.append(opt);
    }
    levelSel.addEventListener("change", () => {
      level = levelSel.value as OthelloLevel;
      setOthelloLevel(level);
    });

    const discSel = el("select", { class: "othello-disc-pick", "aria-label": "Your disc" });
    for (const [val, txt] of [
      ["black", "● Black (open)"],
      ["white", "○ White"],
    ] as const) {
      const opt = el("option", { value: val }, txt);
      if (val === disc) opt.setAttribute("selected", "");
      discSel.append(opt);
    }
    discSel.addEventListener("change", () => {
      disc = discSel.value as OthelloDisc;
      setOthelloDisc(disc);
      void startGame(); // a new colour restarts (it changes who opens)
    });

    const fresh = el("button", { type: "button", class: "sol-fresh" }, "New game");
    fresh.addEventListener("click", () => void startGame());

    bar.append(
      el("label", { class: "othello-field" }, "Difficulty ", levelSel),
      el("label", { class: "othello-field" }, "You play ", discSel),
      fresh,
    );

    // Settings: the opt-in tutor, and (only on a real WebGPU adapter) the
    // experimental local-AI opponent.
    const toggle = (
      checked: boolean,
      label: string,
      cls: string,
      onChange: (on: boolean) => void,
    ): HTMLElement => {
      const input = el("input", { type: "checkbox", class: cls });
      if (checked) input.setAttribute("checked", "");
      input.addEventListener("change", () => onChange((input as HTMLInputElement).checked));
      return el("label", { class: "othello-toggle" }, input, ` ${label}`);
    };
    const details = el("details", { class: "sol-settings othello-settings" });
    details.append(el("summary", {}, "Settings"));
    details.append(
      toggle(othelloTutorEnabled(), "Show tutor", "othello-set-tutor", (on) => {
        setOthelloTutor(on);
        render();
      }),
    );
    if (localAiAvailable) {
      details.append(
        toggle(opponentKind === LOCAL_AI, "Experimental: local AI opponent", "othello-ai-toggle-input", (on) => {
          opponentKind = on ? LOCAL_AI : "engine";
          aiSay = null;
          render();
        }),
        el(
          "p",
          { class: "othello-ai-disclosure" },
          `An in-browser model (${LOCAL_AI_PERSONA.name}) picks within the engine's safe moves and adds banter — a one-time model download on first use; it never plays a losing move (the engine's band decides).`,
        ),
      );
    }
    bar.append(details);
    return bar;
  };

  function render(): void {
    if (disposed || !container || !game) return;
    const board = game.board();
    const parts: (Node | string)[] = [
      renderTurnbar(board),
      renderControls(),
      el(
        "p",
        { class: "othello-banner" },
        "Tap a highlighted square to place your disc and flip the line. Most discs when neither side can move wins.",
      ),
      buildBoard(board, true),
      ...(othelloTutorEnabled() ? [renderTutorPanel()] : []),
      statusEl,
    ];
    // The local-AI opponent's spoken reason for its last move (personality).
    if (aiSay && opponentKind === LOCAL_AI) {
      parts.splice(
        1,
        0,
        el("p", { class: "othello-ai-say", role: "status" }, `${LOCAL_AI_PERSONA.name}: ${aiSay}`),
      );
    }
    container.replaceChildren(el("div", { class: "othello-game" }, ...parts));
  }

  const outcomeLabel = (board: BoardView): string => {
    const you = discCount(board.cells, humanSide());
    const them = discCount(board.cells, humanSide() === 1 ? 2 : 1);
    const code = board.result;
    const head =
      code === 0
        ? "A draw"
        : (code === 1 && humanSide() === 1) || (code === 2 && humanSide() === 2)
          ? "You won"
          : code === -1
            ? "Ended early"
            : `${opponentIdentity().name} won`;
    return code === -1 ? head : `${head} ${you}–${them}`;
  };

  const finish = (): void => {
    if (!game || !container) return;
    ending = true;
    const board = game.board();
    const label = outcomeLabel(board);
    const flash = el(
      "p",
      { class: `othello-flash${board.result === humanSide() ? " win" : ""}`, role: "status" },
      board.result === 0 ? "Draw" : label,
    );
    container.replaceChildren(
      el("div", { class: "othello-game" }, renderTurnbar(board), flash, buildBoard(board, false)),
    );
    window.setTimeout(() => {
      if (disposed) return;
      void presentResult();
    }, FANFARE_MS);
  };

  const presentResult = async (): Promise<void> => {
    if (!container || !game) return;
    const env = game.outcome(false) as OthelloEnvelope;
    const board = game.board();
    const label = outcomeLabel(board);
    container.replaceChildren(
      el("div", { class: "sol-loading" }, "Preparing your verifiable result…"),
    );
    const shareUrl = await shareUrlFor(env);
    if (disposed || !container) return;
    const build = (): HTMLElement =>
      renderResultScreen(env, verify(env), {
        label,
        finalBoard: buildBoard(board, false),
        shareUrl,
        onReverify: () => container!.replaceChildren(build()),
        onPlayAgain: () => void startGame(),
      });
    container.replaceChildren(build());
  };

  async function startGame(seedOverride?: bigint): Promise<void> {
    if (!game || disposed) return;
    thinking = false;
    ending = false;
    lastMove = null;
    seed = seedOverride ?? randomSeed();
    game.newGame(seed);
    setStatus("");
    exposeHook();
    step(); // if the human is White, the engine (Black) opens here
  }

  const showShared = async (payload: string): Promise<void> => {
    if (!container) return;
    let env: OthelloEnvelope;
    try {
      env = await decodeRecord(payload);
    } catch {
      container.replaceChildren(
        el("div", { class: "sol-error" }, "This shared result could not be read."),
      );
      return;
    }
    if (disposed || !container) return;
    const verification = verify(env);
    const board = verifier!.board();
    const label = outcomeLabel(board);
    const build = (): HTMLElement =>
      renderResultScreen(env, verification, {
        label,
        finalBoard: buildBoard(board, false),
        shared: true,
        onReverify: () => container!.replaceChildren(build()),
        onPlayAgain: () => {
          location.href = location.pathname;
        },
      });
    container.replaceChildren(build());
  };

  const exposeHook = (): void => {
    if (!game) return;
    window.__othello = { game, refresh: () => render(), seed };
  };

  return {
    mount(c: HTMLElement): void {
      container = c;
      disposed = false;
      level = othelloLevel();
      disc = othelloDisc();
      container.replaceChildren(el("div", { class: "sol-loading" }, "Loading Othello…"));
      void (async () => {
        try {
          game = await Othello.load();
          verifier = await Othello.load();
        } catch {
          if (!disposed && container) {
            container.replaceChildren(
              el("div", { class: "sol-error" }, "Could not load the game engine."),
            );
          }
          return;
        }
        if (disposed) return;
        const url = new URL(location.href);
        const shared = url.searchParams.get("r");
        if (shared) {
          await showShared(shared);
          return;
        }
        const seedParam = url.searchParams.get("seed");
        await startGame(seedParam !== null ? BigInt(seedParam) : undefined);
        // Probe WebGPU in the background; if present, the controls re-render with
        // the experimental local-AI opponent offered (classic engine otherwise).
        void probeLocalAi();
      })();
    },
    unmount(): void {
      disposed = true;
      delete window.__othello;
      container?.replaceChildren();
      container = null;
      game = null;
      verifier = null;
      runtime = null; // release the WebGPU engine (local-AI) if it was created
      hybrid = null;
    },
  };
}
