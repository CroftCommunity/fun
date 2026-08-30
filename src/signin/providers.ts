//! The sign-in sheet's provider registry — croft-pwa docs/DESIGN.md § Flows ›
//! Sign in, ported (plan D8). A Croft app has no accounts of its own; every
//! identity belongs to a server someone else runs, and the sheet's job is to
//! route you to one — a list of real providers with visibly different rules,
//! not a single "Sign in with Bluesky" button.
//!
//! EVERY FACT BELOW WAS PROBED, not inferred (forage 2026-08-26..29; re-probed by
//! croft-pwa tests/live/signin-providers.live.spec.ts):
//!   - signup posture: com.atproto.server.describeServer → inviteCodeRequired
//!   - OAuth support:  /.well-known/oauth-authorization-server
//!   - prompt=create:  advertised in prompt_values_supported; the open ones were
//!                     observed landing in the registration wizard.
//! Wrong first guesses, recorded so they are not repeated: `blacksky.community`
//! is not a PDS (the host is `blacksky.app`); `eurosky.tech` / `portal.eurosky.tech`
//! are EuroSky's site and portal, the PDS is `eurosky.social`; `mu.social` is a
//! Mastodon server; `muni.town` is not a PDS.

import registry from "./providers.json" with { type: "json" };

export const SIGNUP = { OPEN: "open", INVITE: "invite" } as const;
export type Signup = (typeof SIGNUP)[keyof typeof SIGNUP];

export interface Provider {
  readonly id: string;
  readonly label: string;
  /** The https origin OAuth starts at when this provider is chosen. */
  readonly entryway: string;
  readonly signups: Signup;
}

/** The owner's word for a home on the open social Atmosphere, glossed verbatim. */
export const ATMO_GLOSS = "A Personal Data Server provider in the open social Atmosphere";

/** The front page is capped; everything else reaches the same seam through "Another provider". */
export const FEATURED_CAP = 4;

/** The split between the two panels is POSTURE, not position in the list. */
export function featuredProviders(list: readonly Provider[] = PROVIDERS): readonly Provider[] {
  return list.filter((p) => p.signups === SIGNUP.OPEN).slice(0, FEATURED_CAP);
}

export function otherProviders(list: readonly Provider[] = PROVIDERS): readonly Provider[] {
  return list.filter((p) => p.signups === SIGNUP.INVITE);
}

export function providerById(id: string, list: readonly Provider[] = PROVIDERS): Provider {
  const p = list.find((x) => x.id === id);
  if (!p) throw new Error(`unknown provider: ${id} (known: ${list.map((x) => x.id).join(", ")})`);
  return p;
}

/** An invite-only provider still ADVERTISES prompt=create; the posture decides, not the capability. */
export function canCreateAccount(p: Provider): boolean {
  return p.signups === SIGNUP.OPEN;
}

/** Bad registry data is silent breakage. Validate loudly, at import. */
export function validateProviders(list: readonly Provider[]): readonly Provider[] {
  const seen = new Set<string>();
  const postures: readonly string[] = Object.values(SIGNUP);
  for (const p of list) {
    if (!p.id) throw new Error(`provider without an id: ${JSON.stringify(p)}`);
    if (!/^https:\/\//.test(p.entryway)) throw new Error(`provider ${p.id}: entryway must be an https origin (got ${p.entryway})`);
    if (!p.label) throw new Error(`provider ${p.id}: needs a human label`);
    if (!postures.includes(p.signups)) {
      throw new Error(`provider ${p.id}: unknown signup posture '${String(p.signups)}' (expected ${postures.join(" or ")})`);
    }
    if (seen.has(p.entryway)) throw new Error(`two providers share the entryway ${p.entryway} — one server, two ids, is a bug`);
    seen.add(p.entryway);
  }
  return list;
}

export const PROVIDERS: readonly Provider[] = validateProviders(
  Object.freeze((registry as { providers: readonly Provider[] }).providers),
);
