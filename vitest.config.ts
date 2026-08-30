import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
    // The suites mount the placeholder (the frame's own exercise) through the real
    // chrome; it is a dev fixture, not a shipped game — see src/registry.ts.
    env: { FUN_DEV_GAMES: "1" },
    // Node 25 ships a placeholder `globalThis.localStorage` that outranks jsdom's
    // and has no `clear`/`key`/`length`. This repairs it when broken and is inert
    // on a runtime with a real `Storage` (CI, Node 22). See the file's header.
    setupFiles: ["tests/setup/webstorage.ts"],
  },
});
