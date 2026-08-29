//! State a re-render has no right to throw away.
//!
//! Every game renders with `container.replaceChildren(…)`, rebuilding the whole
//! subtree from the game model. That is the right shape for everything the model
//! owns — the board, the score, which controls are enabled. It is wrong for the
//! few things the **player** owns: whether they opened the settings panel, where
//! their focus was, and where the caret sat in a text field. Those are not in the
//! model, so a rebuild silently discards them.
//!
//! It is not a cosmetic loss. `dots.ts` re-renders when its WebGPU probe
//! resolves, at a moment nothing in the UI predicts. On CI that landed between a
//! test opening the settings panel and clicking a checkbox inside it: the
//! checkbox was detached, its replacement arrived inside a closed panel, and the
//! run hung for 30s and blocked every deploy for two days. A player on a slow
//! device sees the same thing as a panel that snaps shut by itself.
//!
//! Usage — the three lines that wrap an existing render:
//!
//! ```ts
//! const ui = captureUiState(container);
//! container.replaceChildren(/* … */);
//! restoreUiState(container, ui);
//! ```
//!
//! Deliberately narrow. It restores only what it can identify unambiguously, and
//! does nothing at all when it cannot — a wrong guess about focus is worse than
//! leaving focus alone.

/** Where a captured element sat: its class attribute, and which of that class it was. */
interface ElementKey {
  readonly cls: string;
  readonly nth: number;
}

/** Captured focus, including the caret if the element carried one. */
interface FocusState {
  readonly key: ElementKey;
  readonly selectionStart: number | null;
  readonly selectionEnd: number | null;
}

/** An opaque snapshot of the player-owned state inside a container. */
export interface UiState {
  readonly openPanels: readonly ElementKey[];
  readonly focus: FocusState | null;
}

/**
 * Key an element by its class attribute plus its index among siblings sharing it.
 *
 * Class rather than a `data-ui-key`: every game's settings panel already carries a
 * unique, stable class (`dots-settings`, `othello-settings`, …), so this needs no
 * new attribute threaded through thirteen games' markup. The index disambiguates
 * the case where a game ships two panels with the same class.
 */
function keyOf(el: Element, all: readonly Element[]): ElementKey {
  const cls = el.getAttribute("class") ?? "";
  const nth = all.filter((o) => (o.getAttribute("class") ?? "") === cls).indexOf(el);
  return { cls, nth };
}

/** Resolve a key back to an element in the freshly rendered subtree, if it still exists. */
function find(root: ParentNode, key: ElementKey, selector: string): Element | undefined {
  const all = [...root.querySelectorAll(selector)];
  return all.filter((o) => (o.getAttribute("class") ?? "") === key.cls)[key.nth];
}

/** Does this element carry a text caret we can restore? */
function hasCaret(el: Element): el is HTMLInputElement | HTMLTextAreaElement {
  if (el instanceof HTMLTextAreaElement) return true;
  // Only some input types expose selectionStart; reading it on the others throws.
  return el instanceof HTMLInputElement && /^(text|search|url|tel|password)$/.test(el.type);
}

/**
 * Snapshot the player-owned state inside `root`, immediately before it is replaced.
 */
export function captureUiState(root: ParentNode): UiState {
  const panels = [...root.querySelectorAll("details")];
  const openPanels = panels.filter((d) => d.open).map((d) => keyOf(d, panels));

  let focus: FocusState | null = null;
  const active = root.ownerDocument?.activeElement ?? document.activeElement;
  // `contains` on the root itself, so focus outside the game is never captured and
  // therefore never restored — the player may have moved to the page chrome.
  if (active && active !== document.body && (root as Node).contains(active)) {
    const focusable = [...root.querySelectorAll("*")];
    focus = {
      key: keyOf(active, focusable),
      selectionStart: hasCaret(active) ? active.selectionStart : null,
      selectionEnd: hasCaret(active) ? active.selectionEnd : null,
    };
  }
  return { openPanels, focus };
}

/**
 * Re-apply a snapshot to the rebuilt subtree.
 *
 * Every step is best-effort: a panel that no longer exists is skipped rather than
 * throwing, because a game is free to render something else entirely and that is
 * not an error.
 */
export function restoreUiState(root: ParentNode, state: UiState): void {
  for (const key of state.openPanels) {
    const panel = find(root, key, "details");
    if (panel instanceof HTMLDetailsElement) panel.open = true;
  }

  if (!state.focus) return;
  // Never steal focus the player has since moved somewhere else. Between capture
  // and restore the only thing that ran is the game's own render, so anything
  // focused outside this container now is the player's doing, not ours.
  const active = root.ownerDocument?.activeElement ?? document.activeElement;
  if (active && active !== document.body && !(root as Node).contains(active)) return;

  const target = find(root, state.focus.key, "*");
  if (!(target instanceof HTMLElement)) return;
  target.focus();
  const { selectionStart, selectionEnd } = state.focus;
  if (selectionStart !== null && selectionEnd !== null && hasCaret(target)) {
    target.setSelectionRange(selectionStart, selectionEnd);
  }
}
