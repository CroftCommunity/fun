//! The sign-in sheet — croft-pwa docs/DESIGN.md § Components › Sheet, § Flows ›
//! Sign in, § Copy › atmo, ported (plan D8/D10). Native <dialog> + showModal():
//! focus entry, Esc, focus return and background inertness for free, and axe can
//! see inside an open one. The recorded exception to "pages, not modals": a
//! choose-one step that returns you where you were. Built FRESH per open and
//! removed on close, so a half-typed handle never carries over.
//!
//! Class names are `signin-*` (fun's settings sheet already owns `sheet-*`); the
//! `data-*` hooks are croft-pwa's, so its spec ports unchanged.

import { ATMO_GLOSS, canCreateAccount, featuredProviders, otherProviders, type Provider } from "./providers.js";

export interface ChooseOptions {
  readonly prompt?: "create";
}

export interface SheetHandlers {
  /** `target` is a provider entryway (https origin) or a handle. */
  readonly onChoose: (target: string, options?: ChooseOptions) => void;
  /** Called with an empty handle submission; the sheet stays open. */
  readonly onEmptyHandle: () => void;
}

type Attrs = Readonly<Record<string, string | boolean>>;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: readonly (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false) continue;
    if (k === "hidden") node.hidden = true;
    else node.setAttribute(k, v === true ? "" : v);
  }
  node.append(...kids);
  return node;
}

// One row shape for both panels. The two-direction rule (open offers Create,
// invite-only shows the WORDS in the create slot) is a property of the provider,
// not of the panel — a provider that changes posture moves panels and changes its
// controls in one edit to the registry.
function providerRow(p: Provider, h: SheetHandlers): HTMLElement {
  const actions = el("div", { class: "signin-actions" });
  if (canCreateAccount(p)) {
    const create = el("button", { type: "button", class: "signin-btn", "data-provider-create": "" }, "Create account");
    create.addEventListener("click", () => h.onChoose(p.entryway, { prompt: "create" }));
    actions.append(create);
  } else {
    actions.append(el("span", { class: "signin-invite" }, "invite only"));
  }
  const go = el("button", { type: "button", class: "signin-btn primary", "data-provider-signin": "" }, "Sign in");
  go.addEventListener("click", () => h.onChoose(p.entryway));
  actions.append(go);
  return el("div", { class: "signin-row", "data-provider-row": p.id }, el("span", { class: "signin-provider" }, p.label), actions);
}

export function signInSheet(h: SheetHandlers): HTMLDialogElement {
  const titleId = "signin-sheet-title";
  const dialog = el("dialog", { class: "signin-sheet", "data-signin-sheet": "", "aria-labelledby": titleId });
  const close = el("button", { type: "button", class: "signin-x", "aria-label": "Close" }, "✕");
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => dialog.remove());

  // The front page is the providers a newcomer can JOIN from here; invite-only
  // providers are one tap in, below.
  const list = el("div", { class: "signin-list" }, ...featuredProviders().map((p) => providerRow(p, h)));

  // Everything not on the short list reaches the same seam — the handle field
  // for any atproto host at all. The list is an editorial convenience, not a boundary.
  const handle = el("input", {
    type: "text",
    id: "signin-sheet-handle",
    "data-provider-handle": "",
    placeholder: "you.example.com",
    autocapitalize: "none",
    autocorrect: "off",
    spellcheck: "false",
  });
  const form = el(
    "form",
    { class: "signin-form" },
    el("label", { for: "signin-sheet-handle", class: "signin-label" }, "Your handle on any atmo provider"),
    el("div", { class: "signin-handle-row" }, handle, el("button", { type: "submit", class: "signin-btn primary", "data-provider-handle-go": "" }, "Continue")),
  );
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = handle.value.trim().replace(/^@+/, "");
    if (!v) return h.onEmptyHandle();
    h.onChoose(v);
  });
  const panel = el("div", { class: "signin-other", hidden: true }, el("div", { class: "signin-list" }, ...otherProviders().map((p) => providerRow(p, h))), form);
  const other = el("button", { type: "button", class: "signin-btn signin-more", "data-provider-other": "" }, "Another provider");
  other.addEventListener("click", () => {
    other.hidden = true;
    panel.hidden = false;
    handle.focus();
  });

  // "atmo" is the owner's word for a home on the open social Atmosphere. The
  // gloss is a native <abbr title> (hovers on a desktop, read by assistive tech),
  // and the sentence below says the same thing in plain sight for touch.
  const intro = `This shelf has no accounts of its own. You sign in with an account from an atmo provider — ${ATMO_GLOSS.charAt(0).toLowerCase()}${ATMO_GLOSS.slice(1)}. Bluesky is one of many, and each sets its own rules.`;
  dialog.append(
    el("div", { class: "signin-head" }, el("h2", { id: titleId }, "Choose your ", el("abbr", { class: "signin-gloss", title: ATMO_GLOSS }, "atmo"), " provider"), close),
    el("p", { class: "signin-intro" }, intro),
    list,
    other,
    panel,
    el("p", { class: "signin-status", "data-signin-status": "", role: "status", "aria-live": "polite" }),
  );
  return dialog;
}

/** Mount a fresh sheet under `host` and open it modally. */
export function openSignInSheet(host: HTMLElement, h: SheetHandlers): HTMLDialogElement {
  const sheet = signInSheet(h);
  host.append(sheet);
  sheet.showModal();
  return sheet;
}
