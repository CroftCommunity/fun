//! The Blockdoku board over the `blockdoku-wasm` binding. Tap a tray piece to
//! select it, then tap a glowing cell to drop it; complete a row, column, or 3×3
//! box to clear it. The **core decides legality** — the UI glows exactly the
//! core's legal anchors and an illegal tap is a no-op. Endless score-attack; a
//! verifiable `pond-outcome` record (final score) is shown, shareable via `?r=`.

import type { GameModule } from "../../contract.js";
import {
  Blockdoku,
  DEFAULT_CONFIG,
  type BoardView,
  type DealConfig,
  type Difficulty,
  type MoveView,
  type PieceView,
} from "./blockdoku-wasm.js";
import {
  decodeRecord,
  encodeRecord,
  verifyRecord,
  type BlockdokuEnvelope,
  type VerifyResult,
} from "./blockdoku-outcome.js";
import { dayIndexUTC } from "../share.js";
import {
  declareAssistanceEnabled,
  hintsEnabled,
  setDeclareAssistance,
  setHintsEnabled,
} from "../../settings.js";

/** Best-score-per-difficulty persistence (session-degrading, like settings). */
const bestKey = (d: Difficulty): string => `fun-blockdoku-best-${d}`;
function bestScore(d: Difficulty): number {
  try {
    return Number(localStorage.getItem(bestKey(d)) ?? "0") || 0;
  } catch {
    return 0;
  }
}
function recordBest(d: Difficulty, score: number): number {
  const prev = bestScore(d);
  if (score <= prev) return prev;
  try {
    localStorage.setItem(bestKey(d), String(score));
  } catch {
    // storage denied: the best still shows for the session via the return value
  }
  return score;
}

declare global {
  interface Window {
    /** E2E hook: the live binding + a re-render, so tests drive the core. */
    __blockdoku?: {
      game: Blockdoku;
      refresh: () => void;
      seed: bigint;
      select: (slot: number) => void;
      place: (slot: number, row: number, col: number) => void;
      tapAt: (row: number, col: number) => void;
      hint: () => void;
      undo: () => void;
    };
  }
}

const DIFFICULTIES: Difficulty[] = ["easy", "normal", "hard", "expert"];

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

// ---------- the result screen (pure DOM, exported for unit tests) ----------

function headline(env: BlockdokuEnvelope, v: VerifyResult): string {
  if (!v.ok) return "Verification FAILED — this result does not check out";
  return `Score ${env.payload.score ?? 0} — verifiable`;
}

export interface ResultScreenOpts {
  shareUrl?: string;
  onReverify?: () => void;
  onPlayAgain?: () => void;
  shared?: boolean;
}

/** Build the Blockdoku result screen: score headline, verification badge, the
 *  record (score / moves / seed / hash), and controls. */
export function renderResultScreen(
  env: BlockdokuEnvelope,
  verification: VerifyResult,
  opts: ResultScreenOpts = {},
): HTMLElement {
  const rec = env.payload;
  const section = el("section", { class: "sol-result", role: "region", "aria-label": "Result" });
  section.append(el("h2", { class: "sol-headline" }, headline(env, verification)));

  const badge = el("p", {
    class: `sol-verify-badge ${verification.ok ? "ok" : "fail"}`,
    role: "status",
  });
  badge.textContent = verification.ok
    ? "Verified ✓ — re-checked by replaying every move against the core."
    : `Verification failed — expected hash ${verification.expected}, replay produced ${verification.actual}.`;
  section.append(badge);

  const dl = el("dl", { class: "sol-record" });
  const row = (term: string, value: string, cls = ""): void => {
    dl.append(el("dt", {}, term), el("dd", cls ? { class: cls } : {}, value));
  };
  row("Result", rec.result);
  row("Score", String(rec.score ?? 0));
  row("Moves", String(rec.move_count));
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
  if (opts.onPlayAgain) {
    const b = el(
      "button",
      { type: "button", class: "sol-again" },
      opts.shared ? "Play today’s board" : "Play again",
    );
    b.addEventListener("click", opts.onPlayAgain);
    controls.append(b);
  }
  if (controls.childNodes.length) section.append(controls);
  return section;
}

