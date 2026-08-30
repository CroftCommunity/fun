// Minimal static server for dist/ (Playwright webServer + local preview).
// Resolves a directory URL to its index.html so /placeholder/ works.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
// E2E_PORT lets two sessions' e2e runs share a machine: measured 2026-08-30, a peer's
// run on 4180 took this one's server down mid-suite ("Could not connect to the server").
// tools/mock-snaps.mjs sets it too, so a capture never collides with a running suite.
const PORT = Number(process.env.E2E_PORT ?? 4180);
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".map": "application/json",
  ".woff2": "font/woff2",
  ".jpg": "image/jpeg",
};

createServer(async (req, res) => {
  try {
    let path = decodeURIComponent((req.url ?? "/").split("?")[0]);
    if (path.endsWith("/")) path += "index.html";
    const file = join(dist, normalize(path).replace(/^(\.\.[/\\])+/, ""));
    const body = await readFile(file);
    res.setHeader("content-type", TYPES[extname(file)] ?? "application/octet-stream");
    // Tier-2 wrapped games run in an opaque-origin sandboxed iframe; their WebGL
    // texture loads are cross-origin and CORS-blocked without this header.
    // GitHub Pages sends it by default — we match that locally + in the e2e.
    res.setHeader("access-control-allow-origin", "*");
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end("not found");
  }
}).listen(PORT, () => console.log(`serving dist/ at http://localhost:${PORT}`));
