//! Where sign-in keeps its state, and the OAuth client for this origin.
//!
//! The pending authorization (state, PKCE verifier, DPoP key) lives in
//! `sessionStorage` across the redirect; the session (DID, tokens, the DPoP key
//! the tokens are bound to, and the handle for display) in `localStorage`.
//! Both are validated on read, never trusted.

import type { OAuthConfig, OAuthSession, PendingAuth } from "../atproto/oauth/client.js";

export const SESSION_KEY = "fun-signin-session";
export const PENDING_KEY = "fun-signin-pending";
/** Where to return the person after the callback (the page they were on). */
export const RETURN_KEY = "fun-signin-return";

/** A session plus the handle the header shows. */
export interface SignedIn extends OAuthSession {
  readonly handle: string;
}

/**
 * The OAuth client for the origin the shelf runs at. Deployed, the client_id is
 * the hosted client-metadata.json; on localhost it is atproto's loopback form
 * (`http://localhost` with the redirect and scope in the query), which needs no
 * hosted metadata — that is what makes the e2e and local play possible.
 */
export function oauthConfig(origin: string): OAuthConfig {
  const redirectUri = `${origin}/signin/`;
  const scope = "atproto";
  const u = new URL(origin);
  if (u.hostname === "localhost" || u.hostname === "127.0.0.1") {
    const id = new URL("http://localhost");
    id.searchParams.set("redirect_uri", redirectUri);
    id.searchParams.set("scope", scope);
    return { clientId: id.toString(), redirectUri, scope };
  }
  return { clientId: `${origin}/client-metadata.json`, redirectUri, scope };
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/** Pure: a stored session string → a session, or null when it does not check out. */
export function resolveSession(raw: string | null): SignedIn | null {
  if (raw === null) return null;
  let p: unknown;
  try {
    p = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(p)) return null;
  if (typeof p.did !== "string" || !p.did.startsWith("did:")) return null;
  if (typeof p.pds !== "string" || typeof p.accessToken !== "string" || typeof p.tokenEndpoint !== "string") return null;
  if (typeof p.handle !== "string" || !isObject(p.dpopKey)) return null;
  return p as unknown as SignedIn;
}

export function readSession(): SignedIn | null {
  try {
    return resolveSession(localStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}

export function writeSession(s: SignedIn | null): void {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    console.debug("[signin] storage denied: session");
  }
}

export function readPending(): { pending: PendingAuth; returnTo: string } | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as unknown;
    if (!isObject(p) || typeof p.state !== "string" || typeof p.verifier !== "string") return null;
    return { pending: p as unknown as PendingAuth, returnTo: sessionStorage.getItem(RETURN_KEY) ?? "/" };
  } catch {
    return null;
  }
}

export function writePending(pending: PendingAuth | null, returnTo = "/"): void {
  try {
    if (pending) {
      sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
      sessionStorage.setItem(RETURN_KEY, returnTo);
    } else {
      sessionStorage.removeItem(PENDING_KEY);
      sessionStorage.removeItem(RETURN_KEY);
    }
  } catch {
    console.debug("[signin] storage denied: pending");
  }
}
