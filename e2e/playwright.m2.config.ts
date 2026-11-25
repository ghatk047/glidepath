import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/**
 * The M2 integration spec (INT-03) against the same stack as the G9 smoke, with its own run: it
 * reloads the page, walks the whole global layer and writes the status note's screenshots, so it
 * does not belong inside the G9 budget (`playwright.config.ts` leaves it out).
 * Run: `pnpm int:m2 -- --trace off`.
 */

/** Budget of the M2 run; generous, it is a milestone check and not a merge gate. */
export const M2_BUDGET_MS = 420_000;

/** Where the status note's screenshots land, under the repo root. */
export const SHOTS = ['docs', 'status', 'assets'] as const;

export default defineConfig({
  ...base,
  testIgnore: [],
  testMatch: ['m2.spec.ts'],
  globalTimeout: M2_BUDGET_MS,
});
