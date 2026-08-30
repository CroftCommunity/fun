//! The Mahjong board over the `mahjong-wasm` binding. Tap a free tile, tap its
//! match; the core owns every rule — FREE, the match, the deal, the shuffle —
//! and the run replays byte-identically from `(packed origin, move codes)`, so
//! the result is a verifiable `pond-outcome` shareable via `?r=`.

import type { GameModule, GameServices } from "../../contract.js";
import type { GameFrame, GameFrameSpec } from "../../game-frame.js";
import type { Progress } from "../../progress.js";
import { emptyRecord, readRecord, recordSolve, writeRecord, type GameRecord, type InProgress } from "../../record.js";
import type { SettingRow } from "../../settings-sheet.js";
import { today } from "../../shelf.js";
import {
  declareAssistanceEnabled,
  hintsEnabled,
  mahjongDimBlocked,
  mahjongTileStyle,
  setMahjongDimBlocked,
  setMahjongTileStyle,
} from "../../settings.js";
import { dayIndexUTC } from "../share.js";
import { decodeRecord, encodeRecord, verifyRecord, type MahjongEnvelope, type VerifyResult } from "./mahjong-outcome.js";
import { dailySeedFor, Mahjong, type BoardView, type HintView } from "./mahjong-wasm.js";
import { faceLabel, faceSvg, type TileStyle } from "./tiles.js";

declare global {
  interface Window {
    /** E2E hook: the live binding + the tap path, so tests drive the core. */
    __mahjong?: {
      game: Mahjong;
      board: () => BoardView;
      tap: (slot: number) => void;
      select: (slot: number) => void;
      hint: () => HintView | null;
      shuffle: () => void;
      undo: () => void;
      startLevel: (n: number) => void;
      seed: bigint;
    };
  }
}

const GAME_ID = "mahjong";
/** Solver nodes a hint may spend — a few hundred ms in wasm on a phone. */
const HINT_BUDGET = 15_000;
/** Per-layer up-left offset, in half-tile units, and the drawn side edge. */
export const LAYER_SHIFT = 0.35;
export const SIDE_EDGE = 0.35;
const MIN_UNIT = 12;

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

