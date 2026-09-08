//! Flip a settings toggle the way its value changes, not the way a finger lands:
//! a DOM click on the checkbox itself, from inside the page. The checkbox is a
//! 1px hidden input; a Playwright click on it (even forced) still scrolls it
//! into view and fails past a sheet's fold, and a click on its visible track
//! loses to a sheet re-rendering the row under the pointer — both observed on
//! CI's WebKit on 2026-09-08, on different rows each run. A click dispatched in
//! the page needs neither layout nor stillness, and it toggles through the same
//! change event the row's onChange listens to.

import type { Page } from "@playwright/test";

/** `scope` is where the row lives (`.gf-sheet` on a phone, `.gf-extra` in the rail). */
export async function flipToggle(page: Page, scope: string, id: string): Promise<void> {
  const input = page.locator(`${scope} [data-setting="${id}"] .sheet-toggle-input`).first();
  await input.waitFor({ state: "attached" });
  await input.evaluate((el) => (el as HTMLInputElement).click());
}
