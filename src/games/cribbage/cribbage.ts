//! Cribbage over the `cribbage-wasm` binding: two-hand, six-card cribbage to
//! 121 against the shelf's engine, on one device.
//!
//! Four things drive the UI, and all four come from the core:
//!
//! - **You only ever see your own view.** The wrapper has no `state()`; the
//!   engine's hand is not in any buffer this file reads. Card backs are drawn
//!   from a *count*.
//! - **The core decides legality.** Every card is tappable; what does not play
//!   is refused by the core rather than gated here. The one piece of UI-side
//!   gating is the discard's "two selected" confirm, because a throw is two
//!   cards and one tap is not a move.
//! - **Counting is a move.** With manual counting off (the default) the UI
//!   submits the core's exact claim on your behalf after a beat, narrating the
//!   breakdown; with it on, you type a number and the core grades it — an
//!   under-count is the engine's by muggins.
//! - **The game's value is stated.** A win is worth 1, a skunk 2, a double
//!   skunk 3; the record carries it and the end screen says it.
//!
//! A finished game is a verifiable `pond-outcome` record, shareable via `?r=`.

import type { GameModule } from "../../contract.js";
import { captureUiState, restoreUiState } from "../../ui-state.js";
import {
  cribbageLevel,
  cribbageManualCount,
  cribbageTutorEnabled,
  declareAssistanceEnabled,
  hintsEnabled,
  setCribbageLevel,
  setCribbageManualCount,
  setCribbageTutor,
  setDeclareAssistance,
  setHintsEnabled,
  type CribbageLevel,
} from "../../settings.js";
import {
  decodeRecord,
  encodeRecord,
  verifyRecord,
  type CribbageEnvelope,
  type VerifyResult,
} from "./cribbage-outcome.js";
import {
  CLAIM_BASE,
  Cribbage,
  discardCode,
  GO_CODE,
  PLAY_BASE,
  type Assessment,
  type CardView,
  type LastEvent,
  type Level,
  type RevealedHand,
  type UiView,
} from "./cribbage-wasm.js";

declare global {
  interface Window {
    /** E2E hook: the live binding + a re-render, so tests drive the core. */
    __cribbage?: {
      game: Cribbage;
      refresh: () => void;
      seed: bigint;
      /** True while the engine is moving or a beat is playing — tests wait on this. */
      busy: () => boolean;
    };
  }
}

/** The opponent's identity — honest: it is the shelf's engine. */
const OPPONENT = { name: "The Engine", avatar: "🤖" } as const;
/**
 * The persona slot for the opt-in local-AI opponent, wired the way Furrow wires
 * Millet so the LLM trial is a name and a prompt, not a UI change. The trial
 * has not shipped for cribbage (plan O4), so the slot is reserved and unused.
 */
const LOCAL_AI_PERSONA = { name: "The Engine", avatar: "🤖" } as const;
type OpponentKind = "engine" | "local-ai";

const HUMAN = 1 as const;
const ENGINE = 2 as const;

/**
 * The beats: how long the engine appears to think, the pause after a scoring
 * event so its line can be read, the pause before an automatic claim so the
 * hand is seen before it is counted, and the beat before the result screen.
 *
 * `?fast=1` collapses them to a frame. It exists for the browser suite: a full
 * game is ~10 deals of beats, which held a CI worker for over a minute per
 * engine while asserting nothing about the beats themselves, and the mobile
 * leg was starving other suites' page loads (2026-08-29, run 33263190505).
 */
const BEATS = { think: 420, settle: 260, show: 900, fanfare: 1400 } as const;
const FAST_BEATS = { think: 16, settle: 16, show: 16, fanfare: 60 } as const;
let beats: { think: number; settle: number; show: number; fanfare: number } = BEATS;

const LEVELS: readonly CribbageLevel[] = ["Easy", "Medium", "Hard", "Expert"];
const TARGET = 121;
const SKUNK_LINE = 90;

const SUITS = ["♣", "♦", "♥", "♠"] as const;
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;

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

// ---------- pure helpers (unit-tested) ----------

/** Whether a suit draws red (♦ ♥). */
export function isRed(suit: number): boolean {
  return suit === 1 || suit === 2;
}

