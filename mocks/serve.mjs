// Static server for the design spike in `mocks/`, rooted at the REPO ROOT so a
// mock can reference both `mocks/brand/…` and the repo's `assets/fonts/…`.
//
// This is not `tools/serve.mjs` — that one serves `dist/` for the e2e suite and
// local play, and cannot see `mocks/` at all. Run:  node mocks/serve.mjs
// then open http://localhost:4190/mocks/
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 4190;
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".woff2": "font/woff2",
};

createServer(async (req, res) => {
  try {
    let path = decodeURIComponent((req.url ?? "/").split("?")[0]);
    if (path === "/") path = "/mocks/index.html";
    if (path.endsWith("/")) path += "index.html";
    const file = join(root, normalize(path).replace(/^(\.\.[/\\])+/, ""));
    const body = await readFile(file);
    res.setHeader("content-type", TYPES[extname(file)] ?? "application/octet-stream");
    res.setHeader("cache-control", "no-cache");
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end("not found");
  }
}).listen(PORT, () => console.log(`mocks: http://localhost:${PORT}/mocks/`));
