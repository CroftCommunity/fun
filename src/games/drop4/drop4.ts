//! Drop 4 over the `drop4-wasm` binding: a tap-to-play two-player game against
//! the shelf's classic engine. You pick your disc (✕ or ○) and open; tap
//! anywhere in a column to drop into its lowest empty slot, and **The Engine**
//! replies. Four in a row — across, up, or diagonally — wins; a full board is a
//! draw. The core decides legality (a full column is not a legal target), and a
//! finished match is a verifiable `pond-outcome` record, shareable via `?r=`.
//!
//! The opponent is the **live** depth-capped engine (`liveMove`), fast from any
//! position — not the exact oracle (minutes from the opening). Difficulty is a
//! picker (Easy…Perfect) mapped to the engine's strength; both the level and the
//! chosen mark persist.

import type { GameModule } from "../../contract.js";
import { Drop4, type BoardView, type Level, type MoveAssessment } from "./drop4-wasm.js";
import { WebLLMRuntime } from "../../harness/ai-runtime.js";
import { buildBand, HybridPlayer, type BandMove } from "../../harness/hybrid-player.js";
import {
  decodeRecord,
  encodeRecord,
  verifyRecord,
  type Drop4Envelope,
  type VerifyResult,
} from "./drop4-outcome.js";
import {
  declareAssistanceEnabled,
  drop4Level,
  drop4Mark,
  drop4TutorEnabled,
  hintsEnabled,
  setDeclareAssistance,
  setDrop4Level,
  setDrop4Mark,
  setDrop4Tutor,
  setHintsEnabled,
  type Drop4Mark,
} from "../../settings.js";

declare global {
  interface Window {
    /** E2E hook: the live binding + a re-render, so tests drive the core. */
    __drop4?: {
      game: Drop4;
      refresh: () => void;
      seed: bigint;
    };
    /** Test seam: override the local-AI model id (e.g. a smaller/faster model in
     *  the ai:trial driver). Falls back to the pinned model when unset. */
    __DROP4_AI_MODEL?: string;
  }
}

/** The opponent's identity — honest: it is the shelf's classic engine. */
const OPPONENT = { name: "The Engine", avatar: "🤖" } as const;
/** A brief "thinking" pause before the engine replies, so its move reads. */
const THINK_MS = 450;
/** How long the winning board is held (a little fanfare) before the result. */
const FANFARE_MS = 1300;
const LEVELS: readonly Level[] = ["Easy", "Medium", "Hard", "Perfect"];
/** The picker value / opponent kind for the experimental local-AI hybrid. */
const LOCAL_AI = "local-ai";
/**
 * The pinned local-AI model (embedded WebLLM; downloaded once, then cached).
 * A **small** model on purpose: the LLM only writes a one-line quip within the
 * engine's band — size barely helps short banter (the 1.5B was no better and
 * much slower, painfully so on mobile), so we default to the fast 0.5B.
 */
const LOCAL_AI_MODEL = "Qwen2.5-0.5B-Instruct-q4f16_1-MLC";
/** The local-AI opponent's persona (distinct from the classic "The Engine"). */
const LOCAL_AI_PERSONA = { name: "Chip", avatar: "😎" } as const;
/**
 * Persona system prompt — the small model needs tight, concrete rules to sound
 * like a character instead of narrating strategy in the third person.
 */
const HYBRID_SYSTEM = [
  `You are ${LOCAL_AI_PERSONA.name}, a Connect Four opponent with a cocky but`,
  "good-natured personality. You talk a little trash and give credit when it's due.",
  "RULES: speak in FIRST person as yourself, TO your opponent (say \"you\", never",
  "\"the opponent\" or \"the engine\"). ONE short sentence, under 12 words. React to",
  "what JUST happened — never explain strategy or name the board in the third",
  'person. Reply ONLY with JSON {"move": <one of the offered columns>, "reason":',
  '"<your one-line quip>"}.',
].join(" ");
/** Display labels for the picker — the internal `Level`/persisted value stays
 *  `Perfect` (it is the exact/best-play level), but "Expert" reads better and
 *  doesn't overclaim (it is only provably perfect once the game is tractable). */
const LEVEL_LABELS: Record<Level, string> = {
  Easy: "Easy",
  Medium: "Medium",
  Hard: "Hard",
  Perfect: "Expert",
};