/** How a card reads: rank then suit glyph. */
export function cardLabel(c: CardView): string {
  return `${RANKS[c.rank - 1] ?? "?"}${SUITS[c.suit] ?? "?"}`;
}

/** Where a peg sits along the track, as a percentage of 121, clamped. */
export function pegPercent(score: number): number {
  return Math.max(0, Math.min(100, (score / TARGET) * 100));
}

const who = (seat: 1 | 2, opponent: string): string => (seat === HUMAN ? "You" : opponent);

/** The end screen's headline: the score and the game's value. */
export function outcomeLabel(v: UiView, endedEarly: string | null): string {
  if (v.result === -1) return endedEarly ?? "Ended early";
  const [you, them] = v.scores;
  const games = v.value === 1 ? "1 game" : `${v.value} games`;
  if (v.result === HUMAN) {
    const verb = v.value === 3 ? "double-skunked" : v.value === 2 ? "skunked" : "beat";
    return v.value === 1
      ? `You won ${you}–${them} — worth ${games}`
      : `You ${verb} ${OPPONENT.name} ${you}–${them} — worth ${games}`;
  }
  const verb = v.value === 3 ? "double-skunked you" : v.value === 2 ? "skunked you" : "won";
  return `${OPPONENT.name} ${verb} ${them}–${you} — worth ${games}`;
}

/** What to do now, in one line. */
export function turnLine(v: UiView, opponent: string): string {
  const mine = v.toMove === HUMAN;
  switch (v.phase) {
    case "discard": {
      const crib = v.dealer === HUMAN ? "your crib" : `${opponent}'s crib`;
      return mine
        ? `Choose two cards to throw — it is ${crib}.`
        : `${opponent} is choosing its throw to ${crib}.`;
    }
    case "peg":
      if (!mine) return `${opponent} to play — the count is ${v.count}.`;
      return v.legal.length === 1 && v.legal[0] === GO_CODE
        ? `Nothing plays under 31 — say go. The count is ${v.count}.`
        : `Your play — the count is ${v.count}.`;
    case "showNonDealer":
    case "showDealer": {
      const owner = (v.phase === "showDealer") === (v.dealer === HUMAN) ? "your hand" : `${opponent}'s hand`;
      return `The show: counting ${owner}.`;
    }
    case "showCrib":
      return `The show: counting the crib (${v.dealer === HUMAN ? "yours" : `${opponent}'s`}).`;
    case "over":
      return "Game over.";
  }
}

function breakdownWords(b: NonNullable<LastEvent["actual"]>): string {
  const parts: string[] = [];
  if (b.fifteens) parts.push(`fifteens ${b.fifteens}`);
  if (b.pairs) parts.push(`pairs ${b.pairs}`);
  if (b.runs) parts.push(`runs ${b.runs}`);
  if (b.flush) parts.push(`flush ${b.flush}`);
  if (b.nobs) parts.push(`nobs ${b.nobs}`);
  return parts.join(", ");
}

/** A scoring event as one line, or null when nothing scored. */
export function scoredLine(last: LastEvent, opponent: string): string | null {
  const name = who(last.seat, opponent);
  switch (last.kind) {
    case "heels":
      return `${name}: 2 for his heels`;
    case "go":
      return `${name}: 1 for the go`;
    case "lastCard":
      return `${name}: 1 for last card`;
    case "peg": {
      if (last.points === 0) return null;
      const parts: string[] = [];
      if (last.fifteen) parts.push(`fifteen ${last.fifteen}`);
      if (last.thirtyOne) parts.push(`thirty-one ${last.thirtyOne}`);
      if (last.pairs) parts.push(`${last.pairs === 2 ? "a pair" : last.pairs === 6 ? "pair royal" : "double pair royal"} ${last.pairs}`);
      if (last.run) parts.push(`run of ${last.run}`);
      return `${name}: ${parts.join(", ")} — ${last.points}`;
    }
    case "claim": {
      const actual = last.actual!;
      const claimed = last.claimed ?? 0;
      const muggins = last.muggins ?? 0;
      const other = last.seat === HUMAN ? opponent : "You";
      const verb = last.seat === HUMAN ? "counted" : "counted";
      if (muggins > 0) return `${name} ${verb} ${claimed} of ${actual.total} — ${other} took ${muggins} by muggins`;
      if (claimed > actual.total) return `${name} claimed ${claimed} but the hand is ${actual.total}: ${breakdownWords(actual)}`;
      const words = actual.total === 0 ? "nothing" : breakdownWords(actual);
      return `${name} ${verb} ${actual.total}: ${words}`;
    }
  }
}

