//! DPoP (RFC 9449) for atproto OAuth: a per-session ES256 key proves possession
//! on every token request. The key must survive the authorization redirect, so
//! it is exportable and (de)serialised as JWKs. Ported from croft-pwa (bluebird).

import { b64urlFromBytes, randomB64url, sha256, signJwt } from "./jose.js";

function subtle(): SubtleCrypto {
  const c = globalThis.crypto;
  if (!c?.subtle) throw new Error("WebCrypto is unavailable");
  return c.subtle;
}

/** A P-256 public JWK, exactly the members a DPoP header uses. */
export interface PublicJwk {
  readonly kty: "EC";
  readonly crv: "P-256";
  readonly x: string;
  readonly y: string;
}

export interface DpopKey {
  readonly privateKey: CryptoKey;
  readonly publicJwk: PublicJwk;
}

export interface StoredDpopKey {
  readonly privateJwk: JsonWebKey;
  readonly publicJwk: PublicJwk;
}

function toPublicJwk(jwk: JsonWebKey): PublicJwk {
  if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.x || !jwk.y) throw new Error("bad EC key");
  return { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y };
}

export async function generateDpopKey(): Promise<DpopKey> {
  const pair = await subtle().generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
  const pub = await subtle().exportKey("jwk", pair.publicKey);
  return { privateKey: pair.privateKey, publicJwk: toPublicJwk(pub) };
}

export async function exportDpopKey(key: DpopKey): Promise<StoredDpopKey> {
  return { privateJwk: await subtle().exportKey("jwk", key.privateKey), publicJwk: key.publicJwk };
}

export async function importDpopKey(stored: StoredDpopKey): Promise<DpopKey> {
  const privateKey = await subtle().importKey("jwk", stored.privateJwk, { name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
  return { privateKey, publicJwk: stored.publicJwk };
}

export interface DpopProofInput {
  readonly key: DpopKey;
  readonly htm: string;
  readonly htu: string;
  readonly nonce?: string;
  /** Access-token hash (base64url SHA-256 of the token) — required on PDS calls. */
  readonly accessToken?: string;
  /** Seconds since epoch; injectable for tests. */
  readonly iat?: number;
}

/** Build a signed DPoP proof JWT for a request. */
export async function createDpopProof(input: DpopProofInput): Promise<string> {
  const header = { typ: "dpop+jwt", alg: "ES256", jwk: input.key.publicJwk };
  const iat = input.iat ?? Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = { jti: randomB64url(16), htm: input.htm, htu: input.htu, iat };
  if (input.nonce) payload.nonce = input.nonce;
  if (input.accessToken) payload.ath = b64urlFromBytes(await sha256(input.accessToken));
  return signJwt(header, payload, input.key.privateKey);
}
