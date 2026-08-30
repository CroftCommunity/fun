//! The Trio Tumble board (Candy-Crush-style target-score-in-moves) over the
//! `trio-tumble-wasm` binding. Tap a gem, then an adjacent gem, to swap — the core
//! decides which swaps are legal; the UI only highlights and calls `play`. When
//! the move budget runs out the score is graded into stars and a verifiable
//! `pond-outcome` record is shown, shareable via `?r=`.

import type { GameModule, GameServices } from "../contract.js";
import type { GameFrame, GameFrameSpec, Verb } from "../game-frame.js";
import type { Progress } from "../progress.js";
import type { SettingRow } from "../settings-sheet.js";
import { today } from "../shelf.js";
import { TrioTumble, type BoardView, type Frame, type Mode, type Swap } from "./trio-tumble-wasm.js";
import {
  decodeRecord,
  encodeRecord,
  verifyRecord,
  type M3Envelope,
  type VerifyResult,
} from "./trio-tumble-outcome.js";
import { dayIndexUTC } from "./share.js";
import { analyzeCascade, celebrationTier, showCelebration, spawnBurst, type CascadeInfo } from "./trio-tumble-fx.js";
import { createBus, type Bus } from "./trio-tumble-events.js";
import { attachStory, type StoryEngine } from "./trio-tumble-story.js";
import { createOverlay, type Overlay } from "./trio-tumble-overlay.js";
import {
  campaignStars,
  clearResume,
  fetchCampaign,
  levelById,
  loadResume,
  markTutorialSeen,
  nextLevelId,
  recordStars,
  saveResume,
  tutorialSeen,
  unlockedLevel,
  type Campaign,
} from "./trio-tumble-campaign.js";
import { declareAssistanceEnabled, hintsEnabled } from "../settings.js";

declare global {
  interface Window {
    /** E2E hook: the live binding + a re-render, so tests drive the core. */
    __trioTumble?: {
      game: TrioTumble;
      refresh: () => void;
      legalMoves: () => Swap[];
      seed: bigint;
      objective: Mode;
      /** The live success bus — tests subscribe to assert emitted gameplay events. */
      events: Bus;
      /** The current campaign level id, or null when playing daily / free / an objective. */
      level: number | null;
    };
  }
}

const GEM_GLYPH = ["●", "▲", "■", "◆", "★", "✚"];
const GEM_NAME = ["circle", "triangle", "square", "diamond", "star", "plus"];
const BLOCKER_GLYPH = "▦";
const INGREDIENT_GLYPH = "✿";
const LICORICE_GLYPH = "◉";
const MERINGUE_GLYPH = "❖";

// Special candies (Track B0): a special is a normal swappable gem carrying a
// power, drawn with a distinct badge + an a11y suffix (not colour-only). The key
// matches the wasm `BoardView.specials` strings; the blast is added in B1–B4.
const SPECIAL_NAME: Record<string, string> = {
  "striped-h": "striped candy, clears its row",
  "striped-v": "striped candy, clears its column",
  wrapped: "wrapped candy",
  "color-bomb": "colour bomb",
  fish: "fish",
};

/** A winnable-daily pack payload (inside the doc envelope) — one per clear
 *  objective (blockers, jelly). Winnable seeds indexed by date + a win-path fixture. */
interface Pack {
  seeds: number[];
  fixture: { seed: number; moves: Swap[] };
}

/** The static pack URL for a clear objective. */
const PACK_URL: Partial<Record<Mode, string>> = {
  blockers: "/trio-tumble-blockers-pack.json",
  jelly: "/trio-tumble-jelly-pack.json",
  ingredients: "/trio-tumble-ingredients-pack.json",
  checklist: "/trio-tumble-checklist-pack.json",
  obstacles: "/trio-tumble-obstacles-pack.json",
};

/** Fetch and unwrap a winnable-daily pack served at `url`. */
async function fetchPack(url: string): Promise<Pack> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const env = (await res.json()) as { payload: Pack };
  return env.payload;
}

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

const starString = (stars: number): string => "★★★☆☆☆".slice(3 - stars, 6 - stars);

// ---------- the result screen (pure DOM) ----------

// The "clear" objectives (blockers, jelly, ingredients) are graded on
// swaps-to-clear with no score/stars; target-score is the odd one out.
const isClear = (env: M3Envelope): boolean =>
  env.kind === "trio-tumble-blockers" ||
  env.kind === "trio-tumble-jelly" ||
  env.kind === "trio-tumble-ingredients" ||
  env.kind === "trio-tumble-checklist" ||
  env.kind === "trio-tumble-obstacles";

/** "1 swap" / "N swaps" — the clear objectives are graded on swaps-to-clear. */
const swaps = (n: number): string => `${n} swap${n === 1 ? "" : "s"}`;

function headline(env: M3Envelope, v: VerifyResult): string {
  if (!v.ok) return "Verification FAILED — this result does not check out";
  if (env.kind === "trio-tumble-checklist") {
    return env.payload.result === "Won"
      ? `Checklist complete in ${swaps(env.payload.move_count)} — verifiable`
      : "Ran out of swaps — the checklist is incomplete";
  }
  if (isClear(env)) {
    const what =
      env.kind === "trio-tumble-jelly"
        ? "jelly"
        : env.kind === "trio-tumble-ingredients"
          ? "ingredients"
          : env.kind === "trio-tumble-obstacles"
            ? "obstacles"
            : "blockers";
    return env.payload.result === "Won"
      ? `All ${what} cleared in ${swaps(env.payload.move_count)} — verifiable`
      : `Ran out of swaps — ${what} remain`;
  }
  const stars = env.payload.stars ?? 0;
  if (env.payload.result === "Won") return `Cleared with ${starString(stars)} — verifiable`;
  return "Under target — didn’t reach 1★ this time";
}

export interface ResultScreenOpts {
  shareUrl?: string;
  onReverify?: () => void;
  onPlayAgain?: () => void;
  shared?: boolean;
  /** Campaign context: reinterprets the (still-verifiable) score into level stars
   *  and offers a "Next level" step when the level was cleared. */
  campaign?: {
    level: number;
    stars: number;
    cleared: boolean;
    hasNext: boolean;
    onNext?: () => void;
  };
}

