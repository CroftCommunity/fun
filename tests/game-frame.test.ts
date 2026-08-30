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
    verbs: [verb("undo"), verb("hint"), verb("new")],
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

  it("zero game verbs still gives the dock its Settings verb — the common preferences are always reachable", () => {
    const frame = renderGameFrame(host, spec({ verbs: [] }));
    const ids = [...frame.root.querySelectorAll(".gf-verb")].map((b) => b.getAttribute("data-verb"));
    expect(ids).toEqual(["settings"]);
  });

  it("the mode chip shows when a mode is given and is absent otherwise", () => {
    expect(renderGameFrame(host, spec({ mode: "Medium" })).root.querySelector(".gf-mode")?.textContent).toBe("Medium");
    host.innerHTML = "";
    expect(renderGameFrame(host, spec()).root.querySelector(".gf-mode")).toBeNull();
  });

  it("logs one debug line at mount, in the shape the games use", () => {
    renderGameFrame(host, spec());
    expect(console.debug).toHaveBeenCalledTimes(1);
    expect(console.debug).toHaveBeenCalledWith("[frame] mount title=Othello verbs=3 meters=2");
  });

  it("declares the shape it is in — dock or rail — from the media query, on the root", () => {
    const frame = renderGameFrame(host, spec());
    expect(["dock", "rail"]).toContain(frame.root.dataset.gfShape);
  });
});

