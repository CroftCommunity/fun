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
import { declareAssistanceEnabled, setDeclareAssistance } from "../../settings.js";

declare global {
  interface Window {
    /** E2E hook: the live binding + a re-render, so tests drive the core. */
    __blockdoku?: {
      game: Blockdoku;
      refresh: () => void;
      seed: bigint;
      select: (slot: number) => void;
      place: (slot: number, row: number, col: number) => void;
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
  let cursor = { r: 0, c: 0 };

  const shareUrlFor = async (env: BlockdokuEnvelope): Promise<string> =>
    `${location.origin}${location.pathname}?r=${await encodeRecord(env)}`;
  const verify = (env: BlockdokuEnvelope): VerifyResult => verifyRecord(verifier!, env);

  const legalFor = (slot: number | null): MoveView[] =>
    slot === null ? [] : game!.legalMoves().filter((m) => m.slot === slot);

  const selectSlot = (slot: number): void => {
    if (!game || game.isOver()) return;
    const legal = legalFor(slot);
    if (legal.length === 0) return; // an unplaceable piece cannot be selected
    selected = slot;
    cursor = { r: legal[0]!.row, c: legal[0]!.col };
    render();
  };

  const place = (slot: number, row: number, col: number): void => {
    if (!game || game.isOver()) return;
    if (game.playPlace(slot, row, col) !== "applied") return; // core decides
    selected = null;
    render();
  };

  // ---- rendering ----

  const renderHud = (b: BoardView): HTMLElement =>
    el(
      "div",
      { class: "bdk-hud" },
      el("span", { class: "bdk-score" }, `Score ${b.score}`),
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
    settings.append(
      el("summary", {}, "Settings"),
      el("label", { class: "sol-setting" }, "Difficulty ", diffSel),
      assist,
    );
    bar.append(modes, settings);
    return bar;
  };

  const renderBoard = (b: BoardView): HTMLElement => {
    const legal = legalFor(selected);
    const legalSet = new Set(legal.map((m) => `${m.row},${m.col}`));
    // The ghost footprint = the selected piece placed at the cursor, if legal.
    const ghost = new Set<string>();
    if (selected !== null && legalSet.has(`${cursor.r},${cursor.c}`)) {
      const piece = game!.tray()[selected];
      if (piece) footprint(piece, cursor.r, cursor.c).forEach((k) => ghost.add(k));
    }

    const boardEl = el("div", {
      class: "bdk-board",
      role: "group",
      "aria-label": "Blockdoku board",
      tabindex: "0",
    });
    for (let r = 0; r < b.size; r++) {
      for (let c = 0; c < b.size; c++) {
        const key = `${r},${c}`;
        const classes = ["bdk-cell"];
        if (b.cells[r]![c] === 1) classes.push("bdk-filled");
        if (ghost.has(key)) classes.push("bdk-ghost");
        if (legalSet.has(key)) classes.push("bdk-legal");
        if (r === cursor.r && c === cursor.c) classes.push("bdk-cursor");
        if (r % 3 === 0) classes.push("bdk-box-top");
        if (c % 3 === 0) classes.push("bdk-box-left");
        // Cells are presentational: the labelled tray buttons + keyboard
        // (1/2/3 select, arrows move the cursor, Enter places) are the
        // accessible floor, so the 81-cell grid needs no per-cell ARIA.
        const cell = el("div", {
          class: classes.join(" "),
          "data-r": String(r),
          "data-c": String(c),
          "aria-hidden": "true",
        });
        boardEl.append(cell);
      }
    }
    boardEl.addEventListener("click", (e) => {
      const cell = (e.target as HTMLElement).closest<HTMLElement>(".bdk-cell");
      if (!cell || selected === null) return;
      const r = Number(cell.dataset.r);
      const c = Number(cell.dataset.c);
      if (legalSet.has(`${r},${c}`)) place(selected, r, c);
    });
    return boardEl;
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
      "Tap a piece, then tap a glowing cell to drop it. Fill a row, column, or 3×3 box to clear it.",
    );
    container.replaceChildren(
      el("div", { class: "bdk-game" }, renderControls(), renderHud(b), banner, renderBoard(b), renderTray()),
    );
  }

  const presentResult = async (): Promise<void> => {
    if (!container || !game) return;
    const env = game.outcome(declareAssistanceEnabled()) as BlockdokuEnvelope;
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
    const step: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    if (e.key in step) {
      const [dr, dc] = step[e.key]!;
      cursor = { r: Math.max(0, Math.min(8, cursor.r + dr)), c: Math.max(0, Math.min(8, cursor.c + dc)) };
      render();
      e.preventDefault();
    } else if (e.key === "Enter" && selected !== null) {
      place(selected, cursor.r, cursor.c);
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
    cursor = { r: 0, c: 0 };
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
      place: (slot: number, row: number, col: number) => place(slot, row, col),
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