/** Build the Trio Tumble result screen: outcome headline, verification badge, the
 *  record (score / stars / moves / seed / hash), and share/re-verify controls. */
export function renderResultScreen(
  env: M3Envelope,
  verification: VerifyResult,
  opts: ResultScreenOpts = {},
): HTMLElement {
  const rec = env.payload;
  const section = el("section", { class: "sol-result", role: "region", "aria-label": "Result" });
  // In the campaign the headline leads with the level + its stars (a front-end
  // reading of the verified score); a failed verification always wins the headline.
  const campaignHeadline =
    opts.campaign && verification.ok
      ? opts.campaign.cleared
        ? `Level ${opts.campaign.level} complete — ${starString(opts.campaign.stars)}`
        : `Level ${opts.campaign.level} — not cleared (reach 1★ to advance)`
      : null;
  section.append(el("h2", { class: "sol-headline" }, campaignHeadline ?? headline(env, verification)));

  const badge = el("p", {
    class: `sol-verify-badge ${verification.ok ? "ok" : "fail"}`,
    role: "status",
  });
  badge.textContent = verification.ok
    ? "Verified ✓ — re-checked by replaying every swap against the core."
    : `Verification failed — expected hash ${verification.expected}, replay produced ${verification.actual}.`;
  section.append(badge);

  const dl = el("dl", { class: "sol-record" });
  const row = (term: string, value: string, cls = ""): void => {
    dl.append(el("dt", {}, term), el("dd", cls ? { class: cls } : {}, value));
  };
  row("Result", rec.result);
  if (!isClear(env)) {
    // Target-score metrics; the clear objectives are graded on swaps-to-clear alone.
    row("Score", String(rec.score ?? 0));
    row("Stars", starString(rec.stars ?? 0));
  }
  row("Swaps used", String(rec.move_count));
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
      el("a", { class: "sol-share", href: opts.shareUrl, "data-share": opts.shareUrl }, "Share this result"),
    );
  }
  if (opts.campaign?.cleared && opts.campaign.hasNext && opts.campaign.onNext) {
    const b = el("button", { type: "button", class: "m3-next-level" }, "Next level ▶");
    b.addEventListener("click", opts.campaign.onNext);
    controls.append(b);
  }
  if (opts.onPlayAgain) {
    const b = el(
      "button",
      { type: "button", class: "sol-again" },
      opts.shared ? "Play today’s board" : opts.campaign ? "Retry level" : "Play again",
    );
    b.addEventListener("click", opts.onPlayAgain);
    controls.append(b);
  }
  if (controls.childNodes.length) section.append(controls);
  return section;
}

// ---------- the game module ----------

/** What the next board is — the poster's card and the New board sheet both write these. */
let chosenBoard: "campaign" | "daily" | "free" = "campaign";
let chosenObjective: Mode = "target-score";
let chosenLevel: number | null = null;
/** The campaign pack, once a module has loaded it, so the sheet can list levels. */
let campaignForSetup: Campaign | null = null;

const OBJECTIVE_LABEL: Readonly<Record<Mode, string>> = {
  "target-score": "Target score",
  blockers: "Clear blockers",
  jelly: "Clear jelly",
  ingredients: "Ingredients",
  checklist: "Orders",
  obstacles: "Obstacles",
};
const OBJECTIVES: readonly Mode[] = ["target-score", "blockers", "jelly", "ingredients", "checklist", "obstacles"];

/** The New board card: which board, which objective, and — in the campaign — which level. */
export function trioTumbleSetupRows(): SettingRow[] {
  const rows: SettingRow[] = [
    {
      kind: "choice",
      id: "board",
      label: "Board",
      value: chosenBoard,
      options: [
        { value: "campaign", label: "Campaign", hint: "curated levels, stars remembered" },
        { value: "daily", label: "Today’s board", hint: "the same board everyone gets today" },
        { value: "free", label: "New board", hint: "a fresh random board" },
      ],
      onChange: (v) => {
        chosenBoard = v === "daily" ? "daily" : v === "free" ? "free" : "campaign";
      },
    },
    {
      kind: "choice",
      id: "objective",
      label: "Objective",
      hint: "For today’s and new boards; the campaign plays target score.",
      value: chosenObjective,
      options: OBJECTIVES.map((m) => ({ value: m, label: OBJECTIVE_LABEL[m] })),
      onChange: (v) => {
        chosenObjective = OBJECTIVES.includes(v as Mode) ? (v as Mode) : "target-score";
      },
    },
  ];
  if (campaignForSetup) {
    const unlocked = unlockedLevel(campaignForSetup);
    rows.push({
      kind: "choice",
      id: "level",
      label: "Level",
      hint: "Clear a level for one star to unlock the next.",
      value: String(chosenLevel ?? unlocked),
      options: campaignForSetup.levels.map((l) => ({
        value: String(l.id),
        label: `Level ${l.id}`,
        ...(l.id > unlocked ? { disabled: true, hint: "locked" } : {}),
      })),
      onChange: (v) => {
        chosenLevel = Number(v);
      },
    });
  }
  return rows;
}

/** The poster's setup card — the registry's `setup` factory. */
export const trioTumbleSetup = (): SettingRow[] => trioTumbleSetupRows();

