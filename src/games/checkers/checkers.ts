//! Checkers (English draughts) over the `checkers-wasm` binding: a tap-to-play
//! two-player game against the shelf's engine. You pick your men (● black opens,
//! or ○ white), tap a man to see where it can go, and tap a destination to move.
//! Capture is mandatory — when a jump exists the core offers nothing else — and a
//! multi-jump is tapped one landing at a time. **The Engine** replies. A finished
//! match is a verifiable `pond-outcome` record, shareable via `?r=`.
//!
//! The core decides everything about legality. The UI's only job with a jump
//! chain is to *filter* the core's own chains by the landings tapped so far
//! ([`chainStep`]) and commit a complete one; if it ever computed a jump itself
//! that would be a defect regardless of whether it worked.
//!
//! Board geometry mirrors `checkers_core::board`: 32 playable dark squares, index
//! `i` at row `i / 4`, column `2 * (i % 4) + (row even ? 1 : 0)`. Row 0 is the
//! top, which is where Side A (black) starts and away from which it advances.

import type { GameModule } from "../../contract.js";
import { WebLLMRuntime } from "../../harness/ai-runtime.js";
import { speak } from "../../harness/banter.js";
import { buildBand, HybridPlayer, type BandMove } from "../../harness/hybrid-player.js";
import { captureUiState, restoreUiState } from "../../ui-state.js";
import {
  checkersLevel,
  checkersSide,
  checkersTutorEnabled,
  setCheckersLevel,
  setCheckersSide,
  setCheckersTutor,
  type CheckersLevel,
  type CheckersSide,
} from "../../settings.js";
import {
  decodeRecord,
  encodeRecord,
  verifyRecord,
  type CheckersEnvelope,
  type VerifyResult,
} from "./checkers-outcome.js";
import {
  Checkers,
  type BoardView,
  type LegalMove,
  type MoveAssessment,
  type SideCode,
} from "./checkers-wasm.js";

declare global {
  interface Window {
    /** E2E hook: the live binding + a re-render, so tests drive the core. */
    __checkers?: {
      game: Checkers;
      refresh: () => void;
      seed: bigint;
    };
    /** Test seam: override the local-AI model id (a smaller/faster model). */
    __CHECKERS_AI_MODEL?: string;
  }
}

/** The opponent's identity — honest: it is the shelf's engine. */
const OPPONENT = { name: "The Engine", avatar: "🤖" } as const;

const LOCAL_AI = "local-ai";
/** A small, fast model — the local-AI opponent is UX (banter), not strength. */
const LOCAL_AI_MODEL = "Qwen2.5-0.5B-Instruct-q4f16_1-MLC";
/** The experimental local-AI opponent's persona (the Chip/Rowan line). */
const LOCAL_AI_PERSONA = { name: "Alder", avatar: "🌲" } as const;
const HYBRID_SYSTEM = [
  "You are Alder, a friendly but competitive draughts opponent.",
  "You always pick from the offered moves (they are safe by construction).",
  "You add a short, in-character line of banter — never analysis, never move lists.",
].join(" ");

/**
 * The beats: the engine's think and the fanfare before the result. `?fast=1`
 * collapses them to a frame — for the browser suite, whose full-game test
 * asserts rules and wiring, not pacing (plans/2026-08-29-plan-e2e-shards-and-smoke.md, D3).
 */
const BEATS = { think: 420, fanfare: 1200 } as const;
const FAST_BEATS = { think: 16, fanfare: 60 } as const;
let beats: { think: number; fanfare: number } = BEATS;
const BOARD = 8;
const LEVELS: readonly CheckersLevel[] = ["Easy", "Medium", "Hard", "Expert"];

/** What the UI may offer next, given the landings tapped so far. */
export interface ChainStep {
  /** The squares that may be tapped next — each is some live chain's next landing. */
  targets: number[];
  /** The move code to commit now, or null while the chain is unfinished. */
  commit: number | null;
}

