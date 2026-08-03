//! The Blockdoku board over the `blockdoku-wasm` binding. **Drag** a tray piece
//! onto the board — a live preview glows green where the whole shape fits, red
//! where it doesn't — and release to drop it; complete a row, column, or 3×3 box
//! to clear it. Tap-to-select then tap-the-board (and full keyboard control) is
//! the accessible fallback. The **core decides legality** — the UI only ever
//! places where the core says the shape fits, and an illegal drop is a no-op.
//! Endless score-attack; a verifiable `pond-outcome` record (final score) is
//! shown, shareable via `?r=`.

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

// ---------- drag geometry (pure, exported for unit tests) ----------

/** Board pixel geometry for mapping a floating piece to a grid anchor. */
export interface BoardGeom {
  /** Viewport x of the top-left corner of cell (0,0). */
  left: number;
  /** Viewport y of the top-left corner of cell (0,0). */
  top: number;
  /** Cell pitch in px (cells are contiguous, so pitch == cell size). */
  cell: number;
}

/**
 * The board anchor (top-left cell) a piece points at, given the floating clone's
 * top-left in viewport pixels — clamped so the whole shape stays on the board.
 * This decides only *which cell* the dragged piece targets; the core still
 * decides *legality* (a drop is placed only if the core reports it legal).
 */
