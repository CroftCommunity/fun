//! The shared Tier-2 mount primitive: every wrapped game mounts its vendored
//! bundle in a contained sandboxed iframe and tears it down cleanly. Phase 0
//! proved `sandbox="allow-scripts"` (opaque origin) both runs and contains the
//! candidates, so that is the default here. The primitive has no game-specific
//! logic — it is the one place the containment contract lives.

import { beforeEach, describe, expect, it } from "vitest";

import { mountWrappedGame } from "../src/wrapped-game.js";

let container: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = "";
  container = document.createElement("div");
  document.body.append(container);
});

describe("mountWrappedGame", () => {
  it("mounts a sandboxed iframe pointing at the vendored bundle", () => {
    const handle = mountWrappedGame(container, {
      src: "/astray/vendor/index.html",
      title: "Astray (wrapped game)",
    });
    const iframe = container.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe!.getAttribute("src")).toBe("/astray/vendor/index.html");
    expect(iframe!.getAttribute("title")).toBe("Astray (wrapped game)");
    // Phase 0 containment level: opaque origin, no allow-same-origin.
    expect(iframe!.getAttribute("sandbox")).toBe("allow-scripts");
    expect(handle.iframe).toBe(iframe);
  });

  it("teardown removes the iframe, leaving no residue", () => {
    const handle = mountWrappedGame(container, { src: "/x/index.html", title: "x" });
    expect(container.children.length).toBe(1);
    handle.teardown();
    expect(container.children.length).toBe(0);
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("survives repeated mount/teardown cycles without accumulating nodes", () => {
    for (let i = 0; i < 5; i++) {
      const handle = mountWrappedGame(container, { src: "/x/index.html", title: "x" });
      handle.teardown();
    }
    expect(container.children.length).toBe(0);
  });

  it("refuses to weaken containment: allow-same-origin is rejected", () => {
    expect(() =>
      mountWrappedGame(container, {
        src: "/x/index.html",
        title: "x",
        sandbox: "allow-scripts allow-same-origin",
      }),
    ).toThrow(/allow-same-origin/i);
  });
});
