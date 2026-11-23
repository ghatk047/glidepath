import { defineConfig } from '@playwright/test';
import { config } from '@glidepath/int';

/** G9 budget (QA-04): the whole smoke run finishes in under three minutes. */
export const BUDGET_MS = 180_000;

/**
 * E2E smoke (G9): Playwright against the running compose stack, reached through `web` (Caddy) at
 * `PUBLIC_BASE_URL` like a browser. Settings are the INT settings (`tools/int/src/stack.ts`).
 * Caddy's `tls internal` certificate is not in the browser's trust store, hence ignoreHTTPSErrors.
 * Run: `pnpm e2e -- --trace off`.
 */
export default defineConfig({
  testDir: 'tests',
  // The M2 integration spec (INT-03) runs on its own budget: `playwright.m2.config.ts`.
  testIgnore: ['m2.spec.ts'],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  globalTimeout: BUDGET_MS,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: config.baseUrl,
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 },
    trace: 'off',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