/** The player-facing name of a layout slug. */
export function layoutName(slug: string): string {
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

/** Pixels per half tile so `width × height` half units plus the layer shift and the
 *  side edge fit `stageW × stageH`, never below the 12px floor. Pure. */
export function fitUnit(o: { stageW: number; stageH: number; width: number; height: number; layers: number }): number {
  const extra = LAYER_SHIFT * Math.max(0, o.layers - 1) + SIDE_EDGE;
  const byW = o.stageW / (o.width + extra);
  const byH = o.stageH / (o.height + extra);
  return Math.max(MIN_UNIT, Math.floor(Math.min(byW, byH) * 4) / 4);
}

// ---------- the result screen ----------

function headline(env: MahjongEnvelope, v: VerifyResult): string {
  if (!v.ok) return "Verification FAILED — this result does not check out";
  const clean = env.payload.result === "Won" && env.payload.assistance === false;
  return clean
    ? `Cleared clean in ${env.payload.move_count} moves — verifiable`
    : `Cleared in ${env.payload.move_count} moves — verifiable`;
}

export interface ResultOpts {
  shareLine?: string;
  shareUrl?: string;
  onReverify?: () => void;
  onPlayAgain?: () => void;
  playAgainLabel?: string;
}

/** The verification-forward result screen (the shared `sol-result` styling). */
export function renderResultScreen(env: MahjongEnvelope, verification: VerifyResult, opts: ResultOpts = {}): HTMLElement {
  const rec = env.payload;
  const section = el("section", { class: "sol-result", role: "region", "aria-label": "Result" });
  section.append(el("h2", { class: "sol-headline" }, headline(env, verification)));
  const badge = el("p", { class: `sol-verify-badge ${verification.ok ? "ok" : "fail"}`, role: "status" });
  badge.textContent = verification.ok
    ? "Verified ✓ — re-checked by replaying every move against the core."
    : `Verification failed — expected hash ${verification.expected}, replay produced ${verification.actual}.`;
  section.append(badge);
  const dl = el("dl", { class: "sol-record" });
  const row = (term: string, value: string, cls = ""): void => {
    dl.append(el("dt", {}, term), el("dd", cls ? { class: cls } : {}, value));
  };
  row("Result", rec.result === "Won" ? "Cleared" : rec.result);
  row("Moves", String(rec.move_count));
  row("Play", rec.assistance === false ? "no assistance" : rec.assistance ? "with assistance" : "—");
  row("Seed", String(rec.seed));
  row("Final hash", rec.final_hash, "sol-hash");
  section.append(dl);
  if (opts.shareLine) section.append(el("p", { class: "mj-share-line", "data-share-line": opts.shareLine }, opts.shareLine));
  const controls = el("div", { class: "sol-result-controls" });
  if (opts.onReverify) {
    const b = el("button", { type: "button", class: "sol-reverify" }, "Re-verify");
    b.addEventListener("click", opts.onReverify);
    controls.append(b);
  }
  if (opts.shareUrl) controls.append(el("a", { class: "sol-share", href: opts.shareUrl, "data-share": opts.shareUrl }, "Share this result"));
  if (opts.onPlayAgain) {
    const b = el("button", { type: "button", class: "sol-again" }, opts.playAgainLabel ?? "Play again");
    b.addEventListener("click", opts.onPlayAgain);
    controls.append(b);
  }
  if (controls.childNodes.length) section.append(controls);
  return section;
}

// ---------- persistence: the game record (src/record.ts) ----------

function record(): GameRecord {
  return readRecord(GAME_ID) ?? emptyRecord(GAME_ID);
}
function saveRecord(r: GameRecord): void {
  writeRecord({ ...r, updatedAt: new Date().toISOString() });
}
function todayKey(): string {
  return new Date().toISOString().slice(0, 10); // UTC YYYY-MM-DD
}

// ---------- the game module ----------

type ModeChoice = "levels" | "daily";
// The New game card's choice lives at module scope: the poster renders the card
// before the module exists, and the module reads it when a game starts.
let chosenMode: ModeChoice = "levels";

/** The New game card: your next level, or today's Turtle. */
export function mahjongSetupRows(): SettingRow[] {
  return [
    {
      kind: "choice",
      id: "mode",
      label: "Mode",
      hint: "Levels climb through five layouts, from a 36-tile Pond to the 144-tile Turtle, and keep going. Daily is one Turtle a day, the same for everyone.",
      value: chosenMode,
      options: [
        { value: "levels", label: "Levels" },
        { value: "daily", label: "Daily" },
      ],
      onChange: (v) => {
        chosenMode = v === "daily" ? "daily" : "levels";
      },
    },
  ];
}

/** The poster's setup card — the registry's `setup` factory. */
export const mahjongSetup = (): SettingRow[] => mahjongSetupRows();

/** Construct a fresh Mahjong module (the registry `load`). */
export function mahjongModule(): GameModule {
  let game: Mahjong | null = null;
  let verifier: Mahjong | null = null;
  let container: HTMLElement | null = null;
  let frame: GameFrame | null = null;
  let disposed = false;
  let pendingResume: Progress | null = null;

  let mode: "daily" | "levels" = "levels";
  let level = 1;
  let seed = 0n;
  let selected: number | null = null;
  let hinted: [number, number] | null = null;
  let assisted = false;
  let toasted = false;
  let stuckToasted = false;
  let solveRecorded = false;
  let ended = false;
  let style: TileStyle = mahjongTileStyle();
  let fitObserver: ResizeObserver | null = null;

  const statusEl = el("p", { class: "sol-status mj-status", role: "status", "aria-live": "polite" });
  const setStatus = (msg: string): void => {
    statusEl.textContent = msg;
  };

  const moveCodes = (): number[] => {
    if (!game) return [];
    return (game.outcome(false, false) as MahjongEnvelope).payload.moves;
  };

  // ---- the record's in-progress deal + stats ----
  const persist = (solved = false): void => {
    if (!game) return;
    const r = record();
    const inProgress: InProgress = {
      mode: mode === "daily" ? "daily" : "endless",
      level: mode === "daily" ? dayIndexUTC(new Date()) : level,
      seed: seed.toString(),
      moves: moveCodes().map((c) => [c, 0] as const),
      solved,
    };
    saveRecord({ ...r, inProgress });
  };
  const bestLevel = (): number => record().stats.bestLevel;

  // ---- rendering ----
  const fit = (): void => {
    const board = container?.querySelector<HTMLElement>(".mj-board");
    const scroll = container?.querySelector<HTMLElement>(".mj-scroll");
    const stage = frame?.stage ?? container?.parentElement;
    if (!board || !scroll || !stage) return;
    const b = game?.board();
    if (!b) return;
    const layers = Math.max(...b.slots.map((s) => s.z)) + 1;
    const cs = getComputedStyle(stage);
    const stageW = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const stageH = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - statusEl.offsetHeight - 8;
    const u = fitUnit({ stageW, stageH, width: b.width, height: b.height, layers });
    board.style.setProperty("--mj-u", `${u}px`);
    board.style.setProperty("--mj-top", String(layers - 1));
    const extra = LAYER_SHIFT * (layers - 1) + SIDE_EDGE;
    board.style.width = `${(b.width + extra) * u}px`;
    board.style.height = `${(b.height + extra) * u}px`;
  };
  const watchFit = (): void => {
    fitObserver?.disconnect();
    fitObserver = null;
    const stage = frame?.stage ?? container?.parentElement;
    if (!stage || typeof ResizeObserver === "undefined") {
      fit();
      return;
    }
    fitObserver = new ResizeObserver(() => fit());
    fitObserver.observe(stage);
    fit();
  };

  const renderTile = (b: BoardView, i: number, matches: ReadonlySet<number>): HTMLElement => {
    const s = b.slots[i]!;
    const cls = ["mj-tile", s.free ? "free" : "blocked"];
    if (selected === i) cls.push("selected");
    if (matches.has(i)) cls.push("match");
    if (hinted && (hinted[0] === i || hinted[1] === i)) cls.push("hint");
    const btn = el("button", {
      type: "button",
      class: cls.join(" "),
      "data-slot": String(i),
      "aria-label": `${faceLabel(s.face)}, ${s.free ? "free" : "blocked"}`,
      "aria-pressed": String(selected === i),
      style: `--mj-x:${s.x};--mj-y:${s.y};--mj-z:${s.z};z-index:${s.z + 1}`,
    });
    const face = el("span", { class: "mj-face" });
    face.innerHTML = faceSvg(s.face, style);
    btn.append(face);
    return btn;
  };

  const renderBoard = (b: BoardView): HTMLElement => {
    const matches = new Set(selected === null ? [] : game!.matchesFor(selected));
    const board = el("div", {
      class: `mj-board mj-style-${style}${mahjongDimBlocked() ? " mj-dim" : ""}`,
      role: "group",
      "aria-label": `Mahjong board, ${layoutName(b.layout)}, ${b.remaining} tiles left`,
    });
    for (let i = 0; i < b.slots.length; i++) {
      if (b.slots[i]!.present) board.append(renderTile(b, i, matches));
    }
    return board;
  };

  const spec = (): GameFrameSpec => {
    const b = game?.board();
    const verbs: GameFrameSpec["verbs"] = [
      { id: "undo", label: "Undo", icon: "↶", onPress: doUndo },
      hintsEnabled()
        ? { id: "hint", label: "Hint", icon: "✦", primary: true, onPress: showHint }
        : { id: "stuck", label: "I’m stuck", icon: "⇥", onPress: declareStuck },
      { id: "new", label: "New game", icon: "＋", onPress: (btn: HTMLButtonElement) => frame?.openSheet("setup", btn) },
      { id: "shuffle", label: "Shuffle", icon: "⇄", onPress: doShuffle },
    ];
    return {
      title: "Mahjong",
      mode: mode === "daily" ? "Daily · Turtle" : `Level ${level} · ${layoutName(b?.layout ?? "pond")}`,
      meters: [
        { kind: "stat", id: "left", value: b?.remaining ?? 0, label: "left" },
        { kind: "stat", id: "pairs", value: b?.pairs ?? 0, label: "matches" },
        { kind: "stat", id: "moves", value: b?.moveCount ?? 0, label: "moves" },
      ],
      verbs,
      setup: mahjongSetupRows(),
      preferences: [
        {
          kind: "choice",
          id: "tiles",
          label: "Tile faces",
          hint: "Classic draws the traditional faces; Large print uses big numerals and letters, and needs no Chinese font.",
          value: style,
          options: [
            { value: "classic", label: "Classic" },
            { value: "large", label: "Large print" },
          ],
          onChange: (v) => {
            style = v === "large" ? "large" : "classic";
            setMahjongTileStyle(style);
            render();
          },
        },
        {
          kind: "toggle",
          id: "dim",
          label: "Dim blocked tiles",
          hint: "Fade the tiles that cannot be taken yet, so the free ones stand out.",
          value: mahjongDimBlocked(),
          onChange: (on) => {
            setMahjongDimBlocked(on);
            render();
          },
        },
      ],
      onStart: () => {
        if (chosenMode === "daily") startDaily();
        else startLevel(bestLevel());
      },
    };
  };
  const declare = (): void => frame?.update(spec());

  function render(): void {
    if (disposed || !container || !game) return;
    const b = game.board();
    if (b.won) {
      if (!solveRecorded) {
        solveRecorded = true;
        const day = dayIndexUTC(new Date());
        saveRecord(
          recordSolve(record(), mode === "daily" ? { kind: "daily", strict: false, day } : { kind: "endless", level: level + 1, strict: false, day }),
        );
        persist(true);
      }
      void presentResult();
      return;
    }
    const wrap = el("div", { class: "mj-game" }, el("div", { class: "mj-scroll" }, renderBoard(b)), statusEl);
    container.replaceChildren(wrap);
    watchFit();
    if (!toasted) {
      toasted = true;
      frame?.toast("Tap a free tile, then a matching free tile, to take the pair. Free means nothing on top and a side open.", 6000);
    }
    if (b.stuck && !stuckToasted) {
      stuckToasted = true;
      frame?.toast("No matches left — shuffle or undo.", 6000);
    } else if (!b.stuck) {
      stuckToasted = false;
    }
    declare();
  }

  // ---- interaction ----
  const shake = (i: number): void => {
    const t = container?.querySelector<HTMLElement>(`.mj-tile[data-slot="${i}"]`);
    if (!t) return;
    t.classList.remove("mj-shake");
    void t.offsetWidth;
    t.classList.add("mj-shake");
    window.setTimeout(() => t.classList.remove("mj-shake"), 300);
  };

  const tap = (i: number): void => {
    if (!game || ended) return;
    const b = game.board();
    if (b.won) return;
    const s = b.slots[i];
    if (!s || !s.present) return;
    hinted = null;
    if (!s.free) {
      shake(i);
      setStatus(`${faceLabel(s.face)} is blocked.`);
      return;
    }
    if (selected === null) {
      selected = i;
      const n = game.matchesFor(i).length;
      setStatus(n ? `${faceLabel(s.face)} lifted — tap a glowing match.` : `${faceLabel(s.face)} lifted — no free match yet.`);
      render();
      return;
    }
    if (selected === i) {
      selected = null;
      setStatus("");
      render();
      return;
    }
    const from = selected;
    const status = game.play(from, i);
    if (status !== "applied") {
      shake(i);
      setStatus(`${faceLabel(s.face)} does not match.`);
      return;
    }
    selected = null;
    setStatus(`Took a pair of ${faceLabel(s.face)}.`);
    persist();
    render();
  };

  const select = (i: number): void => {
    selected = i;
    render();
  };

  const doUndo = (): void => {
    if (!game || ended) return;
    if (game.undo()) {
      assisted = true;
      selected = null;
      hinted = null;
      solveRecorded = false;
      persist();
      render();
      setStatus("Undid the last move (counts as assistance).");
    }
  };

  const doShuffle = (): void => {
    if (!game || ended) return;
    if (game.shuffle() === "applied") {
      assisted = true;
      selected = null;
      hinted = null;
      persist();
      render();
      setStatus("Shuffled the remaining tiles (counts as assistance).");
    }
  };

  const showHint = (): HintView | null => {
    if (!game || ended) return null;
    const b = game.board();
    if (b.won) return null;
    const h = game.hint(HINT_BUDGET);
    if (!h) {
      setStatus("No match from here — shuffle or undo.");
      return null;
    }
    assisted = true;
    selected = null;
    hinted = [h.a, h.b];
    render();
    const name = faceLabel(b.slots[h.a]!.face);
    setStatus(
      h.proven
        ? `Hint: the pair of ${name} (a proven line to a clear; counts as assistance).`
        : `Hint: the pair of ${name} — a legal pair, not proven to lead to a clear (counts as assistance).`,
    );
    return h;
  };

  const declareStuck = (): void => {
    if (!game) return;
    const b = game.board();
    ended = true;
    setStatus(b.pairs > 0 ? "Ended — a match was still available." : "Ended — no match remained (a genuine dead end).");
    declare();
  };

  const onKeydown = (e: KeyboardEvent): void => {
    if (e.metaKey || e.ctrlKey || e.altKey || !game) return;
    if (e.key === "Escape") {
      selected = null;
      hinted = null;
      render();
      return;
    }
    if (e.key === "u" || e.key === "U") doUndo();
  };

  // ---- result / share ----
  const shareUrlFor = async (env: MahjongEnvelope): Promise<string> => `${location.origin}${location.pathname}?r=${await encodeRecord(env)}`;

  const presentResult = async (): Promise<void> => {
    declare();
    if (!container || !game || !verifier) return;
    const b = game.board();
    const env = game.outcome(declareAssistanceEnabled(), assisted) as MahjongEnvelope;
    const shareLine = mode === "daily" ? `Mahjong ${todayKey()} · ${b.moveCount} moves` : undefined;
    container.replaceChildren(el("div", { class: "sol-loading" }, "Preparing your verifiable result…"));
    const shareUrl = await shareUrlFor(env);
    if (disposed || !container) return;
    const v = verifyRecord(verifier, env);
    const build = (): HTMLElement =>
      renderResultScreen(env, v, {
        shareLine,
        shareUrl,
        onReverify: () => container!.replaceChildren(build()),
        onPlayAgain: mode === "levels" ? () => startLevel(level + 1) : () => startDaily(),
        playAgainLabel: mode === "levels" ? "Next level" : "Play again",
      });
    container.replaceChildren(build());
  };

  const showShared = async (payload: string): Promise<void> => {
    if (!container || !verifier) return;
    let env: MahjongEnvelope;
    try {
      env = await decodeRecord(payload);
    } catch {
      container.replaceChildren(el("div", { class: "sol-error" }, "This shared result could not be read."));
      return;
    }
    if (disposed || !container) return;
    const v = verifyRecord(verifier, env);
    const build = (): HTMLElement =>
      renderResultScreen(env, v, {
        onReverify: () => container!.replaceChildren(build()),
        onPlayAgain: () => {
          location.href = location.pathname;
        },
        playAgainLabel: "Play",
      });
    container.replaceChildren(el("div", { class: "mj-shared" }, build()));
  };

  // ---- lifecycle ----
  const fresh = (): void => {
    selected = null;
    hinted = null;
    assisted = false;
    solveRecorded = false;
    ended = false;
    stuckToasted = false;
    setStatus("");
  };

  const replay = (codes: number[]): void => {
    if (!game) return;
    for (const c of codes) game.playCode(c);
  };

  function startLevel(n: number): void {
    if (!game || disposed) return;
    mode = "levels";
    chosenMode = "levels";
    level = Math.max(1, n);
    game.newLevel(level);
    seed = game.seed();
    fresh();
    console.debug(`[mahjong] level=${level} seed=${seed}`);
    persist();
    exposeHook();
    render();
  }

  function startDaily(): void {
    if (!game || disposed) return;
    mode = "daily";
    chosenMode = "daily";
    game.newDaily(dailySeedFor(todayKey()));
    seed = game.seed();
    fresh();
    console.debug(`[mahjong] daily ${todayKey()} seed=${seed}`);
    persist();
    exposeHook();
    render();
  }

  const applyResume = (p: Progress): void => {
    if (!game || disposed) return;
    const rec = p.record as { level?: unknown; moves?: unknown; assisted?: unknown };
    const codes = Array.isArray(rec.moves) ? (rec.moves as number[]) : [];
    if (typeof p.setup.mode === "string" && p.setup.mode.startsWith("daily:")) {
      mode = chosenMode = "daily";
      game.newDaily(dailySeedFor(todayKey()));
    } else {
      mode = chosenMode = "levels";
      level = Math.max(1, typeof rec.level === "number" ? rec.level : bestLevel());
      game.newLevel(level);
    }
    seed = game.seed();
    fresh();
    replay(codes);
    assisted = rec.assisted === true;
    persist();
    exposeHook();
    render();
  };

  const exposeHook = (): void => {
    if (!game) return;
    window.__mahjong = {
      game,
      board: () => game!.board(),
      tap,
      select,
      hint: showHint,
      shuffle: doShuffle,
      undo: doUndo,
      startLevel,
      seed,
    };
  };

  return {
    mount(c: HTMLElement, services?: GameServices): void {
      container = c;
      frame = services?.frame ?? null;
      disposed = false;
      style = mahjongTileStyle();
      frame?.onSettingsChange(() => render()); // Hints flips the verb
      declare();
      container.replaceChildren(el("div", { class: "sol-loading" }, "Loading Mahjong…"));
      document.addEventListener("keydown", onKeydown);
      c.addEventListener("click", (e) => {
        const btn = (e.target as HTMLElement).closest<HTMLElement>(".mj-tile");
        if (btn?.dataset.slot !== undefined) tap(Number(btn.dataset.slot));
      });
      void (async () => {
        try {
          game = await Mahjong.load();
          verifier = await Mahjong.load();
        } catch {
          if (!disposed && container) container.replaceChildren(el("div", { class: "sol-error" }, "Could not load the game engine."));
          return;
        }
        if (disposed) return;
        const url = new URL(location.href);
        const shared = url.searchParams.get("r");
        if (shared) {
          await showShared(shared);
          return;
        }
        if (pendingResume) {
          const p = pendingResume;
          pendingResume = null;
          applyResume(p);
          return;
        }
        if (url.searchParams.get("daily") === "1") {
          startDaily();
          return;
        }
        const levelParam = url.searchParams.get("level");
        if (levelParam !== null) {
          startLevel(Number(levelParam) || 1);
          return;
        }
        const seedParam = url.searchParams.get("seed");
        if (seedParam !== null) {
          mode = "levels";
          level = 1;
          game.newSeed(Number(url.searchParams.get("layout") ?? 0) || 0, Number(seedParam) >>> 0);
          seed = game.seed();
          fresh();
          exposeHook();
          render();
          return;
        }
        if (chosenMode === "daily") startDaily();
        else startLevel(bestLevel());
      })();
    },
    unmount(): void {
      disposed = true;
      fitObserver?.disconnect();
      fitObserver = null;
      document.removeEventListener("keydown", onKeydown);
      delete window.__mahjong;
      container?.replaceChildren();
      container = null;
      frame = null;
      game = null;
      verifier = null;
    },
    snapshot(): Progress {
      const b = game?.board();
      const now = new Date().toISOString();
      const done = b?.won ?? false;
      const where = mode === "daily" ? "Daily" : `Level ${level}`;
      const line = `${where} · ${b?.remaining ?? 0} tiles left · move ${b?.moveCount ?? 0}`;
      return {
        v: 1,
        status: done ? "finished" : "in-progress",
        startedAt: now,
        updatedAt: now,
        setup: { mode: mode === "daily" ? `daily:${today(new Date())}` : "free", level, seed: seed.toString() },
        record: { seed: seed.toString(), level, moves: moveCodes(), assisted },
        summary: { line: done ? `${line} · cleared` : line },
      };
    },
    resume(p: Progress): void {
      if (game) applyResume(p);
      else pendingResume = p;
    },
  };
}
