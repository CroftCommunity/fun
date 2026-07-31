//! The daily word game board over the `wyrdle-wasm` binding. Type a 5-letter
//! guess (tap the on-screen keyboard or type on a physical one); Enter submits.
//! The core decides legality — a non-word is rejected with a shake and changes
//! nothing. Each guess reveals a per-letter pattern (correct / present / absent);
//! the keyboard keys colour by best-known state. When the word is solved (or the
//! guesses run out) a verifiable `pond-outcome` record is shown, with a
//! spoiler-free emoji-grid brag to copy and a self-verifying `?r=` share.

import type { GameModule } from "../../contract.js";
import { Wyrdle, type BoardView, type Mark } from "./wyrdle-wasm.js";
import {
  decodeRecord,
  emojiGrid,
  encodeRecord,
  verifyRecord,
  type WyrdleEnvelope,
  type VerifyResult,
} from "./wyrdle-outcome.js";
import { dayIndexUTC } from "../share.js";
import {
  declareAssistanceEnabled,
  hintsEnabled,
  setDeclareAssistance,
  setHintsEnabled,
} from "../../settings.js";

declare global {
  interface Window {
    /** E2E hook: the live binding + a re-render, so tests drive the core. */
    __wyrdle?: {
      game: Wyrdle;
      refresh: () => void;
      seed: bigint;
      submitGuess: (word: string) => void;
    };
  }
}

// QWERTY, with Enter/Backspace on the last row.
const KEY_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"] as const;
const MARK_CLASS = ["wy-absent", "wy-present", "wy-correct"] as const;

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

const upper = (letterIndex: number): string => String.fromCharCode(65 + letterIndex);

// ---------- the result screen (pure DOM) ----------

function headline(env: WyrdleEnvelope, v: VerifyResult, maxGuesses: number): string {
  if (!v.ok) return "Verification FAILED — this result does not check out";
  return env.payload.result === "Won"
    ? `Solved in ${env.payload.move_count}/${maxGuesses} — verifiable`
    : "Out of guesses — not solved";
}

export interface ResultScreenOpts {
  emojiText?: string;
  emojiRows?: Mark[][];
  shareUrl?: string;
  onReverify?: () => void;
  onPlayAgain?: () => void;
  shared?: boolean;
}

/** Build the word-game result screen: outcome headline, verification badge, the
 *  record, the spoiler-free emoji grid + copy, and share/re-verify controls. */
export function renderResultScreen(
  env: WyrdleEnvelope,
  verification: VerifyResult,
  maxGuesses: number,
  opts: ResultScreenOpts = {},
): HTMLElement {
  const rec = env.payload;
  const section = el("section", { class: "sol-result", role: "region", "aria-label": "Result" });
  section.append(el("h2", { class: "sol-headline" }, headline(env, verification, maxGuesses)));

  const badge = el("p", {
    class: `sol-verify-badge ${verification.ok ? "ok" : "fail"}`,
    role: "status",
  });
  badge.textContent = verification.ok
    ? "Verified ✓ — re-checked by replaying every guess against the core."
    : `Verification failed — expected hash ${verification.expected}, replay produced ${verification.actual}.`;
  section.append(badge);

  // The spoiler-free emoji grid (the brag). Rows carry no letters.
  if (opts.emojiRows) {
    const grid = el("pre", { class: "wy-emoji-grid", "aria-label": "Your result grid" });
    grid.textContent = opts.emojiRows.map((marks) => marks.map((m) => ["⬛", "🟨", "🟩"][m]).join("")).join("\n");
    section.append(grid);
  }

  const dl = el("dl", { class: "sol-record" });
  const row = (term: string, value: string, cls = ""): void => {
    dl.append(el("dt", {}, term), el("dd", cls ? { class: cls } : {}, value));
  };
  row("Result", rec.result);
  row("Guesses used", `${rec.move_count}/${maxGuesses}`);
  row("Seed", String(rec.seed));
  row("Final hash", rec.final_hash, "sol-hash");
  section.append(dl);

  const controls = el("div", { class: "sol-result-controls" });
  if (opts.emojiText) {
    const copy = el("button", { type: "button", class: "wy-copy" }, "Copy result");
    copy.addEventListener("click", () => {
      const done = (): void => {
        copy.textContent = "Copied ✓";
      };
      try {
        void navigator.clipboard?.writeText(opts.emojiText!).then(done, done);
      } catch {
        done();
      }
    });
    controls.append(copy);
  }
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
        "Share verifiable link",
      ),
    );
  }
  if (opts.onPlayAgain) {
    const b = el(
      "button",
      { type: "button", class: "sol-again" },
      opts.shared ? "Play today’s word" : "Play again",
    );
    b.addEventListener("click", opts.onPlayAgain);
    controls.append(b);
  }
  if (controls.childNodes.length) section.append(controls);
  return section;
}

// ---------- the game module ----------

