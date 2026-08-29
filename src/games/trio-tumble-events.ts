//! A tiny, game-scoped event bus for Trio Tumble. Gameplay successes (clears,
//! cascades, specials, level wins) are emitted here; the presentation layer (burst
//! FX, celebration text) and — from Phase 2 — the narrative overlay subscribe to
//! the *same* stream, so FX and story never disagree. Deliberately not a global:
//! one bus per mounted game (one-directory-per-game), created in the module.

/** A gem/hole cell coordinate. */
export interface Cell {
  r: number;
  c: number;
}

/** Everything the game announces. Consumers switch on `type`. */
export type M3Event =
  | { type: "move"; scoreDelta: number; cascadeDepth: number; cleared: number }
  | { type: "cascade"; depth: number; clearedCells: Cell[] }
  | { type: "special"; kind: string }
  | { type: "level-win"; level: number; stars: number; score: number; clutch: boolean }
  | { type: "level-lose"; level: number }
  | { type: "game-over"; won: boolean; mode: string };

/** A subscriber. Returns nothing; throwing is contained per-listener. */
export type Listener = (e: M3Event) => void;

/** The bus surface: fan-out `emit`, and `on` returning an unsubscribe. */
export interface Bus {
  emit(e: M3Event): void;
  on(fn: Listener): () => void;
}

/** Create an isolated event bus. Listeners are held in a `Set`, so subscribe /
 *  unsubscribe are order-independent and a listener never fires twice. A throwing
 *  listener is isolated so one bad subscriber can't drop events for the others. */
export function createBus(): Bus {
  const listeners = new Set<Listener>();
  return {
    emit(e: M3Event): void {
      // Snapshot so a listener that (un)subscribes during dispatch is well-defined.
      for (const fn of [...listeners]) {
        try {
          fn(e);
        } catch {
          /* a broken subscriber must not break the emit for the rest */
        }
      }
    },
    on(fn: Listener): () => void {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