/** The coach's line plus a pointer at the better move, hedged like the line. */
export function coachFor(a: Assessment, best: number | null): string {
  if (a.regret === 0 || best === null) return a.line;
  if (a.exact) return `${a.line} Best keep: throw pair ${best}.`;
  return `${a.line} It would have played card ${best - PLAY_BASE + 1}.`;
}

// ---------- the module ----------

interface ResultScreenOpts {
  label: string;
  finalTable: HTMLElement;
  shareUrl?: string;
  shared?: boolean;
  onReverify?: () => void;
  onPlayAgain?: () => void;
}

function renderResultScreen(
  env: CribbageEnvelope,
  verification: VerifyResult,
  opts: ResultScreenOpts,
): HTMLElement {
  const rec = env.payload;
  const section = el("section", { class: "sol-result", role: "region", "aria-label": "Result" });
  section.append(
    el(
      "h2",
      { class: "sol-headline" },
      verification.ok ? `${opts.label} — verifiable` : "Verification FAILED — this result does not check out",
    ),
  );
  const badge = el("p", { class: `sol-verify-badge ${verification.ok ? "ok" : "fail"}`, role: "status" });
  badge.textContent = verification.ok
    ? "Verified ✓ — re-checked by replaying every deal, throw, play and count against the core."
    : `Verification failed — expected hash ${verification.expected}, replay produced ${verification.actual}.`;
  section.append(badge, opts.finalTable);

  const dl = el("dl", { class: "sol-record" });
  const row = (term: string, value: string, cls = ""): void => {
    dl.append(el("dt", {}, term), el("dd", cls ? { class: cls } : {}, value));
  };
  row("Result", opts.label);
  row("Moves", String(rec.move_count));
  if (rec.score !== undefined) row("Worth", `${rec.score} ${rec.score === 1 ? "game" : "games"}`);
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
    controls.append(el("a", { class: "sol-share", href: opts.shareUrl, "data-share": opts.shareUrl }, "Share this result"));
  }
  if (opts.onPlayAgain) {
    const b = el("button", { type: "button", class: "sol-again" }, opts.shared ? "Play a game" : "Play again");
    b.addEventListener("click", opts.onPlayAgain);
    controls.append(b);
  }
  if (controls.childNodes.length) section.append(controls);
  return section;
}

