//! The test environment must provide a **spec-shaped** `localStorage`.
//!
//! Node 25 exposes its own experimental `globalThis.localStorage`, and without
//! `--localstorage-file` it is an empty placeholder object rather than a
//! `Storage`. It wins over the one vitest's jsdom environment would install, so
//! on a Node-25 machine every test that touches storage saw an object with no
//! `clear`/`key`/`length` — 11 match-3 tests failed locally with
//! `localStorage.clear is not a function` while CI (Node 22, per `.nvmrc`) was
//! green. A test suite that only passes on the pinned Node hides real failures
//! behind noise, so `tests/setup/webstorage.ts` repairs the global when it is
//! broken and leaves a real `Storage` alone.
//!
//! These assertions are the contract that setup file is held to.

import { beforeEach, describe, expect, it } from "vitest";

import { installStorageIfBroken } from "./setup/webstorage.js";

describe("the test environment's localStorage is a real Storage", () => {
  beforeEach(() => localStorage.clear());

  it("has the whole Storage surface, not just get/set", () => {
    for (const m of ["getItem", "setItem", "removeItem", "clear", "key"] as const) {
      expect(typeof localStorage[m], `localStorage.${m}`).toBe("function");
    }
    expect(typeof localStorage.length).toBe("number");
  });

  it("stores, reads back, removes, and clears", () => {
    expect(localStorage.getItem("absent")).toBeNull();
    localStorage.setItem("a", "1");
    localStorage.setItem("b", "2");
    expect(localStorage.getItem("a")).toBe("1");
    expect(localStorage.length).toBe(2);
    localStorage.removeItem("a");
    expect(localStorage.getItem("a")).toBeNull();
    expect(localStorage.length).toBe(1);
    localStorage.clear();
    expect(localStorage.length).toBe(0);
    expect(localStorage.getItem("b")).toBeNull();
  });

  it("coerces values to strings, as the spec requires", () => {
    localStorage.setItem("n", 42 as unknown as string);
    expect(localStorage.getItem("n")).toBe("42");
  });

  it("enumerates keys by index in insertion order", () => {
    localStorage.setItem("first", "1");
    localStorage.setItem("second", "2");
    expect(localStorage.key(0)).toBe("first");
    expect(localStorage.key(1)).toBe("second");
    expect(localStorage.key(2)).toBeNull();
  });

  it("provides sessionStorage on the same contract", () => {
    sessionStorage.clear();
    sessionStorage.setItem("x", "y");
    expect(sessionStorage.getItem("x")).toBe("y");
    // The two are separate stores.
    expect(localStorage.getItem("x")).toBeNull();
    sessionStorage.clear();
  });
});

describe("installStorageIfBroken — replaces only what is broken", () => {
  const working = (): Storage => {
    const map = new Map<string, string>();
    return {
      get length() {
        return map.size;
      },
      key: (i: number) => [...map.keys()][i] ?? null,
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
      clear: () => map.clear(),
    } as Storage;
  };

  it("leaves a real Storage untouched (the CI path — Node 22 has one)", () => {
    const real = working();
    const target: Record<string, unknown> = { localStorage: real, sessionStorage: working() };
    expect(installStorageIfBroken(target)).toEqual([]);
    expect(target.localStorage).toBe(real);
  });

  it("replaces Node 25's placeholder, which has get/set but no clear", () => {
    // Not an empty object: the placeholder is only *partly* missing, so a check
    // that stopped at `typeof getItem === "function"` would pass it through.
    const placeholder = { getItem: () => null, setItem: () => {} };
    const target: Record<string, unknown> = { localStorage: placeholder, sessionStorage: {} };
    expect(installStorageIfBroken(target).sort()).toEqual(["localStorage", "sessionStorage"]);
    expect(typeof (target.localStorage as Storage).clear).toBe("function");
  });

  it("gives each name its own store, not one shared object", () => {
    const target: Record<string, unknown> = {};
    installStorageIfBroken(target);
    (target.localStorage as Storage).setItem("k", "v");
    expect((target.sessionStorage as Storage).getItem("k")).toBeNull();
  });
});
