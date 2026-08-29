//! Repair `localStorage`/`sessionStorage` when the runtime hands the test
//! environment a broken one.
//!
//! **Why this exists.** Node 25 defines its own experimental
//! `globalThis.localStorage`, and with no `--localstorage-file` it is an empty
//! placeholder object — no `clear`, no `key`, no `length`. It takes precedence
//! over the `Storage` vitest's jsdom environment would otherwise install, so on
//! Node 25 every storage-touching test failed with `localStorage.clear is not a
//! function` (11 of them, in Trio Tumble) while CI stayed green on the Node 22 that
//! `.nvmrc` pins.
//!
//! The honest fix is not "only run tests on Node 22": a suite that fails on the
//! developer's machine and passes on CI trains everyone to ignore red, and the
//! next real failure hides in the same noise. So: if the global is not a working
//! `Storage`, replace it with an in-memory one; if it is, leave it entirely
//! alone. On CI this file does nothing.
//!
//! The replacement is deliberately minimal — `getItem`/`setItem`/`removeItem`/
//! `clear`/`key`/`length`, which is the whole surface the shelf uses (verified by
//! grep: 22 `getItem`, 23 `setItem`, 2 `removeItem`, no property-style access).
//! It does **not** support `storage.foo = x` index access, because nothing here
//! uses it and a `Proxy` to fake it would be a second thing to get wrong.

/** An in-memory `Storage`, insertion-ordered like the real one. */
class MemoryStorage implements Storage {
  readonly #map = new Map<string, string>();

  get length(): number {
    return this.#map.size;
  }
  key(index: number): string | null {
    return [...this.#map.keys()][index] ?? null;
  }
  getItem(key: string): string | null {
    return this.#map.get(String(key)) ?? null;
  }
  setItem(key: string, value: string): void {
    this.#map.set(String(key), String(value));
  }
  removeItem(key: string): void {
    this.#map.delete(String(key));
  }
  clear(): void {
    this.#map.clear();
  }
  [name: string]: unknown;
}

/** A usable `Storage` is one with the whole surface, not just get/set. */
export function isWorkingStorage(value: unknown): boolean {
  const s = value as Partial<Storage> | undefined | null;
  return (
    typeof s?.getItem === "function" &&
    typeof s.setItem === "function" &&
    typeof s.removeItem === "function" &&
    typeof s.clear === "function" &&
    typeof s.key === "function"
  );
}

/**
 * Give `target` a working `localStorage`/`sessionStorage`, replacing only what is
 * broken. Returns the names it replaced, so the decision is observable — the
 * "leave a real Storage alone" half is the one that would otherwise go untested,
 * and it is the half that matters on CI.
 */
export function installStorageIfBroken(target: Record<string, unknown>): string[] {
  const replaced: string[] = [];
  for (const name of ["localStorage", "sessionStorage"] as const) {
    if (isWorkingStorage(target[name])) continue;
    // `configurable: true` so a later environment (or another setup file) can
    // still replace it, and so this is idempotent across re-registration.
    Object.defineProperty(target, name, {
      value: new MemoryStorage(),
      writable: true,
      configurable: true,
    });
    replaced.push(name);
  }
  return replaced;
}

const root = globalThis as unknown as Record<string, unknown>;
const replaced = installStorageIfBroken(root);
// jsdom's `window` is a separate object from `globalThis` in some setups; keep the
// two views pointing at the same store so `window.localStorage` is not the stub.
const win = root.window as Record<string, unknown> | undefined;
if (win && win !== root) {
  for (const name of replaced) {
    Object.defineProperty(win, name, { value: root[name], writable: true, configurable: true });
  }
}
