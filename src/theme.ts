//! Light/dark theme (Phase E). The no-flash resolution runs as an inline
//! pre-paint `<head>` script (see build.mjs THEME_INIT — the same rule as
//! `resolveTheme`, so the first paint already carries the right theme); this
//! module owns the header toggle after load. Two states only (light/dark): a
//! one-tap toggle that silently matched the system read as a no-op — the lesson
//! carried from croft-pwa.

export type Theme = "light" | "dark";

const KEY = "fun-theme";

/** Pure resolver: an explicit stored choice wins; otherwise follow the OS. */
export function resolveTheme(stored: string | null, prefersDark: boolean): Theme {
  if (stored === "light" || stored === "dark") return stored;
  return prefersDark ? "dark" : "light";
}

function prefersDark(): boolean {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function persist(theme: Theme): void {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Private mode / storage denied: the DOM attribute still applies for the
    // session. A cosmetic preference degrades rather than failing loud.
  }
}

/** Apply a theme to the document and keep the manifest theme-color in sync. */
export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
  const color = getComputedStyle(document.documentElement).getPropertyValue("--theme-color").trim();
  const meta = document.querySelector('meta[name="theme-color"]');
  if (color && meta) meta.setAttribute("content", color);
}

/** Current theme from the DOM (set pre-paint), falling back to a fresh resolve. */
export function currentTheme(): Theme {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "light" || attr === "dark") return attr;
  return resolveTheme(read(), prefersDark());
}

/** Flip and persist. Returns the new theme. */
export function toggleTheme(): Theme {
  const next: Theme = currentTheme() === "dark" ? "light" : "dark";
  persist(next);
  applyTheme(next);
  return next;
}
