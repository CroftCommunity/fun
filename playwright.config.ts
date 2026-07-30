import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: true,
  use: { baseURL: "http://localhost:4180" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // Real mobile: WebKit (iOS Safari engine) + touch + a phone viewport, so the
    // boards are exercised the way most players actually reach them. Tests that
    // rely on desktop-only HTML5 drag skip themselves on touch (tap is the floor).
    { name: "mobile-webkit", use: { ...devices["iPhone 13"] } },
  ],
  webServer: {
    // Build the solitaire wasm first — Phase D's board fetches /solitaire.wasm,
    // which build.mjs only copies once the artifact exists.
    command: "npm run build:wasm && node build.mjs && node tools/serve.mjs",
    url: "http://localhost:4180",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
