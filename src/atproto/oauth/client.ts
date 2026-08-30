//! atproto OAuth for a public (SPA) client — authorization-code + PKCE + PAR with
//! DPoP-bound tokens (RFC 9449). No client secret; the `client_id` is the hosted
//! client-metadata.json URL (or atproto's loopback form on localhost). The
//! DPoP-nonce handshake is handled with a single retry.
//!
//! Ported from croft-pwa `src/atproto/oauth/client.ts` (bluebird's lineage —
//! CroftC/.claude/DECISIONS.md § Prior-art router, "do NOT write a ninth").
//! Sign-in and refresh only: the record stays local (plan D9), so the
//! DPoP-authenticated writes are not carried here until a publishing substrate
//! is chosen.

import { resolvePds } from "../read.js";
import { createDpopProof, exportDpopKey, generateDpopKey, importDpopKey, type DpopKey, type StoredDpopKey } from "./dpop.js";
import { randomB64url } from "./jose.js";
import { createPkce } from "./pkce.js";
import { isEntryway, resolveEntryway, resolveIdentity, type ResolveDeps } from "./resolve.js";

export interface OAuthConfig {
  /** The hosted client-metadata.json URL — also the OAuth client_id. */
  readonly clientId: string;
  readonly redirectUri: string;
  readonly scope: string;
  readonly fetchImpl?: typeof fetch;
}

export interface PendingAuth {
  readonly state: string;
  readonly verifier: string;
  readonly dpopKey: StoredDpopKey;
  readonly did: string;
  readonly pds: string;
  readonly authServer: string;
  readonly issuer: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly parEndpoint: string;
}

export interface OAuthSession {
  readonly did: string;
  readonly pds: string;
  readonly issuer: string;
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly tokenEndpoint: string;
  readonly clientId: string;
  readonly dpopKey: StoredDpopKey;
  readonly dpopNonce?: string;
  /** Epoch ms when the access token expires (from `expires_in`), if known. */
  readonly expiresAt?: number;
}

function fetchOf(cfg: OAuthConfig): typeof fetch {
  return cfg.fetchImpl ?? globalThis.fetch.bind(globalThis);
}

interface XrpcJson {
  error?: string;
  [k: string]: unknown;
}

/** POST a form with a DPoP proof, retrying once when the server asks for a nonce. */
async function dpopForm(
  endpoint: string,
  params: Record<string, string>,
  key: DpopKey,
  fetchImpl: typeof fetch,
  opts: { nonce?: string } = {},
): Promise<{ data: XrpcJson; nonce: string | undefined; status: number }> {
  const attempt = async (nonce: string | undefined): Promise<Response> => {
    const proof = await createDpopProof({ key, htm: "POST", htu: endpoint, ...(nonce ? { nonce } : {}) });
    return fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json", dpop: proof },
      body: new URLSearchParams(params).toString(),
    });
  };
  let res = await attempt(opts.nonce);
  let serverNonce = res.headers.get("DPoP-Nonce") ?? undefined;
  let data = (await res.json().catch(() => ({}))) as XrpcJson;
  if (!res.ok && data.error === "use_dpop_nonce" && serverNonce) {
    res = await attempt(serverNonce);
    serverNonce = res.headers.get("DPoP-Nonce") ?? serverNonce;
    data = (await res.json().catch(() => ({}))) as XrpcJson;
  }
  return { data, nonce: serverNonce, status: res.status };
}

export interface BeginOptions {
  /** `create` lands the person in the provider's registration wizard (open signups only). */
  readonly prompt?: "create";
}

/**
 * Step 1: push the authorization request, return the URL to visit. `target` is a
 * handle or DID (identity first, `login_hint` sent) OR a provider entryway such as
 * `https://bsky.social` (server first, no hint — the DID comes back in the token).
 */
