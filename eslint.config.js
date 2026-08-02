import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  // Tier-2 vendored bundles are third-party code taken as-is — not ours to lint.
  { ignores: ["dist/", "node_modules/", "target/", "crates/**", "src/games/*/vendor/**", "reference/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
);
