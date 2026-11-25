import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/**
 * The Build wizard and the walkthrough tour (WIZ-11, `docs/ux/07_wizard_tour_plan.md` §7.2): the specs
 * `wizard.spec.ts` and `tour.spec.ts` against the same stack as the G9 smoke, in a run of their own
 * (`playwright.config.ts` leaves them out so the smoke keeps its 180 s budget). They run a solver job
 * and walk 14 tour steps across the screens.
 * Run: `pnpm e2e:wizard -- --trace off`.
 */

/** Budget of the whole wizard and tour run. */
export const WIZARD_BUDGET_MS = 420_000;

export default defineConfig({
  ...base,
  testIgnore: [],
  testMatch: ['wizard.spec.ts', 'tour.spec.ts'],
  globalTimeout: WIZARD_BUDGET_MS,
  // a solver run is in here
  timeout: 120_000,
});
