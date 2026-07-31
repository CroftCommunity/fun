//! The Tier-2 honest-representation banner. A wrapped game carries no verifiable
//! outcome record (unlike every Tier-1 Croft-native game), so the shelf states
//! that plainly and credits the upstream work. Pure DOM: given a catalog entry,
//! it returns the banner element for a Tier-2 game or `null` for anything else.
//! The chrome prepends the result above the play area; there is no styling or
//! layout logic here beyond class names the shared stylesheet owns.

import type { GameEntry } from "./contract.js";

/**
 * Build the "wrapped game · no verifiable record" banner for a Tier-2 entry, or
 * return `null` for a Tier-1 (verifiable) entry. The banner names the upstream
 * author + license and links to the source; the link opens in a new tab safely.
 */
export function wrappedBanner(entry: GameEntry): HTMLElement | null {
  if (entry.tier !== 2) return null;
  const { author, license, upstreamUrl, basedOn } = entry.attribution;

  const banner = document.createElement("aside");
  banner.className = "wrapped-banner";
  banner.setAttribute("role", "note");
  banner.setAttribute(
    "aria-label",
    `${entry.title}: a wrapped game by ${author}, included with no verifiable record`,
  );

  // The honest posture first: this is not one of our verifiable games.
  const claim = document.createElement("p");
  claim.className = "wrapped-banner-claim";
  claim.textContent = "Wrapped game — no verifiable record.";
  banner.append(claim);

  // Then a genuine acknowledgment of the people whose work this is: we credit
  // the developer, note what it descends from, and link to the original —
  // consistently, for every Tier-2 game (this is shared code).
  const credit = document.createElement("p");
  credit.className = "wrapped-banner-credit";
  const homage = basedOn ? `, a homage to ${basedOn},` : "";
  credit.append(`${entry.title} was created by ${author}${homage} and is included here as-is, with thanks. Released under ${license}. `);
  const link = document.createElement("a");
  link.href = upstreamUrl;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "View the original ↗";
  credit.append(link);
  banner.append(credit);

  return banner;
}