/** Construct a fresh cribbage module (the registry `load`). */
export function cribbageModule(): GameModule {
  let game: Cribbage | null = null;
  let verifier: Cribbage | null = null;
  let container: HTMLElement | null = null;
  let disposed = false;
  let busy = false;
  let ending = false;
  let seed = 0n;
  let level: CribbageLevel = cribbageLevel();
  let status = "";
  /** Hand positions selected for the throw (at most two). */
  let selected: number[] = [];
  let coachMsg: string | null = null;
  let pendingCoach: string | null = null;
  let endedEarly: string | null = null;
  let tutorView: { note: string; options: string[]; hash: string } | null = null;
  // The persona slot is wired but empty (plan O4): the engine is the opponent.
  const opponentKind = "engine" as OpponentKind;
  const opponentIdentity = (): { name: string; avatar: string } =>
    opponentKind === "local-ai" ? LOCAL_AI_PERSONA : OPPONENT;

  const setStatus = (text: string): void => {
    status = text;
    const node = container?.querySelector(".crib-status");
    if (node) node.textContent = text;
  };

  // ---------- rendering ----------

  const cardNode = (c: CardView, attrs: Record<string, string> = {}, tag: "button" | "div" = "div"): HTMLElement => {
    const colour = isRed(c.suit) ? "red" : "black";
    const node = el(tag, { ...attrs, class: `crib-card ${colour} ${attrs.class ?? ""}`.trim(), "aria-label": attrs["aria-label"] ?? cardLabel(c) });
    if (tag === "button") node.setAttribute("type", "button");
    else node.setAttribute("role", "img");
    node.append(el("span", { class: "crib-rank" }, RANKS[c.rank - 1] ?? "?"), el("span", { class: "crib-suit" }, SUITS[c.suit] ?? "?"));
    return node;
  };
  const backNode = (): HTMLElement => el("div", { class: "crib-card back", "aria-hidden": "true" });

  const renderTurnbar = (v: UiView): HTMLElement => {
    const mine = v.toMove === HUMAN;
    const crib = (seat: 1 | 2): string => (v.dealer === seat ? " · crib" : "");
    return el(
      "div",
      { class: "crib-turnbar", role: "status" },
      el("span", { class: `crib-seat you${mine ? " active" : ""}` }, `You ${v.scores[0]}${crib(HUMAN)}`),
      el(
        "span",
        { class: `crib-seat them${mine ? "" : " active"}` },
        `${opponentIdentity().avatar} ${opponentIdentity().name} ${v.scores[1]}${crib(ENGINE)}`,
      ),
    );
  };

  /** Two tracks to 121 with the skunk line at 90. */
  const renderPegboard = (v: UiView): HTMLElement => {
    const track = (seat: 1 | 2): HTMLElement => {
      const score = seat === HUMAN ? v.scores[0] : v.scores[1];
      const t = el(
        "div",
        { class: `crib-track ${seat === HUMAN ? "you" : "them"}`, role: "img", "aria-label": `${who(seat, opponentIdentity().name)}: ${score} of ${TARGET}` },
        el("span", { class: "crib-skunk", "aria-hidden": "true", style: `left:${pegPercent(SKUNK_LINE)}%` }),
        el("span", { class: "crib-peg", "aria-hidden": "true", style: `left:${pegPercent(score)}%` }),
      );
      return t;
    };
    return el(
      "div",
      { class: "crib-pegboard", role: "group", "aria-label": "Peg board" },
      track(ENGINE),
      track(HUMAN),
      el("span", { class: "crib-skunk-label", "aria-hidden": "true" }, "skunk line"),
    );
  };

  const renderRevealed = (r: RevealedHand, interactive: boolean): HTMLElement => {
    const ownerName = r.step === "crib" ? `${who(r.owner, opponentIdentity().name)} — the crib` : `${who(r.owner, opponentIdentity().name)}`;
    const box = el("div", { class: `crib-revealed ${r.owner === HUMAN ? "you" : "them"}${r.actual ? " graded" : ""}`, "data-step": r.step });
    box.append(el("p", { class: "crib-revealed-owner" }, ownerName));
    box.append(el("div", { class: "crib-cards" }, ...r.cards.map((c) => cardNode(c))));
    if (r.actual) {
      const words = r.actual.total === 0 ? "nothing" : breakdownWords(r.actual);
      const claimed = r.claimed ?? r.actual.total;
      const line =
        r.muggins && r.muggins > 0
          ? `Counted ${claimed} of ${r.actual.total} — ${r.muggins} went by muggins`
          : claimed > r.actual.total
            ? `Claimed ${claimed}; the hand is ${r.actual.total}: ${words}`
            : `${r.actual.total}: ${words}`;
      box.append(el("p", { class: "crib-breakdown" }, line));
    } else if (interactive) {
      // Manual counting: the claim is yours to make.
      const input = el("input", { type: "number", min: "0", max: "29", inputmode: "numeric", class: "crib-claim-input", "aria-label": "Your count" });
      const submit = el("button", { type: "button", class: "crib-claim" }, "Count it");
      const claim = (): void => {
        const n = Number((input as HTMLInputElement).value);
        if (!Number.isInteger(n) || n < 0 || n > 29) {
          setStatus("A hand counts 0 to 29.");
          return;
        }
        void applyMove(CLAIM_BASE + n);
      };
      submit.addEventListener("click", claim);
      input.addEventListener("keydown", (ev) => {
        if ((ev as KeyboardEvent).key === "Enter") claim();
      });
      box.append(el("div", { class: "crib-claim-row" }, input, submit));
    } else {
      box.append(el("p", { class: "crib-breakdown pending" }, "Counting…"));
    }
    return box;
  };

  const renderTable = (v: UiView, interactive: boolean): HTMLElement => {
    const opp = el(
      "div",
      { class: "crib-opp", role: "img", "aria-label": `${opponentIdentity().name} holds ${v.opponentCards} ${v.opponentCards === 1 ? "card" : "cards"}` },
      ...Array.from({ length: v.opponentCards }, backNode),
    );
    const cut = v.cut
      ? cardNode(v.cut, { class: "cut", "aria-label": `Cut: ${cardLabel(v.cut)}` })
      : el("div", { class: "crib-card slot", role: "img", "aria-label": "The cut, face down" });
    const crib = el(
      "div",
      { class: "crib-crib", role: "img", "aria-label": `${v.dealer === HUMAN ? "Your" : `${opponentIdentity().name}'s`} crib: ${v.cribCards} cards` },
      ...Array.from({ length: Math.min(v.cribCards, 2) }, backNode),
      el("span", { class: "crib-crib-label" }, v.dealer === HUMAN ? "your crib" : `${opponentIdentity().name}'s crib`),
    );
    const stack = el(
      "div",
      { class: "crib-stack", role: "group", "aria-label": `Played this count: ${v.stack.map(cardLabel).join(" ") || "nothing"}` },
      ...v.stack.map((c) => cardNode(c, { class: "played" })),
    );
    const count = el("p", { class: "crib-count", role: "status" }, v.phase === "peg" ? `Count ${v.count}` : "");

    const showing = v.revealed.length > 0;
    const show = showing
      ? el(
          "div",
          { class: "crib-show" },
          ...v.revealed.map((r) => {
            const stepPhase = r.step === "nonDealer" ? "showNonDealer" : r.step === "dealer" ? "showDealer" : "showCrib";
            const yours = r.owner === HUMAN && v.phase === stepPhase && v.toMove === HUMAN && cribbageManualCount() && !r.actual;
            return renderRevealed(r, yours);
          }),
        )
      : null;

    const hand = el(
      "div",
      { class: "crib-hand", role: "group", "aria-label": "Your hand" },
      ...v.hand.map((c, i) => {
        const legalPlay = v.phase === "peg" && interactive && v.legal.includes(PLAY_BASE + i);
        const classes = [
          v.phase === "discard" && selected.includes(i) ? "selected" : "",
          legalPlay ? "legal" : "",
        ]
          .filter(Boolean)
          .join(" ");
        const node = cardNode(c, { class: classes, "data-index": String(i), "aria-label": `${cardLabel(c)}${selected.includes(i) ? ", selected" : ""}` }, "button");
        if (!interactive) node.setAttribute("aria-disabled", "true");
        return node;
      }),
    );

    const actions = el("div", { class: "crib-actions" });
    if (v.phase === "discard" && interactive) {
      const throwBtn = el("button", { type: "button", class: "crib-throw" }, "Throw to crib");
      if (selected.length !== 2) throwBtn.setAttribute("disabled", "disabled");
      throwBtn.addEventListener("click", () => {
        if (selected.length !== 2) return;
        void applyMove(discardCode(selected[0]!, selected[1]!));
      });
      actions.append(throwBtn);
    }
    if (v.phase === "peg" && interactive && v.legal.includes(GO_CODE)) {
      const goBtn = el("button", { type: "button", class: "crib-go" }, "Go");
      goBtn.addEventListener("click", () => void applyMove(GO_CODE));
      actions.append(goBtn);
    }

    return el(
      "div",
      { class: "crib-table", role: "group", "aria-label": "The table" },
      opp,
      el("div", { class: "crib-middle" }, cut, crib, stack, count),
      ...(show ? [show] : []),
      hand,
      actions,
    );
  };

  const renderControls = (): HTMLElement => {
    const select = el("select", { class: "crib-level", "aria-label": "Difficulty" });
    for (const l of LEVELS) {
      const opt = el("option", l === level ? { selected: "selected" } : {}, l);
      opt.setAttribute("value", l);
      select.append(opt);
    }
    select.addEventListener("change", () => {
      level = select.value as CribbageLevel;
      setCribbageLevel(level);
    });
    const fresh = el("button", { type: "button", class: "crib-new" }, "New game");
    fresh.addEventListener("click", () => void startGame());
    const hints = hintsEnabled();
    const action = el("button", { type: "button", class: hints ? "crib-hint" : "crib-stuck" }, hints ? "Hint" : "I’m done");
    action.addEventListener("click", hints ? showHint : endNow);

    const toggle = (checked: boolean, label: string, cls: string, onChange: (on: boolean) => void): HTMLElement => {
      const input = el("input", { type: "checkbox", class: cls });
      (input as HTMLInputElement).checked = checked;
      input.addEventListener("change", () => onChange((input as HTMLInputElement).checked));
      return el("label", { class: "crib-toggle" }, input, ` ${label}`);
    };
    const details = el("details", { class: "sol-settings crib-settings" });
    details.append(
      el("summary", {}, "Settings"),
      toggle(hints, "Enable hints", "crib-set-hints", (on) => {
        setHintsEnabled(on);
        render();
      }),
      toggle(declareAssistanceEnabled(), "Declare assistance used", "crib-set-assist", (on) => setDeclareAssistance(on)),
      toggle(cribbageTutorEnabled(), "Show tutor", "crib-set-tutor", (on) => {
        setCribbageTutor(on);
        render();
      }),
      toggle(cribbageManualCount(), "Count my own hands (muggins on)", "crib-set-manual", (on) => {
        setCribbageManualCount(on);
        render();
        void step();
      }),
    );
    return el("div", { class: "crib-controls" }, el("label", { class: "crib-field" }, "Difficulty ", select), fresh, action, details);
  };

  const humanToMove = (): boolean => Boolean(game) && game!.view().toMove === HUMAN && game!.view().result === -1;

  const showHint = (): void => {
    if (!game || busy || ending || !humanToMove()) return;
    const v = game.view();
    const report = game.tutor();
    const best = report.moves[0];
    if (!best) return;
    game.markAssistance();
    if (v.phase === "discard") {
      const pairs: [number, number][] = [];
      for (let a = 0; a < 6; a += 1) for (let b = a + 1; b < 6; b += 1) pairs.push([a, b]);
      const [a, b] = pairs[best.code] ?? [0, 1];
      setStatus(`Hint: throw ${cardLabel(v.hand[a]!)} ${cardLabel(v.hand[b]!)} — ${(best.expected / 100).toFixed(1)} expected on average. Counts as assistance.`);
    } else {
      const c = v.hand[best.code - PLAY_BASE];
      setStatus(`Hint: play ${c ? cardLabel(c) : "a card"} — ${best.line} Counts as assistance.`);
    }
  };

  const endNow = (): void => {
    if (!game || ending) return;
    endedEarly = `Ended early — deal ${game.view().dealNo} was in progress`;
    finish();
  };

  const renderTutorPanel = (): HTMLElement => {
    const panel = el("section", { class: "crib-tutor", "aria-label": "Tutor" });
    const explain = el("button", { type: "button", class: "crib-tutor-explain" }, "Explain my options");
    const note = el("p", { class: "crib-tutor-note", "aria-live": "polite" });
    const optionsEl = el("ul", { class: "crib-tutor-options", "aria-label": "Options" });
    if (tutorView && game && tutorView.hash === game.currentHash()) {
      note.textContent = tutorView.note;
      optionsEl.replaceChildren(...tutorView.options.map((line) => el("li", {}, line)));
    }
    explain.addEventListener("click", () => {
      if (!game || busy || ending || !humanToMove()) return;
      const g = game;
      const v = g.view();
      const report = g.tutor();
      const at = g.currentHash();
      const heading = report.exact
        ? "Exact — averaged over every card that could be cut:"
        : "The engine's reading (the other hand is a model, not a fact):";
      const pairs: [number, number][] = [];
      for (let a = 0; a < 6; a += 1) for (let b = a + 1; b < 6; b += 1) pairs.push([a, b]);
      const options = report.moves.slice(0, 6).map((m) => {
        const what =
          v.phase === "discard"
            ? `throw ${pairs[m.code]!.map((i) => cardLabel(v.hand[i]!)).join(" ")}`
            : `play ${cardLabel(v.hand[m.code - PLAY_BASE]!)}`;
        return `${what} — ${(m.expected / 100).toFixed(1)} (${m.quality})`;
      });
      tutorView = { note: heading, options, hash: at };
      note.textContent = heading;
      optionsEl.replaceChildren(...options.map((line) => el("li", {}, line)));
    });
    const coach = el("p", { class: "crib-tutor-coach", role: "status", "aria-live": "polite" });
    if (coachMsg) coach.textContent = coachMsg;
    panel.append(explain, note, optionsEl, coach);
    return panel;
  };

  const render = (): void => {
    if (!game || !container || ending) return;
    const v = game.view();
    const interactive = v.toMove === HUMAN && !busy && v.result === -1;
    // The player's open settings panel and focus survive the rebuild: the
    // engine's resting render lands at a moment nothing in the UI predicts, and
    // on CI it landed between a test opening the panel and checking a box inside
    // it (run 33264669353, mobile-webkit — the Dots hang, again).
    const ui = captureUiState(container);
    container.replaceChildren(
      el(
        "div",
        { class: "crib-game" },
        renderTurnbar(v),
        renderControls(),
        renderPegboard(v),
        renderTable(v, interactive),
        el("p", { class: "crib-turnline" }, turnLine(v, opponentIdentity().name)),
        ...(cribbageTutorEnabled() ? [renderTutorPanel()] : []),
        el("p", { class: "crib-status", role: "status" }, status),
      ),
    );
    container.querySelector(".crib-hand")?.addEventListener("click", onHandClick);
    restoreUiState(container, ui);
  };

  // ---------- moves ----------

  const narrate = (v: UiView): void => {
    if (!v.last) return;
    const line = scoredLine(v.last, opponentIdentity().name);
    if (line) setStatus(line);
  };

  const onHandClick = (ev: Event): void => {
    const target = (ev.target as HTMLElement | null)?.closest("[data-index]");
    if (!target || !game || busy || ending) return;
    const v = game.view();
    if (v.toMove !== HUMAN || v.result === -1 === false) return;
    const i = Number(target.getAttribute("data-index"));
    if (v.phase === "discard") {
      selected = selected.includes(i) ? selected.filter((x) => x !== i) : [...selected, i].slice(-2);
      render();
      return;
    }
    if (v.phase === "peg") void applyMove(PLAY_BASE + i);
  };

  const applyMove = async (code: number): Promise<void> => {
    if (!game || busy || ending) return;
    if (game.view().toMove !== HUMAN) return;
    if (status) setStatus("");
    if (cribbageTutorEnabled()) {
      const a = game.assess(code);
      pendingCoach = a ? coachFor(a, game.tutor().best) : null;
    }
    const outcome = game.play(code);
    if (outcome !== "applied") {
      setStatus("That move is not legal here.");
      render();
      return;
    }
    selected = [];
    coachMsg = pendingCoach;
    pendingCoach = null;
    tutorView = null;
    narrate(game.view());
    render();
    await step();
  };

  /** Guards against two loops driving the engine at once. */
  let stepping = false;

  /**
   * Let the engine move, and make automatic claims, for as long as the turn is
   * not the human's to act. `busy` is held for the WHOLE loop — including the
   * settle beat after each move — and the resting view is painted exactly once,
   * at exit. The first version released `busy` before the settle beat so the
   * player could act sooner; measured in the e2e suite, that let a tap start a
   * second loop while the first was still asleep, and the two then drove the
   * engine together, re-rendering under every tap.
   */
  const step = async (): Promise<void> => {
    if (!game || disposed || ending || stepping) return;
    stepping = true;
    busy = true;
    let guard = 0;
    try {
      while (game.view().result === -1 && guard < 60) {
        guard += 1;
        const v = game.view();
        const atShow = v.phase.startsWith("show");
        if (v.toMove === ENGINE) {
          render();
          await sleep(atShow ? beats.show : beats.think);
          if (disposed || !game) return;
          const mv = game.liveMove(level as Level);
          if (mv === null) break;
          game.play(mv);
        } else if (atShow && !cribbageManualCount()) {
          render();
          await sleep(beats.show);
          if (disposed || !game) return;
          const claim = game.autoClaim();
          if (claim === null) break;
          game.play(claim);
        } else {
          break;
        }
        narrate(game.view());
        render();
        await sleep(beats.settle);
        if (disposed || !game) return;
      }
    } finally {
      stepping = false;
      busy = false;
    }
    if (game.view().result !== -1) {
      finish();
      return;
    }
    render();
  };

  // ---------- ending ----------

  const verify = (env: CribbageEnvelope): VerifyResult => verifyRecord(verifier!, env);

  const shareUrlFor = async (env: CribbageEnvelope): Promise<string> => {
    const payload = await encodeRecord(env);
    const url = new URL(location.href);
    url.search = "";
    url.searchParams.set("r", payload);
    return url.toString();
  };

  const finalTable = (v: UiView): HTMLElement =>
    el("div", { class: "crib-final" }, renderTurnbar(v), renderPegboard(v));

  const finish = (): void => {
    if (!game || !container) return;
    ending = true;
    const v = game.view();
    const won = v.result === HUMAN;
    container.replaceChildren(
      el(
        "div",
        { class: "crib-game" },
        renderTurnbar(v),
        el("p", { class: `crib-flash${won ? " win" : ""}`, role: "status" }, outcomeLabel(v, endedEarly)),
        renderPegboard(v),
        el("p", { class: "crib-status", role: "status" }, status),
      ),
    );
    window.setTimeout(() => {
      if (disposed) return;
      void presentResult();
    }, beats.fanfare);
  };

  const presentResult = async (): Promise<void> => {
    if (!container || !game) return;
    const env = game.outcome(declareAssistanceEnabled()) as CribbageEnvelope;
    const v = game.view();
    const label = outcomeLabel(v, endedEarly);
    container.replaceChildren(el("div", { class: "sol-loading" }, "Preparing your verifiable result…"));
    const shareUrl = await shareUrlFor(env);
    if (disposed || !container) return;
    const build = (): HTMLElement =>
      renderResultScreen(env, verify(env), {
        label,
        finalTable: finalTable(v),
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
    selected = [];
    coachMsg = null;
    pendingCoach = null;
    endedEarly = null;
    tutorView = null;
    seed = seedOverride ?? randomSeed();
    game.newGame(seed);
    setStatus("");
    exposeHook();
    render();
    await step();
  }

  const showShared = async (payload: string): Promise<void> => {
    if (!container) return;
    let env: CribbageEnvelope;
    try {
      env = await decodeRecord(payload);
    } catch {
      container.replaceChildren(el("div", { class: "sol-error" }, "This shared result could not be read."));
      return;
    }
    if (disposed || !container) return;
    const verification = verify(env);
    const v = verifier!.view();
    const worth = v.value === 1 ? "worth 1 game" : `worth ${v.value} games`;
    const label =
      v.result === -1
        ? "Ended early"
        : v.result === 1
          ? `First player won ${v.scores[0]}–${v.scores[1]} — ${worth}`
          : `Second player won ${v.scores[1]}–${v.scores[0]} — ${worth}`;
    const build = (): HTMLElement =>
      renderResultScreen(env, verification, {
        label,
        finalTable: finalTable(v),
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
    window.__cribbage = { game, refresh: () => render(), seed, busy: () => busy };
  };

  return {
    mount(c: HTMLElement): void {
      container = c;
      disposed = false;
      level = cribbageLevel();
      container.replaceChildren(el("div", { class: "sol-loading" }, "Loading Cribbage…"));
      void (async () => {
        try {
          game = await Cribbage.load();
          verifier = await Cribbage.load();
        } catch {
          if (!disposed && container) {
            container.replaceChildren(el("div", { class: "sol-error" }, "Could not load the game engine."));
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
      })();
    },
    unmount(): void {
      disposed = true;
      delete window.__cribbage;
      container?.replaceChildren();
      container = null;
      game = null;
      verifier = null;
    },
  };
}