/**
 * The step-through jump-chain rule, as a pure filter over the core's chains.
 *
 * Given every legal move, the piece the player tapped, and the landings tapped
 * since, return the squares that may be tapped next and — only when the tapped
 * path is a whole chain with nothing continuing through it — the code to commit.
 *
 * A continuation is preferred over committing, so a partially expressed jump is
 * never played as a shorter one. (English draughts cannot actually produce a
 * legal chain that is a strict prefix of another legal chain — a jump must
 * continue while one is available — so this only decides an impossible case; it
 * decides it by asking rather than by guessing.)
 */
export function chainStep(
  moves: readonly LegalMove[],
  from: number,
  prefix: readonly number[],
): ChainStep {
  const live = moves.filter(
    (m) => m.from === from && prefix.every((sq, i) => m.path[i] === sq),
  );
  const targets = [
    ...new Set(
      live.filter((m) => m.path.length > prefix.length).map((m) => m.path[prefix.length]!),
    ),
  ];
  const whole = live.find((m) => m.path.length === prefix.length);
  return { targets, commit: targets.length === 0 && whole ? whole.code : null };
}

/** The `(from, to)` a packed move code names — the UI reads codes, never builds them. */
const fromTo = (code: number): [number, number] => [code & 31, (code >> 5) & 31];

/** A short, engine-grounded idea for why a move is reasonable (tutor copy). */
export const ideaFor = (m: MoveAssessment): string =>
  m.captures > 1
    ? `takes ${m.captures} pieces`
    : m.captures === 1
      ? "takes a piece"
      : m.quality === "optimal"
        ? "your strongest line"
        : "stays safe";

/**
 * Coaching for a just-tapped move, or null if it does not warrant a note.
 *
 * Honest about certainty: checkers is not solved from the opening, and a move's
 * value is `exact` only when its line reached a **proven terminal**. Only then
 * may the tutor say the move *threw* the game. A horizon judgement cannot
 * establish a class drop at all, so it softens to "looks risky" and fires only
 * for a move the engine clearly dislikes (a negative value while a positive one
 * was on offer). Pinned by `tests/checkers-tutor.test.ts` from both sides.
 */
export const coachFor = (
  verdict: MoveAssessment | null,
  bestCol: number | null,
  exact: boolean,
): string | null => {
  if (!verdict || bestCol === null) return null;
  const best = moveLabel(bestCol);
  if (exact) {
    return verdict.quality === "blunder" ? `That threw the game — ${best} held it.` : null;
  }
  return verdict.value < 0 && verdict.bestValue > 0
    ? `That looks risky — ${best} may be stronger.`
    : null;
};

/** The dark-square index at `(row, col)`, or null on a light (unplayable) square. */
export function squareAt(row: number, col: number): number | null {
  return (row + col) % 2 === 0 ? null : row * 4 + Math.floor(col / 2);
}

/** The side that owns a cell value (0 empty, 1/2 = A man/king, 3/4 = B man/king). */
const ownerOf = (v: number): 0 | SideCode => (v === 0 ? 0 : v <= 2 ? 1 : 2);
const isKing = (v: number): boolean => v === 2 || v === 4;

/** Count a side's pieces (men and kings alike). */
function pieceCount(cells: readonly number[], side: SideCode): number {
  return cells.filter((v) => ownerOf(v) === side).length;
}

/** A human-readable move label, e.g. "row 3, column 2 to row 4, column 3". */
const moveLabel = (code: number): string => {
  const [from, to] = fromTo(code);
  return `${squareLabel(from)} to ${squareLabel(to)}`;
};

