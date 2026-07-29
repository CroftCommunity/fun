import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: true,
  use: { baseURL: "http://localhost:4180" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node build.mjs && node tools/serve.mjs",
    url: "http://localhost:4180",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