export async function beginAuthorization(
  target: string,
  cfg: OAuthConfig,
  deps: ResolveDeps = {},
  options: BeginOptions = {},
): Promise<{ authorizeUrl: string; pending: PendingAuth }> {
  const fetchImpl = fetchOf(cfg);
  const resolveDeps = { ...deps, ...(cfg.fetchImpl ? { fetchImpl } : {}) };
  const id = isEntryway(target) ? await resolveEntryway(target, resolveDeps) : await resolveIdentity(target, resolveDeps);
  const pkce = await createPkce();
  const key = await generateDpopKey();
  const state = randomB64url(16);

  const { data, status } = await dpopForm(
    id.meta.pushed_authorization_request_endpoint,
    {
      client_id: cfg.clientId,
      response_type: "code",
      redirect_uri: cfg.redirectUri,
      scope: cfg.scope,
      state,
      code_challenge: pkce.challenge,
      code_challenge_method: "S256",
      ...(id.did ? { login_hint: target } : {}),
      ...(options.prompt ? { prompt: options.prompt } : {}),
    },
    key,
    fetchImpl,
  );
  const requestUri = data.request_uri;
  if (typeof requestUri !== "string") {
    throw new Error(`PAR failed (${status})${data.error ? `: ${data.error}` : ""}`);
  }
  const authorizeUrl = new URL(id.meta.authorization_endpoint);
  authorizeUrl.searchParams.set("client_id", cfg.clientId);
  authorizeUrl.searchParams.set("request_uri", requestUri);
  return {
    authorizeUrl: authorizeUrl.toString(),
    pending: {
      state,
      verifier: pkce.verifier,
      dpopKey: await exportDpopKey(key),
      did: id.did,
      pds: id.pds,
      authServer: id.authServer,
      issuer: id.meta.issuer,
      authorizationEndpoint: id.meta.authorization_endpoint,
      tokenEndpoint: id.meta.token_endpoint,
      parEndpoint: id.meta.pushed_authorization_request_endpoint,
    },
  };
}

/** Step 2: exchange the callback code for DPoP-bound tokens. */
export async function completeAuthorization(
  pending: PendingAuth,
  callback: { code: string; state: string },
  cfg: OAuthConfig,
): Promise<OAuthSession> {
  if (callback.state !== pending.state) throw new Error("OAuth state mismatch — refusing the callback");
  const fetchImpl = fetchOf(cfg);
  const key = await importDpopKey(pending.dpopKey);
  const { data, nonce, status } = await dpopForm(
    pending.tokenEndpoint,
    {
      grant_type: "authorization_code",
      code: callback.code,
      redirect_uri: cfg.redirectUri,
      client_id: cfg.clientId,
      code_verifier: pending.verifier,
    },
    key,
    fetchImpl,
  );
  const accessToken = data.access_token;
  if (typeof accessToken !== "string") {
    throw new Error(`Token exchange failed (${status})${data.error ? `: ${data.error}` : ""}`);
  }
  // atproto binds `sub` to the authenticated DID: verify it — or, after a provider
  // start (no DID up front), take it from here and resolve the REAL PDS, which
  // need not be the entryway chosen.
  const sub = typeof data.sub === "string" ? data.sub : undefined;
  if (pending.did && sub && sub !== pending.did) throw new Error("Token subject does not match the resolved DID");
  if (!pending.did && !sub) throw new Error("Token carries no subject and no DID was resolved up front — refusing an anonymous session");
  const did = pending.did || (sub as string);
  const pds = pending.did ? pending.pds : await resolvePds(did, { fetchImpl });
  return {
    did,
    pds,
    issuer: pending.issuer,
    accessToken,
    ...(typeof data.refresh_token === "string" ? { refreshToken: data.refresh_token } : {}),
    tokenEndpoint: pending.tokenEndpoint,
    clientId: cfg.clientId,
    dpopKey: pending.dpopKey,
    ...(nonce ? { dpopNonce: nonce } : {}),
    ...(typeof data.expires_in === "number" ? { expiresAt: Date.now() + data.expires_in * 1000 } : {}),
  };
}

/** Refresh the session (rotating refresh token): the returned session replaces the old one. */
export async function refresh(session: OAuthSession, fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)): Promise<OAuthSession> {
  if (!session.refreshToken) throw new Error("No refresh token — a new sign-in is needed.");
  const key = await importDpopKey(session.dpopKey);
  const { data, nonce, status } = await dpopForm(
    session.tokenEndpoint,
    { grant_type: "refresh_token", refresh_token: session.refreshToken, client_id: session.clientId },
    key,
    fetchImpl,
    session.dpopNonce ? { nonce: session.dpopNonce } : {},
  );
  const accessToken = data.access_token;
  if (typeof accessToken !== "string") throw new Error(`Refresh failed (${status})${data.error ? `: ${data.error}` : ""}`);
  const nextNonce = nonce ?? session.dpopNonce;
  return {
    ...session,
    accessToken,
    refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : session.refreshToken,
    ...(nextNonce ? { dpopNonce: nextNonce } : {}),
    ...(typeof data.expires_in === "number" ? { expiresAt: Date.now() + data.expires_in * 1000 } : {}),
  };
}
