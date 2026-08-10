//! Furrow (mancala) over the `furrow-wasm` binding: a tap-to-play two-player
//! game against the shelf's engine. You tap one of your pits; every seed in it is
//! sown one at a time around the board, skipping the opponent's store. Land the
//! last seed in your own store and **you go again**. Land it in an empty pit on
//! your own side and you take that seed and everything facing it. When either
//! side runs out of seeds the other sweeps the rest, and the bigger store wins.
//!
//! Three things drive the UI, and all three come from the core:
//!
//! - **The sow is animated from `sowPath`**, never from a loop in TypeScript. One
//!   move drops seeds into as many as thirteen cells and skips exactly one of the
//!   fourteen; a second implementation of that rule would be a second place for
//!   it to be wrong. The core says which cells, in order; the UI lights them up.
//! - **The core decides legality.** Every pit is tappable and the core refuses
//!   what is not legal, rather than the UI gating taps — the tap-first standard,
//!   and the reason an empty pit is inert without the UI knowing why.
//! - **The sweep is announced.** The final score is not what accumulated during
//!   play, so a player who is not told the sweep happened reads the end screen as
//!   a bug.
//!
//! A finished match is a verifiable `pond-outcome` record, shareable via `?r=`.

import type { GameModule } from "../../contract.js";
import { WebLLMRuntime } from "../../harness/ai-runtime.js";
import { speak } from "../../harness/banter.js";
import { buildBand, HybridPlayer, type BandMove } from "../../harness/hybrid-player.js";
import {
  declareAssistanceEnabled,
  furrowLevel,
  furrowTutorEnabled,
  hintsEnabled,
  setDeclareAssistance,
  setFurrowLevel,
  setFurrowTutor,
  setHintsEnabled,
  type FurrowLevel,
} from "../../settings.js";
import {
  decodeRecord,
  encodeRecord,
  verifyRecord,
  type FurrowEnvelope,
  type VerifyResult,
} from "./furrow-outcome.js";
import {
  Furrow,
  type BoardView,
  type Level,
  type PitVerdict,
  type SideCode,
  type TutorReport,
} from "./furrow-wasm.js";

declare global {
  interface Window {
    /** Test seam: override the local-AI model id (a smaller/faster model). */
    __FURROW_AI_MODEL?: string;
    /** E2E hook: the live binding + a re-render, so tests drive the core. */
    __furrow?: {
      game: Furrow;
      refresh: () => void;
      seed: bigint;
      /** True while a sow is animating — tests wait on this rather than a timer. */
      busy: () => boolean;
    };
  }
}

/** The opponent's identity — honest: it is the shelf's engine. */
const OPPONENT = { name: "The Engine", avatar: "🤖" } as const;

const LOCAL_AI = "local-ai";
/** A small, fast model — the local-AI opponent is UX (banter), not strength. */
const LOCAL_AI_MODEL = "Qwen2.5-0.5B-Instruct-q4f16_1-MLC";
/** The experimental local-AI opponent's persona, continuing the Chip / Rowan /
 *  Alder / Bramble line. Millet is a seed crop, which is what this game sows. */
const LOCAL_AI_PERSONA = { name: "Millet", avatar: "\u{1F331}" } as const;
const HYBRID_SYSTEM = [
  "You are Millet, a friendly but competitive mancala opponent.",
  "You always pick from the offered pits (they are safe by construction).",
  "You add a short, in-character line of banter — never analysis, never move lists.",
].join(" ");

/** The human opens (Side A). Unlike dots, no seat is a known loss: Phase 0 could
 *  not solve the opening, so the published first-player advantage is not
 *  something this shelf has reproduced or relies on. */
const HUMAN: SideCode = 1;
const ENGINE: SideCode = 2;

/** Milliseconds between seeds landing. Fourteen cells at this rate is under a
 *  second, which reads as a sow rather than a slideshow. */
