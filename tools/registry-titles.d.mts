/** Types for the registry reader (`tools/registry-titles.mjs`). */
export interface RegistryEntryName {
  readonly id: string;
  readonly name: string;
}
/** Every registry entry as `{ id, name }`, in registry order. Throws on zero. */
export function readRegistryEntries(source: string): RegistryEntryName[];
/** `{ id: displayName }` for every registry entry. Throws on zero. */
export function readRegistryTitles(source: string): Record<string, string>;
/** The registry's ids, in registry order — the pages `build.mjs` emits. */
export function GAME_PAGES(source: string): string[];