/** Construct a fresh Wyrdle module (the registry `load`). */
export function wyrdleModule(): GameModule {
  let game: Wyrdle | null = null;
  let verifier: Wyrdle | null = null;
  let container: HTMLElement | null = null;
  let disposed = false;

  let mode: "daily" | "free" = "daily";
  let seed = 0n;
  let buffer = ""; // the in-progress guess (lowercase letters)
  let shaking = false;
  let maxGuesses = 6;
  let wordLen = 5;

  const statusEl = el("p", { class: "sol-status", role: "status", "aria-live": "polite" });
  const setStatus = (msg: string): void => {
    statusEl.textContent = msg;
  };

  const randomSeed = (): bigint => {
    const buf = new Uint32Array(2);
    crypto.getRandomValues(buf);
    return (BigInt(buf[0]!) << 16n) ^ BigInt(buf[1]! & 0xffff);
  };

  const puzzleLabel = (): string => (mode === "daily" ? `#${seed}` : `#${seed}`);

  const shareUrlFor = async (env: WyrdleEnvelope): Promise<string> =>
    `${location.origin}${location.pathname}?r=${await encodeRecord(env)}`;

  const verify = (env: WyrdleEnvelope): VerifyResult => verifyRecord(verifier!, env);

  const gameOver = (): boolean => !!game && (game.isWon() || game.isLost());

  const flashShake = (): void => {
    shaking = true;
    render();
    setTimeout(() => {
      shaking = false;
      if (!disposed) render();
    }, 450);
  };

  const submit = (): void => {
    if (!game || gameOver()) return;
    if (buffer.length < wordLen) {
      setStatus("Not enough letters");
      flashShake();
      return;
    }
    const status = game.guess(buffer);
    if (status !== "applied") {
      setStatus("Not in word list"); // the core rejected it — nothing changes
      flashShake();
      return;
    }
    buffer = "";
    setStatus("");
    render();
  };

  const handleKey = (key: string): void => {
    if (!game || gameOver()) return;
    if (key === "enter") {
      submit();
    } else if (key === "back") {
      if (buffer.length > 0) {
        buffer = buffer.slice(0, -1);
        setStatus("");
        render();
      }
    } else if (/^[a-z]$/.test(key) && buffer.length < wordLen) {
      buffer += key;
      setStatus("");
      render();
    }
  };

  const onKeydown = (e: KeyboardEvent): void => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "Enter") {
      handleKey("enter");
    } else if (e.key === "Backspace") {
      handleKey("back");
    } else if (/^[a-zA-Z]$/.test(e.key)) {
      handleKey(e.key.toLowerCase());
    } else {
      return;
    }
    e.preventDefault();
  };

  // --- hints ---

  const showHint = (): void => {
    if (!game || gameOver()) return;
    const h = game.hint();
    if (!h) {
      render();
      return;
    }
    game.markAssistance();
    setStatus(`Hint: letter ${h.pos + 1} is ${upper(h.letter)} (a hint counts as assistance)`);
  };

  const endNow = (): void => {
    // "I'm done" with hints off: end the round honestly (guesses always remain,
    // else the game would already be over).
    setStatus("Ended early — you still had guesses left.");
    render(true);
  };

  // --- rendering ---

  const renderControls = (board: BoardView): HTMLElement => {
    const bar = el("div", { class: "sol-controls" });

    const modes = el("div", { class: "sol-modes", role: "group", "aria-label": "Puzzle" });
    const daily = el(
      "button",
      { type: "button", class: "sol-mode-daily", "aria-pressed": String(mode === "daily") },
      "Today’s word",
    );
    const fresh = el(
      "button",
      { type: "button", class: "sol-new", "aria-pressed": String(mode === "free") },
      "New word",
    );
    daily.addEventListener("click", () => void startGame("daily"));
    fresh.addEventListener("click", () => void startGame("free"));
    modes.append(daily, fresh);

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
    );

    const hud = el(
      "div",
      { class: "wy-hud" },
      el("span", { class: "wy-guesses" }, `Guesses left ${board.guessesLeft}`),
    );

    bar.append(modes, actionBtn, settings);
    const wrap = el("div");
    wrap.append(bar, hud);
    return wrap;
  };

  const tile = (letter: string, stateClass: string, ariaLabel: string): HTMLElement =>
    el("div", { class: `wy-tile ${stateClass}`, role: "img", "aria-label": ariaLabel }, letter);

  const renderGrid = (board: BoardView): HTMLElement => {
    const grid = el("div", { class: "wy-grid", role: "group", "aria-label": "Guesses" });
    const played = board.guesses.length;
    for (let r = 0; r < maxGuesses; r += 1) {
      const isCurrent = r === played && !gameOver();
      const rowEl = el("div", {
        class: `wy-row${isCurrent && shaking ? " wy-shake" : ""}`,
      });
      for (let c = 0; c < wordLen; c += 1) {
        if (r < played) {
          const g = board.guesses[r]!;
          const mark = g.marks[c] as Mark;
          rowEl.append(
            tile(upper(g.letters[c]!), MARK_CLASS[mark], `${upper(g.letters[c]!)}, ${["absent", "present", "correct"][mark]}`),
          );
        } else if (isCurrent && c < buffer.length) {
          rowEl.append(tile(buffer[c]!.toUpperCase(), "wy-filled", `${buffer[c]!.toUpperCase()}, typed`));
        } else {
          rowEl.append(tile("", "wy-empty", "empty"));
        }
      }
      grid.append(rowEl);
    }
    return grid;
  };

  const renderKeyboard = (board: BoardView): HTMLElement => {
    const kb = el("div", { class: "wy-keyboard", role: "group", "aria-label": "Keyboard" });
    KEY_ROWS.forEach((rowKeys, i) => {
      const rowEl = el("div", { class: "wy-kb-row" });
      if (i === KEY_ROWS.length - 1) {
        rowEl.append(keyButton("enter", "Enter", ""));
      }
      for (const ch of rowKeys) {
        const idx = ch.charCodeAt(0) - 97;
        const state = board.keyboard[idx]!;
        const cls = state >= 0 ? MARK_CLASS[state as Mark] : "";
        rowEl.append(keyButton(ch, ch.toUpperCase(), cls));
      }
      if (i === KEY_ROWS.length - 1) {
        rowEl.append(keyButton("back", "⌫", ""));
      }
      kb.append(rowEl);
    });
    kb.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>(".wy-key");
      if (btn) handleKey(btn.dataset.key!);
    });
    return kb;
  };

  const keyButton = (key: string, label: string, stateClass: string): HTMLElement =>
    el(
      "button",
      {
        type: "button",
        class: `wy-key ${stateClass}`.trim(),
        "data-key": key,
        "aria-label": key === "back" ? "Backspace" : key === "enter" ? "Enter" : `Letter ${label}`,
      },
      label,
    );

  const presentResult = async (): Promise<void> => {
    if (!container || !game) return;
    const declare = declareAssistanceEnabled();
    const env = game.outcome(declare) as WyrdleEnvelope;
    const rows: Mark[][] = game.board().guesses.map((g) => g.marks);
    const solved = env.payload.result === "Won";
    const emojiText = emojiGrid(rows, puzzleLabel(), solved, maxGuesses);
    container.replaceChildren(el("div", { class: "sol-loading" }, "Preparing your verifiable result…"));
    const shareUrl = await shareUrlFor(env);
    if (disposed || !container) return;
    const build = (): HTMLElement =>
      renderResultScreen(env, verify(env), maxGuesses, {
        emojiText,
        emojiRows: rows,
        shareUrl,
        onReverify: () => container!.replaceChildren(build()),
        onPlayAgain: () => void startGame(mode),
      });
    container.replaceChildren(build());
  };

  function render(force = false): void {
    if (disposed || !container || !game) return;
    if (force || gameOver()) {
      void presentResult();
      return;
    }
    const board = game.board();
    container.replaceChildren(renderControls(board), renderGrid(board), renderKeyboard(board), statusEl);
  }

  async function startGame(nextMode: "daily" | "free", seedOverride?: bigint): Promise<void> {
    if (!game || disposed) return;
    mode = nextMode;
    seed =
      seedOverride ??
      (nextMode === "daily" ? BigInt(game.dailySeed(dayIndexUTC(new Date()))) : randomSeed());
    game.newGame(seed);
    const board = game.board();
    maxGuesses = board.maxGuesses || 6;
    wordLen = board.wordLen || 5;
    buffer = "";
    shaking = false;
    setStatus("");
    console.debug(`[wyrdle] mount seed=${seed} mode=${mode}`);
    exposeHook();
    render();
  }

  const showShared = async (payload: string): Promise<void> => {
    if (!container) return;
    let env: WyrdleEnvelope;
    try {
      env = await decodeRecord(payload);
    } catch {
      container.replaceChildren(el("div", { class: "sol-error" }, "This shared result could not be read."));
      return;
    }
    if (disposed || !container) return;
    // Replay through the verifier to reconstruct the grid (spoiler-free rows).
    verifier!.newGame(BigInt(env.payload.seed));
    for (const wgs of env.payload.moves) verifier!.guess(wgs);
    const rows: Mark[][] = verifier!.board().guesses.map((g) => g.marks);
    const solved = env.payload.result === "Won";
    const emojiText = emojiGrid(rows, `#${env.payload.seed}`, solved, maxGuesses);
    const build = (): HTMLElement =>
      renderResultScreen(env, verify(env), maxGuesses, {
        emojiText,
        emojiRows: rows,
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
    window.__wyrdle = {
      game,
      refresh: () => render(),
      seed,
      submitGuess: (word: string) => {
        buffer = word.toLowerCase();
        submit();
      },
    };
  };

  return {
    mount(c: HTMLElement): void {
      container = c;
      disposed = false;
      container.replaceChildren(el("div", { class: "sol-loading" }, "Loading Wyrdle…"));
      document.addEventListener("keydown", onKeydown);
      void (async () => {
        try {
          game = await Wyrdle.load();
          verifier = await Wyrdle.load();
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
      delete window.__wyrdle;
      container?.replaceChildren();
      container = null;
      game = null;
      verifier = null;
      buffer = "";
    },
  };
}
