import { defineConfig } from '@playwright/test';
import { config } from '@glidepath/int';

/**
 * Perf monitors (QA-08): the same stack, sign-in and browser set-up as the smoke
 * (`playwright.config.ts`), measuring instead of asserting behaviour. `pnpm e2e:perf`.
 * `--device` (see `perf.mjs`) runs the same specs headed on the demo machine.
 */
export default defineConfig({
  testDir: 'perf',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  globalTimeout: 300_000,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: config.baseUrl,
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 },
    trace: 'off',
    headless: process.env.GP_PERF_DEVICE !== '1',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
