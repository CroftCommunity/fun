//! Types for the art drop-off's pure helpers, so `tests/intake.test.ts` type-checks
//! against them under `strict` rather than importing an implicit `any`.
//!
//! `intake.mjs` stays plain JavaScript because it is a script the repo runs with
//! `node` directly (`npm run intake`), not something the bundler compiles. Only
//! the exported, side-effect-free surface is declared here — the file's `main()`
//! is guarded and never runs on import.

/** `Morning Miles.mp3` → `morning-miles` */
export function slug(name: string): string;

/**
 * Every way a drop may name a game: registry id, slugified title, and — for a
 * game with a subtitle — its whole name. Values are always the registry id.
 */
export function gameAliases(): Map<string, string>;

/** What a dropped filename says it is; `null` when it carries no kind word. */
export function parseDropName(
  file: string,
): { rawId: string; kind: "icon" | "splash"; focus?: number } | null;

/** Where a splash lands, decided by its measured aspect rather than its name. */
export function splashDest(dir: string, w: number, h: number): string;
