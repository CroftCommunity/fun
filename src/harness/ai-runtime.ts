//! A browser LLM runtime behind one small port. `MockRuntime` is deterministic
//! (what CI exercises); `WebLLMRuntime` runs a real in-browser model on WebGPU.
//!
//! The WebLLM **library is embedded** — bundled by `build.mjs` to a same-origin
//! `/vendor/webllm.js` and imported from **our own origin**, never a third-party
//! CDN (this is an offline-capable PWA, and a CDN for executable code is both an
//! availability and a code-injection risk). The import is **lazy** — it fires
//! only on the first `generate()`, so CI/build and every non-AI game never load
//! it, and `app.js` is byte-unchanged.
//!
//! (Honest scope: embedding the *library* closes the CDN/injection vector for the
//! runtime code. WebLLM still fetches the model **weights + per-model `model_lib`
//! WASM** from the model CDN on first load, then caches them in-browser; fully
//! self-hosting those for offline is a named follow-on — hosting ~1 GB is not
//! viable on GitHub Pages.)

/** Options for one generation. */
export interface GenerateOptions {
  /** A JSON Schema; when present the runtime constrains output to match it. */
  readonly schema?: object;
  /** Greedy (temperature 0) when true or omitted — reproducible; false = sampled. */
  readonly greedy?: boolean;
  /** Token cap for the reply. */
  readonly maxTokens?: number;
  /** Optional system prompt prepended to the conversation. */
  readonly system?: string;
}

/** A browser LLM runtime: generate text, optionally schema-constrained. */
export interface AIRuntime {
  /** Generate a completion for `prompt`. Returns the raw string reply. */
  generate(prompt: string, opts?: GenerateOptions): Promise<string>;
  /** A stable identity for reproducibility (model id, or `"mock"`). */
  fingerprint(): string;
}

/** Deterministic, scripted runtime — the CI/test double. No model, no network. */
export class MockRuntime implements AIRuntime {
  readonly #reply: (prompt: string, opts: GenerateOptions) => string;
  readonly #id: string;
  constructor(opts: { reply: (prompt: string, opts: GenerateOptions) => string; id?: string }) {
    this.#reply = opts.reply;
    this.#id = opts.id ?? "mock";
  }
  generate(prompt: string, opts: GenerateOptions = {}): Promise<string> {
    return Promise.resolve(this.#reply(prompt, opts));
  }
  fingerprint(): string {
    return this.#id;
  }
}

// --- WebLLMRuntime: the real in-browser model (embedded, same-origin, lazy) ---

/** Default same-origin URL of the embedded WebLLM bundle (built by `build.mjs`). */
const EMBEDDED_WEBLLM_URL = "/vendor/webllm.js";

/** The slice of the embedded WebLLM module we call (typed to the shape we use;
 *  the runtime import is by URL so we pin the contract here). */
interface MLCEngine {
  chat: {
    completions: {
      create(req: unknown): Promise<{ choices?: ReadonlyArray<{ message?: { content?: string } }> }>;
    };
  };
}
interface WebLLMModule {
  CreateMLCEngine(
    model: string,
    opts?: { initProgressCallback?: (p: { text: string }) => void },
  ): Promise<MLCEngine>;
}

/** Config for a real WebLLM runtime. */
export interface WebLLMConfig {
  /** The MLC model id, e.g. `"Qwen2.5-1.5B-Instruct-q4f16_1-MLC"`. */
  readonly model: string;
  /** Same-origin URL of the embedded bundle (default `/vendor/webllm.js`). */
  readonly moduleUrl?: string;
  /** Load-progress callback (model download / shader compile). */
  readonly onProgress?: (text: string) => void;
}

/**
 * A real in-browser LLM on WebGPU. Requires `navigator.gpu` (system Chrome) and a
 * one-time model download (weights stream from the model CDN, then cache). The
 * WebLLM **library** is imported from our own origin (`moduleUrl`), never a
 * third-party CDN, and only on the first `generate()` — so CI/build never load it.
 */
export class WebLLMRuntime implements AIRuntime {
  readonly #cfg: WebLLMConfig;
  #engine: MLCEngine | null = null;
  constructor(cfg: WebLLMConfig) {
    this.#cfg = cfg;
  }

  async #ensureEngine(): Promise<MLCEngine> {
    if (this.#engine) return this.#engine;
    const url = this.#cfg.moduleUrl ?? EMBEDDED_WEBLLM_URL;
    const mod = (await import(url)) as unknown as WebLLMModule;
    this.#engine = await mod.CreateMLCEngine(this.#cfg.model, {
      initProgressCallback: (p) => this.#cfg.onProgress?.(p.text),
    });
    return this.#engine;
  }

  async generate(prompt: string, opts: GenerateOptions = {}): Promise<string> {
    const engine = await this.#ensureEngine();
    const messages = [
      ...(opts.system ? [{ role: "system", content: opts.system }] : []),
      { role: "user", content: prompt },
    ];
    const request = {
      messages,
      temperature: opts.greedy === false ? 0.7 : 0,
      max_tokens: opts.maxTokens ?? 256,
      ...(opts.schema
        ? { response_format: { type: "json_object", schema: JSON.stringify(opts.schema) } }
        : {}),
    };
    const reply = await engine.chat.completions.create(request);
    return reply.choices?.[0]?.message?.content ?? "";
  }

  fingerprint(): string {
    return `webllm:${this.#cfg.model}`;
  }
}