/** Construct a fresh Trio Tumble module (the registry `load`). */
export function trioTumbleModule(): GameModule {
  let game: TrioTumble | null = null;
  let verifier: TrioTumble | null = null;
  let container: HTMLElement | null = null;
  let disposed = false;

  let mode: "daily" | "free" = "daily";
  let objective: Mode = "target-score";
  const packCache: Partial<Record<Mode, Pack>> = {};
  // The campaign ladder (curated levels over verifiable seeds). `level` is the
  // current campaign level id, or null when playing daily / free / an objective.
  let campaign: Campaign | null = null;
  let frame: GameFrame | null = null;
  let pendingResume: Progress | null = null;
  let level: number | null = null;
  // The current campaign board's committed move list — autosaved after each move
  // (the moves, never the board) and replayed into a fresh core to resume.
  let moveLog: Swap[] = [];
  let seed = 0n;
  let selected: { r: number; c: number } | null = null;
  let hint: Swap | null = null;
  // When the current `hint` is the Level 1 first-move onboarding nudge (not an
  // assistance hint), the glowed cells get a brighter, pulsing treatment.
  let tutorialNudge = false;
  let cascadeEl: HTMLElement | null = null;
  let animating = false;
  // A completed swipe sets this so the trailing synthetic `click` doesn't also
  // tap-select. Reset at the start of every pointer gesture so it can never eat a
  // later genuine tap. Module-scoped so it survives the board re-render a swap triggers.
  let suppressClick = false;

  // Per-phase cascade animation cadence. A move emits swap + 3 frames per cascade
  // step (clear/fall/refill), so a 1–3-step move runs ~0.3–0.8s.
  // Per-phase cascade cadence. A clear frame is held long enough to *register*
  // (the gap + burst read); the after-swap and fall/refill frames stay snappy so
  // the move still feels quick. A 1-clear move ≈ 0.45s, a big cascade lingers.
  const SWAP_MS = 110;
  const CLEAR_MS = 260;
  const FALL_MS = 90;
  const delay = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms));

  // Gameplay success bus: bursts + celebration (below) and the narrative overlay
  // subscribe to the same stream, so FX and story never disagree.
  const bus = createBus();
  let overlay: Overlay | null = null;
  let story: StoryEngine | null = null;

  const reducedMotion = (): boolean => {
    try {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      return true; // no matchMedia (or it threw) → skip the animation, safely
    }
  };

  const statusEl = el("p", { class: "sol-status", role: "status", "aria-live": "polite" });
  const setStatus = (msg: string): void => {
    statusEl.textContent = msg;
  };

  const randomSeed = (): bigint => {
    const buf = new Uint32Array(2);
    crypto.getRandomValues(buf);
    return (BigInt(buf[0]!) << 16n) ^ BigInt(buf[1]! & 0xffff);
  };

  const shareUrlFor = async (env: M3Envelope): Promise<string> =>
    `${location.origin}${location.pathname}?r=${await encodeRecord(env)}`;

  const verify = (env: M3Envelope): VerifyResult => verifyRecord(verifier!, env);

  const adjacent = (a: { r: number; c: number }, r: number, c: number): boolean =>
    Math.abs(a.r - r) + Math.abs(a.c - c) === 1;

  /** The legal swap connecting `a` and `(r,c)`, if the core allows it. */
  const swapBetween = (a: { r: number; c: number }, r: number, c: number): Swap | null => {
    for (const s of game!.legalMoves()) {
      if (
        (s[0] === a.r && s[1] === a.c && s[2] === r && s[3] === c) ||
        (s[0] === r && s[1] === c && s[2] === a.r && s[3] === a.c)
      ) {
        return s;
      }
    }
    return null;
  };

  // The round is over when the budget or legal moves run out, or — in a clear
  // objective (blockers / jelly) — the moment the objective is met.
  const gameOver = (): boolean =>
    !!game &&
    (game.movesLeft() === 0 ||
      game.legalMoves().length === 0 ||
      (objective !== "target-score" && game.isWon()));

  // One animation frame board (decorative + aria-hidden). Empty cells are holes
  // mid-cascade; letters are blockers (clear-the-blockers boards).
  const renderFrame = (rows: Frame): HTMLElement => {
    const boardEl = el("div", { class: "m3-board m3-animating", tabindex: "-1", "aria-hidden": "true" });
    rows.forEach((row) => {
      const rowEl = el("div", { class: "m3-row" });
      for (const ch of row) {
        if (ch >= "0" && ch <= "9") {
          const color = Number(ch);
          // Same inner-shape structure as the live board (gemButton), so cascade
          // frames don't flicker glossy→glyph mid-animation.
          const g = el("span", { class: `m3-gem gem-${color}` });
          g.append(el("span", { class: "m3-shape", "aria-hidden": "true" }, GEM_GLYPH[color]!));
          rowEl.append(g);
        } else if (ch === ".") {
          rowEl.append(el("span", { class: "m3-gem m3-hole" }));
        } else if (ch === "*") {
          rowEl.append(el("span", { class: "m3-ingredient" }, INGREDIENT_GLYPH));
        } else {
          rowEl.append(el("span", { class: "m3-blocker" }, BLOCKER_GLYPH));
        }
      }
      boardEl.append(rowEl);
    });
    return boardEl;
  };

  // Step through the per-phase snapshots, swapping just the board element so the
  // HUD/controls stay put. Clear frames are held longer (CLEAR_MS) and fire a
  // particle burst at the cells that emptied; the deepest cascade flashes an
  // escalating celebration. Input is gated (`animating`) until the settled render.
  const animateSnapshots = async (frames: Frame[], cascade: CascadeInfo): Promise<void> => {
    if (!container) return;
    animating = true;
    const clearAt = new Map(cascade.clears.map((p) => [p.frameIndex, p]));
    const tier = celebrationTier(cascade.depth);
    const lastClearIndex = cascade.clears.at(-1)?.frameIndex ?? -1;
    try {
      for (let i = 0; i < frames.length; i += 1) {
        if (disposed || !container) return;
        const current = container.querySelector<HTMLElement>(".m3-board");
        if (!current) return;
        current.replaceWith(renderFrame(frames[i]!));
        const phase = clearAt.get(i);
        if (phase) {
          const boardEl = container.querySelector<HTMLElement>(".m3-board");
          const layer = container.querySelector<HTMLElement>(".m3-fx");
          if (boardEl && layer) {
            spawnBurst(layer, boardEl, phase.cells, tier ? tier.level : 1);
            if (tier && i === lastClearIndex) showCelebration(layer, tier.label, tier.level);
          }
        }
        await delay(phase ? CLEAR_MS : i === 0 ? SWAP_MS : FALL_MS);
      }
    } finally {
      animating = false;
    }
  };

  const applySwap = (s: Swap): void => {
    // The core applies the whole move now (wasm state is settled immediately);
    // the frames are only the intermediate boards the UI animates over.
    const scoreBefore = game!.score();
    const frames = game!.playTraced(s);
    selected = null;
    hint = null;
    tutorialNudge = false;
    setStatus("");
    // Every applied swap is logged: the frame's store replays it (any board), and
    // the campaign's own autosave keeps its deep-link resume (campaign only).
    if (frames.length > 0) moveLog.push(s);
    if (level !== null && frames.length > 0) {
      saveResume({ objective, seed: seed.toString(), level, moves: moveLog });
    }
    const cascade = analyzeCascade(frames);
    // Announce the move so FX + (Phase 2) narrative react to the same signal.
    bus.emit({
      type: "move",
      scoreDelta: game!.score() - scoreBefore,
      cascadeDepth: cascade.depth,
      cleared: cascade.totalCleared,
    });
    if (cascade.depth >= 1) {
      bus.emit({ type: "cascade", depth: cascade.depth, clearedCells: cascade.clears.flatMap((p) => p.cells) });
    }
    if (reducedMotion() || frames.length === 0) {
      render();
      return;
    }
    void animateSnapshots(frames, cascade).then(() => {
      if (!disposed) render();
    });
  };

  const handleClick = (r: number, c: number): void => {
    if (!game || animating || gameOver()) return;
    hint = null;
    tutorialNudge = false;
    if (!selected) {
      selected = { r, c };
      applyGlow();
      return;
    }
    if (selected.r === r && selected.c === c) {
      selected = null;
      applyGlow();
      return;
    }
    if (adjacent(selected, r, c)) {
      const s = swapBetween(selected, r, c);
      if (s) {
        applySwap(s);
        return;
      }
      setStatus("That swap makes no match.");
    }
    selected = { r, c }; // switch selection
    applyGlow();
  };

  // --- hints ---

  const showHint = (): void => {
    if (!game || animating || gameOver()) return;
    const moves = game.legalMoves();
    if (moves.length === 0) {
      render(); // no moves -> the game is over
      return;
    }
    game.markAssistance();
    hint = moves[0]!;
    tutorialNudge = false; // a real assistance hint, not the onboarding nudge
    selected = null;
    setStatus(
      `Hint: swap row ${hint[0] + 1} col ${hint[1] + 1} with row ${hint[2] + 1} col ${hint[3] + 1} (a hint counts as assistance)`,
    );
    applyGlow();
  };

  const endNow = (): void => {
    // "I'm stuck" with hints off: spend the rest of the budget and tally.
    setStatus("");
    render(true);
  };

  // --- rendering ---

  const gemButton = (color: number, r: number, c: number): HTMLElement => {
    const b = el("button", {
      type: "button",
      class: `m3-gem gem-${color}`,
      "data-r": String(r),
      "data-c": String(c),
      "aria-label": `${GEM_NAME[color]} gem, row ${r + 1} column ${c + 1}`,
    });
    // The glossy candy shape lives on an inner element so the button keeps its
    // hit-area + focus/selection/legal/hint glows (which a shape's clip-path would
    // otherwise clip). The glyph rides inside as a faint non-colour redundancy cue.
    b.append(el("span", { class: "m3-shape", "aria-hidden": "true" }, GEM_GLYPH[color]!));
    return b;
  };

  // --- what the frame shows: one chip, three fixed meters, the verbs, the New board card ---
  const chip = (): string => {
    if (campaign && level !== null) return `Campaign · ${level} of ${campaign.levels.length}`;
    return `${OBJECTIVE_LABEL[objective]} · ${mode === "daily" ? "Today’s" : "New"}`;
  };
  const meters = (board: BoardView | undefined): GameFrameSpec["meters"] => {
    const swaps = { kind: "stat" as const, id: "swaps", value: board?.movesLeft ?? 0, label: "swaps left" };
    const score = { kind: "stat" as const, id: "score", value: board?.score ?? 0, label: "score" };
    const activeLevel = campaign && level !== null ? levelById(campaign, level) : undefined;
    if (!board) return [score, swaps, { kind: "stat", id: "stars", value: starString(0), label: "stars" }];
    if (activeLevel) {
      return [score, swaps, { kind: "stat", id: "stars", value: starString(campaignStars(board.score, activeLevel.stars)), label: `stars at ${activeLevel.stars.join(" / ")}` }];
    }
    const clear = (noun: string, remaining: number, total: number): GameFrameSpec["meters"] => [
      { kind: "stat", id: "left", value: `${remaining} of ${total}`, label: `${noun} left` },
      swaps,
      score,
    ];
    switch (board.mode) {
      case "blockers":
        return clear("blockers", board.blockersRemaining, board.blockersTotal);
      case "jelly":
        return clear("jelly", board.jellyRemaining, board.jellyTotal);
      case "ingredients":
        return clear("ingredients", board.ingredientsRemaining, board.ingredientsTotal);
      case "obstacles":
        return clear("obstacles", board.blockersRemaining, board.blockersTotal);
      case "checklist": {
        const done =
          Number(board.checklistColorCleared >= board.checklistColorTarget) +
          Number(board.checklistStripedMade >= board.checklistStripedTarget) +
          Number(board.checklistWrappedMade >= board.checklistWrappedTarget);
        return [{ kind: "stat", id: "orders", value: `${done} of 3`, label: "orders done" }, swaps, score];
      }
      default:
        return [score, swaps, { kind: "stat", id: "stars", value: starString(board.stars), label: `targets ${board.targets.join(" / ")}` }];
    }
  };
  const spec = (): GameFrameSpec => {
    const board = game?.board();
    const hints = hintsEnabled();
    const verbs: Verb[] = [
      hints
        ? { id: "hint", label: "Hint", icon: "✦", primary: true, onPress: showHint }
        : { id: "done", label: "I’m done", icon: "⇥", onPress: endNow },
    ];
    if (level !== null) verbs.push({ id: "restart", label: "Restart", icon: "↺", onPress: () => void startLevel(level!) });
    verbs.push({ id: "new", label: "New board", icon: "⟳", onPress: (btn) => frame?.openSheet("setup", btn) });
    return {
      title: "Trio Tumble",
      mode: chip(),
      meters: meters(board),
      verbs,
      setup: trioTumbleSetupRows(),
      onStart: () => {
        if (chosenBoard === "campaign") void startLevel(chosenLevel ?? (campaign ? unlockedLevel(campaign) : 1));
        else {
          objective = chosenObjective;
          void startGame(chosenBoard);
        }
      },
    };
  };
  const declare = (): void => frame?.update(spec());

  // The Orders tally: three goals, ticked as reached. It lives in the stage above the
  // board because it is FIXED for the board's life — the same three lines from the
  // first swap to the last — so it never changes height (frame rule 1).
  const goalSpan = (label: string, made: number, target: number, aria: string): HTMLElement => {
    const done = made >= target;
    return el(
      "span",
      {
        class: `m3-goal${done ? " done" : ""}`,
        "aria-label": `${aria}: ${Math.min(made, target)} of ${target}${done ? ", done" : ""}`,
      },
      `${label} ${Math.min(made, target)}/${target}${done ? " ✓" : ""}`,
    );
  };
  const checklistHud = (b: BoardView): HTMLElement =>
    el(
      "div",
      { class: "m3-hud m3-checklist-hud" },
      goalSpan(
        `${GEM_GLYPH[b.checklistColor] ?? "?"} clear`,
        b.checklistColorCleared,
        b.checklistColorTarget,
        `clear ${GEM_NAME[b.checklistColor] ?? "gem"} gems`,
      ),
      goalSpan("striped", b.checklistStripedMade, b.checklistStripedTarget, "make striped candies"),
      goalSpan("wrapped", b.checklistWrappedMade, b.checklistWrappedTarget, "make wrapped candies"),
    );

  const renderBoard = (board: BoardView): HTMLElement => {
    const boardEl = el("div", { class: "m3-board", tabindex: "-1" });
    board.cells.forEach((row, r) => {
      const rowEl = el("div", { class: "m3-row" });
      row.forEach((color, c) => {
        // A blocker is a fixed, non-swappable tile (not a `.m3-gem`, so taps and
        // drags skip it); its neighbours' matches clear it.
        if (board.blockers[r]?.[c]) {
          // A blocker cell. In obstacles mode it carries a flavour (licorice /
          // meringue) rendered as a distinct tile; meringue shows its remaining
          // layer count (a non-colour durability cue). Otherwise a plain blocker.
          const obs = board.obstacles?.[r]?.[c] ?? "";
          if (obs === "licorice") {
            rowEl.append(
              el(
                "span",
                { class: "m3-obstacle m3-licorice", role: "img", "aria-label": `licorice, row ${r + 1} column ${c + 1}` },
                LICORICE_GLYPH,
              ),
            );
          } else if (obs === "meringue") {
            const layers = board.obstacleLayers?.[r]?.[c] ?? 1;
            rowEl.append(
              el(
                "span",
                {
                  class: "m3-obstacle m3-meringue",
                  role: "img",
                  "aria-label": `meringue, ${layers} ${layers === 1 ? "layer" : "layers"} left, row ${r + 1} column ${c + 1}`,
                },
                `${MERINGUE_GLYPH}${layers}`,
              ),
            );
          } else {
            rowEl.append(
              el("span", { class: "m3-blocker", role: "img", "aria-label": `blocker, row ${r + 1} column ${c + 1}` }, BLOCKER_GLYPH),
            );
          }
        } else if (board.ingredients?.[r]?.[c]) {
          // An ingredient is a fixed non-swappable object (not a `.m3-gem`) that
          // falls with gravity and exits at the bottom; you clear the gems beneath
          // it to drop it. The a11y label is not colour-only.
          rowEl.append(
            el(
              "span",
              { class: "m3-ingredient", role: "img", "aria-label": `ingredient, row ${r + 1} column ${c + 1}` },
              INGREDIENT_GLYPH,
            ),
          );
        } else {
          // A jellied cell is a normal swappable gem with a jelly backing; a match
          // over it scrubs the jelly. The `.m3-jellied` class draws the backing and
          // the a11y label notes it, without changing interaction.
          const gem = gemButton(color, r, c);
          if ((board.jelly[r]?.[c] ?? 0) > 0) {
            gem.classList.add("m3-jellied");
            gem.setAttribute("aria-label", `${gem.getAttribute("aria-label")}, on jelly`);
          }
          // A special candy is the same swappable gem with a power badge + an
          // a11y suffix (the `.m3-special-*` class draws the badge; the shape
          // cue is not colour-only). Interaction is unchanged.
          const special = board.specials?.[r]?.[c] ?? "";
          if (special) {
            gem.classList.add("m3-special", `m3-special-${special}`);
            gem.setAttribute(
              "aria-label",
              `${gem.getAttribute("aria-label")}, ${SPECIAL_NAME[special] ?? special}`,
            );
          }
          rowEl.append(gem);
        }
      });
      boardEl.append(rowEl);
    });
    boardEl.addEventListener("click", (e) => {
      // A completed swipe swallows its trailing click here so it doesn't also
      // tap-select. Everything else is a genuine tap (mouse, touch, keyboard).
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      const btn = (e.target as HTMLElement).closest<HTMLElement>(".m3-gem");
      if (!btn) return;
      handleClick(Number(btn.dataset.r), Number(btn.dataset.c));
    });

    // Swipe-to-swap (Pointer Events): press a gem and swipe toward a neighbour —
    // the primary, flow-building gesture, working the same on touch and desktop.
    // Direction is resolved from the pointer delta (robust to the board being
    // rebuilt mid-cascade), and the core still decides legality. A swipe under
    // the threshold falls through to tap-select, which — with keyboard — stays
    // the accessible floor. Listeners are delegated on the board element, so each
    // re-rendered board gets its own set (no leak, no stale capture).
    let swipe: { r: number; c: number; x: number; y: number; threshold: number; fired: boolean } | null = null;
    boardEl.addEventListener("pointerdown", (e: PointerEvent) => {
      suppressClick = false; // start of a gesture — clear any stale suppression
      if (animating || gameOver()) return;
      const btn = (e.target as HTMLElement).closest<HTMLElement>(".m3-gem");
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      swipe = {
        r: Number(btn.dataset.r),
        c: Number(btn.dataset.c),
        x: e.clientX,
        y: e.clientY,
        threshold: Math.max(12, rect.width * 0.5), // ~half the gem pitch
        fired: false,
      };
      // No `setPointerCapture` here: an adjacent-cell swipe stays over the board,
      // and capturing retargets the trailing `click` to the board element — which
      // would break tap-select (the delegated click could no longer find its gem).
    });
    boardEl.addEventListener("pointermove", (e: PointerEvent) => {
      if (!swipe || swipe.fired || animating || gameOver()) return;
      const dx = e.clientX - swipe.x;
      const dy = e.clientY - swipe.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < swipe.threshold) return;
      // Dominant-axis cardinal neighbour.
      const [dr, dc] = Math.abs(dx) > Math.abs(dy) ? [0, Math.sign(dx)] : [Math.sign(dy), 0];
      const from = { r: swipe.r, c: swipe.c };
      const s = swapBetween(from, swipe.r + dr, swipe.c + dc);
      swipe.fired = true;
      suppressClick = true;
      if (s) {
        e.preventDefault();
        applySwap(s);
      } else {
        // Swiped toward a non-matching / off-board neighbour: select the origin so
        // its legal targets glow (no state change), same as a tap on it.
        selected = from;
        hint = null;
        tutorialNudge = false;
        applyGlow();
        setStatus("That swap makes no match.");
      }
    });
    const endSwipe = (): void => {
      swipe = null;
    };
    boardEl.addEventListener("pointerup", endSwipe);
    boardEl.addEventListener("pointercancel", endSwipe);
    return boardEl;
  };

  const gemAt = (r: number, c: number): HTMLElement | null =>
    container?.querySelector<HTMLElement>(`.m3-gem[data-r="${r}"][data-c="${c}"]`) ?? null;

  const applyGlow = (): void => {
    if (!container) return;
    container
      .querySelectorAll(".legal-target, .selected, .hint-from, .hint-to, .m3-nudge")
      .forEach((e) => e.classList.remove("legal-target", "selected", "hint-from", "hint-to", "m3-nudge"));
    if (hint) {
      const from = gemAt(hint[0], hint[1]);
      const to = gemAt(hint[2], hint[3]);
      from?.classList.add("hint-from");
      to?.classList.add("hint-to");
      // The onboarding nudge (Level 1 first move) gets a brighter, pulsing glow so
      // the suggested opening is unmistakable — distinct from a subtle assistance hint.
      if (tutorialNudge) {
        from?.classList.add("m3-nudge");
        to?.classList.add("m3-nudge");
      }
      return;
    }
    if (!selected) return;
    gemAt(selected.r, selected.c)?.classList.add("selected");
    for (const s of game!.legalMoves()) {
      if (s[0] === selected.r && s[1] === selected.c) gemAt(s[2], s[3])?.classList.add("legal-target");
      else if (s[2] === selected.r && s[3] === selected.c) gemAt(s[0], s[1])?.classList.add("legal-target");
    }
  };

  // A brief celebratory gem cascade on a passing result; decorative and
  // aria-hidden; skipped under reduced-motion; removed on unmount.
  const playCascade = (): void => {
    try {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    } catch {
      return;
    }
    const layer = el("div", { class: "sol-cascade", "aria-hidden": "true" });
    for (let i = 0; i < 24; i += 1) {
      const s = el("span", { class: `gem-${i % 6}` }, GEM_GLYPH[i % 6]!);
      s.style.left = `${(i * 4.15) % 100}%`;
      s.style.animationDelay = `${(i % 8) * 0.08}s`;
      layer.append(s);
    }
    document.body.append(layer);
    cascadeEl = layer;
    setTimeout(() => {
      layer.remove();
      if (cascadeEl === layer) cascadeEl = null;
    }, 1900);
  };

  const presentResult = async (): Promise<void> => {
    if (!container || !game) return;
    const env = game.outcome(declareAssistanceEnabled()) as M3Envelope;
    // Campaign context: reinterpret the verified score into level stars, record
    // progress, and offer the next level. The record/hash/share are unchanged.
    const activeLevel = campaign && level !== null ? levelById(campaign, level) : undefined;
    let campaignOpts: ResultScreenOpts["campaign"];
    if (activeLevel) {
      const score = env.payload.score ?? 0;
      const cStars = campaignStars(score, activeLevel.stars);
      const cleared = cStars >= 1;
      recordStars(activeLevel.id, cStars);
      clearResume(); // the board is finished — nothing left to resume

      const nextId = nextLevelId(campaign!, activeLevel.id);
      if (cleared) bus.emit({ type: "level-win", level: activeLevel.id, stars: cStars, score, clutch: false });
      else bus.emit({ type: "level-lose", level: activeLevel.id });
      campaignOpts = {
        level: activeLevel.id,
        stars: cStars,
        cleared,
        hasNext: nextId !== null,
        onNext: nextId !== null ? () => void startLevel(nextId) : undefined,
      };
    }
    const passed = campaignOpts
      ? campaignOpts.cleared
      : isClear(env)
        ? env.payload.result === "Won"
        : (env.payload.stars ?? 0) >= 1;
    if (passed) playCascade();
    container.replaceChildren(el("div", { class: "sol-loading" }, "Preparing your verifiable result…"));
    const shareUrl = await shareUrlFor(env);
    if (disposed || !container) return;
    const build = (): HTMLElement =>
      renderResultScreen(env, verify(env), {
        shareUrl,
        onReverify: () => container!.replaceChildren(build()),
        onPlayAgain: () => (level !== null ? void startLevel(level) : void startGame(mode)),
        campaign: campaignOpts,
      });
    container.replaceChildren(build());
    declare();
  };

  function render(force = false): void {
    if (disposed || !container || !game) return;
    if (force || gameOver()) {
      void presentResult();
      return;
    }
    const board = game.board();
    // A single centred play column (RESPONSIVE-DESIGN Principle 1): controls, board,
    // and status share one vertical axis, centred in the play area (never left-hugging).
    // The board sits in a positioned wrap next to a decorative burst layer; the
    // layer persists while the board element is swapped frame-to-frame mid-cascade.
    const boardWrap = el(
      "div",
      { class: "m3-board-wrap" },
      renderBoard(board),
      el("div", { class: "m3-fx", "aria-hidden": "true" }),
    );
    const gameEl = el(
      "div",
      { class: "m3-game" },
      ...(board.mode === "checklist" ? [checklistHud(board)] : []),
      boardWrap,
      statusEl,
    );
    container.replaceChildren(gameEl);
    applyGlow();
    declare();
  }

  // Pick the seed for a clear objective — always from its winnable pack (daily =
  // the day's seed; free = a pack seed off the day + a nonce), so the board is
  // guaranteed clearable. An explicit `seedOverride` (shared/`?seed=`) is trusted.
  const packSeed = (pack: Pack, nextMode: "daily" | "free"): bigint => {
    const i =
      nextMode === "daily"
        ? dayIndexUTC(new Date()) % pack.seeds.length
        : Number(randomSeed() % BigInt(pack.seeds.length));
    return BigInt(pack.seeds[i]!);
  };

  async function startGame(nextMode: "daily" | "free", seedOverride?: bigint): Promise<void> {
    if (!game || disposed) return;
    const clearing =
      objective === "blockers" ||
      objective === "jelly" ||
      objective === "ingredients" ||
      objective === "checklist" ||
      objective === "obstacles";
    if (clearing && !packCache[objective]) {
      try {
        packCache[objective] = await fetchPack(PACK_URL[objective]!);
      } catch {
        const label =
          objective === "jelly"
            ? "clear-the-jelly"
            : objective === "ingredients"
              ? "ingredients"
              : objective === "checklist"
                ? "orders"
                : objective === "obstacles"
                  ? "obstacles"
                  : "clear-the-blockers";
        showLoadError(`Today’s ${label} board could not be loaded.`);
        return;
      }
      if (disposed || !game) return;
    }
    mode = nextMode;
    if (objective === "blockers") {
      seed = seedOverride ?? packSeed(packCache.blockers!, nextMode);
      game.newBlockersGame(seed);
    } else if (objective === "jelly") {
      seed = seedOverride ?? packSeed(packCache.jelly!, nextMode);
      game.newJellyGame(seed);
    } else if (objective === "ingredients") {
      seed = seedOverride ?? packSeed(packCache.ingredients!, nextMode);
      game.newIngredientsGame(seed);
    } else if (objective === "checklist") {
      seed = seedOverride ?? packSeed(packCache.checklist!, nextMode);
      game.newChecklistGame(seed);
    } else if (objective === "obstacles") {
      seed = seedOverride ?? packSeed(packCache.obstacles!, nextMode);
      game.newObstaclesGame(seed);
    } else {
      // Target-score daily uses a seed from the baked par table (ladder tiers);
      // free-play is a random seed (off-table → live fallback tiers).
      seed =
        seedOverride ??
        (nextMode === "daily"
          ? BigInt(game.targetDailySeed(dayIndexUTC(new Date())))
          : randomSeed());
      game.newGame(seed);
    }
    level = null; // daily / free / an objective is not a campaign level
    moveLog = [];
    chosenBoard = nextMode;
    chosenObjective = objective;
    selected = null;
    hint = null;
    story?.resetForNewBoard();
    setStatus("");
    exposeHook();
    render();
  }

  /** Replay a stored board from the frame's store — a campaign level, or any objective board. */
  const applyResume = async (p: Progress): Promise<void> => {
    if (!game || disposed) return;
    const rec = p.record as { seed?: unknown; objective?: unknown; level?: unknown; moves?: unknown };
    const moves = Array.isArray(rec.moves) ? (rec.moves as Swap[]) : [];
    if (typeof rec.level === "number") {
      await startLevel(rec.level, moves);
      return;
    }
    objective = OBJECTIVES.includes(rec.objective as Mode) ? (rec.objective as Mode) : "target-score";
    const nextMode = p.setup.mode.startsWith("daily:") ? "daily" : "free";
    await startGame(nextMode, typeof rec.seed === "string" ? BigInt(rec.seed) : undefined);
    if (!game || disposed) return;
    for (const m of moves) {
      if (game.play(m) === "applied") moveLog.push(m);
      else break;
    }
    setStatus(moves.length ? "Resumed." : "");
    render();
  };

  const ensureCampaign = async (): Promise<Campaign | null> => {
    if (campaign) return campaign;
    try {
      campaign = await fetchCampaign();
    } catch {
      return null;
    }
    campaignForSetup = campaign;
    return campaign;
  };

  // Enter a campaign level: a curated seed played in target-score mode, so the
  // outcome stays verifiable; the campaign only reinterprets its score into stars.
  // `replay` resumes an in-progress board by re-applying its saved move list into
  // the fresh core (deterministic → identical state, still verifiable).
  async function startLevel(id: number, replay?: Swap[]): Promise<void> {
    if (!game || disposed) return;
    const camp = await ensureCampaign();
    if (!camp || disposed || !game) {
      showLoadError("Today’s campaign could not be loaded.");
      return;
    }
    const lvl = levelById(camp, id) ?? camp.levels[0]!;
    objective = "target-score";
    mode = "free";
    level = lvl.id;
    chosenBoard = "campaign";
    chosenLevel = lvl.id;
    seed = BigInt(lvl.seed);
    game.newGame(seed);
    moveLog = [];
    if (replay && replay.length) {
      for (const m of replay) {
        if (game.play(m) === "applied") moveLog.push(m);
      }
      saveResume({ objective, seed: seed.toString(), level, moves: moveLog });
    } else {
      clearResume();
    }
    selected = null;
    // First-move nudge: on the very first visit to Level 1, glow the curated
    // opening swap so a new player sees an obvious, mechanic-demoing move. It's
    // onboarding, not a hint — it does NOT mark assistance. Shown once ever, and
    // cleared by the first interaction.
    const nudge = lvl.id === 1 && lvl.hint && !replay?.length && !tutorialSeen();
    hint = nudge ? (lvl.hint ?? null) : null;
    tutorialNudge = Boolean(nudge);
    if (nudge) markTutorialSeen();
    story?.resetForNewBoard();
    setStatus(replay?.length ? `Resumed Level ${lvl.id}.` : (lvl.intro ?? ""));
    exposeHook();
    render();
  }

  const showLoadError = (msg: string): void => {
    if (!container) return;
    const box = el("div", { class: "sol-error" });
    const b = el("button", { type: "button", class: "sol-mode-free" }, "Play target-score instead");
    b.addEventListener("click", () => {
      objective = "target-score";
      void startGame("daily");
    });
    box.append(el("p", {}, msg), b);
    container.replaceChildren(box);
  };

  const showShared = async (payload: string): Promise<void> => {
    if (!container) return;
    let env: M3Envelope;
    try {
      env = await decodeRecord(payload);
    } catch {
      container.replaceChildren(el("div", { class: "sol-error" }, "This shared result could not be read."));
      return;
    }
    if (disposed || !container) return;
    const build = (): HTMLElement =>
      renderResultScreen(env, verify(env), {
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
    window.__trioTumble = {
      game,
      refresh: () => render(),
      legalMoves: () => game!.legalMoves(),
      seed,
      objective,
      events: bus,
      level,
    };
  };

  return {
    mount(c: HTMLElement, services?: GameServices): void {
      container = c;
      frame = services?.frame ?? null;
      disposed = false;
      frame?.onSettingsChange(() => render()); // Hints flips the verb
      declare();
      container.replaceChildren(el("div", { class: "sol-loading" }, "Loading Trio Tumble…"));
      void (async () => {
        try {
          game = await TrioTumble.load();
          verifier = await TrioTumble.load();
        } catch {
          if (!disposed && container) {
            container.replaceChildren(el("div", { class: "sol-error" }, "Could not load the game engine."));
          }
          return;
        }
        if (disposed) return;
        // The narrative overlay (Biscuit's beats) — gated to campaign play: outside
        // the campaign, decline the beat so it stays unconsumed for later.
        overlay = createOverlay(document.body);
        story = attachStory(bus, (beat) => {
          if (level === null || disposed) return false;
          overlay?.show(beat);
          return true;
        });
        const url = new URL(location.href);
        const shared = url.searchParams.get("r");
        if (shared) {
          await showShared(shared);
          return;
        }
        // `?mode=blockers` / `?mode=jelly` / `?mode=ingredients` / `?mode=checklist`
        // open a non-target-score objective directly.
        const modeParam = url.searchParams.get("mode");
        const isObjectiveMode =
          modeParam === "blockers" ||
          modeParam === "jelly" ||
          modeParam === "ingredients" ||
          modeParam === "checklist" ||
          modeParam === "obstacles";
        if (isObjectiveMode) {
          objective = modeParam;
        }
        if (pendingResume) {
          const p = pendingResume;
          pendingResume = null;
          await applyResume(p);
          return;
        }
        // Precedence: ?r= (shared) > ?seed= > ?mode= > ?level=N > campaign(unlocked).
        const seedParam = url.searchParams.get("seed");
        if (seedParam !== null) {
          await startGame("free", BigInt(seedParam));
          return;
        }
        if (isObjectiveMode) {
          await startGame("daily");
          return;
        }
        const levelParam = url.searchParams.get("level");
        if (levelParam !== null) {
          await startLevel(Number(levelParam));
          return;
        }
        // A first-time visitor lands in the campaign at their furthest unlocked
        // level; if the campaign pack can't load, fall back to the daily board.
        const camp = await ensureCampaign();
        if (camp && !disposed) {
          // Resume an in-progress campaign board (replaying its saved moves) if one
          // was left mid-play; otherwise open the furthest unlocked level fresh.
          const saved = loadResume();
          if (saved && saved.level != null && levelById(camp, saved.level) && saved.moves.length) {
            await startLevel(saved.level, saved.moves);
          } else {
            await startLevel(unlockedLevel(camp));
          }
          return;
        }
        await startGame("daily");
      })();
    },
    unmount(): void {
      disposed = true;
      delete window.__trioTumble;
      story?.stop();
      story = null;
      overlay?.destroy();
      overlay = null;
      cascadeEl?.remove();
      cascadeEl = null;
      container?.replaceChildren();
      container = null;
      frame = null;
      game = null;
      verifier = null;
      selected = null;
    },
    // --- the progress store: the board's seed, objective, level and every swap ---
    snapshot(): Progress {
      const b = game?.board();
      const now = new Date().toISOString();
      const done = gameOver();
      const swaps = b?.movesLeft ?? 0;
      return {
        v: 1,
        status: done ? "finished" : "in-progress",
        startedAt: now,
        updatedAt: now,
        setup: {
          mode: level === null && mode === "daily" ? `daily:${today(new Date())}` : "free",
          objective,
          ...(level !== null ? { level } : {}),
          seed: seed.toString(),
        },
        record: { seed: seed.toString(), objective, ...(level !== null ? { level } : {}), moves: [...moveLog] },
        summary: {
          line: done
            ? `Finished · score ${b?.score ?? 0}`
            : `${level !== null ? `Level ${level} · ` : ""}score ${b?.score ?? 0} · ${swaps} swap${swaps === 1 ? "" : "s"} left`,
        },
      };
    },
    resume(p: Progress): void {
      if (game) void applyResume(p);
      else pendingResume = p;
    },
  };
}
