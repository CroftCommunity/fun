//! The sign-in sheet on the shelf — croft-pwa docs/DESIGN.md § Flows › Sign in,
//! ported (plan D8/D10). Hermetic: nothing leaves localhost; the OAuth discovery
//! a provider button triggers is answered by page.route at THAT entryway, the
//! PAR body is captured so Create is proved to send prompt=create, and one test
//! walks the whole round trip — authorize, callback, token — to a signed-in
//! header with the local record bound to the DID and no record sent anywhere.

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { ATMO_GLOSS, PROVIDERS, featuredProviders, otherProviders } from "../src/signin/providers.js";

const OPEN = featuredProviders();
const INVITE = otherProviders();

const rows = (page: Page, within: string) =>
  page.evaluate(
    (sel) =>
      [...document.querySelectorAll(`${sel} [data-provider-row]`)].map((r) => ({
        id: r.getAttribute("data-provider-row"),
        create: !!r.querySelector("[data-provider-create]"),
        signin: !!r.querySelector("[data-provider-signin]"),
        visible: r.getClientRects().length > 0,
        text: (r as HTMLElement).innerText.replace(/\s+/g, " ").trim(),
      })),
    within,
  );

async function openSheet(page: Page, path = "/"): Promise<void> {
  await page.goto(path);
  await page.locator("[data-signin-open]").click();
  await expect(page.locator("dialog[data-signin-sheet]")).toHaveAttribute("open", "");
}

test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) => {
    const host = new URL(route.request().url()).hostname;
    if (host === "localhost" || host === "127.0.0.1") void route.continue();
    else void route.abort();
  });
});

test("the registry carries both postures, or this spec proves nothing", () => {
  expect(OPEN.length).toBeGreaterThan(0);
  expect(INVITE.length).toBeGreaterThan(0);
});

test("closed until asked; the header's Sign in opens a native dialog titled for an atmo provider", async ({ page }) => {
  await page.goto("/");
  expect(await page.locator("dialog[data-signin-sheet][open]").count()).toBe(0);
  await page.locator("[data-signin-open]").click();
  const d = page.locator("dialog[data-signin-sheet]");
  await expect(d).toHaveAttribute("open", "");
  await expect(d.locator("h2")).toHaveText("Choose your atmo provider");
  await expect(d.locator("h2 abbr")).toHaveAttribute("title", ATMO_GLOSS);
  await expect(d.locator("p").first()).toContainText("Personal Data Server");
});

test("mock E6.2: the sign-in sheet shows both panels and the create rule in both directions", async ({ page }) => {
  await openSheet(page);
  const front = await rows(page, "dialog[data-signin-sheet] > .signin-list");
  expect(front.map((r) => r.id)).toEqual(OPEN.map((p) => p.id));
  for (const r of front) expect(r.visible && r.create && r.signin, JSON.stringify(r)).toBe(true);
  for (const p of INVITE) expect(front.some((r) => r.id === p.id)).toBe(false);

  const before = await rows(page, ".signin-other");
  expect(before.map((r) => r.id)).toEqual(INVITE.map((p) => p.id));
  expect(before.every((r) => !r.visible)).toBe(true);

  await page.locator("[data-provider-other]").click();
  await expect(page.locator("[data-provider-other]")).toBeHidden();
  const other = await rows(page, ".signin-other");
  for (const r of other) {
    expect(r.visible).toBe(true);
    expect(r.create, `${r.id} is invite-only — a Create would land on a screen demanding a code`).toBe(false);
    expect(r.signin).toBe(true);
    expect(r.text).toMatch(/invite only/i);
  }
  await expect(page.locator("[data-provider-handle]")).toBeFocused();
});

