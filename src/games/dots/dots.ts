//! Dots and Boxes over the `dots-wasm` binding: a tap-to-play two-player game
//! against the shelf's engine. You tap an undrawn edge; whoever draws the fourth
//! side of a box claims it **and moves again**. When every edge is drawn the
//! side with more boxes wins — nine boxes cannot split, so there is no draw.
//!
//! The extra turn is the thing this game brings to the shelf that no other
//! adversarial game here has, so the UI says it out loud rather than leaving the
//! player wondering why the turn did not pass.
//!
//! 3x3 is a **second-player win** with perfect play, so the human takes the
//! second seat by default and the engine opens. That is a property of the board,
//! not of the engine: opening against a perfect opponent loses by construction.
//!
//! The core decides everything about legality and scoring; the UI's only board
//! arithmetic is the lattice layout (`dots-lattice.ts`, pure and unit-pinned). A
//! finished match is a verifiable `pond-outcome` record, shareable via `?r=`.

import type { GameModule } from "../../contract.js";
import { WebLLMRuntime } from "../../harness/ai-runtime.js";
import { speak } from "../../harness/banter.js";
import { buildBand, HybridPlayer, type BandMove } from "../../harness/hybrid-player.js";
import {
  declareAssistanceEnabled,
  dotsLevel,
  dotsSeat,
  dotsTutorEnabled,
  hintsEnabled,
  setDeclareAssistance,
  setDotsLevel,
  setDotsSeat,
  setDotsTutor,
  setHintsEnabled,
  type DotsLevel,
  type DotsSeat,
} from "../../settings.js";
import { latticeCells } from "./dots-lattice.js";
import {
  decodeRecord,
  encodeRecord,
  verifyRecord,
  type DotsEnvelope,
  type VerifyResult,
} from "./dots-outcome.js";
import {
  Dots,
  type BoardView,
  type EdgeVerdict,
  type Level,
  type SideCode,
  type TutorReport,
} from "./dots-wasm.js";

declare global {
  interface Window {
    /** E2E hook: the live binding + a re-render, so tests drive the core. */
    __dots?: {
      game: Dots;
      refresh: () => void;
      seed: bigint;
    };
    /** Test seam: override the local-AI model id (a smaller/faster model). */
    __DOTS_AI_MODEL?: string;
  }
}

/** The opponent's identity — honest: it is the shelf's engine. */
const OPPONENT = { name: "The Engine", avatar: "🤖" } as const;

const LOCAL_AI = "local-ai";
/** A small, fast model — the local-AI opponent is UX (banter), not strength. */
const LOCAL_AI_MODEL = "Qwen2.5-0.5B-Instruct-q4f16_1-MLC";
/** The experimental local-AI opponent's persona (the Chip/Rowan/Alder line). */
const LOCAL_AI_PERSONA = { name: "Bramble", avatar: "🌾" } as const;
const HYBRID_SYSTEM = [
  "You are Bramble, a friendly but competitive Dots and Boxes opponent.",
  "You always pick from the offered edges (they are safe by construction).",
  "You add a short, in-character line of banter — never analysis, never move lists.",
].join(" ");

const THINK_MS = 420;
const FANFARE_MS = 1200;
const LEVELS: readonly DotsLevel[] = ["Easy", "Medium", "Hard", "Perfect"];

/** The box mark for a side. Shape, not only colour, tells the two apart. */
const MARK: Record<SideCode, string> = { 1: "▲", 2: "●" };

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

/**
 * How an edge reads out loud: "top side of row 1, column 2" is unhelpful, so an
 * edge is named by its orientation and its position in the lattice. Pure, and
 * used for both the accessible label and any copy that names a move.
 */
export function edgeLabel(edge: number, rows: number, cols: number): string {
  const hEdges = (rows + 1) * cols;
  if (edge < hEdges) {
    const r = Math.floor(edge / cols);
    return `horizontal edge, row ${r + 1}, column ${(edge % cols) + 1}`;
  }
  const v = edge - hEdges;
  const r = Math.floor(v / (cols + 1));
  return `vertical edge, row ${r + 1}, column ${(v % (cols + 1)) + 1}`;
}