type Mark = Drop4Mark;
type Cell = [number, number];

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

const glyphFor = (m: Mark): string => (m === "x" ? "✕" : "○");
const other = (m: Mark): Mark => (m === "x" ? "o" : "x");

/** A short, engine-grounded idea for why a move is reasonable (tutor copy). */
const ideaFor = (m: MoveAssessment): string =>
  m.immediateWin
    ? "wins now"
    : m.blocksOpponentWin
      ? "blocks their threat"
      : m.quality === "optimal"
        ? "your strongest line"
        : "stays safe";

/**
 * Coaching for a just-tapped move, or null if it was not a blunder. Honest
 * about certainty: only when the facts are provably `exact` (endgame) does it
 * say the move *threw* the game; when the facts are the horizon-approximate
 * capped search's it softens to "looks risky" (it cannot prove the class drop).
 */
const coachFor = (
  verdict: MoveAssessment | null,
  bestCol: number | null,
  exact: boolean,
): string | null => {
  if (!verdict || verdict.quality !== "blunder" || bestCol === null) return null;
  const held = `column ${bestCol + 1}`;
  return exact
    ? `That threw the game — ${held} held it.`
    : `That looks risky — ${held} may have been safer.`;
};

/** The human-facing outcome from a live/replayed result code (draw-aware). */
function outcomeLabel(code: number): string {
  if (code === 1) return "You won";
  if (code === 2) return `${OPPONENT.name} won`;
  if (code === 0) return "A draw";
  return "Ended early";
}

/** The winning four (row, col) cells for `val`, or `[]` if none. Display-only —
 *  it scans the final board so the win is *shown*, never trusting a flag. */
function winningLine(cells: number[][], val: number): Cell[] {
  if (val !== 1 && val !== 2) return [];
  const h = cells.length;
  const w = cells[0]?.length ?? 0;
  const dirs: Cell[] = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ];
  for (let r = 0; r < h; r += 1) {
    for (let c = 0; c < w; c += 1) {
      if (cells[r]![c] !== val) continue;
      for (const [dr, dc] of dirs) {
        const line: Cell[] = [[r, c]];
        for (let k = 1; k < 4; k += 1) {
          const nr = r + dr * k;
          const nc = c + dc * k;
          if (nr < 0 || nr >= h || nc < 0 || nc >= w || cells[nr]![nc] !== val) break;
          line.push([nr, nc]);
        }
        if (line.length === 4) return line;
      }
    }
  }
  return [];
}

const inLine = (line: Cell[], r: number, c: number): boolean =>
  line.some(([lr, lc]) => lr === r && lc === c);

// ---------- the result screen (pure DOM) ----------

export interface ResultScreenOpts {
  label: string;
  finalBoard: HTMLElement;
  shareUrl?: string;
  onReverify?: () => void;
  onPlayAgain?: () => void;
  shared?: boolean;
}

/** Build the Drop 4 result screen: outcome headline, verification badge, the
 *  final board (winning line highlighted), the record, and controls. */
