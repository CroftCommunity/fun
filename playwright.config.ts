import { defineConfig, devices } from "@playwright/test";

// The specs drive `/placeholder/` — the frame's own exercise — which is a dev fixture
// the site does not ship (src/registry.ts). Set here, before the config is read, so
// the webServer's `node build.mjs` bundles it AND the specs' own import of the
// registry lists it; the deploy build never sets it.
process.env.FUN_DEV_GAMES = "1";

// Same port as tools/serve.mjs; E2E_PORT overrides both so concurrent sessions do not
// take each other's server down.
const origin = `http://localhost:${process.env.E2E_PORT ?? 4180}`;

export default defineConfig({
  testDir: "tests",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: true,
  use: { baseURL: origin },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // Real mobile: WebKit (iOS Safari engine) + touch + a phone viewport, so the
    // boards are exercised the way most players actually reach them. Tests that
    // rely on desktop-only HTML5 drag skip themselves on touch (tap is the floor).
    { name: "mobile-webkit", use: { ...devices["iPhone 13"] } },
  ],
  webServer: {
    // Build the wasm first — every board fetches its module, and build.mjs only
    // copies a module that exists. On CI the shards download the modules built
    // once by the `wasm` job (E2E_PREBUILT_WASM), and build.mjs makes a missing
    // one fatal there, so a lost artifact cannot serve an engineless shelf.
    command: process.env.E2E_PREBUILT_WASM
      ? "node build.mjs && node tools/serve.mjs"
      : "npm run build:wasm && node build.mjs && node tools/serve.mjs",
    url: origin,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
