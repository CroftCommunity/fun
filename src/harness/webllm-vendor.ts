//! Embedded WebLLM bundle entry. `build.mjs` bundles this to `/vendor/webllm.js`
//! so the runtime library ships from our OWN origin — never a third-party CDN
//! (offline-capable PWA; no CDN-served executable code). `WebLLMRuntime` imports
//! this by URL, lazily, only when the experimental local-AI toggle fires.
//!
//! Only `CreateMLCEngine` (the main-thread engine) is re-exported — no web worker
//! to bundle, and it is all `WebLLMRuntime` calls.
export { CreateMLCEngine } from "@mlc-ai/web-llm";
