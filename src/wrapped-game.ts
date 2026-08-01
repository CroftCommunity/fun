//! The shared Tier-2 mount primitive. A wrapped game is untrusted third-party
//! code running in our chrome, so it lives in a **sandboxed iframe with an
//! opaque origin** (`sandbox="allow-scripts"`, verified in Phase 0 to run and
//! contain all candidates). This is the single place the containment contract is
//! expressed; every Tier-2 `GameModule` mounts through here rather than building
//! its own iframe, so the posture cannot drift game-to-game.

/** Options for mounting a wrapped game's vendored bundle. */
export interface WrappedGameOptions {
  /** URL of the vendored bundle's entry document (served same-origin). */
  readonly src: string;
  /** Accessible title for the iframe. */
  readonly title: string;
  /**
   * The iframe `sandbox` attribute. Defaults to the Phase-0 containment level.
   * `allow-same-origin` is rejected — combined with `allow-scripts` it lets the
   * frame remove its own sandbox, defeating containment.
   */
  readonly sandbox?: string;
}

/** A live wrapped-game mount and its teardown. */
export interface WrappedGameHandle {
  /** The mounted iframe element. */
  readonly iframe: HTMLIFrameElement;
  /** Remove the iframe and release it. Safe to call once. */
  teardown(): void;
}

const DEFAULT_SANDBOX = "allow-scripts";

/**
 * Mount a wrapped game's vendored bundle in a contained sandboxed iframe inside
 * `container`, returning a handle whose `teardown()` removes it cleanly. The
 * opaque origin means the frame cannot reach our DOM, storage, or cookies, so
 * teardown is a plain removal — there is nothing it can leak back into our page.
 */
export function mountWrappedGame(
  container: HTMLElement,
  { src, title, sandbox = DEFAULT_SANDBOX }: WrappedGameOptions,
): WrappedGameHandle {
  if (/\ballow-same-origin\b/.test(sandbox)) {
    throw new Error(
      "mountWrappedGame: allow-same-origin defeats containment (the frame could remove its own sandbox); refusing it.",
    );
  }

  const iframe = document.createElement("iframe");
  iframe.className = "wrapped-game-frame";
  iframe.setAttribute("sandbox", sandbox);
  iframe.setAttribute("title", title);
  iframe.setAttribute("src", src);
  container.append(iframe);

  // An opaque-origin sandboxed iframe never takes keyboard focus on its own:
  // clicks land on the game canvas, but key events go to the parent document and
  // never reach the wrapped game (so keyboard-driven games look "dead" to the
  // keyboard until something focuses the frame). Focus it once it loads so the
  // keyboard works without a click first. Containment is unchanged — focus does
  // not grant the frame any access to our DOM, storage, or cookies. A keyboard
  // game that also wants focus restored *after* the user clicks away must grab it
  // from inside its own bundle (the parent can't observe in-frame pointer events
  // across the opaque origin) — see docs/BUILDING-GAMES.md §9.
  iframe.addEventListener("load", () => iframe.focus());

  let torn = false;
  return {
    iframe,
    teardown(): void {
      if (torn) return;
      torn = true;
      iframe.remove();
    },
  };
}