test("fits the narrowest phone: no sideways scroll at 320px and every control ≥44px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await openSheet(page);
  await page.locator("[data-provider-other]").click();
  const fit = await page.evaluate(() => {
    const d = document.querySelector("dialog[data-signin-sheet]") as HTMLElement;
    const small = [...d.querySelectorAll("button, input")]
      .map((b) => {
        const r = b.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return null;
        return r.width < 44 || r.height < 44 ? `${(b as HTMLElement).innerText || (b as HTMLElement).tagName} ${Math.round(r.width)}x${Math.round(r.height)}` : null;
      })
      .filter(Boolean);
    return { scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth, sheetW: Math.round(d.getBoundingClientRect().width), small };
  });
  expect(fit.scrollW).toBeLessThanOrEqual(fit.innerW + 1);
  expect(fit.sheetW).toBeLessThanOrEqual(320);
  expect(fit.small).toEqual([]);
});

for (const skin of ["worlds-light", "worlds-dark"] as const) {
  test(`a11y: the OPEN sheet has no serious/critical violations (${skin})`, async ({ page }) => {
    await page.addInitScript((s) => {
      try {
        localStorage.setItem("fun-skin", s);
      } catch {
        /* private mode */
      }
    }, skin);
    await openSheet(page);
    await page.locator("[data-provider-other]").click();
    const results = await new AxeBuilder({ page }).analyze();
    const blocking = results.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => `${v.id} (${v.impact ?? "?"}) × ${v.nodes.length}`);
    expect(blocking, blocking.join(" · ")).toEqual([]);
  });
}

/** Mock a provider's OAuth discovery and PAR at its own entryway; capture PAR bodies. */
async function mockProvider(page: Page, entryway: string): Promise<{ par: () => URLSearchParams[]; state: () => string | null }> {
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith(entryway)) return route.fallback();
    const host = new URL(url).hostname;
    if (host === "localhost" || host === "127.0.0.1") return route.continue();
    return route.abort();
  });
  const bodies: URLSearchParams[] = [];
  await page.route(`${entryway}/.well-known/oauth-protected-resource`, (route) =>
    route.fulfill({ json: { resource: entryway, authorization_servers: [entryway] } }),
  );
  await page.route(`${entryway}/.well-known/oauth-authorization-server`, (route) =>
    route.fulfill({
      json: {
        issuer: entryway,
        authorization_endpoint: `${entryway}/oauth/authorize`,
        token_endpoint: `${entryway}/oauth/token`,
        pushed_authorization_request_endpoint: `${entryway}/oauth/par`,
      },
    }),
  );
  await page.route(`${entryway}/oauth/par`, (route) => {
    bodies.push(new URLSearchParams(route.request().postData() ?? ""));
    return route.fulfill({ status: 201, json: { request_uri: "urn:req:e2e", expires_in: 60 } });
  });
  // The authorize hop would leave the origin; hold it so the test can read state.
  await page.route(`${entryway}/oauth/authorize**`, (route) => route.fulfill({ status: 200, body: "held" }));
  return { par: () => bodies, state: () => bodies.at(-1)?.get("state") ?? null };
}

for (const p of PROVIDERS) {
  test(`${p.id}: Sign in reaches PAR at ${p.entryway} with no login_hint`, async ({ page }) => {
    const { par } = await mockProvider(page, p.entryway);
    await openSheet(page);
    if (p.signups === "invite") await page.locator("[data-provider-other]").click();
    await page.locator(`[data-provider-row="${p.id}"] [data-provider-signin]`).click();
    await page.waitForURL(`${p.entryway}/oauth/authorize**`);
    expect(par()).toHaveLength(1);
    expect(par()[0]?.has("login_hint")).toBe(false);
  });
}

test("mock E6.3: Create and Sign in are two intents in the PAR", async ({ page }) => {
  const p = OPEN[0]!;
  const { par } = await mockProvider(page, p.entryway);
  await openSheet(page);
  await page.locator(`[data-provider-row="${p.id}"] [data-provider-create]`).click();
  await page.waitForURL(`${p.entryway}/oauth/authorize**`);
  expect(par()).toHaveLength(1);
  expect(par()[0]?.get("prompt")).toBe("create");
  expect(par()[0]?.has("login_hint")).toBe(false);

  await openSheet(page);
  await page.locator(`[data-provider-row="${p.id}"] [data-provider-signin]`).click();
  await page.waitForURL(`${p.entryway}/oauth/authorize**`);
  expect(par()).toHaveLength(2);
  expect(par()[1]?.has("prompt")).toBe(false);
});

