//! The skippable beat overlay — a small corner card that surfaces a Biscuit beat
//! without blocking play. Phase 2 shows a placeholder (a title, the caption, and a
//! stub media slot); Phase 3 drops a real clip into the media slot. Skips are one
//! tap; the card auto-dismisses so it never stalls a session; the caption is
//! announced politely and the whole thing is keyboard-dismissable. Motion is left
//! to CSS (`prefers-reduced-motion` degrades the entrance to a static card).

import type { Beat } from "./trio-tumble-story.js";

/** The overlay handle: show a beat, or tear it down on unmount. */
export interface Overlay {
  show(beat: Beat): void;
  destroy(): void;
}

/** Create a beat overlay hosted in `host` (a corner card, `pointer-events` only on
 *  the card itself, so it never intercepts board taps). */
export function createOverlay(host: HTMLElement): Overlay {
  let card: HTMLElement | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const dismiss = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    card?.remove();
    card = null;
  };

  const button = (cls: string, label: string, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = cls;
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  };

  return {
    show(beat: Beat): void {
      dismiss(); // one card at a time

      const el = document.createElement("div");
      el.className = "m3-beat";
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");

      const media = document.createElement("div");
      media.className = "m3-beat-media";
      media.setAttribute("aria-hidden", "true");
      media.textContent = "🐕"; // placeholder for Biscuit's clip (Phase 3)

      const body = document.createElement("div");
      body.className = "m3-beat-body";
      const title = document.createElement("p");
      title.className = "m3-beat-title";
      title.textContent = beat.title;
      const caption = document.createElement("p");
      caption.className = "m3-beat-caption";
      caption.textContent = beat.caption;

      const controls = document.createElement("div");
      controls.className = "m3-beat-controls";
      const watch = button("m3-beat-play", "▶ Watch", () => {
        // Placeholder: real clips arrive in Phase 3. Acknowledge, then dismiss.
        caption.textContent = "(Biscuit’s clip is coming soon.)";
        controls.remove();
        if (timer) clearTimeout(timer);
        timer = setTimeout(dismiss, 1200);
      });
      const skip = button("m3-beat-skip", "Skip", dismiss);
      controls.append(watch, skip);

      body.append(title, caption, controls);
      el.append(media, body);
      host.append(el);
      card = el;

      // Auto-dismiss so it never stalls a session even if untouched.
      timer = setTimeout(dismiss, 6000);
    },
    destroy(): void {
      dismiss();
    },
  };
}