describe("renderGameFrame — verbs", () => {
  it("four game verbs plus the frame's Settings render five; five game verbs throw, naming the game and listing them", () => {
    const four = renderGameFrame(host, spec({ verbs: ["a", "b", "c", "d"].map(verb) }));
    const ids = [...four.root.querySelectorAll(".gf-verb")].map((b) => b.getAttribute("data-verb"));
    expect(ids).toEqual(["a", "b", "c", "d", "settings"]);
    host.innerHTML = "";
    expect(() => renderGameFrame(host, spec({ verbs: ["a", "b", "c", "d", "e"].map(verb) }))).toThrow(
      /Othello.*5 verbs.*a, b, c, d, e/,
    );
  });

  it("the Settings verb is the frame's: it is last, and a game that declares its own 'settings' id is refused", () => {
    expect(() => renderGameFrame(host, spec({ verbs: [verb("settings")] }))).toThrow(/settings.*frame/);
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

  it("a frame mounted without a spec accepts its first update() as the declaration, then fixes the slots", () => {
    const frame = renderGameFrame(host, undefined, { title: "Othello" });
    expect(frame.root.querySelector(".gf-meters")).toBeNull();
    frame.update(spec());
    expect(frame.root.querySelectorAll(".gf-seat")).toHaveLength(2);
    expect(frame.root.querySelectorAll(".gf-verb")).toHaveLength(4);
    const order = [...frame.root.children].map((c) => c.className.split(" ")[0]);
    expect(order).toEqual(["gf-game-bar", "gf-meters", "gf-stage", "gf-dock"]);
    expect(() => frame.update(spec({ meters: [] }))).toThrow(/meters/);
  });

  it("update() re-renders the title, mode and verbs", () => {
    const frame = renderGameFrame(host, spec());
    frame.update(spec({ title: "Othello", mode: "Hard", verbs: [verb("one")] }));
    expect(frame.root.querySelector(".gf-mode")?.textContent).toBe("Hard");
    expect(frame.root.querySelectorAll(".gf-verb")).toHaveLength(2); // one + Settings
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

describe("renderGameFrame — the sheets", () => {
  const common = () => [
    { kind: "toggle" as const, id: "hints", label: "Hints", value: true, onChange: () => {} },
    { kind: "toggle" as const, id: "assist", label: "Declare assistance", value: true, onChange: () => {} },
  ];
  const prefs = [{ kind: "toggle" as const, id: "tutor", label: "Tutor", value: false, onChange: () => {} }];
  const setup = [
    {
      kind: "choice" as const,
      id: "level",
      label: "Difficulty",
      value: "medium",
      options: [
        { value: "easy", label: "Easy" },
        { value: "medium", label: "Medium" },
      ],
      onChange: () => {},
    },
  ];

  it("the settings sheet is [common, then the game's preferences], each under its heading", () => {
    const frame = renderGameFrame(host, spec({ preferences: prefs }), { common });
    frame.openSheet("settings");
    const sheet = frame.root.querySelector(".gf-sheet")!;
    expect(sheet.getAttribute("role")).toBe("dialog");
    expect(sheet.getAttribute("aria-modal")).toBe("true");
    const heads = [...sheet.querySelectorAll(".sheet-section")].map((h) => h.textContent);
    expect(heads).toEqual(["Every game", "Othello"]);
    const ids = [...sheet.querySelectorAll(".sheet-row")].map((r) => r.getAttribute("data-setting"));
    expect(ids).toEqual(["hints", "assist", "tutor"]);
    expect(console.debug).toHaveBeenCalledWith("[frame] sheet=settings open");
  });

  it("a game with no preferences still gets the common section", () => {
    const frame = renderGameFrame(host, spec(), { common });
    frame.openSheet("settings");
    const ids = [...frame.root.querySelectorAll(".gf-sheet .sheet-row")].map((r) => r.getAttribute("data-setting"));
    expect(ids).toEqual(["hints", "assist"]);
    expect([...frame.root.querySelectorAll(".gf-sheet .sheet-section")].map((h) => h.textContent)).toEqual(["Every game"]);
  });

  it("the setup sheet renders setup rows and a Start button, and not the preferences — and vice versa", () => {
    const onStart = vi.fn();
    const frame = renderGameFrame(host, spec({ setup, preferences: prefs, onStart }), { common });
    frame.openSheet("setup");
    let ids = [...frame.root.querySelectorAll(".gf-sheet .sheet-row")].map((r) => r.getAttribute("data-setting"));
    expect(ids).toEqual(["level"]);
    frame.root.querySelector<HTMLButtonElement>(".gf-sheet .gf-start")!.click();
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(frame.root.querySelector(".gf-sheet")).toBeNull(); // Start closes the sheet
    frame.openSheet("settings");
    ids = [...frame.root.querySelectorAll(".gf-sheet .sheet-row")].map((r) => r.getAttribute("data-setting"));
    expect(ids).toEqual(["hints", "assist", "tutor"]);
    expect(frame.root.querySelector(".gf-sheet .gf-start")).toBeNull();
  });

  it("a second openSheet replaces the first — one sheet in the DOM, never two", () => {
    const frame = renderGameFrame(host, spec({ setup, preferences: prefs }), { common });
    frame.openSheet("settings");
    frame.openSheet("setup");
    expect(frame.root.querySelectorAll(".gf-sheet")).toHaveLength(1);
    expect(frame.root.querySelectorAll(".gf-scrim")).toHaveLength(1);
    expect(frame.root.querySelector(".gf-sheet .gf-start")).not.toBeNull();
  });

  it("Escape and the scrim close the sheet and return focus to the verb that opened it", () => {
    const frame = renderGameFrame(host, spec({ preferences: prefs }), { common });
    const settingsVerb = frame.root.querySelector<HTMLButtonElement>('.gf-verb[data-verb="settings"]')!;
    settingsVerb.focus();
    settingsVerb.click();
    expect(frame.root.querySelector(".gf-sheet")).not.toBeNull();
    expect(frame.root.querySelector(".gf-sheet")!.contains(document.activeElement)).toBe(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(frame.root.querySelector(".gf-sheet")).toBeNull();
    expect(document.activeElement).toBe(settingsVerb);
    settingsVerb.click();
    frame.root.querySelector<HTMLElement>(".gf-scrim")!.click();
    expect(frame.root.querySelector(".gf-sheet")).toBeNull();
    expect(document.activeElement).toBe(settingsVerb);
  });

  it("the rail panel shows the setup read-only and the preferences inline, and update() refreshes it", () => {
    const frame = renderGameFrame(host, spec({ setup, preferences: prefs, mode: "Medium" }), { common });
    const extra = frame.root.querySelector(".gf-extra")!;
    expect(extra.querySelector(".gf-readonly")?.textContent).toContain("Difficulty");
    expect(extra.querySelector(".gf-readonly")?.textContent).toContain("Medium");
    expect([...extra.querySelectorAll(".sheet-row")].map((r) => r.getAttribute("data-setting"))).toEqual([
      "hints",
      "assist",
      "tutor",
    ]);
    frame.update(spec({ setup: [{ ...setup[0]!, value: "easy" }], preferences: prefs }));
    // update() replaces the panel wholesale; re-query rather than hold the old node.
    expect(frame.root.querySelector(".gf-extra .gf-readonly")?.textContent).toContain("Easy");
    expect(frame.root.querySelectorAll(".gf-extra")).toHaveLength(1);
  });
});

describe("renderGameFrame — the mirror preference", () => {
  it("data-gf-side follows the option, and setSide() flips it live", () => {
    const frame = renderGameFrame(host, spec(), { side: "left" });
    expect(frame.root.dataset.gfSide).toBe("left");
    frame.setSide("right");
    expect(frame.root.dataset.gfSide).toBe("right");
    host.innerHTML = "";
    expect(renderGameFrame(host, spec()).root.dataset.gfSide).toBe("right");
  });
});