test("a handle on any other provider reaches the same seam, leading @ stripped; failure says so", async ({ page }) => {
  await openSheet(page);
  await page.locator("[data-provider-other]").click();
  const seen: string[] = [];
  await page.route("**/xrpc/com.atproto.identity.resolveHandle*", (route) => {
    seen.push(new URL(route.request().url()).searchParams.get("handle") ?? "");
    return route.fulfill({ status: 400, json: { error: "InvalidRequest" } });
  });
  await page.locator("[data-provider-handle]").fill("@someone.zio.blue");
  await page.locator("[data-provider-handle-go]").click();
  await expect(page.locator("[data-signin-status]")).toContainText(/could not start sign-in/i);
  expect(seen).toEqual(["someone.zio.blue"]);
});

test("mock E6.4: sign-in binds the local record to the DID and publishes nothing", async ({ page }) => {
  const p = OPEN[0]!;
  const did = "did:plc:e2eperson";
  const { state } = await mockProvider(page, p.entryway);
  // The authorize hop comes straight back to /signin/ with a code and the PAR's state.
  await page.unroute(`${p.entryway}/oauth/authorize**`);
  // A page that bounces back (WebKit's route.fulfill cannot answer a 302).
  await page.route(`${p.entryway}/oauth/authorize**`, (route) => {
    const back = `http://localhost:${new URL(page.url()).port}/signin/?code=e2e-code&state=${state()}`;
    return route.fulfill({ status: 200, contentType: "text/html", body: `<!doctype html><script>location.replace(${JSON.stringify(back)})</script>` });
  });
  const sent: string[] = [];
  await page.route(`${p.entryway}/oauth/token`, (route) => {
    sent.push(route.request().postData() ?? "");
    return route.fulfill({ json: { access_token: "at-e2e", refresh_token: "rt-e2e", token_type: "DPoP", expires_in: 3600, sub: did, scope: "atproto" } });
  });
  // The person's real PDS, from the DID document; and their handle from the AppView.
  await page.route(`https://plc.directory/${did}`, (route) =>
    route.fulfill({ json: { id: did, service: [{ id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: p.entryway }] } }),
  );
  await page.route("https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile*", (route) =>
    route.fulfill({ json: { did, handle: "alice.test.social" } }),
  );
  const writes: string[] = [];
  await page.route("**/xrpc/com.atproto.repo.*", (route) => {
    writes.push(route.request().url());
    return route.fulfill({ status: 500, body: "must not be called" });
  });

  // A local record exists before sign-in, anonymous.
  await page.goto("/color-sort/?level=1");
  await page.waitForFunction(() => Boolean(window.__colorSort));
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("fun-record-color-sort")!).did)).toBeNull();

  await page.locator("[data-signin-open]").click();
  await page.locator(`[data-provider-row="${p.id}"] [data-provider-signin]`).click();
  await page.waitForURL("**/color-sort/**");
  // Back where the person was, signed in: the header shows them, the record carries the DID.
  await expect(page.locator("[data-signin-who]")).toContainText("alice.test.social");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("fun-record-color-sort")!).did)).toBe(did);
  expect(sent).toHaveLength(1);
  expect(writes).toEqual([]);
  // Sign out forgets the session but keeps the record (it is the person's, locally).
  await page.locator("[data-signin-who]").click();
  await page.locator("[data-signin-out]").click();
  await expect(page.locator("[data-signin-open]")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("fun-signin-session"))).toBeNull();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("fun-record-color-sort")!).did)).toBe(did);
});
