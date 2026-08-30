//! The game frame — the structure every game page shares. Five bands with
//! reserved heights; a game declares a spec and never touches the chrome.
//! `plans/2026-08-30-plan-game-frame.md` Phase 1a. jsdom has no layout, so the
//! pixel assertions live in `tests/game-frame.spec.ts`; this file pins the
//! shape: which bands exist, what is fixed, and what fails loud.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderGameFrame, type GameFrameSpec, type Verb } from "../src/game-frame.js";

function verb(id: string): Verb {
  return { id, label: id, icon: "•", onPress: () => {} };
}

function spec(over: Partial<GameFrameSpec> = {}): GameFrameSpec {
  return {
    title: "Othello",
    meters: [
      { kind: "seat", id: "you", name: "You", glyph: "●", score: 2, state: "active", sub: "your move" },
      { kind: "seat", id: "engine", name: "The Engine", glyph: "○", score: 2 },
    ],
    verbs: [verb("undo"), verb("hint"), verb("new"), verb("settings")],
    ...over,
  };
}

let host: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = "";
  host = document.createElement("main");
  host.className = "play-area";
  document.body.append(host);
  vi.spyOn(console, "debug").mockImplementation(() => {});
});

describe("renderGameFrame — bands", () => {
  it("renders the bands in order: game bar, meters, stage, dock", () => {
    const frame = renderGameFrame(host, spec());
    const order = [...frame.root.children].map((c) => c.className.split(" ")[0]);
    expect(order).toEqual(["gf-game-bar", "gf-meters", "gf-stage", "gf-dock"]);
    expect(frame.stage).toBe(frame.root.querySelector(".gf-stage"));
    expect(frame.root.querySelector(".gf-title")?.textContent).toBe("Othello");
  });

  it("with no spec renders the game bar and the stage only — no meters, no dock", () => {
    const frame = renderGameFrame(host, undefined, { title: "Placeholder" });
    expect(frame.root.querySelector(".gf-game-bar")).not.toBeNull();
    expect(frame.root.querySelector(".gf-stage")).not.toBeNull();
    expect(frame.root.querySelector(".gf-meters")).toBeNull();
    expect(frame.root.querySelector(".gf-dock")).toBeNull();
    expect(frame.root.querySelector(".gf-title")?.textContent).toBe("Placeholder");
  });

  it("zero verbs means no dock at all — nothing, not an empty band", () => {
    const frame = renderGameFrame(host, spec({ verbs: [] }));
    expect(frame.root.querySelector(".gf-dock")).toBeNull();
  });

  it("the mode chip shows when a mode is given and is absent otherwise", () => {
    expect(renderGameFrame(host, spec({ mode: "Medium" })).root.querySelector(".gf-mode")?.textContent).toBe("Medium");
    host.innerHTML = "";
    expect(renderGameFrame(host, spec()).root.querySelector(".gf-mode")).toBeNull();
  });

  it("logs one debug line at mount, in the shape the games use", () => {
    renderGameFrame(host, spec());
    expect(console.debug).toHaveBeenCalledTimes(1);
    expect(console.debug).toHaveBeenCalledWith("[frame] mount title=Othello verbs=4 meters=2");
  });
});

describe("renderGameFrame — verbs", () => {
  it("five verbs render five; six throw, naming the game and listing the verbs", () => {
    const five = renderGameFrame(host, spec({ verbs: ["a", "b", "c", "d", "e"].map(verb) }));
    expect(five.root.querySelectorAll(".gf-verb")).toHaveLength(5);
    host.innerHTML = "";
    expect(() => renderGameFrame(host, spec({ verbs: ["a", "b", "c", "d", "e", "f"].map(verb) }))).toThrow(
      /Othello.*6 verbs.*a, b, c, d, e, f/,
    );
  });

  it("a verb press calls its handler; a disabled verb is disabled and a primary one is marked", () => {
    const onPress = vi.fn();
    const frame = renderGameFrame(
      host,
      spec({
        verbs: [
          { id: "hint", label: "Hint", icon: "✦", primary: true, onPress },
          { id: "undo", label: "Undo", icon: "↶", disabled: true, onPress: () => {} },
        ],
      }),
    );
    const [hint, undo] = [...frame.root.querySelectorAll<HTMLButtonElement>(".gf-verb")];
    hint!.click();
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(hint!.classList.contains("primary")).toBe(true);
    expect(undo!.disabled).toBe(true);
    expect(undo!.querySelector(".gf-verb-label")?.textContent).toBe("Undo");
  });
});

