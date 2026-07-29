//! Entry point loaded by every page. Boots the chrome, which reads the current
//! game from `document.body[data-game]` (set per-page by the build) and mounts
//! it into the play area. Exposed on `window.__chrome` for the E2E.

import { boot, type Chrome } from "./chrome.js";

declare global {
  interface Window {
    __chrome?: Chrome;
  }
}

window.__chrome = boot();
