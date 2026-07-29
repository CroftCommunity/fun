import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: true,
  use: { baseURL: "http://localhost:4180" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Build the solitaire wasm first — Phase D's board fetches /solitaire.wasm,
    // which build.mjs only copies once the artifact exists.
    command: "npm run build:wasm && node build.mjs && node tools/serve.mjs",
    url: "http://localhost:4180",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
