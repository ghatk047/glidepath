import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/**
 * The M3 integration storyline subset (INT-04): the demo storyline's beats 0:00–18:00
 * (`docs/ux/05_demo_storyline.md`, Airlines at 19:30 is M4) against the same stack as the G9
 * smoke, with its own run and budget. The full G10 storyline (QA-05) replaces it once merged.
 * Run: `pnpm int:m3 -- --trace off`.
 */

/** Budget of the M3 run; a milestone check, not a merge gate (the Path and Monte Carlo jobs run). */
export const M3_BUDGET_MS = 600_000;

export default defineConfig({
  ...base,
  testIgnore: [],
  testMatch: ['int-m3.spec.ts'],
  globalTimeout: M3_BUDGET_MS,
  // one beat may wait on a solver job (min-risk path, Monte Carlo) on a loaded machine
  timeout: 240_000,
});