export function anchorFromClone(
  cloneLeft: number,
  cloneTop: number,
  geom: BoardGeom,
  piece: { rows: number; cols: number },
  size = 9,
): { r: number; c: number } {
  const rawC = Math.round((cloneLeft - geom.left) / geom.cell);
  const rawR = Math.round((cloneTop - geom.top) / geom.cell);
  return {
    r: Math.max(0, Math.min(size - piece.rows, rawR)),
    c: Math.max(0, Math.min(size - piece.cols, rawC)),
  };
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
  // The keyboard/tap anchor: the board cell the selected piece's TOP-LEFT sits on.
  let cursor = { r: 3, c: 3 };
  let boardEl: HTMLElement | null = null;
  // The active pointer drag, if any (a floating clone tracks the finger; the board
  // previews where it would land). Null when not dragging.
  let drag: DragState | null = null;
  // A pointer drag/tap raises a synthetic `click` right after `pointerup`. This
  // flag swallows exactly that click so it doesn't double-fire selection or a
  // stray placement. A keyboard/AT activation raises `click` with no preceding
  // pointer sequence, so that path still selects/places.
  let dragJustEnded = false;

  interface DragState {
    slot: number;
    pointerId: number;
    clone: HTMLElement;
    grabDX: number;
    grabDY: number;
    legal: Set<string>;
    anchor: { r: number; c: number } | null;
    moved: boolean;
    startX: number;
    startY: number;
  }

  const statusEl = el("p", { class: "sol-status", role: "status", "aria-live": "polite" });
  const setStatus = (msg: string): void => {
    statusEl.textContent = msg;
  };

  const shareUrlFor = async (env: BlockdokuEnvelope): Promise<string> =>
    `${location.origin}${location.pathname}?r=${await encodeRecord(env)}`;
  const verify = (env: BlockdokuEnvelope): VerifyResult => verifyRecord(verifier!, env);

  const legalFor = (slot: number | null): MoveView[] =>
    slot === null || !game ? [] : game.legalMoves().filter((m) => m.slot === slot);

  /** The set of legal top-left anchors ("r,c") for a slot — cheap membership. */
  const legalSet = (slot: number | null): Set<string> =>
    new Set(legalFor(slot).map((m) => `${m.row},${m.col}`));

  /** Clamp an anchor so the whole `rows×cols` shape stays on the 9×9 board. */
  const clampAnchor = (
    piece: { rows: number; cols: number },
    r: number,
    c: number,
  ): { r: number; c: number } => ({
    r: Math.max(0, Math.min(9 - piece.rows, r)),
    c: Math.max(0, Math.min(9 - piece.cols, c)),
  });

  /** Live board geometry (top-left of cell 0,0 + cell pitch), or null pre-render. */
  const boardGeom = (): BoardGeom | null => {
    const c0 = boardEl?.querySelector<HTMLElement>('.bdk-cell[data-r="0"][data-c="0"]');
    if (!c0) return null;
    const rect = c0.getBoundingClientRect();
    return { left: rect.left, top: rect.top, cell: rect.width };
  };

  const selectSlot = (slot: number): void => {
    if (!game || game.isOver()) return;
    const piece = game.tray()[slot];
    if (!piece || legalFor(slot).length === 0) return; // an unplaceable piece can't be picked
    selected = slot;
    cursor = clampAnchor(piece, cursor.r, cursor.c); // keep the anchor valid for this shape
    render();
  };

  const placeAt = (slot: number, row: number, col: number): void => {
    if (!game || game.isOver()) return;
    if (game.playPlace(slot, row, col) !== "applied") return; // core decides
    selected = null;
    setStatus("");
    render();
  };

  // Exact placement for the keyboard/tap fallback: anchor the selected piece's
  // TOP-LEFT at (r,c), clamped in-bounds. If the core doesn't accept it, say so —
  // no silent "nearest fit" snapping (that was the confusing part).
  const tapPlace = (r: number, c: number): void => {
    if (selected === null || !game) return;
    const piece = game.tray()[selected];
    if (!piece) return;
    const a = clampAnchor(piece, r, c);
    if (!legalSet(selected).has(`${a.r},${a.c}`)) {
      setStatus("That piece won’t fit there — try another spot.");
      return;
    }
    placeAt(selected, a.r, a.c);
  };

  // ---- pointer drag: grab a tray piece, drag it over the board, drop to place ----

  /** A floating clone of a piece at board-cell scale (follows the finger). */
  const buildDragClone = (piece: PieceView, cell: number): HTMLElement => {
    const clone = el("div", {
      class: `bdk-drag bdk-tier-${piece.tier}`,
      "aria-hidden": "true",
      style: `grid-template-columns: repeat(${piece.cols}, ${cell}px); grid-template-rows: repeat(${piece.rows}, ${cell}px);`,
    });
    for (let r = 0; r < piece.rows; r++) {
      for (let c = 0; c < piece.cols; c++) {
        clone.append(el("span", { class: piece.cells[r]![c] === 1 ? "bdk-drag-on" : "bdk-drag-off" }));
      }
    }
    return clone;
  };

  const updateDrag = (x: number, y: number): void => {
    if (!drag || !game) return;
    const left = x - drag.grabDX;
    const top = y - drag.grabDY;
    drag.clone.style.left = `${left}px`;
    drag.clone.style.top = `${top}px`;
    const geom = boardGeom();
    const piece = game.tray()[drag.slot];
    if (!geom || !piece) {
      drag.anchor = null;
      paintGhost(null);
      return;
    }
    drag.anchor = anchorFromClone(left, top, geom, piece);
    paintGhost(drag.anchor);
  };

  const endDrag = (): void => {
    if (!drag) return;
    window.removeEventListener("pointermove", onDragMove);
    window.removeEventListener("pointerup", onDragEnd);
    window.removeEventListener("pointercancel", onDragEnd);
    drag.clone.remove();
    drag = null;
  };

  const onDragMove = (ev: PointerEvent): void => {
    if (!drag || ev.pointerId !== drag.pointerId) return;
    if (Math.abs(ev.clientX - drag.startX) > 6 || Math.abs(ev.clientY - drag.startY) > 6) {
      drag.moved = true;
    }
    updateDrag(ev.clientX, ev.clientY);
    ev.preventDefault();
  };

  const onDragEnd = (ev: PointerEvent): void => {
    if (!drag || ev.pointerId !== drag.pointerId) return;
    const { slot, anchor, moved, legal } = drag;
    endDrag();
    dragJustEnded = true; // swallow the synthetic click that follows this pointerup
    setTimeout(() => {
      dragJustEnded = false;
    }, 0);
    // A real drag onto a legal cell places; a tap (no movement) or an illegal drop
    // just leaves the piece selected so the tap/keyboard fallback can finish it.
    if (moved && anchor && legal.has(`${anchor.r},${anchor.c}`)) {
      placeAt(slot, anchor.r, anchor.c);
    } else {
      render();
    }
  };

  const startDrag = (slot: number, ev: PointerEvent): void => {
    if (!game || game.isOver()) return;
    const piece = game.tray()[slot];
    if (!piece || legalFor(slot).length === 0) return; // a dead piece can't be dragged
    selected = slot;
    cursor = clampAnchor(piece, cursor.r, cursor.c);
    const cell = boardGeom()?.cell ?? 30;
    const clone = buildDragClone(piece, cell);
    document.body.append(clone);
    drag = {
      slot,
      pointerId: ev.pointerId,
      clone,
      // Float the piece centred over — and lifted above — the finger, so it stays
      // visible while dragging.
      grabDX: (piece.cols * cell) / 2,
      grabDY: piece.rows * cell + cell * 0.6,
      legal: legalSet(slot),
      anchor: null,
      moved: false,
      startX: ev.clientX,
      startY: ev.clientY,
    };
    window.addEventListener("pointermove", onDragMove);
    window.addEventListener("pointerup", onDragEnd);
    window.addEventListener("pointercancel", onDragEnd);
    render(); // reflect the selection (tray highlight); the clone lives on <body>
    updateDrag(ev.clientX, ev.clientY);
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

  // Repaint the transient placement preview via targeted class toggles, so a
  // drag/keyboard move doesn't re-render all 81 cells. When NOTHING is selected
  // the board is left clean — there is no resting cursor and no full-board glow.
  // The preview shows exactly the selected piece's footprint at the current
  // anchor: green (`bdk-ghost`) where the core accepts it, red (`bdk-ghost-bad`)
  // where it doesn't.
  const paintGhost = (override?: { r: number; c: number } | null): void => {
    if (!boardEl) return;
    boardEl
      .querySelectorAll(".bdk-ghost, .bdk-ghost-bad")
      .forEach((c) => c.classList.remove("bdk-ghost", "bdk-ghost-bad"));
    if (selected === null || !game) return;
    const piece = game.tray()[selected];
    if (!piece) return;
    const a = override ?? clampAnchor(piece, cursor.r, cursor.c);
    const legal = drag ? drag.legal : legalSet(selected);
    const cls = legal.has(`${a.r},${a.c}`) ? "bdk-ghost" : "bdk-ghost-bad";
    for (const key of footprint(piece, a.r, a.c)) {
      const [r, c] = key.split(",");
      boardEl.querySelector(`.bdk-cell[data-r="${r}"][data-c="${c}"]`)?.classList.add(cls);
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
    // Desktop hover moves the anchor so the mouse gets a live preview and can
    // click-to-place. During a pointer drag the window listener owns the preview,
    // so the board's own hover stands down.
    board.addEventListener("pointermove", (e) => {
      if (selected === null || drag) return;
      const cell = (e.target as HTMLElement).closest<HTMLElement>(".bdk-cell");
      if (!cell || !game) return;
      const piece = game.tray()[selected];
      if (!piece) return;
      cursor = clampAnchor(piece, Number(cell.dataset.r), Number(cell.dataset.c));
      paintGhost();
    });
    // A plain tap/click on the board places the selected piece exactly (top-left
    // at the tapped cell, clamped). The click synthesised right after a drag is
    // swallowed so it can't double-place.
    board.addEventListener("click", (e) => {
      if (dragJustEnded) return;
      const cell = (e.target as HTMLElement).closest<HTMLElement>(".bdk-cell");
      if (!cell || selected === null) return;
      tapPlace(Number(cell.dataset.r), Number(cell.dataset.c));
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
      if (piece && placeable) {
        // Press-and-drag starts a drag; a plain tap/keyboard activation selects.
        slotEl.addEventListener("pointerdown", (e) => {
          slotEl.releasePointerCapture?.(e.pointerId); // let window own the move stream
          startDrag(slot, e);
          e.preventDefault();
        });
      }
      slotEl.addEventListener("click", () => {
        if (dragJustEnded) return; // the synthetic click after a drag/tap
        selectSlot(slot);
      });
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
        ? "Drag a piece onto the board — or tap a piece, then tap where it goes. Fill a row, column, or 3×3 box to clear it."
        : "Drop it where the piece lights up (it turns red where it won’t fit). Tap the board or press Enter to place; arrow keys nudge it.",
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
    paintGhost(); // preview the selected piece at the current anchor (nothing if unselected)
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
    if (e.key in step && selected !== null) {
      const piece = game.tray()[selected];
      if (piece) {
        const [dr, dc] = step[e.key]!;
        cursor = clampAnchor(piece, cursor.r + dr, cursor.c + dc);
        paintGhost(); // move the preview without re-rendering the whole board
      }
      e.preventDefault();
    } else if (e.key === "Enter" && selected !== null) {
      tapPlace(cursor.r, cursor.c);
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
      tapAt: (row: number, col: number) => tapPlace(row, col),
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
      endDrag(); // drop any floating clone + window drag listeners
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