const SEED_MS = 55;
/** A beat after the sow lands, so a capture or an extra turn is legible. */
const SETTLE_MS = 180;
/** How long the engine appears to think before its sow starts. */
const THINK_MS = 380;
/** How long the final board is shown before the verifiable result screen. */
const FANFARE_MS = 1200;

const LEVELS: readonly FurrowLevel[] = ["Easy", "Medium", "Hard", "Expert"];

/** The mark for a side. Shape, not only colour, tells the two apart. */
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

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });

function randomSeed(): bigint {
  const buf = new Uint32Array(2);
  crypto.getRandomValues(buf);
  return (BigInt(buf[0]!) << 21n) ^ BigInt(buf[1]!);
}

/**
 * How a pit reads out loud. Pure, and used for the accessible label and for any
 * copy that names a move.
 *
 * Pits are numbered by **absolute cell**, which is what the record carries — but
 * "cell 9" means nothing to a player, so the label says whose row it is and
 * which pit along that row, counting from the side's own end.
 */
export function pitLabel(pit: number, pits: number): string {
  if (pit < pits) return `your pit ${pit + 1}`;
  return `their pit ${pit - pits}`;
}

/** Which side owns `cell`, or null for a store. Pure. */
export function ownerOfCell(cell: number, pits: number): SideCode | null {
  if (cell < pits) return 1;
  if (cell === pits) return null; // A's store
  if (cell < 2 * pits + 1) return 2;
  return null; // B's store
}

/**
 * What the coach may say about a move the player just made, or `null` when there
 * is nothing honest to add.
 *
 * The sentence itself is the **engine's** (`coach_line` in `furrow-solver`, bound
 * to `exact` in Rust so a depth-capped verdict cannot be worded as a proof). This
 * adds only the pointer to a better pit — and hedges that pointer the same way: a
 * search that proved nothing cannot claim the other pit held the game. That
 * matters more here than in any shelf game so far, because Phase 0 measured about
 * **70% of a game** sitting above the exact threshold.
 */
export function coachFor(
  verdict: PitVerdict | null,
  bestPit: number | null,
  pits: number,
): string | null {
  if (!verdict || verdict.quality === "optimal") return null;
  if (bestPit === null) return verdict.line;
  const where = capitalise(pitLabel(bestPit, pits));
  return verdict.exact ? `${verdict.line} ${where} held it.` : `${verdict.line} ${where} may be stronger.`;
}

/**
 * A hint: which pit the engine likes, **why** it likes it, and the fact that
 * taking it counts as assistance. A hint that only pointed would teach nothing,
 * and one that did not declare its cost would quietly weaken the record.
 */
export function hintLine(report: TutorReport, pits: number): string | null {
  const best = report.bestCol;
  if (best === null) return null;
  const fact = report.moves.find((m) => m.col === best);
  const why = fact ? ` — ${fact.idea}` : "";
  return `Hint: ${pitLabel(best, pits)}${why}. (A hint counts as assistance.)`;
}

/** Sentence-case a label that starts a sentence. */
function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * The line under the board: whose turn, and why it is still theirs.
 *
 * The extra turn is the rule a player is most likely to read as a bug, so it is
 * stated rather than left to be inferred from a board that did not change hands.
 */
export function turnLine(
  board: BoardView,
  humanToMove: boolean,
  opponentName: string = OPPONENT.name,
): string {
  if (board.result !== -1) return "The game is over.";
  if (board.keptTurn) {
    return humanToMove
      ? "Your seed landed in your store — go again."
      : `${opponentName} landed in its store — it goes again.`;
  }
  return humanToMove ? "Your move." : `${opponentName} is thinking…`;
}

interface ResultScreenOpts {
  label: string;
  finalBoard: HTMLElement;
  shareUrl?: string;
  shared?: boolean;
  onReverify?: () => void;
  onPlayAgain?: () => void;
}

