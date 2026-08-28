/** Types for the boot-script generator (`tools/skin-init.mjs`). */
export interface ParsedSkin {
  readonly palette: "light" | "dark";
  readonly family: string;
}
/** Parse `SKINS` out of `src/skins.ts`. Throws rather than yielding nothing. */
export function parseSkins(source: string): Record<string, ParsedSkin>;
/** The `DEFAULT_SKIN` id, read from the module source. */
export function parseDefault(source: string): string;
/** The inline `<head>` script that stamps `[data-skin]` before first paint. */
export function skinInit(source: string): string;
