/** Types for the registry reader (`tools/registry-titles.mjs`). */
export interface RegistryEntryName {
  readonly id: string;
  readonly name: string;
}
/** `devGames: true` appends the `DEV_ONLY` fixtures (the placeholder) after the shipped catalog. */
export interface CatalogOptions {
  readonly devGames?: boolean;
}
/** Every shipped entry as `{ id, name }`, in registry order; dev fixtures after them when asked. Throws on zero. */
export function readRegistryEntries(source: string, options?: CatalogOptions): RegistryEntryName[];
/** `{ id: displayName }` for every entry. Throws on zero. */
export function readRegistryTitles(source: string, options?: CatalogOptions): Record<string, string>;
/** The catalog's ids, in order — the pages `build.mjs` emits. Dev fixtures only when asked. */
export function GAME_PAGES(source: string, options?: CatalogOptions): string[];