/**
 * What the coach may say about a move the player just made, or `null` when
 * there is nothing honest to add.
 *
 * The sentence itself is the **engine's** (`coach_line` in `dots-solver`, bound
 * to `exact` in Rust so a depth-capped verdict cannot be worded as a proof).
 * This adds only the pointer to a better edge — and hedges that pointer the same
 * way: a search that proved nothing cannot claim the other edge held the game.
 */
export function coachFor(
  verdict: EdgeVerdict | null,
  bestEdge: number | null,
  rows: number,
  cols: number,
): string | null {
  if (!verdict || verdict.quality === "optimal") return null;
  if (bestEdge === null) return verdict.line;
  const where = `The ${edgeLabel(bestEdge, rows, cols)}`;
  return verdict.exact
    ? `${verdict.line} ${where} held it.`
    : `${verdict.line} ${where} may be stronger.`;
}

/**
 * A hint: which edge the engine likes, **why** it likes it, and the fact that
 * taking it counts as assistance. A hint that only pointed would teach nothing,
 * and one that did not declare its cost would quietly weaken the record.
 */
export function hintLine(report: TutorReport, rows: number, cols: number): string | null {
  const best = report.bestCol;
  if (best === null) return null;
  const fact = report.moves.find((m) => m.col === best);
  const why = fact ? ` — ${fact.idea}` : "";
  return `Hint: the ${edgeLabel(best, rows, cols)}${why}. (A hint counts as assistance.)`;
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

/** The Dots result screen: outcome headline, verification badge, the final
 *  board, the record, and controls. Reuses the shared `sol-*` styling. */
function renderResultScreen(
  env: DotsEnvelope,
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
    ? "Verified ✓ — re-checked by replaying every edge against the core."
    : `Verification failed — expected hash ${verification.expected}, replay produced ${verification.actual}.`;
  section.append(badge);

  section.append(opts.finalBoard);

  const dl = el("dl", { class: "sol-record" });
  const row = (term: string, value: string, cls = ""): void => {
    dl.append(el("dt", {}, term), el("dd", cls ? { class: cls } : {}, value));
  };
  row("Result", opts.label);
  row("Edges drawn", String(rec.move_count));
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

/** Construct a fresh Dots and Boxes module (the registry `load`). */
export function dotsModule(): GameModule {
  let game: Dots | null = null;
  let verifier: Dots | null = null;
  let container: HTMLElement | null = null;
  let disposed = false;
  let thinking = false;
  let ending = false;
  let seed = 0n;
  let level: DotsLevel = dotsLevel();
  let seat: DotsSeat = dotsSeat();
  // Engine-grounded coaching for the human's last move, surfaced once the
  // engine has replied (so it does not spoil the reply). Cleared each turn.
  let coachMsg: string | null = null;
  let pendingCoach: string | null = null;
  /** Set when the player ends the match themselves — the honest report. */
  let endedEarly: string | null = null;

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

  const opponentIdentity = (): { name: string; avatar: string } =>
    opponentKind === LOCAL_AI ? LOCAL_AI_PERSONA : OPPONENT;

  /** The side value the human plays: 1 (opens) or 2 (replies). */
  const humanSide = (): SideCode => (seat === "first" ? 1 : 2);
  const engineSide = (): SideCode => (humanSide() === 1 ? 2 : 1);

  const statusEl = el("p", { class: "dots-status", role: "status", "aria-live": "polite" });
  const setStatus = (msg: string): void => {
    statusEl.textContent = msg;
  };

  const randomSeed = (): bigint => {
    const buf = new Uint32Array(2);
    crypto.getRandomValues(buf);
    return (BigInt(buf[0]!) << 16n) ^ BigInt(buf[1]! & 0xffff);
  };

  const shareUrlFor = async (env: DotsEnvelope): Promise<string> =>
    `${location.origin}${location.pathname}?r=${await encodeRecord(env)}`;
  const verify = (env: DotsEnvelope): VerifyResult => verifyRecord(verifier!, env);

  const gameOver = (): boolean => (game ? game.board().result !== -1 : false);
  const humanToMove = (): boolean => (game ? game.board().toMove === humanSide() : false);

  // --- the turn loop. A capture keeps the turn, so "whose move is it" is read
  // from the board every time rather than toggled — the rule that makes this
  // game different from the shelf's other three. ---
  const step = (): void => {
    if (disposed || !game || !container) return;
    if (gameOver()) {
      finish();
      return;
    }
    if (humanToMove()) {
      thinking = false;
      render();
      return;
    }
    thinking = true;
    setStatus(`${opponentIdentity().name} is thinking…`);
    render();
    window.setTimeout(() => {
      void (async () => {
      if (disposed || !game) return;
      const mv = opponentKind === LOCAL_AI ? await hybridMove() : game.liveMove(level as Level);
      if (disposed || !game) return;
      if (mv !== null) game.play(mv);
      const b = game.board();
      thinking = false;
      setStatus(
        b.keptTurn && b.result === -1
          ? `${opponentIdentity().name} closed a box — it goes again.`
          : "",
      );
      // The reply is in, so the coaching for the human's move can surface.
      if (pendingCoach !== null && b.toMove === humanSide()) {
        coachMsg = pendingCoach;
        pendingCoach = null;
      }
      step();
      })();
    }, THINK_MS);
  };

  const playEdge = (edge: number): void => {
    if (!game || thinking || ending || gameOver() || !humanToMove()) return;
    if (!game.board().legal.includes(edge)) return; // the core decides legality
    const dims = game.board();
    coachMsg = null; // clear last turn's coaching
    // Assess the tapped edge at the position it was tapped in — after the move
    // the facts are about a different board. The cheap per-tap export, not the
    // panel's: the panel's budget must not land on every tap.
    // The verdict drives the coach (when the tutor is on) and the local-AI
    // opponent's reaction, so it is read whenever either could use it.
    const wantVerdict = dotsTutorEnabled() || opponentKind === LOCAL_AI;
    const verdict = wantVerdict ? game.assess(edge) : null;
    lastHumanQuality = verdict?.quality ?? null;
    const pending =
      dotsTutorEnabled() && verdict && verdict.quality !== "optimal"
        ? coachFor(verdict, game.coach().bestCol, dims.rows, dims.cols)
        : null;
    if (game.play(edge) !== "applied") return;
    const b = game.board();
    setStatus(b.keptTurn && b.result === -1 ? "You closed a box — your turn again." : "");
    // Hold the coaching until the engine has replied, so it does not sit on
    // screen spoiling a move that has not happened yet.
    if (b.result !== -1 || b.toMove === humanSide()) coachMsg = pending;
    else pendingCoach = pending;
    step();
  };

  // --- assistance ---

  const showHint = (): void => {
    if (!game || thinking || ending || gameOver() || !humanToMove()) return;
    const b = game.board();
    const said = hintLine(game.coach(), b.rows, b.cols);
    if (!said) return;
    game.markAssistance(); // the binding holds the flag; the record carries it
    setStatus(said);
    render();
  };

  /** Hints off: the control ends the match, and says what was left on the board. */
  const endNow = (): void => {
    if (!game || ending) return;
    const left = game.board().legal.length;
    endedEarly = `Ended early — ${left} edges were still undrawn.`;
    finish();
  };

  // --- the experimental local-AI opponent ---
  // What just happened, in one word — drives the persona prompt and the fallback
  // line, so the banter is reactive rather than generic.
  type Situation = "closing" | "giving" | "blundered" | "neutral";
  const readSituation = (band: readonly BandMove[]): Situation => {
    if (band.some((m) => m.idea.startsWith("closes"))) return "closing";
    if (lastHumanQuality === "blunder") return "blundered";
    if (band.every((m) => m.idea.startsWith("hands over"))) return "giving";
    return "neutral";
  };
  const SITUATION_HINT: Record<Situation, string> = {
    closing: "A box is there for the taking — claim it with a little flourish.",
    giving: "Every line on offer hands something over — be rueful about it.",
    blundered: "The player just slipped — tease taking advantage.",
    neutral: "Nothing decisive yet — a light competitive jab.",
  };
  const FALLBACK_LINE: Record<Situation, string> = {
    closing: "That one's mine. And I go again.",
    giving: "Fine. Take it — I'll take the next three.",
    blundered: "Ooh, thank you for that.",
    neutral: "Your move. I'm not worried yet.",
  };

  const hybridPrompt = (g: Dots, band: readonly BandMove[], sit: Situation): string => {
    const edges = band.map((m) => m.col).join(", ");
    return [
      `Board (free edges show their own number):\n${g.renderText()}`,
      SITUATION_HINT[sit],
      `Draw ONE of these edges: ${edges}.`,
      `Reply ONLY with JSON {"move": <one of ${edges}>, "reason": "<your one-line quip, under 12 words>"}.`,
    ].join("\n");
  };

  // The engine builds a never-throw band, the LLM picks within it and quips, and
  // any failure falls back to the engine. `buildBand`/`HybridPlayer` are the
  // shipped shared ones, unchanged — the fourth game to reuse them as-is.
  const hybridMove = async (): Promise<number | null> => {
    if (!game) return null;
    try {
      if (!runtime || !hybrid) {
        setStatus(`${LOCAL_AI_PERSONA.name}: warming up the model (one-time download)…`);
        render();
        runtime = new WebLLMRuntime({
          model: window.__DOTS_AI_MODEL ?? LOCAL_AI_MODEL,
          onProgress: (t) => setStatus(`${LOCAL_AI_PERSONA.name}: ${t}`),
        });
        hybrid = new HybridPlayer(runtime);
      }
      // This game's `idea` comes from the engine itself (Rust), so unlike the
      // other three the band needs no phrasing here — the same sentence the
      // tutor and the harness adapter carry.
      const band = buildBand(game.tutor().moves);
      if (band.length === 0) return game.liveMove(level as Level); // no band → classic safety
      const sit = readSituation(band);
      const decision = await hybrid.pick(band, {
        prompt: hybridPrompt(game, band, sit),
        system: HYBRID_SYSTEM,
      });
      // The shared filter decides whether the model's own words are fit to speak
      // (`src/harness/banter.ts`): a line that claims something about the board
      // can be false, and a persona that sounds authoritative and is wrong is the
      // cosmetic cousin of an over-claimed `exact`.
      aiSay = speak(decision, FALLBACK_LINE[sit]).line;
      return decision.move;
    } catch {
      aiSay = null;
      return game.liveMove(level as Level); // never break the game on an AI failure
    }
  };

  // A real WebGPU adapter is required; probe once on mount and offer the toggle
  // only if it passes (the classic engine otherwise).
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

  const buildBoard = (board: BoardView, interactive: boolean): HTMLElement => {
    const boardEl = el("div", {
      class: `dots-board${interactive ? "" : " dots-final"}`,
      role: "group",
      "aria-label": interactive ? "Dots and Boxes board" : "Final board",
      style: `grid-template-columns: var(--dots-node) repeat(${board.cols}, var(--dots-span) var(--dots-node)); grid-template-rows: var(--dots-node) repeat(${board.rows}, var(--dots-span) var(--dots-node));`,
    });
    const canPlay = interactive && !thinking && !ending && !gameOver() && humanToMove();
    for (const cell of latticeCells(board.rows, board.cols)) {
      if (cell.kind === "dot") {
        boardEl.append(el("div", { class: "dots-dot", "aria-hidden": "true" }));
        continue;
      }
      if (cell.kind === "box") {
        const owner = board.owners[cell.index] ?? 0;
        const who = owner === humanSide() ? "You" : OPPONENT.name;
        boardEl.append(
          el(
            "div",
            {
              class: `dots-box${owner === 1 ? " a" : owner === 2 ? " b" : ""}`,
              role: "img",
              "aria-label": owner ? `Box claimed by ${who}` : "Unclaimed box",
            },
            owner ? el("span", { class: "dots-mark", "aria-hidden": "true" }, MARK[owner as SideCode]) : "",
          ),
        );
        continue;
      }
      const e = cell.index;
      const owner = board.edgeOwner[e] ?? 0;
      const drawn = board.drawn[e] === true;
      const legal = canPlay && board.legal.includes(e);
      const just = interactive && board.lastEdge === e;
      const name = edgeLabel(e, board.rows, board.cols);
      const shape = cell.kind === "h" ? "h" : "v";
      const marks = `${drawn ? " drawn" : ""}${owner === 1 ? " a" : owner === 2 ? " b" : ""}${just ? " just-drawn" : ""}`;
      if (legal) {
        const closes = game ? game.closesCount(e) : 0;
        boardEl.append(
          el("button", {
            type: "button",
            class: `dots-edge ${shape} legal${marks}`,
            "data-edge": String(e),
            "aria-label": closes > 0 ? `Draw ${name} — closes ${closes === 2 ? "two boxes" : "a box"}` : `Draw ${name}`,
          }),
        );
      } else {
        boardEl.append(
          el("div", {
            class: `dots-edge ${shape}${marks}`,
            "data-edge": String(e),
            "aria-hidden": "true",
          }),
        );
      }
    }
    if (interactive) {
      boardEl.addEventListener("click", (ev) => {
        const target = (ev.target as HTMLElement).closest<HTMLElement>(".dots-edge.legal");
        if (target?.dataset.edge) playEdge(Number(target.dataset.edge));
      });
    }
    return boardEl;
  };

  const yourBoxes = (board: BoardView): number =>
    humanSide() === 1 ? board.boxesA : board.boxesB;
  const theirBoxes = (board: BoardView): number =>
    humanSide() === 1 ? board.boxesB : board.boxesA;

  const renderTurnbar = (board: BoardView): HTMLElement => {
    const turn =
      board.result !== -1
        ? ""
        : board.toMove === humanSide()
          ? "Your move"
          : `${opponentIdentity().name} to move`;
    return el(
      "div",
      { class: "dots-turnbar" },
      el(
        "span",
        { class: "dots-score you" },
        `You ${MARK[humanSide()]} ${yourBoxes(board)}`,
      ),
      el(
        "span",
        { class: "dots-score them" },
        `${opponentIdentity().name} ${opponentIdentity().avatar} ${MARK[engineSide()]} ${theirBoxes(board)}`,
      ),
      el("span", { class: "dots-turn", role: "status", "aria-live": "polite" }, turn),
    );
  };

  const renderControls = (): HTMLElement => {
    const bar = el("div", { class: "sol-controls dots-controls" });

    const levelSel = el("select", { class: "dots-level", "aria-label": "Difficulty" });
    for (const l of LEVELS) {
      const opt = el("option", { value: l }, l);
      if (l === level) opt.setAttribute("selected", "");
      levelSel.append(opt);
    }
    levelSel.addEventListener("change", () => {
      level = levelSel.value as DotsLevel;
      setDotsLevel(level);
    });

    const seatSel = el("select", { class: "dots-seat", "aria-label": "Your seat" });
    for (const [val, txt] of [
      ["second", "Second (reply)"],
      ["first", "First (open)"],
    ] as const) {
      const opt = el("option", { value: val }, txt);
      if (val === seat) opt.setAttribute("selected", "");
      seatSel.append(opt);
    }
    seatSel.addEventListener("change", () => {
      seat = seatSel.value as DotsSeat;
      setDotsSeat(seat);
      void startGame(); // a new seat restarts (it changes who opens)
    });

    const fresh = el("button", { type: "button", class: "sol-fresh" }, "New game");
    fresh.addEventListener("click", () => void startGame());

    // The shared assistance control: a hint while hints are on, and otherwise
    // the honest way out — ending the match rather than pretending it finished.
    const hints = hintsEnabled();
    const action = el(
      "button",
      { type: "button", class: hints ? "dots-hint" : "dots-stuck" },
      hints ? "Hint" : "I’m done",
    );
    action.addEventListener("click", hints ? showHint : endNow);

    const toggle = (
      checked: boolean,
      label: string,
      cls: string,
      onChange: (on: boolean) => void,
    ): HTMLElement => {
      const input = el("input", { type: "checkbox", class: cls });
      (input as HTMLInputElement).checked = checked;
      input.addEventListener("change", () => onChange((input as HTMLInputElement).checked));
      return el("label", { class: "dots-toggle" }, input, ` ${label}`);
    };
    const details = el("details", { class: "sol-settings dots-settings" });
    details.append(
      el("summary", {}, "Settings"),
      toggle(hints, "Enable hints", "dots-set-hints", (on) => {
        setHintsEnabled(on);
        render(); // relabel the action control (Hint ↔ I'm done)
      }),
      toggle(declareAssistanceEnabled(), "Declare assistance used", "dots-set-assist", (on) => {
        setDeclareAssistance(on);
      }),
      toggle(dotsTutorEnabled(), "Show tutor", "dots-set-tutor", (on) => {
        setDotsTutor(on);
        render();
      }),
    );
    if (localAiAvailable) {
      details.append(
        toggle(
          opponentKind === LOCAL_AI,
          "Experimental: local AI opponent",
          "dots-ai-toggle-input",
          (on) => {
            opponentKind = on ? LOCAL_AI : "engine";
            aiSay = null;
            render();
          },
        ),
        el(
          "p",
          { class: "dots-ai-disclosure" },
          // Both costs stated, and the guarantee stated *with its reason* — which
          // is what makes it true here and false in Furrow, where the same
          // sentence had to be withdrawn. See `docs/AI-PLAYERS.md` → "The band's
          // guarantee is only as strong as the exact fraction".
          `An in-browser model (${LOCAL_AI_PERSONA.name}) picks within the engine's safe edges and adds banter — a one-time ~270 MB download, then about a quarter-second a move. It never plays a losing move: this board is solved from four edges in, so the engine's band is a proof rather than a guess.`,
        ),
      );
    }

    bar.append(
      el("label", { class: "dots-field" }, "Difficulty ", levelSel),
      el("label", { class: "dots-field" }, "You play ", seatSel),
      fresh,
      action,
      details,
    );
    return bar;
  };

  // --- the tutor panel (engine-grounded coaching; opt-in, no GPU) ---
  const renderTutorPanel = (): HTMLElement => {
    const panel = el("section", { class: "dots-tutor", "aria-label": "Tutor" });
    const explain = el(
      "button",
      { type: "button", class: "dots-tutor-explain" },
      "Explain my options",
    );
    const note = el("p", { class: "dots-tutor-note", "aria-live": "polite" });
    const optionsEl = el("ul", { class: "dots-tutor-options", "aria-label": "Reasonable edges" });
    explain.addEventListener("click", () => {
      if (!game || thinking || ending || gameOver() || !humanToMove()) return;
      // Paint the reading state BEFORE the deep search starts. The panel's
      // search blocks the main thread, so without this the button looks dead
      // for as long as it runs — the lesson checkers learned the hard way.
      note.textContent = "Reading ahead…";
      const g = game;
      const b = g.board();
      window.setTimeout(() => {
        const report = g.tutor();
        const band = report.moves
          .filter((m) => m.quality !== "blunder")
          .sort((x, y) => y.value - x.value);
        note.textContent = report.exact ? "Solved from here:" : "Reading ahead (not yet certain):";
        optionsEl.replaceChildren(
          ...band
            .slice(0, 6)
            .map((m) => el("li", {}, `${edgeLabel(m.col, b.rows, b.cols)} — ${m.idea}`)),
        );
      }, 0);
    });
    const coach = el("p", { class: "dots-tutor-coach", role: "status", "aria-live": "polite" });
    if (coachMsg) coach.textContent = coachMsg;
    panel.append(explain, note, optionsEl, coach);
    return panel;
  };

  function render(): void {
    if (disposed || !container || !game) return;
    const board = game.board();
    container.replaceChildren(
      el(
        "div",
        { class: "dots-game" },
        renderTurnbar(board),
        // The local-AI opponent's spoken reason for its last move (personality).
        ...(aiSay && opponentKind === LOCAL_AI
          ? [el("p", { class: "dots-ai-say", role: "status" }, `${LOCAL_AI_PERSONA.name}: ${aiSay}`)]
          : []),
        renderControls(),
        el(
          "p",
          { class: "dots-banner" },
          "Tap an edge. Draw the fourth side of a box to claim it — and go again. Most boxes wins.",
        ),
        buildBoard(board, true),
        ...(dotsTutorEnabled() ? [renderTutorPanel()] : []),
        statusEl,
      ),
    );
  }

  const outcomeLabel = (board: BoardView): string => {
    const you = yourBoxes(board);
    const them = theirBoxes(board);
    // An unfinished match reports what was left rather than a score nobody
    // reached — the record says `Abandoned`, and the screen should agree.
    if (board.result === -1) return endedEarly ?? "Ended early";
    if (board.result === 0) return `A draw ${you}–${them}`;
    return you > them ? `You won ${you}–${them}` : `${opponentIdentity().name} won ${them}–${you}`;
  };

  const finish = (): void => {
    if (!game || !container) return;
    ending = true;
    const board = game.board();
    const won = yourBoxes(board) > theirBoxes(board);
    container.replaceChildren(
      el(
        "div",
        { class: "dots-game" },
        renderTurnbar(board),
        el("p", { class: `dots-flash${won ? " win" : ""}`, role: "status" }, outcomeLabel(board)),
        buildBoard(board, false),
      ),
    );
    window.setTimeout(() => {
      if (disposed) return;
      void presentResult();
    }, FANFARE_MS);
  };

  const presentResult = async (): Promise<void> => {
    if (!container || !game) return;
    const env = game.outcome(declareAssistanceEnabled()) as DotsEnvelope;
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
    coachMsg = null;
    pendingCoach = null;
    endedEarly = null;
    aiSay = null;
    lastHumanQuality = null;
    seed = seedOverride ?? randomSeed();
    game.newGame(seed);
    setStatus("");
    exposeHook();
    step(); // if the human took the second seat, the engine opens here
  }

  const showShared = async (payload: string): Promise<void> => {
    if (!container) return;
    let env: DotsEnvelope;
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
    // A shared record is Side-A-centric; the viewer is a spectator, so the label
    // names the sides by seat rather than pretending they played.
    const label =
      board.result === 0
        ? `A draw ${board.boxesA}–${board.boxesB}`
        : board.result === 1
          ? `First player won ${board.boxesA}–${board.boxesB}`
          : `Second player won ${board.boxesB}–${board.boxesA}`;
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
    window.__dots = { game, refresh: () => render(), seed };
  };

  return {
    mount(c: HTMLElement): void {
      container = c;
      disposed = false;
      level = dotsLevel();
      seat = dotsSeat();
      container.replaceChildren(el("div", { class: "sol-loading" }, "Loading Dots and Boxes…"));
      void (async () => {
        try {
          game = await Dots.load();
          verifier = await Dots.load();
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
        // Probe WebGPU in the background; if present the controls re-render with
        // the experimental local-AI opponent offered (classic engine otherwise).
        void probeLocalAi();
      })();
    },
    unmount(): void {
      disposed = true;
      delete window.__dots;
      container?.replaceChildren();
      container = null;
      game = null;
      verifier = null;
      runtime = null; // release the WebGPU engine (local-AI) if it was created
      hybrid = null;
    },
  };
}
