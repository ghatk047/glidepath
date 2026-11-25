import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/**
 * The demo storyline (QA-05, gate G10): the 11 beats of `docs/ux/05_demo_storyline.md` "Run of show"
 * and the "Ready for questions" moves, against the same stack as the G9 smoke, in a run of its own
 * (nightly and before the freeze): it solves a path, exports and re-imports a workbook, and edits
 * through every module, so it does not belong in the G9 budget (`playwright.config.ts` leaves it out).
 * Run: `pnpm e2e:storyline -- --trace off`.
 */

/** Budget of the whole storyline run; the demo itself is 20 minutes, the test should be far shorter. */
export const STORYLINE_BUDGET_MS = 600_000;

export default defineConfig({
  ...base,
  testIgnore: [],
  testMatch: ['storyline.spec.ts', 'storyline-wizard.spec.ts'],
  globalTimeout: STORYLINE_BUDGET_MS,
  // a solver run and a workbook round trip are in here
  timeout: 120_000,
});
