import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
    // Node 25 ships a placeholder `globalThis.localStorage` that outranks jsdom's
    // and has no `clear`/`key`/`length`. This repairs it when broken and is inert
    // on a runtime with a real `Storage` (CI, Node 22). See the file's header.
    setupFiles: ["tests/setup/webstorage.ts"],
  },
});
