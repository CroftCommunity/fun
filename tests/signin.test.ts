//! Sign-in (src/signin/, src/atproto/) — the croft-pwa port (plan D8; DECISIONS.md
//! "do NOT write a ninth"). The registry's facts were probed in croft-pwa and
//! forage; this suite checks the shape, the two-panel split, the create rule in
//! both directions, and the OAuth config for the deployed and loopback origins.

import { describe, expect, it } from "vitest";
import { ATMO_GLOSS, PROVIDERS, SIGNUP, canCreateAccount, featuredProviders, otherProviders, providerById, validateProviders, type Provider } from "../src/signin/providers.js";
import { oauthConfig, resolveSession, SESSION_KEY } from "../src/signin/session.js";
import { bindRecordsToDid, emptyRecord, memorySubstrate, readRecord, writeRecord } from "../src/record.js";

const open = (id: string): Provider => ({ id, label: id.toUpperCase(), entryway: `https://${id}.test`, signups: SIGNUP.OPEN });
const invite = (id: string): Provider => ({ id, label: id.toUpperCase(), entryway: `https://${id}.test`, signups: SIGNUP.INVITE });

describe("signin providers: the registry", () => {
  it("passes its own validation and carries the four probed providers", () => {
    expect(() => validateProviders(PROVIDERS)).not.toThrow();
    expect(PROVIDERS.map((p) => p.id).sort()).toEqual(["blacksky", "bsky", "eurosky", "northsky"]);
    const byEntry = Object.fromEntries(PROVIDERS.map((p) => [p.entryway, p.signups]));
    expect(byEntry["https://bsky.social"]).toBe(SIGNUP.OPEN);
    expect(byEntry["https://northsky.social"]).toBe(SIGNUP.INVITE);
    expect(providerById("eurosky").label).toBe("EuroSky");
    expect(() => providerById("nope")).toThrow(/nope.*bsky/);
    expect(ATMO_GLOSS).toBe("A Personal Data Server provider in the open social Atmosphere");
  });

  it("splits the panels by posture, caps the front page, and offers Create only where signups are open", () => {
    const list = [open("a"), invite("b"), open("c"), open("d"), open("e"), open("f")];
    expect(featuredProviders(list).map((p) => p.id)).toEqual(["a", "c", "d", "e"]);
    expect(otherProviders(list).map((p) => p.id)).toEqual(["b"]);
    expect(canCreateAccount(open("a"))).toBe(true);
    expect(canCreateAccount(invite("b"))).toBe(false);
  });

  it("refuses bad rows loudly", () => {
    expect(() => validateProviders([{ ...open("a"), entryway: "http://a.test" }])).toThrow(/https/);
    expect(() => validateProviders([open("a"), { ...open("b"), entryway: "https://a.test" }])).toThrow(/share/);
    expect(() => validateProviders([{ ...open("a"), signups: "maybe" as never }])).toThrow(/posture/);
  });
});

describe("oauthConfig — the client for the origin the shelf runs at", () => {
  it("deployed: the hosted client-metadata.json is the client_id, /signin/ the redirect", () => {
    const c = oauthConfig("https://fun.croft.ing");
    expect(c.clientId).toBe("https://fun.croft.ing/client-metadata.json");
    expect(c.redirectUri).toBe("https://fun.croft.ing/signin/");
    expect(c.scope).toBe("atproto");
  });
  it("loopback: atproto's localhost client — client_id http://localhost with the redirect in its query", () => {
    const c = oauthConfig("http://localhost:4180");
    expect(c.redirectUri).toBe("http://localhost:4180/signin/");
    const u = new URL(c.clientId);
    expect(u.origin).toBe("http://localhost");
    expect(u.searchParams.get("redirect_uri")).toBe("http://localhost:4180/signin/");
    expect(u.searchParams.get("scope")).toBe("atproto");
  });
});

describe("resolveSession — a stored session is validated, never trusted", () => {
  it("accepts a session with a DID, refuses the rest", () => {
    const good = { did: "did:plc:abc", pds: "https://pds.test", issuer: "https://pds.test", accessToken: "t", tokenEndpoint: "https://pds.test/oauth/token", clientId: "c", dpopKey: { privateJwk: {}, publicJwk: { kty: "EC", crv: "P-256", x: "x", y: "y" } }, handle: "alice.test" };
    expect(resolveSession(JSON.stringify(good))?.did).toBe("did:plc:abc");
    expect(resolveSession(JSON.stringify({ ...good, did: 5 }))).toBeNull();
    expect(resolveSession("nope")).toBeNull();
    expect(resolveSession(null)).toBeNull();
    expect(SESSION_KEY).toBe("fun-signin-session");
  });
});

describe("mock E6.4 (unit half): signing in binds every local record to the DID and publishes nothing", () => {
  it("bindRecordsToDid stamps the did on records that exist and leaves the rest alone", () => {
    const mem = memorySubstrate();
    writeRecord(emptyRecord("color-sort"), mem);
    writeRecord({ ...emptyRecord("wyrdle"), did: "did:plc:old" }, mem);
    const bound = bindRecordsToDid("did:plc:new", ["color-sort", "wyrdle", "2048"], mem);
    expect(bound).toEqual(["color-sort", "wyrdle"]);
    expect(readRecord("color-sort", mem)?.did).toBe("did:plc:new");
    expect(readRecord("wyrdle", mem)?.did).toBe("did:plc:new");
    expect(readRecord("2048", mem)).toBeNull();
  });
});