/** A human-readable square label, e.g. square 0 -> "row 1, column 2" (1-based). */
const squareLabel = (sq: number): string => {
  const row = Math.floor(sq / 4);
  const col = 2 * (sq % 4) + (row % 2 === 0 ? 1 : 0);
  return `row ${row + 1}, column ${col + 1}`;
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

// ---------- the result screen (pure DOM) ----------

interface ResultScreenOpts {
  label: string;
  finalBoard: HTMLElement;
  shareUrl?: string;
  onReverify?: () => void;
  onPlayAgain?: () => void;
  shared?: boolean;
}

/** Build the checkers result screen: outcome headline, verification badge, the
 *  final board, the record, and controls. Reuses the shared `sol-*` styling. */
function renderResultScreen(
  env: CheckersEnvelope,
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
  section.append(badge, opts.finalBoard);

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

/** Construct a fresh checkers module (the registry `load`). */
export function checkersModule(): GameModule {
  let game: Checkers | null = null;
  let verifier: Checkers | null = null;
  let container: HTMLElement | null = null;
  let disposed = false;
  let thinking = false;
  let ending = false;
  let seed = 0n;
  let level: CheckersLevel = checkersLevel();
  let side: CheckersSide = checkersSide();
  // The in-progress tap: the piece picked up, and the landings tapped so far.
  let selected: number | null = null;
  let prefix: number[] = [];
  // The last move played (either side), highlighted so the reply is visible.
  let lastFrom: number | null = null;
  let lastTo: number | null = null;
  // Engine-grounded coaching for the human's last move, surfaced after the
  // engine replies (so it does not spoil the reply). Cleared each human turn.
  let coachMsg: string | null = null;
  /**
   * The tutor's last reading, held WITH the position it was computed for.
   *
   * It used to live only in the DOM, so every `render()` erased it — the player
   * asked "explain my options", read two lines, toggled a setting, and the answer
   * vanished (TODO/dots.md, which names this game). The state hash is the other
   * half: a band of reasonable moves is *true* until a move is made and *stale*
   * the instant one is, so repainting it unconditionally would trade a lost answer
   * for a wrong one. Furrow already does exactly this (`tutorView`); it shipped
   * last and solved what the earlier three inherited.
   */
  let tutorReading: { note: string; items: string[]; at: string } | null = null;
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
  const humanSide = (): SideCode => (side === "black" ? 1 : 2);
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

  const shareUrlFor = async (env: CheckersEnvelope): Promise<string> =>
    `${location.origin}${location.pathname}?r=${await encodeRecord(env)}`;
  const verify = (env: CheckersEnvelope): VerifyResult => verifyRecord(verifier!, env);

  const gameOver = (): boolean => (game ? game.board().result !== -1 : false);
  const humanToMove = (): boolean => (game ? game.board().toMove === humanSide() : false);

  /** Play a move code, remembering where it came from so the UI can show it. */
  const applyMove = (code: number): boolean => {
    if (!game) return false;
    const detail = game.board().legal.find((m) => m.code === code) ?? null;
    if (game.play(code) !== "applied") return false;
    lastFrom = detail?.from ?? null;
    lastTo = detail?.to ?? null;
    selected = null;
    prefix = [];
    return true;
  };

  // --- turn loop: after any move, let the engine reply until it is the human's
  // turn again, or the game ends. Checkers has no pass — a side with no legal
  // move has lost, and the core reports that as the result. ---
  const step = (): void => {
    if (disposed || !game || !container) return;
    if (gameOver()) {
      finish();
      return;
    }
    if (humanToMove()) {
      thinking = false;
      setStatus("");
      render(); // wait for the human's tap
      return;
    }
    thinking = true;
    setStatus(`${opponentIdentity().name} is thinking…`);
    render();
    window.setTimeout(() => {
      void (async () => {
        if (disposed || !game) return;
        const mv = opponentKind === LOCAL_AI ? await hybridMove() : game.liveMove(level);
        if (disposed || !game) return;
        if (mv !== null) applyMove(mv);
        thinking = false;
        // Surface any coaching for the human's move now the reply is in.
        if (pendingCoach !== null) {
          coachMsg = pendingCoach;
          pendingCoach = null;
        }
        step();
      })();
    }, beats.think);
  };

  /** A tap on a playable square: pick a piece up, extend a chain, or commit. */
  const tapSquare = (sq: number): void => {
    if (!game || thinking || ending || gameOver() || !humanToMove()) return;
    const moves = game.board().legal; // the core decides legality, always
    if (selected !== null) {
      const step0 = chainStep(moves, selected, prefix);
      if (step0.targets.includes(sq)) {
        prefix = [...prefix, sq];
        const next = chainStep(moves, selected, prefix);
        if (next.commit !== null) {
          // Assess the move at the *current* position, before it is applied —
          // this drives the opt-in tutor coach AND the local-AI's reaction.
          // `coach()`, not `tutor()`: this is the tap path, and the panel's
          // deeper budget measured 705ms against this one's 46ms. The panel is
          // opened deliberately; a move is not.
          const report = game.coach();
          const verdict = report.moves.find((m) => m.col === next.commit) ?? null;
          lastHumanQuality = verdict?.quality ?? null;
          const pending = checkersTutorEnabled()
            ? coachFor(verdict, report.bestCol, verdict?.exact ?? false)
            : null;
          if (applyMove(next.commit)) {
            coachMsg = null; // clear last turn's coaching
            setStatus("");
            if (gameOver()) {
              coachMsg = pending; // a game-ending blunder is still explained
            } else {
              pendingCoach = pending;
            }
            step();
            return;
          }
        }
        setStatus("Keep jumping — tap the next landing.");
        render();
        return;
      }
      if (sq === selected) {
        selected = null;
        prefix = [];
        setStatus("");
        render();
        return;
      }
    }
    // Otherwise: pick up a piece, but only one the core offers a move for.
    if (!moves.some((m) => m.from === sq)) return;
    selected = sq;
    prefix = [];
    setStatus("");
    render();
  };

  // What just happened, in one word — drives the persona prompt + the fallback
  // line, so the banter is reactive, not generic.
  type Situation = "captured" | "blundered" | "solid" | "neutral";
  const readSituation = (band: readonly BandMove[]): Situation => {
    if (band.some((m) => m.idea.startsWith("takes"))) return "captured";
    if (lastHumanQuality === "blunder") return "blundered";
    if (lastHumanQuality === "optimal") return "solid";
    return "neutral";
  };
  const SITUATION_HINT: Record<Situation, string> = {
    captured: "A capture is on offer — take it with a little flourish.",
    blundered: "The player just slipped — tease taking advantage.",
    solid: "The player made a solid move — give a little credit, stay competitive.",
    neutral: "Nothing decisive yet — a light competitive jab.",
  };
  const FALLBACK_LINE: Record<Situation, string> = {
    captured: "Jump's mandatory. Sorry about your man.",
    blundered: "Ooh, that left a gap — thanks.",
    solid: "Nice one. I'm just getting started.",
    neutral: "Your move. I'm not worried yet.",
  };

  const hybridPrompt = (g: Checkers, band: readonly BandMove[], sit: Situation): string => {
    const codes = band.map((m) => m.col).join(", ");
    return [
      `Board (you play the men you are to move):\n${g.renderText()}`,
      SITUATION_HINT[sit],
      `Play ONE of these move codes: ${codes}.`,
      `Reply ONLY with JSON {"move": <one of ${codes}>, "reason": "<your one-line quip, under 12 words>"}.`,
    ].join("\n");
  };

  // The hybrid opponent's move: the engine builds a never-throw band, the LLM
  // picks within it and quips; any failure falls back to the engine. Reuses the
  // shipped buildBand/HybridPlayer unchanged (the generality proof, third game).
  const hybridMove = async (): Promise<number | null> => {
    if (!game) return null;
    try {
      if (!runtime || !hybrid) {
        setStatus(`${LOCAL_AI_PERSONA.name}: warming up the model (one-time download)…`);
        render();
        runtime = new WebLLMRuntime({
          model: window.__CHECKERS_AI_MODEL ?? LOCAL_AI_MODEL,
          onProgress: (t) => setStatus(`${LOCAL_AI_PERSONA.name}: ${t}`),
        });
        hybrid = new HybridPlayer(runtime);
      }
      // Checkers' one-ply fact is the capture count, so the band offers "takes 2
      // pieces" rather than the generic label the shared fallback would produce.
      const band = buildBand(
        game.tutor().moves.map((m) => ({ ...m, idea: m.captures > 0 ? ideaFor(m) : undefined })),
      );
      if (band.length === 0) return game.liveMove(level); // no band → classic safety
      const sit = readSituation(band);
      const decision = await hybrid.pick(band, {
        prompt: hybridPrompt(game, band, sit),
        system: HYBRID_SYSTEM,
      });
      // The shared filter decides whether the model's own words are fit to
      // speak (`src/harness/banter.ts`): a line that claims something about the
      // board can be false, and a persona that sounds authoritative and is wrong
      // is the cosmetic cousin of an over-claimed `exact`.
      aiSay = speak(decision, FALLBACK_LINE[sit]).line;
      return decision.move;
    } catch {
      aiSay = null;
      return game.liveMove(level); // never break the game on an AI failure
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
    const panel = el("section", { class: "checkers-tutor", "aria-label": "Tutor" });
    const explain = el(
      "button",
      { type: "button", class: "checkers-tutor-explain" },
      "Explain my options",
    );
    const note = el("p", { class: "checkers-tutor-note", "aria-live": "polite" });
    const optionsEl = el("ul", {
      class: "checkers-tutor-options",
      "aria-label": "Reasonable moves",
    });
    explain.addEventListener("click", () => {
      if (!game || thinking || ending || gameOver() || !humanToMove()) return;
      // The panel's search is deliberately deeper than any move-time search —
      // that is what buys the proofs behind "that threw the game" — and it is
      // synchronous wasm, measured at up to ~700ms worst case. So paint the
      // reading state FIRST and start the search on the next frame; without the
      // deferral the button would look dead for that whole time, because the
      // search blocks the same task that would have painted it.
      explain.setAttribute("aria-busy", "true");
      note.textContent = "Reading ahead…";
      optionsEl.replaceChildren();
      requestAnimationFrame(() => {
        window.setTimeout(() => {
          if (disposed || !game) return;
          const report = game.tutor();
          const band = report.moves
            .filter((m) => m.quality !== "blunder")
            .sort((a, b) => b.value - a.value);
          // The report is `exact` only when every move in it was proven;
          // otherwise the panel says so rather than implying certainty it does
          // not have.
          const heading = report.exact ? "" : "Reading ahead (not yet certain):";
          const items = band.slice(0, 6).map((m) => `${moveLabel(m.col)} — ${ideaFor(m)}`);
          note.textContent = heading;
          optionsEl.replaceChildren(...items.map((line) => el("li", {}, line)));
          tutorReading = { note: heading, items, at: game.currentHash() };
          explain.removeAttribute("aria-busy");
        }, 0);
      });
    });
    // Repaint the last reading if it still describes the position on screen.
    // `coachMsg` below has always worked this way; the reading simply never had
    // anywhere to be repainted from.
    if (game && tutorReading && tutorReading.at === game.currentHash()) {
      note.textContent = tutorReading.note;
      optionsEl.replaceChildren(...tutorReading.items.map((line) => el("li", {}, line)));
    }
    const coach = el("p", { class: "checkers-tutor-coach", role: "status", "aria-live": "polite" });
    if (coachMsg) coach.textContent = coachMsg;
    panel.append(explain, note, optionsEl, coach);
    return panel;
  };

  // ---------- rendering ----------

  const pieceNode = (v: number): HTMLElement =>
    el(
      "span",
      {
        class: `checkers-piece ${ownerOf(v) === 1 ? "a" : "b"}${isKing(v) ? " king" : ""}`,
        "aria-hidden": "true",
      },
      isKing(v) ? "♛" : "",
    );

  const describe = (v: number): string =>
    v === 0
      ? "empty"
      : `${ownerOf(v) === humanSide() ? "your" : "the engine's"} ${isKing(v) ? "king" : "man"}`;

  const buildBoard = (board: BoardView, interactive: boolean): HTMLElement => {
    const boardEl = el("div", {
      class: `checkers-board${interactive ? "" : " checkers-final"}`,
      role: "group",
      "aria-label": interactive ? "Checkers board" : "Final board",
    });
    const canPlay = interactive && !thinking && !ending && !gameOver() && humanToMove();
    const stepNow =
      canPlay && selected !== null ? chainStep(board.legal, selected, prefix) : null;
    for (let r = 0; r < BOARD; r += 1) {
      for (let c = 0; c < BOARD; c += 1) {
        const sq = squareAt(r, c);
        if (sq === null) {
          boardEl.append(el("div", { class: "checkers-square light", "aria-hidden": "true" }));
          continue;
        }
        const v = board.cells[sq]!;
        const label = `${squareLabel(sq)}: ${describe(v)}`;
        const isTarget = stepNow?.targets.includes(sq) ?? false;
        const canPick = canPlay && board.legal.some((m) => m.from === sq);
        const marks = [
          isTarget ? " target" : "",
          canPick ? " selectable" : "",
          selected === sq ? " selected" : "",
          prefix.includes(sq) ? " chain-step" : "",
          interactive && (lastFrom === sq || lastTo === sq) ? " just-played" : "",
        ].join("");
        if (interactive && (isTarget || canPick || selected === sq)) {
          boardEl.append(
            el(
              "button",
              {
                type: "button",
                class: `checkers-square dark${marks}`,
                "data-sq": String(sq),
                "aria-label": isTarget ? `Move to ${squareLabel(sq)}` : `Select ${label}`,
              },
              v ? pieceNode(v) : "",
            ),
          );
        } else {
          boardEl.append(
            el(
              "div",
              {
                class: `checkers-square dark${marks}`,
                "data-sq": String(sq),
                role: "img",
                "aria-label": label,
              },
              v ? pieceNode(v) : "",
            ),
          );
        }
      }
    }
    if (interactive) {
      boardEl.addEventListener("click", (e) => {
        const cell = (e.target as HTMLElement).closest<HTMLElement>(".checkers-square.dark");
        if (cell?.dataset.sq) tapSquare(Number(cell.dataset.sq));
      });
    }
    return boardEl;
  };

  const renderTurnbar = (board: BoardView): HTMLElement => {
    const them: SideCode = humanSide() === 1 ? 2 : 1;
    const turn =
      board.result !== -1
        ? ""
        : board.toMove === humanSide()
          ? "Your move"
          : `${opponentIdentity().name} to move`;
    return el(
      "div",
      { class: "checkers-turnbar" },
      el(
        "span",
        { class: "checkers-score you" },
        `You ${humanSide() === 1 ? "●" : "○"} ${pieceCount(board.cells, humanSide())}`,
      ),
      el(
        "span",
        { class: "checkers-score them" },
        `${opponentIdentity().name} ${opponentIdentity().avatar} ${them === 1 ? "●" : "○"} ${pieceCount(board.cells, them)}`,
      ),
      el("span", { class: "checkers-turn", role: "status", "aria-live": "polite" }, turn),
    );
  };

  const renderControls = (): HTMLElement => {
    const bar = el("div", { class: "sol-controls checkers-controls" });

    const levelSel = el("select", { class: "checkers-level", "aria-label": "Difficulty" });
    for (const l of LEVELS) {
      const opt = el("option", { value: l }, l);
      if (l === level) opt.setAttribute("selected", "");
      levelSel.append(opt);
    }
    levelSel.addEventListener("change", () => {
      level = levelSel.value as CheckersLevel;
      setCheckersLevel(level);
    });

    const sideSel = el("select", { class: "checkers-side-pick", "aria-label": "Your men" });
    for (const [val, txt] of [
      ["black", "● Black (opens)"],
      ["white", "○ White"],
    ] as const) {
      const opt = el("option", { value: val }, txt);
      if (val === side) opt.setAttribute("selected", "");
      sideSel.append(opt);
    }
    sideSel.addEventListener("change", () => {
      side = sideSel.value as CheckersSide;
      setCheckersSide(side);
      void startGame(); // a new colour restarts (it changes who opens)
    });

    const fresh = el("button", { type: "button", class: "sol-fresh" }, "New game");
    fresh.addEventListener("click", () => void startGame());

    bar.append(
      el("label", { class: "checkers-field" }, "Difficulty ", levelSel),
      el("label", { class: "checkers-field" }, "You play ", sideSel),
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
      return el("label", { class: "checkers-toggle" }, input, ` ${label}`);
    };
    const details = el("details", { class: "sol-settings checkers-settings" });
    details.append(el("summary", {}, "Settings"));
    details.append(
      toggle(checkersTutorEnabled(), "Show tutor", "checkers-set-tutor", (on) => {
        setCheckersTutor(on);
        render();
      }),
    );
    if (localAiAvailable) {
      details.append(
        toggle(
          opponentKind === LOCAL_AI,
          "Experimental: local AI opponent",
          "checkers-ai-toggle-input",
          (on) => {
            opponentKind = on ? LOCAL_AI : "engine";
            aiSay = null;
            render();
          },
        ),
        el(
          "p",
          { class: "checkers-ai-disclosure" },
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
        { class: "checkers-banner" },
        "Tap a man, then tap where it goes. Capture is mandatory — when a jump is on offer it is your only move — and a multi-jump is tapped one landing at a time. Reach the far row to be crowned.",
      ),
      buildBoard(board, true),
      ...(checkersTutorEnabled() ? [renderTutorPanel()] : []),
      statusEl,
    ];
    // The local-AI opponent's spoken reason for its last move (personality).
    if (aiSay && opponentKind === LOCAL_AI) {
      parts.splice(
        1,
        0,
        el("p", { class: "checkers-ai-say", role: "status" }, `${LOCAL_AI_PERSONA.name}: ${aiSay}`),
      );
    }
    // The player owns the open panel and the focus; the model does not.
    const ui = captureUiState(container);
    container.replaceChildren(el("div", { class: "checkers-game" }, ...parts));
    restoreUiState(container, ui);
  }

  const outcomeLabel = (board: BoardView): string => {
    const you = pieceCount(board.cells, humanSide());
    const them = pieceCount(board.cells, humanSide() === 1 ? 2 : 1);
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
      { class: `checkers-flash${board.result === humanSide() ? " win" : ""}`, role: "status" },
      board.result === 0 ? "Draw" : label,
    );
    container.replaceChildren(
      el("div", { class: "checkers-game" }, renderTurnbar(board), flash, buildBoard(board, false)),
    );
    window.setTimeout(() => {
      if (disposed) return;
      void presentResult();
    }, beats.fanfare);
  };

  const presentResult = async (): Promise<void> => {
    if (!container || !game) return;
    const env = game.outcome(false) as CheckersEnvelope;
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
    selected = null;
    prefix = [];
    lastFrom = null;
    lastTo = null;
    coachMsg = null;
    pendingCoach = null;
    aiSay = null;
    seed = seedOverride ?? randomSeed();
    game.newGame(seed);
    setStatus("");
    exposeHook();
    step(); // if the human plays White, the engine (Black) opens here
  }

  const showShared = async (payload: string): Promise<void> => {
    if (!container) return;
    let env: CheckersEnvelope;
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
    window.__checkers = { game, refresh: () => render(), seed };
  };

  return {
    mount(c: HTMLElement): void {
      container = c;
      disposed = false;
      level = checkersLevel();
      side = checkersSide();
      container.replaceChildren(el("div", { class: "sol-loading" }, "Loading checkers…"));
      void (async () => {
        try {
          game = await Checkers.load();
          verifier = await Checkers.load();
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
        beats = url.searchParams.get("fast") === "1" ? FAST_BEATS : BEATS;
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
      delete window.__checkers;
      container?.replaceChildren();
      container = null;
      game = null;
      verifier = null;
      runtime = null; // release the WebGPU engine (local-AI) if it was created
      hybrid = null;
    },
  };
}