function renderResultScreen(
  env: FurrowEnvelope,
  verification: VerifyResult,
  opts: ResultScreenOpts,
): HTMLElement {
  const rec = env.payload;
  const section = el("section", {
    class: "sol-result",
    role: "region",
    "aria-label": "Result",
  });
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
    ? "Verified ✓ — re-checked by replaying every sow against the core."
    : `Verification failed — expected hash ${verification.expected}, replay produced ${verification.actual}.`;
  section.append(badge);

  section.append(opts.finalBoard);

  const dl = el("dl", { class: "sol-record" });
  const row = (term: string, value: string, cls = ""): void => {
    dl.append(el("dt", {}, term), el("dd", cls ? { class: cls } : {}, value));
  };
  row("Result", opts.label);
  row("Pits sown", String(rec.move_count));
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
        {
          class: "sol-share",
          href: opts.shareUrl,
          "data-share": opts.shareUrl,
        },
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

/** Construct a fresh Furrow module (the registry `load`). */
export function furrowModule(): GameModule {
  let game: Furrow | null = null;
  let verifier: Furrow | null = null;
  let container: HTMLElement | null = null;
  let disposed = false;
  let busy = false;
  let ending = false;
  let seed = 0n;
  let level: FurrowLevel = furrowLevel();
  let status = "";
  let sweptNotice = false;
  /** The coach's line about the human's last move, shown in the tutor panel. */
  let coachMsg: string | null = null;
  /** The verdict captured *before* the human's move is applied — a move can only
   *  be graded against the position it was played in. */
  let pendingCoach: string | null = null;
  /** Set when the player ends the match early, so the record and the screen agree. */
  let endedEarly: string | null = null;
  /**
   * The tutor panel's last reading, held in module state rather than in the DOM.
   *
   * Without this the panel is wiped by the next `render()` — and a re-render
   * lands shortly after every turn settles, so the options a player just asked
   * for vanish under them. `TODO/dots.md` files this as a shared defect across
   * othello, checkers and dots; Furrow does not inherit it. The reading is
   * cleared when the position it described stops being the current one, because
   * a stale reading is worse than none.
   */
  let tutorView: { note: string; options: string[]; hash: string } | null = null;

  // --- experimental local-AI opponent (hybrid: engine band + LLM in-band pick) ---
  // The engine still decides *which moves are safe*; the model only picks among
  // them and says something. Reuses the game-agnostic hybrid harness unchanged —
  // the fifth game to do so, and the second where the band's `idea` already comes
  // from Rust so there is nothing to phrase here.
  let localAiAvailable = false;
  let opponentKind: "engine" | typeof LOCAL_AI = "engine" as "engine" | typeof LOCAL_AI;
  let runtime: WebLLMRuntime | null = null;
  let hybrid: HybridPlayer | null = null;
  let aiSay: string | null = null;

  const opponentIdentity = (): { name: string; avatar: string } =>
    opponentKind === LOCAL_AI ? LOCAL_AI_PERSONA : OPPONENT;

  /** What the position is about, for the persona's tone only — never for play. */
  type Situation = "chaining" | "capturing" | "starved" | "neutral";
  const readSituation = (band: readonly BandMove[]): Situation => {
    if (band.some((m) => /go again/.test(m.idea))) return "chaining";
    if (band.some((m) => /^captures /.test(m.idea))) return "capturing";
    if (band.length <= 2) return "starved";
    return "neutral";
  };
  const SITUATION_HINT: Record<Situation, string> = {
    chaining: "A pit lands in your store — take the free turn with a little flourish.",
    capturing: "There is a capture on the board — be pleased with yourself.",
    starved: "Your row is nearly empty — be wry about having no choices left.",
    neutral: "Nothing decisive yet — a light competitive jab.",
  };
  const FALLBACK_LINE: Record<Situation, string> = {
    chaining: "Straight into the store. And again.",
    capturing: "Those were sitting there so nicely.",
    starved: "Not much left on my side. Not much needed.",
    neutral: "Your move. I'm not worried yet.",
  };

  const hybridPrompt = (g: Furrow, band: readonly BandMove[], sit: Situation): string => {
    const pits = band.map((m) => m.col).join(", ");
    return [
      `Board (each pit reads as pitNumber=seeds):\n${g.renderText()}`,
      SITUATION_HINT[sit],
      `Sow ONE of these pits: ${pits}.`,
      `Reply ONLY with JSON {"move": <one of ${pits}>, "reason": "<your one-line quip, under 12 words>"}.`,
    ].join("\n");
  };

  const hybridMove = async (): Promise<number | null> => {
    if (!game) return null;
    try {
      if (!runtime || !hybrid) {
        setStatus(`${LOCAL_AI_PERSONA.name}: warming up the model (one-time download)\u2026`);
        render();
        runtime = new WebLLMRuntime({
          model: window.__FURROW_AI_MODEL ?? LOCAL_AI_MODEL,
          onProgress: (t) => setStatus(`${LOCAL_AI_PERSONA.name}: ${t}`),
        });
        hybrid = new HybridPlayer(runtime);
      }
      // The band's `idea` is the engine's own sentence (Rust), so the UI
      // opponent, the tutor and the harness adapter all carry one wording rather
      // than three that agree.
      const band = buildBand(game.tutor().moves);
      if (band.length === 0) return game.liveMove(level as Level); // no band -> classic safety
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

  const setStatus = (text: string): void => {
    status = text;
    const node = container?.querySelector(".furrow-status");
    if (node) node.textContent = text;
  };

  const yourStore = (b: BoardView): number => (HUMAN === 1 ? b.storeA : b.storeB);
  const theirStore = (b: BoardView): number => (HUMAN === 1 ? b.storeB : b.storeA);

  // ---------- rendering ----------

  const pitButton = (board: BoardView, cell: number, interactive: boolean): HTMLElement => {
    const mine = ownerOfCell(cell, board.pits) === HUMAN;
    // The ring marks *your* tappable pits, and only while it is your turn.
    // `board.legal` is the mover's legal set, so during the engine's turn it
    // holds the engine's pits — ringing those would both confuse the player and
    // quietly hand them the opponent's options, which is assistance nobody asked
    // for. Gate it on `interactive`, which already means "yours, now".
    const legal = interactive && mine && board.legal.includes(cell);
    const seeds = board.cells[cell] ?? 0;
    const classes = ["furrow-pit", mine ? "mine" : "theirs"];
    if (legal) classes.push("legal");
    if (seeds === 0) classes.push("empty");
    if (board.lastPit === cell) classes.push("just-sown");
    // Every pit is tappable and the CORE refuses what is not legal. That is the
    // tap-first standard, and it is why an empty pit is inert without the UI
    // having to know the rule that makes it so.
    const node = el(
      "button",
      {
        type: "button",
        class: classes.join(" "),
        "data-pit": String(cell),
        "aria-label": `${pitLabel(cell, board.pits)}, ${seeds} ${seeds === 1 ? "seed" : "seeds"}`,
        ...(interactive ? {} : { "aria-disabled": "true" }),
      },
      el("span", { class: "furrow-count" }, String(seeds)),
    );
    return node;
  };

  const storeCell = (board: BoardView, side: SideCode): HTMLElement => {
    const count = side === 1 ? board.storeA : board.storeB;
    const who = side === HUMAN ? "You" : OPPONENT.name;
    return el(
      "div",
      {
        class: `furrow-store ${side === HUMAN ? "mine" : "theirs"}`,
        "data-store": String(side),
        "aria-label": `${who}: ${count} banked`,
        role: "img",
      },
      el("span", { class: "furrow-mark" }, MARK[side]),
      el("span", { class: "furrow-count" }, String(count)),
    );
  };

  /**
   * The board, laid out the way it faces the players: the opponent's row reads
   * right-to-left along the top, yours left-to-right along the bottom, with each
   * store at its owner's end.
   */
  const buildBoard = (board: BoardView, interactive: boolean): HTMLElement => {
    const theirs: number[] = [];
    for (let i = 2 * board.pits; i >= board.pits + 1; i -= 1) theirs.push(i);
    const mine: number[] = [];
    for (let i = 0; i < board.pits; i += 1) mine.push(i);

    const boardEl = el(
      "div",
      { class: "furrow-board", role: "group", "aria-label": "Furrow board" },
      storeCell(board, ENGINE),
      el(
        "div",
        { class: "furrow-rows" },
        el(
          "div",
          { class: "furrow-row theirs" },
          el("span", { class: "furrow-rowmark", "aria-hidden": "true" }, MARK[ENGINE]),
          ...theirs.map((c) => pitButton(board, c, false)),
        ),
        el(
          "div",
          { class: "furrow-row mine" },
          el("span", { class: "furrow-rowmark", "aria-hidden": "true" }, MARK[HUMAN]),
          ...mine.map((c) => pitButton(board, c, interactive)),
        ),
      ),
      storeCell(board, HUMAN),
    );
    // The board cannot reflow — a mancala row that wrapped would stop being a
    // row — so it sizes to its contents inside a wrapper that scrolls.
    return el("div", { class: "furrow-boardwrap" }, boardEl);
  };

  const renderTurnbar = (board: BoardView): HTMLElement => {
    const humanTurn = board.toMove === HUMAN;
    return el(
      "div",
      { class: "furrow-turnbar", role: "status" },
      el(
        "span",
        { class: `furrow-seat you${humanTurn ? " active" : ""}` },
        `${MARK[HUMAN]} You ${yourStore(board)}`,
      ),
      el(
        "span",
        { class: `furrow-seat them${humanTurn ? "" : " active"}` },
        `${opponentIdentity().avatar} ${opponentIdentity().name} ${theirStore(board)}`,
      ),
    );
  };

  const renderControls = (): HTMLElement => {
    const select = el("select", { class: "furrow-level", "aria-label": "Difficulty" });
    for (const l of LEVELS) {
      const opt = el("option", l === level ? { selected: "selected" } : {}, l);
      opt.setAttribute("value", l);
      select.append(opt);
    }
    select.addEventListener("change", () => {
      level = select.value as FurrowLevel;
      setFurrowLevel(level);
    });

    const fresh = el("button", { type: "button", class: "furrow-new" }, "New game");
    fresh.addEventListener("click", () => void startGame());

    // The shared assistance control: a hint while hints are on, and otherwise
    // the honest way out — ending the match rather than pretending it finished.
    const hints = hintsEnabled();
    const action = el(
      "button",
      { type: "button", class: hints ? "furrow-hint" : "furrow-stuck" },
      hints ? "Hint" : "I\u2019m done",
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
      return el("label", { class: "furrow-toggle" }, input, ` ${label}`);
    };
    const details = el("details", { class: "sol-settings furrow-settings" });
    details.append(
      el("summary", {}, "Settings"),
      toggle(hints, "Enable hints", "furrow-set-hints", (on) => {
        setHintsEnabled(on);
        render(); // relabel the action control (Hint <-> I'm done)
      }),
      toggle(declareAssistanceEnabled(), "Declare assistance used", "furrow-set-assist", (on) => {
        setDeclareAssistance(on);
      }),
      toggle(furrowTutorEnabled(), "Show tutor", "furrow-set-tutor", (on) => {
        setFurrowTutor(on);
        render();
      }),
    );
    if (localAiAvailable) {
      details.append(
        toggle(
          opponentKind === LOCAL_AI,
          "Experimental: local AI opponent",
          "furrow-ai-toggle-input",
          (on) => {
            opponentKind = on ? LOCAL_AI : "engine";
            aiSay = null;
            render();
          },
        ),
        el(
          "p",
          { class: "furrow-ai-disclosure" },
          // Measured, not asserted (2026-08-10, 8 games vs Expert). The earlier
          // copy said "never plays a losing move (the engine's band decides)",
          // copied from dots — where it is true, because 3x3 is solved from four
          // plies in and the band's class floor is a *proof* nearly everywhere.
          // Here roughly 70% of a game is above the exact threshold, so for most
          // of it the band is the engine's judgement rather than a guarantee, and
          // the model picks badly within it: Millet wins 1 game in 8 where the
          // engine itself draws 4. Saying "never plays a losing move" was the
          // cosmetic cousin of an over-claimed `exact`.
          `An in-browser model (${LOCAL_AI_PERSONA.name}) picks among the pits the engine rates as sound and adds banter — a one-time ~270 MB download on first use. It plays weaker than the engine, measured at 1 win in 8 against Expert: outside the endgame the engine is judging which pits are sound rather than proving it.`,
        ),
      );
    }

    return el(
      "div",
      { class: "furrow-controls" },
      el("label", { class: "furrow-field" }, "Difficulty ", select),
      fresh,
      action,
      details,
    );
  };

  const humanToMove = (): boolean =>
    Boolean(game) && game!.board().toMove === HUMAN && game!.board().result === -1;

  /** Point at a good pit, say why, and declare the cost. */
  const showHint = (): void => {
    if (!game || busy || ending || !humanToMove()) return;
    const said = hintLine(game.coach(), game.board().pits);
    if (!said) return;
    game.markAssistance();
    setStatus(said);
  };

  /** End the match now and report what was left, rather than pretending it
   *  finished. The record says `Abandoned`, and the screen must agree. */
  const endNow = (): void => {
    if (!game || ending) return;
    const board = game.board();
    endedEarly = `Ended early \u2014 ${board.inPlay} seeds were still on the board`;
    finish();
  };

  // --- the tutor panel (engine-grounded coaching; opt-in, no GPU) ---
  const renderTutorPanel = (): HTMLElement => {
    const panel = el("section", { class: "furrow-tutor", "aria-label": "Tutor" });
    const explain = el(
      "button",
      { type: "button", class: "furrow-tutor-explain" },
      "Explain my options",
    );
    const note = el("p", { class: "furrow-tutor-note", "aria-live": "polite" });
    const optionsEl = el("ul", { class: "furrow-tutor-options", "aria-label": "Reasonable pits" });
    // Repaint the last reading, if it still describes the position on screen.
    if (tutorView && game && tutorView.hash === game.currentHash()) {
      note.textContent = tutorView.note;
      optionsEl.replaceChildren(...tutorView.options.map((line) => el("li", {}, line)));
    }
    explain.addEventListener("click", () => {
      if (!game || busy || ending || !humanToMove()) return;
      // Paint the reading state BEFORE the deep search starts. The panel's search
      // blocks the main thread, so without this the button looks dead for as long
      // as it runs — the lesson checkers learned the hard way.
      note.textContent = "Reading ahead\u2026";
      const g = game;
      const pits = g.board().pits;
      const at = g.currentHash();
      window.setTimeout(() => {
        const report = g.tutor();
        const band = report.moves
          .filter((m) => m.quality !== "blunder")
          .sort((x, y) => y.value - x.value);
        // The panel is the only surface allowed to claim a proof, and it may only
        // do so when the search actually reached terminals.
        const heading = report.exact ? "Solved from here:" : "Reading ahead (not yet certain):";
        const options = band
          .slice(0, 6)
          .map((m) => `${pitLabel(m.col, pits)} \u2014 ${m.idea}`);
        tutorView = { note: heading, options, hash: at };
        note.textContent = heading;
        optionsEl.replaceChildren(...options.map((line) => el("li", {}, line)));
      }, 0);
    });
    const coach = el("p", { class: "furrow-tutor-coach", role: "status", "aria-live": "polite" });
    if (coachMsg) coach.textContent = coachMsg;
    panel.append(explain, note, optionsEl, coach);
    return panel;
  };

  const render = (): void => {
    if (!game || !container || ending) return;
    const board = game.board();
    const humanTurn = board.toMove === HUMAN;
    const statusEl = el("p", { class: "furrow-status", role: "status" }, status);
    container.replaceChildren(
      el(
        "div",
        { class: "furrow-game" },
        renderTurnbar(board),
        // The local-AI opponent's spoken reason for its last move (personality).
        ...(aiSay && opponentKind === LOCAL_AI
          ? [
              el(
                "p",
                { class: "furrow-ai-say", role: "status" },
                `${LOCAL_AI_PERSONA.name}: ${aiSay}`,
              ),
            ]
          : []),
        renderControls(),
        el(
          "p",
          { class: "furrow-banner" },
          "Tap one of your pits. Land your last seed in your store to go again; land it in an empty pit of yours to capture. Most seeds wins.",
        ),
        buildBoard(board, humanTurn && !busy),
        el("p", { class: "furrow-turnline" }, turnLine(board, humanTurn, opponentIdentity().name)),
        ...(furrowTutorEnabled() ? [renderTutorPanel()] : []),
        statusEl,
      ),
    );
    const boardEl = container.querySelector(".furrow-board");
    boardEl?.addEventListener("click", onBoardClick);
  };

  // ---------- the sow, animated from the core's own preview ----------

  const animateSow = async (pit: number): Promise<void> => {
    if (!game || !container) return;
    const preview = game.sowPath(pit);
    if (!preview) return;
    const boardEl = container.querySelector(".furrow-board");
    if (!boardEl) return;
    for (const cell of preview.path) {
      if (disposed) return;
      const node = boardEl.querySelector(`[data-pit="${cell}"], [data-store="${cellStore(cell)}"]`);
      node?.classList.add("landing");
      await sleep(SEED_MS);
      node?.classList.remove("landing");
    }
    if (preview.capturesFrom !== null) {
      boardEl.querySelector(`[data-pit="${preview.capturesFrom}"]`)?.classList.add("captured");
      await sleep(SETTLE_MS);
    }
  };

  /** The store side a cell index denotes, or -1 when it is a pit. Pure. */
  const cellStore = (cell: number): number => {
    const board = game?.board();
    if (!board) return -1;
    if (cell === board.aStore) return 1;
    if (cell === board.bStore) return 2;
    return -1;
  };

  const applyMove = async (pit: number): Promise<void> => {
    if (!game || busy || ending) return;
    if (game.board().toMove !== HUMAN) return;
    // Ask the core first: an illegal tap is refused here, not filtered by the UI.
    const preview = game.sowPath(pit);
    if (!preview) {
      setStatus("That pit has nothing to sow.");
      return;
    }
    // A refusal from a previous tap has been answered by this one; leaving it up
    // would have the board contradict itself.
    if (status) setStatus("");
    // Grade the move against the position it was played in, before it is applied
    // — afterwards that position no longer exists. The sentence is the engine's;
    // `coachFor` adds only the pointer, hedged the same way.
    if (furrowTutorEnabled()) {
      pendingCoach = coachFor(game.assess(pit), game.coach().bestCol, game.board().pits);
    }
    busy = true;
    render();
    await animateSow(pit);
    if (disposed || !game) return;
    const before = game.board();
    const outcome = game.play(pit);
    busy = false;
    if (outcome !== "applied") {
      setStatus("That move is not legal here.");
      render();
      return;
    }
    const after = game.board();
    noteSweep(before, after);
    coachMsg = pendingCoach;
    pendingCoach = null;
    tutorView = null; // the reading described the position before this move
    render();
    await step();
  };

  const noteSweep = (before: BoardView, after: BoardView): void => {
    if (!after.sweptAtEnd || sweptNotice) return;
    sweptNotice = true;
    const swept = after.storeA + after.storeB - (before.storeA + before.storeB);
    setStatus(
      `One side ran out of seeds — the other swept the ${swept} still on the board. That is why the score jumped.`,
    );
  };

  const onBoardClick = (ev: Event): void => {
    const target = (ev.target as HTMLElement | null)?.closest("[data-pit]");
    if (!target || !game || busy || ending) return;
    const board = game.board();
    if (board.toMove !== HUMAN || board.result !== -1) return;
    const pit = Number(target.getAttribute("data-pit"));
    void applyMove(pit);
  };

  /** Let the engine move for as long as the turn is its own. */
  const step = async (): Promise<void> => {
    if (!game || disposed || ending) return;
    let guard = 0;
    while (game.board().result === -1 && game.board().toMove === ENGINE && guard < 40) {
      guard += 1;
      busy = true;
      render();
      await sleep(THINK_MS);
      if (disposed || !game) return;
      const mv = opponentKind === LOCAL_AI ? await hybridMove() : game.liveMove(level as Level);
      if (mv === null) break;
      await animateSow(mv);
      if (disposed || !game) return;
      const before = game.board();
      game.play(mv);
      const after = game.board();
      noteSweep(before, after);
      busy = false;
      render();
      await sleep(SETTLE_MS);
    }
    busy = false;
    if (!game || disposed) return;
    if (game.board().result !== -1) {
      finish();
      return;
    }
    render();
  };

  // ---------- ending ----------

  const outcomeLabel = (board: BoardView): string => {
    const you = yourStore(board);
    const them = theirStore(board);
    // An unfinished match reports what was left rather than a score nobody
    // reached — the record says `Abandoned`, and the screen should agree.
    if (board.result === -1) return endedEarly ?? "Ended early";
    if (board.result === 0) return `A draw ${you}–${them}`;
    return you > them ? `You won ${you}–${them}` : `${OPPONENT.name} won ${them}–${you}`;
  };

  const verify = (env: FurrowEnvelope): VerifyResult => verifyRecord(verifier!, env);

  const shareUrlFor = async (env: FurrowEnvelope): Promise<string> => {
    const payload = await encodeRecord(env);
    const url = new URL(location.href);
    url.search = "";
    url.searchParams.set("r", payload);
    return url.toString();
  };

  const finish = (): void => {
    if (!game || !container) return;
    ending = true;
    const board = game.board();
    const won = yourStore(board) > theirStore(board);
    container.replaceChildren(
      el(
        "div",
        { class: "furrow-game" },
        renderTurnbar(board),
        el("p", { class: `furrow-flash${won ? " win" : ""}`, role: "status" }, outcomeLabel(board)),
        buildBoard(board, false),
        el("p", { class: "furrow-status", role: "status" }, status),
      ),
    );
    window.setTimeout(() => {
      if (disposed) return;
      void presentResult();
    }, FANFARE_MS);
  };

  const presentResult = async (): Promise<void> => {
    if (!container || !game) return;
    const env = game.outcome(declareAssistanceEnabled()) as FurrowEnvelope;
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
    busy = false;
    ending = false;
    sweptNotice = false;
    coachMsg = null;
    pendingCoach = null;
    endedEarly = null;
    tutorView = null;
    aiSay = null;
    seed = seedOverride ?? randomSeed();
    game.newGame(seed);
    setStatus("");
    exposeHook();
    render();
    await step();
  }

  const showShared = async (payload: string): Promise<void> => {
    if (!container) return;
    let env: FurrowEnvelope;
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
        ? `A draw ${board.storeA}–${board.storeB}`
        : board.result === 1
          ? `First player won ${board.storeA}–${board.storeB}`
          : `Second player won ${board.storeB}–${board.storeA}`;
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
    window.__furrow = { game, refresh: () => render(), seed, busy: () => busy };
  };

  return {
    mount(c: HTMLElement): void {
      container = c;
      disposed = false;
      level = furrowLevel();
      container.replaceChildren(el("div", { class: "sol-loading" }, "Loading Furrow…"));
      void (async () => {
        try {
          game = await Furrow.load();
          verifier = await Furrow.load();
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
      delete window.__furrow;
      container?.replaceChildren();
      container = null;
      game = null;
      verifier = null;
      runtime = null; // release the WebGPU engine (local-AI) if it was created
      hybrid = null;
    },
  };
}
