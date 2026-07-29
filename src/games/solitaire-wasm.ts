//! Typed TS wrapper over the `solitaire-wasm` raw C-ABI binding. Loads the wasm,
//! decodes the output buffer, and presents a typed API to the board UI. The
//! wasm holds the game; this wrapper never re-implements rules.

/** A visible card. */
export interface CardView {
  suit: number;
  rank: number;
}
/** A tableau slot; `card` is absent for face-down (hidden) cards. */
export interface SlotView {
  faceUp: boolean;
  card?: CardView;
}
/** The board as the UI sees it (hidden cards omitted). */
export interface BoardView {
  foundations: [number, number, number, number];
  stockCount: number;
  wasteTop?: CardView;
  wasteCount: number;
  tableau: SlotView[][];
  won: boolean;
}

/** A move, matching `solitaire-core`'s serde encoding. */
export type SolMove =
  | "Draw"
  | "WasteToFoundation"
  | { WasteToTableau: { pile: number } }
  | { TableauToFoundation: { pile: number } }
  | { TableauToTableau: { from: number; count: number; to: number } };

/** Move application status. */
export type MoveStatus = "applied" | "illegal" | "bad";

interface Exports {
  memory: WebAssembly.Memory;
  out_len(): number;
  new_game(lo: number, hi: number): void;
  board_json(): number;
  legal_moves_json(): number;
  current_hash(): number;
  is_won(): number;
  play_draw(): number;
  play_waste_to_foundation(): number;
  play_waste_to_tableau(pile: number): number;
  play_tableau_to_foundation(pile: number): number;
  play_tableau_to_tableau(from: number, count: number, to: number): number;
  undo(): number;
  outcome_json(ifUnfinished: number, declare: number): number;
}

const STATUS: Record<number, MoveStatus> = { 0: "applied", 1: "illegal", 2: "bad" };

/** A loaded solitaire binding bound to one game. */
export class Solitaire {
  private constructor(private readonly x: Exports) {}

  static async load(wasmUrl = "/solitaire.wasm"): Promise<Solitaire> {
    const source =
      typeof fetch === "function"
        ? await WebAssembly.instantiateStreaming(fetch(wasmUrl), {}).catch(async () =>
            WebAssembly.instantiate(await (await fetch(wasmUrl)).arrayBuffer(), {}),
          )
        : (() => {
            throw new Error("no fetch available to load wasm");
          })();
    const { instance } = await source;
    return new Solitaire(instance.exports as unknown as Exports);
  }

  private read(ptr: number): string {
    const len = this.x.out_len();
    const bytes = new Uint8Array(this.x.memory.buffer, ptr, len);
    return new TextDecoder().decode(bytes);
  }

  newGame(seed: bigint): void {
    this.x.new_game(Number(seed & 0xffff_ffffn), Number((seed >> 32n) & 0xffff_ffffn));
  }
  board(): BoardView {
    return JSON.parse(this.read(this.x.board_json())) as BoardView;
  }
  legalMoves(): SolMove[] {
    return JSON.parse(this.read(this.x.legal_moves_json())) as SolMove[];
  }
  currentHash(): string {
    return JSON.parse(this.read(this.x.current_hash())) as string;
  }
  isWon(): boolean {
    return this.x.is_won() === 1;
  }
  undo(): boolean {
    return this.x.undo() === 1;
  }
  outcome(unfinished: "abandoned" | "stuck", declareAssistance: boolean): unknown {
    const ptr = this.x.outcome_json(unfinished === "stuck" ? 1 : 0, declareAssistance ? 1 : 0);
    return JSON.parse(this.read(ptr));
  }

  play(move: SolMove): MoveStatus {
    if (move === "Draw") return STATUS[this.x.play_draw()]!;
    if (move === "WasteToFoundation") return STATUS[this.x.play_waste_to_foundation()]!;
    if ("WasteToTableau" in move) return STATUS[this.x.play_waste_to_tableau(move.WasteToTableau.pile)]!;
    if ("TableauToFoundation" in move)
      return STATUS[this.x.play_tableau_to_foundation(move.TableauToFoundation.pile)]!;
    const t = move.TableauToTableau;
    return STATUS[this.x.play_tableau_to_tableau(t.from, t.count, t.to)]!;
  }
}