describe("renderGameFrame — meters are fixed slots", () => {
  it("a seat without a sub still has an empty sub element, so text can swap without a reflow", () => {
    const frame = renderGameFrame(host, spec());
    const subs = frame.root.querySelectorAll(".gf-seat .gf-sub");
    expect(subs).toHaveLength(2);
    expect(subs[0]!.textContent).toBe("your move");
    expect(subs[1]!.textContent).toBe("");
  });

  it("update() to thinking sets the state and the sub text without changing the band's children; back to idle clears both", () => {
    const frame = renderGameFrame(host, spec());
    const band = frame.root.querySelector(".gf-meters")!;
    const before = band.childElementCount;
    const engine = (): HTMLElement => frame.root.querySelectorAll<HTMLElement>(".gf-seat")[1]!;

    frame.update(
      spec({
        meters: [
          { kind: "seat", id: "you", name: "You", glyph: "●", score: 4 },
          { kind: "seat", id: "engine", name: "The Engine", glyph: "○", score: 1, state: "thinking", sub: "thinking…" },
        ],
      }),
    );
    expect(engine().dataset.state).toBe("thinking");
    expect(engine().querySelector(".gf-sub")?.textContent).toBe("thinking…");
    expect(engine().querySelector(".gf-seat-score")?.textContent).toBe("1");
    expect(band.childElementCount).toBe(before);

    frame.update(spec());
    expect(engine().dataset.state).toBe("idle");
    expect(engine().querySelector(".gf-sub")?.textContent).toBe("");
    expect(band.childElementCount).toBe(before);
  });

  it("stats render a value and a label, and update in place", () => {
    const frame = renderGameFrame(
      host,
      spec({ meters: [{ kind: "stat", id: "moves", value: 12, label: "moves" }] }),
    );
    expect(frame.root.querySelector(".gf-stat-value")?.textContent).toBe("12");
    expect(frame.root.querySelector(".gf-stat-label")?.textContent).toBe("moves");
    frame.update(spec({ meters: [{ kind: "stat", id: "moves", value: 13, label: "moves" }] }));
    expect(frame.root.querySelector(".gf-stat-value")?.textContent).toBe("13");
  });

  it("update() with a different number of meters throws — slots are fixed for the life of the frame", () => {
    const frame = renderGameFrame(host, spec());
    expect(() => frame.update(spec({ meters: [{ kind: "stat", id: "x", value: 1, label: "x" }] }))).toThrow(
      /Othello.*meters.*2.*1/,
    );
  });

  it("update() re-renders the title, mode and verbs", () => {
    const frame = renderGameFrame(host, spec());
    frame.update(spec({ title: "Othello", mode: "Hard", verbs: [verb("one")] }));
    expect(frame.root.querySelector(".gf-mode")?.textContent).toBe("Hard");
    expect(frame.root.querySelectorAll(".gf-verb")).toHaveLength(1);
  });
});

describe("renderGameFrame — lifecycle", () => {
  it("destroy() empties the host, and a second destroy() is a no-op", () => {
    const frame = renderGameFrame(host, spec());
    expect(host.childElementCount).toBe(1);
    frame.destroy();
    expect(host.childElementCount).toBe(0);
    expect(() => frame.destroy()).not.toThrow();
    expect(host.childElementCount).toBe(0);
  });

  it("the game bar carries a back link to the shelf and a ⋯ menu with the given items", () => {
    const frame = renderGameFrame(host, spec(), {
      menu: [{ label: "How to play", href: "/how-to/?game=othello" }],
    });
    expect(frame.root.querySelector<HTMLAnchorElement>(".gf-back")?.getAttribute("href")).toBe("/");
    const more = frame.root.querySelector<HTMLButtonElement>(".gf-more")!;
    expect(more.getAttribute("aria-expanded")).toBe("false");
    more.click();
    expect(more.getAttribute("aria-expanded")).toBe("true");
    expect(frame.root.querySelector(".gf-menu a")?.getAttribute("href")).toBe("/how-to/?game=othello");
  });
});
