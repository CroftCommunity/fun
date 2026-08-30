//! Sign-in on the shelf — one identity for every game (plan D10; mock E
//! proposal 6). The header carries either "Sign in" (opens the atmo-provider
//! sheet) or the person (their handle; a menu with Sign out). A provider tap
//! pushes the authorization request and leaves for the provider; the callback
//! page (`/signin/`) finishes the exchange, binds every local record to the DID
//! (nothing is sent anywhere — plan D9), and returns the person to the page
//! they left. croft-pwa DESIGN rule 8: silence is success — the only failure
//! copy is "Could not start sign-in: <reason>".

import { getProfile } from "../atproto/read.js";
import { beginAuthorization, completeAuthorization, type OAuthConfig } from "../atproto/oauth/client.js";
import { bindRecordsToDid } from "../record.js";
import { oauthConfig, readPending, readSession, writePending, writeSession, type SignedIn } from "./session.js";
import { openSignInSheet, type ChooseOptions } from "./sheet.js";

export type { SignedIn } from "./session.js";

/** The current person, or null. */
export function currentSession(): SignedIn | null {
  return readSession();
}

/** Start OAuth at a provider entryway or for a handle. Resolves when the page is leaving. */
export async function startSignIn(target: string, options: ChooseOptions = {}, cfg: OAuthConfig = oauthConfig(location.origin)): Promise<void> {
  const { authorizeUrl, pending } = await beginAuthorization(target, cfg, {}, options);
  writePending(pending, `${location.pathname}${location.search}`);
  location.assign(authorizeUrl);
}

export interface SignInHost {
  /** Where the sheet mounts (the chrome's root). */
  readonly host: HTMLElement;
  /** Called after the header should re-paint (sign-out). */
  readonly onChange: () => void;
}

/** Open the sheet. A provider tap says "Starting sign-in…" then leaves; a failure says why. */
export function openSignIn(h: SignInHost): void {
  const sheet = openSignInSheet(h.host, {
    onChoose: (target, options) => {
      const status = sheet.querySelector<HTMLElement>("[data-signin-status]");
      if (status) status.textContent = "Starting sign-in…";
      startSignIn(target, options).catch((err: unknown) => {
        const reason = err instanceof Error ? err.message : String(err);
        if (status) status.textContent = `Could not start sign-in: ${reason}`;
      });
    },
    onEmptyHandle: () => {
      const status = sheet.querySelector<HTMLElement>("[data-signin-status]");
      if (status) status.textContent = "Type a handle, or pick a provider above.";
    },
  });
}

export function signOut(h: SignInHost): void {
  writeSession(null);
  h.onChange();
}

/**
 * The callback page: exchange the code, look up the handle, bind the local
 * records, and go back. Returns false when this is not a callback (no pending
 * authorization, or no code in the URL).
 */
export async function handleCallback(games: readonly string[], cfg: OAuthConfig = oauthConfig(location.origin)): Promise<boolean> {
  const url = new URL(location.href);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const p = readPending();
  if (!code || !state || !p) return false;
  const session = await completeAuthorization(p.pending, { code, state }, cfg);
  let handle = session.did;
  try {
    handle = (await getProfile(session.did, cfg.fetchImpl ? { fetchImpl: cfg.fetchImpl } : {})).handle;
  } catch {
    // The AppView is a convenience for the display name; the DID is the identity.
  }
  writeSession({ ...session, handle });
  writePending(null);
  const bound = bindRecordsToDid(session.did, games);
  console.debug(`[signin] ${session.did} as ${handle}; records bound: ${bound.join(", ") || "none"}`);
  location.replace(p.returnTo);
  return true;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...kids);
  return node;
}

/** The header control: "Sign in", or the person with a Sign out menu. */
export function renderSignInControl(h: SignInHost): HTMLElement {
  const wrap = el("div", { class: "signin-control" });
  const paint = (): void => {
    const s = readSession();
    wrap.replaceChildren();
    if (!s) {
      const btn = el(
        "button",
        { type: "button", class: "signin-open", "data-signin-open": "", "aria-label": "Sign in or create an account" },
        el("span", { class: "signin-glyph", "aria-hidden": "true" }, "◎"),
        el("span", { class: "signin-text" }, "Sign in"),
      );
      btn.addEventListener("click", () => openSignIn({ host: h.host, onChange: paint }));
      wrap.append(btn);
      return;
    }
    const menuId = "signin-menu";
    const who = el(
      "button",
      { type: "button", class: "signin-who", "data-signin-who": "", "aria-expanded": "false", "aria-controls": menuId, "aria-label": `Signed in as ${s.handle}` },
      el("span", { class: "signin-avatar", "aria-hidden": "true" }, s.handle.charAt(0).toUpperCase()),
      el("span", { class: "signin-handle" }, s.handle),
    );
    const menu = el("div", { id: menuId, class: "signin-menu", hidden: "" });
    const out = el("button", { type: "button", class: "signin-out", "data-signin-out": "" }, "Sign out");
    out.addEventListener("click", () => signOut({ host: h.host, onChange: paint }));
    menu.append(el("p", { class: "signin-did" }, s.did), out);
    who.addEventListener("click", () => {
      const open = menu.hidden;
      menu.hidden = !open;
      who.setAttribute("aria-expanded", String(open));
    });
    wrap.append(who, menu);
  };
  paint();
  return wrap;
}
