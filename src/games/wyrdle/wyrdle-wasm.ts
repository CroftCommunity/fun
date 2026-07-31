//! Typed TS wrapper over the `wyrdle-wasm` raw C-ABI binding. Loads the wasm,
//! decodes the output buffer, and presents a typed API to the board UI. The wasm
//! holds the game; this wrapper never re-implements rules (legality, scoring, and
//! the keyboard state all come from the core). The hidden answer never crosses
//! the boundary — only per-guess patterns do — so the UI cannot leak it.

/** A per-letter mark: 0 absent, 1 present, 2 correct. */
export type Mark = 0 | 1 | 2;

/** One played guess and its pattern. */
export interface GuessView {
  /** Letter indices `0..26` (`a`=0). */
  letters: number[];
  /** Per-position marks aligned to `letters`. */
  marks: Mark[];
}

/** The board as the UI sees it. */
export interface BoardView {
  wordLen: number;
  maxGuesses: number;
  /** Guesses played so far, in order, each scored. */
  guesses: GuessView[];
  /** Best-known mark per letter `a..z` (26 entries); `-1` = not yet seen. */
  keyboard: number[];
  /** The answer has been found. */
  won: boolean;
  /** The budget is spent without solving. */
  lost: boolean;
  guessesLeft: number;
}

/** Guess application status. */
export type GuessStatus = "applied" | "not-a-word" | "bad";

interface Exports {
  memory: WebAssembly.Memory;
  out_len(): number;
  new_game(lo: number, hi: number): void;
  wyrdle_daily_seed(day_index: number): number;
  board_json(): number;
  current_hash(): number;
  is_allowed(l0: number, l1: number, l2: number, l3: number, l4: number): number;
  is_won(): number;
  is_lost(): number;
  guess(l0: number, l1: number, l2: number, l3: number, l4: number): number;
  hint(): number;
  mark_assistance(): void;
  outcome_json(declare: number): number;
}

const STATUS: Record<number, GuessStatus> = { 0: "applied", 1: "not-a-word", 2: "bad" };

/** Lowercase 5-letter word -> the five letter indices the C-ABI expects. */
function toIndices(word: string): [number, number, number, number, number] {
  const idx = [...word.toLowerCase()].map((c) => c.charCodeAt(0) - 97);
  return [idx[0]!, idx[1]!, idx[2]!, idx[3]!, idx[4]!];
}

/** A loaded wyrdle binding bound to one game. */
export class Wyrdle {
  private constructor(private readonly x: Exports) {}

  static async load(wasmUrl = "/wyrdle.wasm"): Promise<Wyrdle> {
    const source =
      typeof fetch === "function"
        ? await WebAssembly.instantiateStreaming(fetch(wasmUrl), {}).catch(async () =>
            WebAssembly.instantiate(await (await fetch(wasmUrl)).arrayBuffer(), {}),
          )
        : (() => {
            throw new Error("no fetch available to load wasm");
          })();
    const { instance } = await source;
    return new Wyrdle(instance.exports as unknown as Exports);
  }

  private read(ptr: number): string {
    const len = this.x.out_len();
    const bytes = new Uint8Array(this.x.memory.buffer, ptr, len);
    return new TextDecoder().decode(bytes);
  }

  newGame(seed: bigint): void {
    this.x.new_game(Number(seed & 0xffff_ffffn), Number((seed >> 32n) & 0xffff_ffffn));
  }
  /** The daily seed for `dayIndex` — a seed from the baked answer pack. */
  dailySeed(dayIndex: number): number {
    return this.x.wyrdle_daily_seed(dayIndex);
  }
  board(): BoardView {
    return JSON.parse(this.read(this.x.board_json())) as BoardView;
  }
  currentHash(): string {
    return JSON.parse(this.read(this.x.current_hash())) as string;
  }
  isWon(): boolean {
    return this.x.is_won() === 1;
  }
  isLost(): boolean {
    return this.x.is_lost() === 1;
  }
  /** Whether `word` is a legal guess — the core decides. */
  isAllowed(word: string): boolean {
    return this.x.is_allowed(...toIndices(word)) === 1;
  }
  /** A hint: the first not-yet-solved position + its letter index, or null if
   *  the puzzle is already solved. Using it counts as assistance. */
  hint(): { pos: number; letter: number } | null {
    const packed = this.x.hint();
    if (packed === 0xffff_ffff) return null;
    return { pos: (packed >> 8) & 0xff, letter: packed & 0xff };
  }
  markAssistance(): void {
    this.x.mark_assistance();
  }
  outcome(declareAssistance: boolean): unknown {
    return JSON.parse(this.read(this.x.outcome_json(declareAssistance ? 1 : 0)));
  }

  /** Submit a guess. A non-word / over-budget guess leaves the board unchanged. */
  guess(word: string): GuessStatus {
    return STATUS[this.x.guess(...toIndices(word))]!;
  }
}