// ---------- the game module ----------

/** Construct a fresh Blockdoku module (the registry `load`). */
export function blockdokuModule(): GameModule {
  let game: Blockdoku | null = null;
  let verifier: Blockdoku | null = null;
  let container: HTMLElement | null = null;
  let disposed = false;

  let mode: "daily" | "free" = "daily";
  let seed = 0n;
  let config: DealConfig = { ...DEFAULT_CONFIG };
  let selected: number | null = null;
  let cursor = { r: 4, c: 4 }; // the target the piece centres on (hover / keyboard)
  let boardEl: HTMLElement | null = null;

  const statusEl = el("p", { class: "sol-status", role: "status", "aria-live": "polite" });
  const setStatus = (msg: string): void => {
    statusEl.textContent = msg;
  };

  const shareUrlFor = async (env: BlockdokuEnvelope): Promise<string> =>
    `${location.origin}${location.pathname}?r=${await encodeRecord(env)}`;
  const verify = (env: BlockdokuEnvelope): VerifyResult => verifyRecord(verifier!, env);

  const legalFor = (slot: number | null): MoveView[] =>
    slot === null ? [] : game!.legalMoves().filter((m) => m.slot === slot);

  // "Tap the middle of the piece; it snaps to the nearest spot it fits." Among the
  // core's legal placements for the slot, pick the one whose piece-centre is
  // closest to the target cell (tie-break row then col). The UI never invents a
  // placement — it only ever chooses among core-legal moves.
  const snapAnchor = (slot: number | null, tr: number, tc: number): MoveView | null => {
    if (slot === null || !game) return null;
    const piece = game.tray()[slot];
    const legal = legalFor(slot);
    if (!piece || legal.length === 0) return null;
    const cr = piece.rows / 2;
    const cc = piece.cols / 2;
    let best = legal[0]!;
    let bestD = Infinity;
    for (const m of legal) {
      const dr = m.row + cr - (tr + 0.5);
      const dc = m.col + cc - (tc + 0.5);
      const d = dr * dr + dc * dc;
      if (d < bestD) {
        bestD = d;
        best = m;
      }
    }
    return best;
  };

  const selectSlot = (slot: number): void => {
    if (!game || game.isOver()) return;
    if (legalFor(slot).length === 0) return; // an unplaceable piece cannot be selected
    selected = slot;
    render();
  };

  const placeAt = (slot: number, row: number, col: number): void => {
    if (!game || game.isOver()) return;
    if (game.playPlace(slot, row, col) !== "applied") return; // core decides
    selected = null;
    setStatus("");
    render();
  };

  // Place the selected piece near a target cell, snapped to its nearest fit.
  const placeSnapped = (tr: number, tc: number): void => {
    if (selected === null) return;
    const a = snapAnchor(selected, tr, tc);
    if (a) placeAt(a.slot, a.row, a.col);
  };

  const undo = (): void => {
    if (!game || !game.undo()) return; // core marks assistance
    selected = null;
    setStatus("Undid the last move (counts as assistance).");
    render();
  };

  const showHint = (): void => {
    if (!game || game.isOver()) return;
    const hint = game.hint();
    if (!hint) {
      setStatus("No legal move remains.");
      return;
    }
    game.markAssistance();
    selected = hint.slot;
    cursor = { r: hint.row, c: hint.col };
    setStatus(`Hint: piece ${hint.slot + 1} fits here (a hint counts as assistance).`);
    render();
  };

  const imStuck = (): void => {
    if (!game || game.isOver()) return;
    const hadMove = game.legalMoves().length > 0;
    setStatus(
      hadMove ? "Ended early — you still had a legal move." : "Ended — no legal move remained.",
    );
    render(true);
  };

  // ---- rendering ----

  const renderHud = (b: BoardView): HTMLElement =>
    el(
      "div",
      { class: "bdk-hud" },
      el("span", { class: "bdk-score" }, `Score ${b.score}`),
      el("span", { class: "bdk-best" }, `Best ${Math.max(bestScore(config.difficulty), b.score)}`),
      el("span", { class: "bdk-streak" }, `Streak ${b.streak}`),
      el("span", { class: "bdk-diff" }, config.difficulty),
    );

  const renderControls = (): HTMLElement => {
    const bar = el("div", { class: "sol-controls" });
    const modes = el("div", { class: "sol-modes", role: "group", "aria-label": "Board" });
    const daily = el(
      "button",
      { type: "button", class: "sol-mode-daily", "aria-pressed": String(mode === "daily") },
      "Today’s board",
    );
    const fresh = el(
      "button",
      { type: "button", class: "sol-new", "aria-pressed": String(mode === "free") },
      "New board",
    );
    daily.addEventListener("click", () => void startGame("daily"));
    fresh.addEventListener("click", () => void startGame("free"));
    modes.append(daily, fresh);

    // Hints on → "Hint"; hints off → "I'm stuck" (ends + reports honestly).
    const hints = hintsEnabled();
    const actionBtn = el(
      "button",
      { type: "button", class: hints ? "sol-hint" : "sol-stuck" },
      hints ? "Hint" : "I’m stuck",
    );
    actionBtn.addEventListener("click", hints ? showHint : imStuck);

    const undoBtn = el("button", { type: "button", class: "bdk-undo" }, "Undo");
    undoBtn.addEventListener("click", undo);

    const settings = el("details", { class: "sol-settings" });
    const diffSel = el("select", { class: "bdk-diff-select", "aria-label": "Difficulty" });
    for (const d of DIFFICULTIES) {
      const o = el("option", { value: d }, d);
      if (d === config.difficulty) o.setAttribute("selected", "selected");
      diffSel.append(o);
    }
    diffSel.addEventListener("change", () => {
      config = { ...config, difficulty: (diffSel as HTMLSelectElement).value as Difficulty };
      void startGame(mode);
    });
    const assist = el("label", { class: "sol-setting" });
    const assistBox = el("input", { type: "checkbox", class: "sol-set-assist" });
    (assistBox as HTMLInputElement).checked = declareAssistanceEnabled();
    assistBox.addEventListener("change", () =>
      setDeclareAssistance((assistBox as HTMLInputElement).checked),
    );
    assist.append(assistBox, document.createTextNode(" Declare assistance used"));
    const hintsToggle = el("label", { class: "sol-setting" });
    const hintsBox = el("input", { type: "checkbox", class: "sol-set-hints" });
    (hintsBox as HTMLInputElement).checked = hints;
    hintsBox.addEventListener("change", () => {
      setHintsEnabled((hintsBox as HTMLInputElement).checked);
      render();
    });
    hintsToggle.append(hintsBox, document.createTextNode(" Enable hints"));

    settings.append(
      el("summary", {}, "Settings"),
      el("label", { class: "sol-setting" }, "Difficulty ", diffSel),
      hintsToggle,
      assist,
    );
    bar.append(modes, actionBtn, undoBtn, settings);
    return bar;
  };

  // Repaint only the transient overlay (cursor ring + the single snapped ghost)
  // via targeted class toggles, so a hover/keyboard move doesn't re-render 81
  // cells. There is NO full-board legal glow — just a preview of where THIS tap
  // would land, snapped to the nearest fit.
  const paintGhost = (): void => {
    if (!boardEl) return;
    boardEl
      .querySelectorAll(".bdk-ghost, .bdk-cursor")
      .forEach((c) => c.classList.remove("bdk-ghost", "bdk-cursor"));
    boardEl
      .querySelector(`.bdk-cell[data-r="${cursor.r}"][data-c="${cursor.c}"]`)
      ?.classList.add("bdk-cursor");
    if (selected === null) return;
    const a = snapAnchor(selected, cursor.r, cursor.c);
    const piece = game!.tray()[selected];
    if (!a || !piece) return;
    for (const key of footprint(piece, a.row, a.col)) {
      boardEl
        .querySelector(`.bdk-cell[data-r="${key.split(",")[0]}"][data-c="${key.split(",")[1]}"]`)
        ?.classList.add("bdk-ghost");
    }
  };

  const renderBoard = (b: BoardView): HTMLElement => {
    const board = el("div", {
      class: "bdk-board",
      role: "group",
      "aria-label": "Blockdoku board",
      tabindex: "0",
    });
    for (let r = 0; r < b.size; r++) {
      for (let c = 0; c < b.size; c++) {
        const classes = ["bdk-cell"];
        if (b.cells[r]![c] === 1) classes.push("bdk-filled");
        if (r % 3 === 0) classes.push("bdk-box-top");
        if (c % 3 === 0) classes.push("bdk-box-left");
        // Cells are presentational: the labelled tray buttons + keyboard
        // (1/2/3 select, arrows move the cursor, Enter places) are the
        // accessible floor, so the 81-cell grid needs no per-cell ARIA.
        board.append(
          el("div", {
            class: classes.join(" "),
            "data-r": String(r),
            "data-c": String(c),
            "aria-hidden": "true",
          }),
        );
      }
    }
    // Hover moves the preview (desktop); a tap drops the piece, snapped.
    board.addEventListener("pointermove", (e) => {
      if (selected === null) return;
      const cell = (e.target as HTMLElement).closest<HTMLElement>(".bdk-cell");
      if (!cell) return;
      cursor = { r: Number(cell.dataset.r), c: Number(cell.dataset.c) };
      paintGhost();
    });
    board.addEventListener("click", (e) => {
      const cell = (e.target as HTMLElement).closest<HTMLElement>(".bdk-cell");
      if (!cell || selected === null) return;
      placeSnapped(Number(cell.dataset.r), Number(cell.dataset.c));
    });
    boardEl = board;
    return board;
  };

  const renderTray = (): HTMLElement => {
    const tray = game!.tray();
    const wrap = el("div", { class: "bdk-tray", role: "group", "aria-label": "Pieces" });
    tray.forEach((piece, slot) => {
      const placeable = legalFor(slot).length > 0;
      const slotEl = el("button", {
        type: "button",
        class: `bdk-piece${selected === slot ? " bdk-selected" : ""}${piece && placeable ? "" : " bdk-piece-dead"}`,
        "data-slot": String(slot),
        "aria-pressed": String(selected === slot),
        "aria-label": piece ? `Piece ${slot + 1}: ${piece.name}${placeable ? "" : " (no legal placement)"}` : `Slot ${slot + 1} empty`,
        ...(piece && placeable ? {} : { disabled: "disabled" }),
      });
      if (piece) slotEl.append(renderMini(piece));
      slotEl.addEventListener("click", () => selectSlot(slot));
      wrap.append(slotEl);
    });
    return wrap;
  };

  const renderMini = (piece: PieceView): HTMLElement => {
    const grid = el("div", {
      class: `bdk-mini bdk-tier-${piece.tier}`,
      style: `grid-template-columns: repeat(${piece.cols}, 1fr)`,
    });
    for (let r = 0; r < piece.rows; r++) {
      for (let c = 0; c < piece.cols; c++) {
        grid.append(
          el("span", { class: piece.cells[r]![c] === 1 ? "bdk-mini-on" : "bdk-mini-off" }),
        );
      }
    }
    return grid;
  };

  function render(force = false): void {
    if (disposed || !container || !game) return;
    if (force || game.isOver()) {
      void presentResult();
      return;
    }
    const b = game.board();
    const banner = el(
      "p",
      { class: "bdk-banner" },
      selected === null
        ? "Tap a piece to pick it up. Fill a row, column, or 3×3 box to clear it."
        : "Now tap the board where you want it — the piece centres on your tap and snaps to the nearest fit.",
    );
    container.replaceChildren(
      el(
        "div",
        { class: "bdk-game" },
        renderControls(),
        renderHud(b),
        banner,
        renderBoard(b),
        renderTray(),
        statusEl,
      ),
    );
    paintGhost(); // show the cursor ring + snapped preview for the current target
  }

  const presentResult = async (): Promise<void> => {
    if (!container || !game) return;
    const env = game.outcome(declareAssistanceEnabled()) as BlockdokuEnvelope;
    recordBest(config.difficulty, env.payload.score ?? 0);
    container.replaceChildren(el("div", { class: "sol-loading" }, "Preparing your verifiable result…"));
    const shareUrl = await shareUrlFor(env);
    if (disposed || !container) return;
    const build = (): HTMLElement =>
      renderResultScreen(env, verify(env), {
        shareUrl,
        onReverify: () => container!.replaceChildren(build()),
        onPlayAgain: () => void startGame(mode),
      });
    container.replaceChildren(build());
  };

  const onKeydown = (e: KeyboardEvent): void => {
    if (!game || game.isOver() || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key >= "1" && e.key <= "3") {
      selectSlot(Number(e.key) - 1);
      e.preventDefault();
      return;
    }
    if (e.key === "u" || e.key === "U") {
      undo();
      e.preventDefault();
      return;
    }
    const step: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    if (e.key in step) {
      const [dr, dc] = step[e.key]!;
      cursor = { r: Math.max(0, Math.min(8, cursor.r + dr)), c: Math.max(0, Math.min(8, cursor.c + dc)) };
      paintGhost(); // move the preview without re-rendering the whole board
      e.preventDefault();
    } else if (e.key === "Enter" && selected !== null) {
      placeSnapped(cursor.r, cursor.c);
      e.preventDefault();
    }
  };

  async function startGame(nextMode: "daily" | "free", seedOverride?: bigint): Promise<void> {
    if (!game || disposed) return;
    mode = nextMode;
    const base =
      seedOverride ??
      (nextMode === "daily" ? BigInt(game.dailySeed(dayIndexUTC(new Date()))) : randomSeed());
    seed = base;
    selected = null;
    cursor = { r: 4, c: 4 };
    setStatus("");
    game.newGame(base, config);
    exposeHook();
    render();
  }

  const randomSeed = (): bigint => {
    const buf = new Uint32Array(2);
    crypto.getRandomValues(buf);
    return (BigInt(buf[0]!) << 4n) ^ BigInt(buf[1]! & 0xf);
  };

  const showShared = async (payload: string): Promise<void> => {
    if (!container) return;
    let env: BlockdokuEnvelope;
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
    window.__blockdoku = {
      game,
      refresh: () => render(),
      seed,
      select: (slot: number) => selectSlot(slot),
      place: (slot: number, row: number, col: number) => placeAt(slot, row, col),
      tapAt: (row: number, col: number) => placeSnapped(row, col),
      hint: () => showHint(),
      undo: () => undo(),
    };
  };

  return {
    mount(c: HTMLElement): void {
      container = c;
      disposed = false;
      container.replaceChildren(el("div", { class: "sol-loading" }, "Loading Blockdoku…"));
      document.addEventListener("keydown", onKeydown);
      void (async () => {
        try {
          game = await Blockdoku.load();
          verifier = await Blockdoku.load();
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
        if (seedParam !== null) {
          await startGame("free", BigInt(seedParam));
          return;
        }
        await startGame("daily");
      })();
    },
    unmount(): void {
      disposed = true;
      document.removeEventListener("keydown", onKeydown);
      delete window.__blockdoku;
      container?.replaceChildren();
      container = null;
      game = null;
      verifier = null;
    },
  };
}

/** The board cells a piece occupies if anchored at `(row, col)`. */
function footprint(piece: PieceView, row: number, col: number): string[] {
  const out: string[] = [];
  for (let r = 0; r < piece.rows; r++) {
    for (let c = 0; c < piece.cols; c++) {
      if (piece.cells[r]![c] === 1) out.push(`${row + r},${col + c}`);
    }
  }
  return out;
}
