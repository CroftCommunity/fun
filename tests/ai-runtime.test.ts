//! AIRuntime port wiring: the deterministic MockRuntime (what CI exercises)
//! generates through the port under a schema, and the module loads WITHOUT
//! pulling the WebLLM runtime — the CDN import lives inside WebLLMRuntime's
//! methods only, so CI/build never touch GPU code. The real WebLLMRuntime is
//! proven by `npm run ai:trial` (localhost/system Chrome), not here.

import { describe, expect, it } from "vitest";
import { MockRuntime, WebLLMRuntime, type AIRuntime } from "../src/harness/ai-runtime.js";

describe("AIRuntime / MockRuntime", () => {
  it("generates the scripted reply through the port under a schema", async () => {
    const rt: AIRuntime = new MockRuntime({
      id: "mock-1",
      reply: (prompt, opts) =>
        JSON.stringify({ move: 3, reason: `p=${prompt};schema=${Boolean(opts.schema)}` }),
    });
    const schema = {
      type: "object",
      properties: { move: { type: "integer" }, reason: { type: "string" } },
      required: ["move", "reason"],
    };
    const out = await rt.generate("pick", { schema, greedy: true, maxTokens: 64 });
    const parsed = JSON.parse(out) as { move: number; reason: string };
    expect(parsed.move).toBe(3);
    expect(parsed.reason).toContain("schema=true");
    expect(parsed.reason).toContain("p=pick");
    expect(rt.fingerprint()).toBe("mock-1");
  });

  it("loads without pulling the WebLLM runtime (CI/build never import GPU code)", async () => {
    // If the CDN import were static/top-level, this dynamic import would try to
    // resolve an https:// specifier in node and throw — so a clean load proves
    // the WebLLM import is lazy (inside WebLLMRuntime methods only).
    const mod = await import("../src/harness/ai-runtime.js");
    expect(typeof mod.MockRuntime).toBe("function");
    expect(typeof mod.WebLLMRuntime).toBe("function");
    // Constructing WebLLMRuntime must not import web-llm either (lazy until generate()).
    const rt = new WebLLMRuntime({ model: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC" });
    expect(rt.fingerprint()).toBe("webllm:Qwen2.5-1.5B-Instruct-q4f16_1-MLC");
  });
});
