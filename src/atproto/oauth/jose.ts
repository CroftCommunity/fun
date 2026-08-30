//! Minimal JOSE helpers for atproto OAuth on WebCrypto — no dependencies. Only
//! what the flow needs: base64url, SHA-256, and ES256 (P-256) JWT signing.
//! WebCrypto's ECDSA P-256 signatures are already IEEE P1363 (r||s), which is
//! the JWS ES256 encoding — no DER conversion. Ported from croft-pwa (bluebird).

function subtle(): SubtleCrypto {
  const c = globalThis.crypto;
  if (!c?.subtle) throw new Error("WebCrypto is unavailable");
  return c.subtle;
}

export function b64urlFromBytes(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlFromString(str: string): string {
  return b64urlFromBytes(new TextEncoder().encode(str));
}

export function randomB64url(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buf);
  return b64urlFromBytes(buf);
}

export async function sha256(input: string | Uint8Array): Promise<Uint8Array> {
  const data = typeof input === "string" ? new TextEncoder().encode(input) : input;
  return new Uint8Array(await subtle().digest("SHA-256", data as BufferSource));
}

export async function sha256B64url(input: string): Promise<string> {
  return b64urlFromBytes(await sha256(input));
}

/** Sign a compact JWS with an ES256 (P-256) private key. */
export async function signJwt(header: Record<string, unknown>, payload: Record<string, unknown>, key: CryptoKey): Promise<string> {
  const signingInput = `${b64urlFromString(JSON.stringify(header))}.${b64urlFromString(JSON.stringify(payload))}`;
  const sig = await subtle().sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${b64urlFromBytes(new Uint8Array(sig))}`;
}
