//! PKCE (RFC 7636) for the authorization-code flow; atproto requires S256.
//! Ported from croft-pwa (bluebird).

import { randomB64url, sha256B64url } from "./jose.js";

export interface Pkce {
  readonly verifier: string;
  readonly challenge: string;
  readonly method: "S256";
}

/** A random code verifier — 32 random bytes → 43 unreserved base64url chars. */
export function generateVerifier(): string {
  return randomB64url(32);
}

export async function challengeS256(verifier: string): Promise<string> {
  return sha256B64url(verifier);
}

export async function createPkce(): Promise<Pkce> {
  const verifier = generateVerifier();
  return { verifier, challenge: await challengeS256(verifier), method: "S256" };
}
