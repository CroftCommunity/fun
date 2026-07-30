//! Shared share-link + daily helpers for every game (see docs/BUILDING-GAMES.md).
//!
//! A self-verifying outcome record is the full document, and move lists are long
//! and repetitive, so the share payload is **deflated** then base64url-encoded —
//! a long record shrinks to a portable URL. Plus the UTC daily-rollover index.

const toB64Url = (b64: string): string => b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64Url = (s: string): string => s.replace(/-/g, "+").replace(/_/g, "/");

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function pipe(stream: TransformStream, bytes: Uint8Array): Promise<Uint8Array> {
  // Begin consuming `readable` before writing so the stream's backpressure never
  // deadlocks the single large write (it can, e.g. in Chromium).
  const collected = new Response(stream.readable).arrayBuffer();
  const writer = stream.writable.getWriter();
  await writer.write(bytes);
  await writer.close();
  return new Uint8Array(await collected);
}

/** Encode any JSON-serializable value as a deflated base64url share payload. */
export async function encodeShare(value: unknown): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(value));
  const compressed = await pipe(new CompressionStream("deflate-raw"), json);
  return toB64Url(bytesToBase64(compressed));
}

/** Decode a deflated base64url share payload back into a value. */
export async function decodeShare<T>(payload: string): Promise<T> {
  const compressed = base64ToBytes(fromB64Url(payload));
  const json = await pipe(new DecompressionStream("deflate-raw"), compressed);
  return JSON.parse(new TextDecoder().decode(json)) as T;
}

const MS_PER_DAY = 86_400_000;

/** Whole UTC days since the Unix epoch — the daily-deal rollover boundary. */
export function dayIndexUTC(now: Date): number {
  return Math.floor(now.getTime() / MS_PER_DAY);
}
