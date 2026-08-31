//! OAuth discovery from a provider ENTRYWAY (the sheet's "Sign in" with no handle).
//! Two live shapes, harvested 2026-08-30 with curl:
//!
//!   - a single-host provider (Blacksky `https://blacksky.app`, EuroSky
//!     `https://eurosky.social`) is its own PDS AND authorization server, and
//!     answers `/.well-known/oauth-protected-resource` naming itself;
//!   - Bluesky's `https://bsky.social` is an entryway — the authorization server
//!     for a fleet of PDS hosts (`*.host.bsky.network`), which are the ones that
//!     serve `oauth-protected-resource`. The entryway itself answers 404 there
//!     and serves `/.well-known/oauth-authorization-server` directly.
//!
//! The reference `@atproto/oauth-client` (`resolveFromService`) tries the
//! protected-resource document first and falls back to reading the input as an
//! issuer. Before this suite existed the shelf assumed shape one everywhere, and
//! the Bluesky row failed with "protected-resource failed: 404".

import { describe, expect, it } from "vitest";
import { resolveEntryway } from "../src/atproto/oauth/resolve.js";

type Doc = Record<string, unknown>;

/** A fetch that answers exactly the URLs given (JSON, 200) and 404 to everything else. */
function fetchServing(docs: Readonly<Record<string, Doc>>): { fetchImpl: typeof fetch; calls: () => string[] } {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = input instanceof URL ? input.toString() : typeof input === "string" ? input : input.url;
    calls.push(url);
    const doc = docs[url];
    if (!doc) return new Response("Cannot GET", { status: 404, headers: { "content-type": "text/html" } });
    return new Response(JSON.stringify(doc), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { fetchImpl, calls: () => calls };
}

function authServerDoc(issuer: string): Doc {
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    pushed_authorization_request_endpoint: `${issuer}/oauth/par`,
  };
}

describe("resolveEntryway", () => {
  it("a PDS-shaped provider: follows its protected-resource document to the authorization server", async () => {
    const pds = "https://pds.example";
    const as = "https://auth.example";
    const { fetchImpl } = fetchServing({
      [`${pds}/.well-known/oauth-protected-resource`]: { resource: pds, authorization_servers: [as] },
      [`${as}/.well-known/oauth-authorization-server`]: authServerDoc(as),
    });
    const id = await resolveEntryway(pds, { fetchImpl });
    expect(id).toMatchObject({ did: "", pds, authServer: as });
    expect(id.meta.pushed_authorization_request_endpoint).toBe(`${as}/oauth/par`);
  });

  it("an entryway with no protected-resource document (bsky.social): reads it as the authorization server itself", async () => {
    const entryway = "https://bsky.social";
    const { fetchImpl, calls } = fetchServing({
      [`${entryway}/.well-known/oauth-authorization-server`]: authServerDoc(entryway),
    });
    const id = await resolveEntryway(entryway, { fetchImpl });
    expect(id).toMatchObject({ did: "", pds: entryway, authServer: entryway });
    expect(id.meta.authorization_endpoint).toBe(`${entryway}/oauth/authorize`);
    // The protected-resource document is still asked for FIRST (a PDS host must not
    // be mistaken for an issuer); the issuer read is the fallback.
    expect(calls()).toEqual([
      `${entryway}/.well-known/oauth-protected-resource`,
      `${entryway}/.well-known/oauth-authorization-server`,
    ]);
  });

  it("an origin serving neither document: fails with the protected-resource status, not the fallback's", async () => {
    const { fetchImpl } = fetchServing({});
    await expect(resolveEntryway("https://nothing.example", { fetchImpl })).rejects.toThrow("protected-resource failed: 404");
  });

  it("a trailing slash on the entryway is not carried into the resolved origins", async () => {
    const entryway = "https://bsky.social";
    const { fetchImpl } = fetchServing({
      [`${entryway}/.well-known/oauth-authorization-server`]: authServerDoc(entryway),
    });
    const id = await resolveEntryway(`${entryway}/`, { fetchImpl });
    expect(id).toMatchObject({ pds: entryway, authServer: entryway });
  });
});