export function renderResultScreen(
  env: Drop4Envelope,
  verification: VerifyResult,
  opts: ResultScreenOpts,
): HTMLElement {
  const rec = env.payload;
  const section = el("section", { class: "sol-result", role: "region", "aria-label": "Result" });
  const headline = verification.ok
    ? `${opts.label} — verifiable`
    : "Verification FAILED — this result does not check out";
  section.append(el("h2", { class: "sol-headline" }, headline));

  const badge = el("p", {
    class: `sol-verify-badge ${verification.ok ? "ok" : "fail"}`,
    role: "status",
  });
  badge.textContent = verification.ok
    ? "Verified ✓ — re-checked by replaying every move against the core."
    : `Verification failed — expected hash ${verification.expected}, replay produced ${verification.actual}.`;
  section.append(badge);

  // The final position, so the winning move (and the four-in-a-row) is visible.
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

/** Construct a fresh Drop 4 module (the registry `load`). */
export function drop4Module(): GameModule {
  let game: Drop4 | null = null;
  let verifier: Drop4 | null = null;
  let container: HTMLElement | null = null;
  let disposed = false;
  let thinking = false;
  let ending = false;
  let seed = 0n;
  let level: Level = drop4Level();
  let playerMark: Mark = drop4Mark();
  let lastMove: Cell | null = null;
  // Engine-grounded coaching for the human's last move, surfaced after the
  // engine replies (so it does not spoil the reply). Cleared each human turn.
  let coachMsg: string | null = null;

  // --- experimental local-AI opponent (hybrid: engine band + LLM in-band pick) ---
  // Offered only when a real WebGPU adapter is present; the classic engine stays
  // the default. All LLM code is lazy — no model download unless the toggle is on
  // and a move is played.
  let localAiAvailable = false;
  let opponentKind: "engine" | typeof LOCAL_AI = "engine";
  let runtime: WebLLMRuntime | null = null;
  let hybrid: HybridPlayer | null = null;
  /** The opponent's spoken line for its last move (local-AI only). */
  let aiSay: string | null = null;
  /** Signals about the human's last move, for the local-AI opponent's reaction:
   *  the move's quality, and whether it blocked the opponent's winning threat. */
  let lastHumanQuality: "optimal" | "resultPreserving" | "blunder" | null = null;
  let lastHumanBlocked = false;

  const statusEl = el("p", { class: "sol-status", role: "status", "aria-live": "polite" });
  const setStatus = (msg: string): void => {
    statusEl.textContent = msg;
  };

  // Which mark each side shows: the human (Side A, value 1) plays playerMark;
  // the engine (Side B, value 2) plays the other. Colour follows the mark.
  const markForValue = (v: number): Mark | null =>
    v === 1 ? playerMark : v === 2 ? other(playerMark) : null;

  // The opponent's shown identity: the classic engine by default, the local-AI
  // persona (Chip) when that opponent is toggled on.
  const opponentIdentity = (): { name: string; avatar: string } =>
    opponentKind === LOCAL_AI ? LOCAL_AI_PERSONA : OPPONENT;

  const randomSeed = (): bigint => {
    const buf = new Uint32Array(2);
    crypto.getRandomValues(buf);
    return (BigInt(buf[0]!) << 16n) ^ BigInt(buf[1]! & 0xffff);
  };

  const shareUrlFor = async (env: Drop4Envelope): Promise<string> =>
    `${location.origin}${location.pathname}?r=${await encodeRecord(env)}`;

  const verify = (env: Drop4Envelope): VerifyResult => verifyRecord(verifier!, env);

  const gameOver = (): boolean => (game ? game.board().result !== -1 : false);
  const humanToMove = (): boolean => (game ? game.board().toMove === 1 : false);

  const columnFill = (cells: number[][], c: number): number => {
    let n = 0;
    for (const rowVals of cells) if (rowVals[c] !== 0) n += 1;
    return n;
  };

  const applyMove = (col: number): boolean => {
    if (!game) return false;
    if (game.play(col) !== "applied") return false;
    lastMove = [columnFill(game.board().cells, col) - 1, col];
    return true;
  };

  const playCol = (col: number): void => {
    if (!game || thinking || ending || gameOver() || !humanToMove()) return;
    coachMsg = null; // clear last turn's coaching
    // Assess the tapped move at the *current* position (human to move) before
    // it is applied — "was that a blunder" needs the position before the move.
    // This drives the tutor coach (only when the opt-in tutor is on) AND the
    // local-AI opponent's reaction (banter), so capture the quality either way.
    const report = game.tutor();
    const verdict = report.moves.find((m) => m.col === col) ?? null;
    lastHumanQuality = verdict?.quality ?? null;
    lastHumanBlocked = verdict?.blocksOpponentWin ?? false;
    const pending = drop4TutorEnabled() ? coachFor(verdict, report.bestCol, report.exact) : null;
    if (!applyMove(col)) return; // the core decides; illegal = no-op
    setStatus("");
    if (gameOver()) {
      coachMsg = pending; // a game-ending blunder is still explained (tutor on)
      finish();
      return;
    }
    render();
    scheduleEngine(pending);
  };

  // The opponent replies after a brief "thinking" beat. The classic engine uses
  // the fast live engine (never the exact oracle, minutes from the opening); the
  // experimental local-AI opponent asks the hybrid. Any coaching for the human's
  // move is surfaced *after* the reply, so it does not spoil it.
  const scheduleEngine = (pending: string | null): void => {
    if (!game) return;
    thinking = true;
    setStatus(`${opponentIdentity().name} is thinking…`);
    render();
    window.setTimeout(() => void engineReply(pending), THINK_MS);
  };

  const engineReply = async (pending: string | null): Promise<void> => {
    if (disposed || !game) return;
    const col = opponentKind === LOCAL_AI ? await hybridMove() : game.liveMove(level);
    if (disposed || !game) return;
    thinking = false;
    if (col !== null) applyMove(col);
    if (gameOver()) {
      coachMsg = pending;
      finish();
      return;
    }
    setStatus("");
    coachMsg = pending;
    render();
  };

  // What just happened, in one word — drives both the persona prompt and the
  // deterministic fallback line, so the banter is *reactive*, not generic.
  type Situation = "blocked-me" | "blundered" | "solid" | "i-can-win" | "neutral";
  const readSituation = (band: readonly BandMove[]): Situation => {
    if (band.some((m) => m.idea === "wins now")) return "i-can-win";
    if (lastHumanBlocked) return "blocked-me";
    if (lastHumanQuality === "blunder") return "blundered";
    if (lastHumanQuality === "optimal") return "solid";
    return "neutral";
  };
  const SITUATION_HINT: Record<Situation, string> = {
    "blocked-me": "You just blocked the line I was building — react to that.",
    blundered: "You just played a weak move — tease me taking advantage.",
    solid: "You just played a solid move — give a little credit, stay competitive.",
    "i-can-win": "You can complete four this move — claim the win with a flourish.",
    neutral: "Nothing decisive yet — a light competitive jab.",
  };
  // In-character canned lines, used when the small model returns nothing usable.
  const FALLBACK_LINE: Record<Situation, string> = {
    "blocked-me": "I thought I had you there.",
    blundered: "Ooh, risky — I'll take it.",
    solid: "Nice one. I'm just getting started.",
    "i-can-win": "Gotcha. Good game.",
    neutral: "Your move. I'm not worried yet.",
  };

  // Build the persona prompt from the board, the situation, and the never-throw
  // band. The LLM picks within the band and writes Chip's one-line quip.
  const hybridPrompt = (g: Drop4, band: readonly BandMove[], sit: Situation): string => {
    const legal = band.map((m) => m.col).join(", ");
    return [
      `Board (you are playing as your discs):\n${g.renderText()}`,
      `${SITUATION_HINT[sit]}`,
      `Drop into ONE of these columns: ${legal}.`,
      `Your voice, e.g.: "Bold move — let's see." / "I thought I had you." / "Gotcha, good game."`,
      `Reply ONLY with JSON {"move": <one of ${legal}>, "reason": "<your one-line quip, under 12 words>"}.`,
    ].join("\n");
  };

  // Keep the model's quip only if it's usable (short, non-empty); else fall back
  // to the in-character line for the situation — the small model whiffs often.
  const cleanBanter = (reason: string, sit: Situation): string => {
    const r = reason.trim();
    return r.length > 0 && r.length <= 90 ? r : FALLBACK_LINE[sit];
  };

  const hybridMove = async (): Promise<number | null> => {
    if (!game) return null;
    try {
      if (!runtime || !hybrid) {
        setStatus(`${LOCAL_AI_PERSONA.name}: warming up the model (one-time download)…`);
        render();
        runtime = new WebLLMRuntime({
          model: window.__DROP4_AI_MODEL ?? LOCAL_AI_MODEL,
          onProgress: (t) => setStatus(`${LOCAL_AI_PERSONA.name}: ${t}`),
        });
        hybrid = new HybridPlayer(runtime);
      }
      const band = buildBand(game.tutor().moves);
      if (band.length === 0) return game.liveMove(level); // no band → classic safety
      const sit = readSituation(band);
      const decision = await hybrid.pick(band, { prompt: hybridPrompt(game, band, sit), system: HYBRID_SYSTEM });
      // The LLM's line if usable, else the in-character fallback (also used when
      // the hybrid itself fell back to the engine move — source === "fallback").
      aiSay = decision.source === "llm" ? cleanBanter(decision.reason, sit) : FALLBACK_LINE[sit];
      return decision.move;
    } catch {
      aiSay = null;
      return game.liveMove(level); // never break the game on an AI failure
    }
  };

  // A real WebGPU adapter is required for the local-AI opponent; probe once on
  // mount and offer the toggle only if it passes (classic levels otherwise).
  const probeLocalAi = async (): Promise<void> => {
    try {
      const gpu = (
        navigator as Navigator & {
          gpu?: { requestAdapter(): Promise<{ isFallbackAdapter?: boolean } | null> };
        }
      ).gpu;
      const adapter = gpu ? await gpu.requestAdapter() : null;
      // Require a real adapter — exclude software/fallback adapters (e.g. bundled
      // Chromium's SwiftShader), which cannot run the model usefully.
      localAiAvailable = Boolean(adapter && adapter.isFallbackAdapter !== true);
    } catch {
      localAiAvailable = false;
    }
    if (!disposed) render();
  };

  // --- hints ---

  const showHint = (): void => {
    if (!game || thinking || ending || gameOver() || !humanToMove()) return;
    // The engine's best move *and why* — a class-preserving band move plus the
    // fact that makes it good. Using a hint counts as assistance.
    const report = game.tutor();
    const best = report.bestCol;
    if (best === null) return;
    const m = report.moves.find((mm) => mm.col === best) ?? null;
    game.markAssistance();
    const why = m ? ideaFor(m) : "a strong drop";
    setStatus(`Hint: column ${best + 1} — ${why} (a hint counts as assistance).`);
  };

  const endNow = (): void => {
    setStatus("Ended early — the match was unfinished.");
    void presentResult();
  };

  // --- rendering ---

  const renderTurnbar = (): HTMLElement => {
    const over = gameOver();
    const youActive = !over && !thinking && !ending && humanToMove();
    const oppActive = !over && (thinking || !humanToMove());
    const you = el(
      "div",
      { class: `drop4-player you${youActive ? " active" : ""}` },
      el("span", { class: `drop4-chip ${playerMark}`, "aria-hidden": "true" }, glyphFor(playerMark)),
      el("span", { class: "drop4-name" }, "You"),
    );
    const opp = el(
      "div",
      { class: `drop4-player opp${oppActive ? " active" : ""}` },
      el(
        "span",
        { class: `drop4-chip ${other(playerMark)}`, "aria-hidden": "true" },
        glyphFor(other(playerMark)),
      ),
      el(
        "span",
        { class: "drop4-name" },
        `${opponentIdentity().name} ${opponentIdentity().avatar}`,
      ),
      ...(thinking ? [el("span", { class: "drop4-thinking" }, "thinking…")] : []),
    );
    return el(
      "div",
      { class: "drop4-turnbar", role: "group", "aria-label": "Players" },
      you,
      el("span", { class: "drop4-vs", "aria-hidden": "true" }, "vs"),
      opp,
    );
  };

  const renderOptions = (): HTMLElement => {
    const opts = el("div", { class: "drop4-options" });

    const levelLabel = el("label", { class: "drop4-level-label" }, "Difficulty ");
    const select = el("select", { class: "drop4-level", "aria-label": "Difficulty" });
    for (const lv of LEVELS) {
      const o = el("option", { value: lv }, LEVEL_LABELS[lv]);
      if (lv === level) (o as HTMLOptionElement).selected = true;
      select.append(o);
    }
    select.addEventListener("change", () => {
      level = (select as HTMLSelectElement).value as Level;
      setDrop4Level(level);
    });
    levelLabel.append(select);

    const marks = el("div", { class: "drop4-marks", role: "group", "aria-label": "Play as" });
    marks.append(el("span", { class: "drop4-marks-label" }, "You play "));
    for (const m of ["x", "o"] as Mark[]) {
      const b = el(
        "button",
        {
          type: "button",
          class: `drop4-mark ${m}`,
          "data-mark": m,
          "aria-pressed": String(playerMark === m),
          "aria-label": `Play as ${m === "x" ? "cross" : "nought"}`,
        },
        glyphFor(m),
      );
      b.addEventListener("click", () => {
        if (playerMark === m) return;
        playerMark = m;
        setDrop4Mark(m);
        render();
      });
      marks.append(b);
    }

    opts.append(levelLabel, marks);
    // The experimental local-AI opponent — a separate toggle offered only when a
    // real (non-fallback) WebGPU adapter is present. The classic engine + its
    // difficulty picker stay the default and are unaffected.
    if (localAiAvailable) {
      const aiWrap = el("label", { class: "drop4-ai-toggle" });
      const input = el("input", { type: "checkbox", class: "drop4-ai-toggle-input" });
      (input as HTMLInputElement).checked = opponentKind === LOCAL_AI;
      input.addEventListener("change", () => {
        opponentKind = (input as HTMLInputElement).checked ? LOCAL_AI : "engine";
        render();
      });
      aiWrap.append(input, document.createTextNode(" Experimental: local AI opponent"));
      opts.append(aiWrap);
    }
    // First-use disclosure: the local-AI opponent downloads a model to the
    // browser once, then runs on-device. Shown up front, before any download.
    if (opponentKind === LOCAL_AI) {
      opts.append(
        el(
          "p",
          { class: "drop4-ai-disclosure", role: "note" },
          "Experimental: this downloads a ~1 GB AI model to your browser once, then runs fully on your device (offline after that). It plays with personality, not extra strength — the classic engine stays the default and the stronger opponent.",
        ),
      );
    }
    return opts;
  };

  const renderControls = (): HTMLElement => {
    const bar = el("div", { class: "sol-controls" });
    const modes = el("div", { class: "sol-modes", role: "group", "aria-label": "Game" });
    const fresh = el("button", { type: "button", class: "sol-new" }, "New game");
    fresh.addEventListener("click", () => void startGame());
    modes.append(fresh);

    const hints = hintsEnabled();
    const actionBtn = el(
      "button",
      { type: "button", class: hints ? "sol-hint" : "sol-stuck" },
      hints ? "Hint" : "I’m done",
    );
    actionBtn.addEventListener("click", hints ? showHint : endNow);

    const setting = (
      checked: boolean,
      label: string,
      cls: string,
      onChange: (on: boolean) => void,
    ): HTMLElement => {
      const wrap = el("label", { class: "sol-setting" });
      const input = el("input", { type: "checkbox", class: cls });
      (input as HTMLInputElement).checked = checked;
      input.addEventListener("change", () => onChange((input as HTMLInputElement).checked));
      wrap.append(input, document.createTextNode(` ${label}`));
      return wrap;
    };
    const settings = el("details", { class: "sol-settings" });
    settings.append(
      el("summary", {}, "Settings"),
      setting(hints, "Enable hints", "sol-set-hints", (on) => {
        setHintsEnabled(on);
        render();
      }),
      setting(declareAssistanceEnabled(), "Declare assistance used", "sol-set-assist", (on) => {
        setDeclareAssistance(on);
      }),
      setting(drop4TutorEnabled(), "Show tutor", "sol-set-tutor", (on) => {
        setDrop4Tutor(on);
        render();
      }),
    );

    bar.append(modes, actionBtn, settings);
    return bar;
  };

  /** Build a board element. `interactive` adds the drop controls + click/glow;
   *  a static board (result screen / fanfare) just shows the final position. */
  const buildBoard = (board: BoardView, opts: { interactive: boolean; winLine: Cell[] }): HTMLElement => {
    const { interactive, winLine } = opts;
    const boardEl = el("div", {
      class: `drop4-board${interactive ? "" : " drop4-final"}`,
      role: "group",
      "aria-label": interactive ? "Drop 4 board" : "Final board",
    });
    const canDrop = interactive && !thinking && !ending && !gameOver() && humanToMove();
    const cols = el("div", { class: "drop4-cols" });
    for (let c = 0; c < board.width; c += 1) {
      const open = board.legal.includes(c);
      const glow = interactive && open && canDrop;
      const colEl = el("div", {
        class: `drop4-col${glow ? " legal" : ""}`,
        "data-col": String(c),
      });
      if (interactive) {
        // The accessible, keyboard-operable drop control (the whole column is
        // also a pointer target — see the delegated handler below).
        colEl.append(
          el(
            "button",
            {
              type: "button",
              class: "drop4-drop",
              "data-col": String(c),
              "aria-label": open ? `Drop in column ${c + 1}` : `Column ${c + 1} is full`,
            },
            // Visible 1-based column number (so "column N" from the tutor/hint is
            // legible) + the drop-arrow affordance.
            el("span", { class: "drop4-colnum", "aria-hidden": "true" }, String(c + 1)),
            el("span", { class: "drop4-arrow", "aria-hidden": "true" }, "▼"),
          ),
        );
      }
      // Cells top-to-bottom (row 0 is the bottom).
      for (let r = board.height - 1; r >= 0; r -= 1) {
        const v = board.cells[r]![c]!;
        const mark = markForValue(v);
        const who = mark === playerMark ? "you" : mark ? OPPONENT.name : "empty";
        const win = inLine(winLine, r, c);
        const justPlayed = interactive && lastMove?.[0] === r && lastMove?.[1] === c;
        colEl.append(
          el(
            "div",
            {
              class: `drop4-cell${mark ? ` ${mark}` : ""}${win ? " win" : ""}${justPlayed ? " just-played" : ""}`,
              role: "img",
              "aria-label": `Row ${r + 1} column ${c + 1}: ${who === "empty" ? "empty" : `${who} (${mark ? glyphFor(mark) : ""})`}`,
            },
            mark ? glyphFor(mark) : "",
          ),
        );
      }
      cols.append(colEl);
    }
    if (interactive) {
      cols.addEventListener("click", (e) => {
        const colEl = (e.target as HTMLElement).closest<HTMLElement>(".drop4-col");
        if (colEl?.dataset.col) playCol(Number(colEl.dataset.col));
      });
    }
    boardEl.append(cols);
    return boardEl;
  };

  // --- the tutor panel (engine-grounded coaching; on by default, no GPU) ---

  const renderTutorPanel = (): HTMLElement => {
    const panel = el("section", { class: "drop4-tutor", "aria-label": "Tutor" });
    const explain = el(
      "button",
      { type: "button", class: "drop4-tutor-explain" },
      "Explain my options",
    );
    const note = el("p", { class: "drop4-tutor-note", "aria-live": "polite" });
    const optionsEl = el("ul", { class: "drop4-tutor-options", "aria-label": "Reasonable moves" });
    explain.addEventListener("click", () => {
      if (!game || thinking || ending || gameOver() || !humanToMove()) return;
      const report = game.tutor();
      // The class-preserving band — moves that do not throw the game — best first.
      const band = report.moves
        .filter((m) => m.quality !== "blunder")
        .sort((a, b) => b.value - a.value);
      // Honest: early facts are horizon-approximate, not proven (kept out of the
      // list so each list item is a real column option).
      note.textContent = report.exact ? "" : "Reading ahead (not yet certain):";
      optionsEl.replaceChildren(
        ...band.map((m) => el("li", {}, `Column ${m.col + 1} — ${ideaFor(m)}`)),
      );
      // When the local-AI toggle is on AND the model is already loaded, let the
      // LLM narrate the same (engine-grounded) options in a friendlier sentence.
      // The facts stay the deterministic list above; the LLM only reweords —
      // best-effort, never triggers a download, degrades to the list on failure.
      if (opponentKind === LOCAL_AI && runtime) void narrateOptions(band, note);
    });
    const coach = el("p", { class: "drop4-tutor-coach", role: "status", "aria-live": "polite" });
    if (coachMsg) coach.textContent = coachMsg;
    panel.append(explain, note, optionsEl, coach);
    return panel;
  };

  // Best-effort LLM narration of the (engine-grounded) options — only when the
  // model is already loaded, so it never triggers a download; falls back silently
  // to the deterministic list on any error.
  const narrateOptions = async (band: MoveAssessment[], noteEl: HTMLElement): Promise<void> => {
    if (!runtime) return;
    try {
      const list = band.map((m) => `${m.col}: ${ideaFor(m)}`).join("; ");
      const raw = await runtime.generate(
        `In one short, friendly sentence, tell the player their reasonable Connect Four options (0-based columns): ${list}. Do not add moves not listed.`,
        { greedy: false, maxTokens: 60 },
      );
      if (raw.trim()) noteEl.textContent = raw.trim();
    } catch {
      /* keep the deterministic list */
    }
  };

  const winLineNow = (b: BoardView): Cell[] =>
    b.result === 1 || b.result === 2 ? winningLine(b.cells, b.result) : [];

  function render(): void {
    if (disposed || !container || !game) return;
    const board = game.board();
    const banner = el(
      "p",
      { class: "drop4-banner" },
      "Tap a column to drop your disc. Line up four in a row — across, up, or diagonally — before the engine does.",
    );
    const parts: (Node | string)[] = [
      renderTurnbar(),
      renderOptions(),
      renderControls(),
      banner,
      buildBoard(board, { interactive: true, winLine: winLineNow(board) }),
      // The tutor panel is opt-in (Settings → Show tutor); off by default.
      ...(drop4TutorEnabled() ? [renderTutorPanel()] : []),
      statusEl,
    ];
    // The local-AI opponent's spoken reason for its last move (personality).
    if (aiSay && opponentKind === LOCAL_AI) {
      parts.splice(
        1,
        0,
        el("p", { class: "drop4-ai-say", role: "status" }, `${LOCAL_AI_PERSONA.name}: ${aiSay}`),
      );
    }
    container.replaceChildren(el("div", { class: "drop4-game" }, ...parts));
  }

  // Hold the winning board for a beat (a little fanfare) before the result.
  const finish = (): void => {
    if (!game || !container) return;
    ending = true;
    const board = game.board();
    const line = winLineNow(board);
    const label = outcomeLabel(board.result);
    const flash = el(
      "p",
      { class: `drop4-flash${board.result === 1 ? " win" : ""}`, role: "status" },
      board.result === 0 ? "Draw" : `${label}${board.result === 1 ? " 🎉" : ""}`,
    );
    container.replaceChildren(
      el(
        "div",
        { class: "drop4-game" },
        renderTurnbar(),
        flash,
        ...(coachMsg
          ? [el("p", { class: "drop4-tutor-coach", role: "status" }, coachMsg)]
          : []),
        buildBoard(board, { interactive: false, winLine: line }),
      ),
    );
    window.setTimeout(() => {
      if (disposed) return;
      void presentResult();
    }, FANFARE_MS);
  };

  const presentResult = async (): Promise<void> => {
    if (!container || !game) return;
    const env = game.outcome(declareAssistanceEnabled()) as Drop4Envelope;
    const board = game.board();
    const label = outcomeLabel(board.result);
    const line = winLineNow(board);
    container.replaceChildren(el("div", { class: "sol-loading" }, "Preparing your verifiable result…"));
    const shareUrl = await shareUrlFor(env);
    if (disposed || !container) return;
    const build = (): HTMLElement =>
      renderResultScreen(env, verify(env), {
        label,
        finalBoard: buildBoard(board, { interactive: false, winLine: line }),
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
    coachMsg = null;
    aiSay = null;
    seed = seedOverride ?? randomSeed();
    game.newGame(seed);
    setStatus("");
    console.debug(`[drop4] mount seed=${seed} level=${level} mark=${playerMark}`);
    exposeHook();
    render();
  }

  const showShared = async (payload: string): Promise<void> => {
    if (!container) return;
    let env: Drop4Envelope;
    try {
      env = await decodeRecord(payload);
    } catch {
      container.replaceChildren(el("div", { class: "sol-error" }, "This shared result could not be read."));
      return;
    }
    if (disposed || !container) return;
    const verification = verify(env);
    const board = verifier!.board();
    const label = outcomeLabel(board.result);
    const line = winLineNow(board);
    const build = (): HTMLElement =>
      renderResultScreen(env, verification, {
        label,
        finalBoard: buildBoard(board, { interactive: false, winLine: line }),
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
    window.__drop4 = { game, refresh: () => render(), seed };
  };

  return {
    mount(c: HTMLElement): void {
      container = c;
      disposed = false;
      level = drop4Level();
      playerMark = drop4Mark();
      container.replaceChildren(el("div", { class: "sol-loading" }, "Loading Drop 4…"));
      void (async () => {
        try {
          game = await Drop4.load();
          verifier = await Drop4.load();
        } catch {
          if (!disposed && container) {
            container.replaceChildren(el("div", { class: "sol-error" }, "Could not load the game engine."));
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
        // Probe WebGPU in the background; if present, the picker re-renders with
        // the experimental local-AI opponent offered (classic engine otherwise).
        void probeLocalAi();
      })();
    },
    unmount(): void {
      disposed = true;
      delete window.__drop4;
      container?.replaceChildren();
      container = null;
      game = null;
      verifier = null;
      // Release the WebGPU engine (local-AI) so its GPU resources can be freed.
      runtime = null;
      hybrid = null;
    },
  };
}
