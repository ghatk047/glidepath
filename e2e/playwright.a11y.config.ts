import { defineConfig } from '@playwright/test';
import { config } from '@glidepath/int';

/**
 * Accessibility checks (QA-07, G12): the same stack, sign-in and browser set-up as the smoke
 * (`playwright.config.ts`). axe-core on every module in both themes, Lighthouse accessibility on
 * Cockpit / Levers / Path, and the keyboard paths. `pnpm e2e:a11y -- --trace off`.
 *
 * `GP_A11Y_CHROMIUM` names the Chromium that Lighthouse's browser runs (default: Playwright's own).
 */
export default defineConfig({
  testDir: 'a11y',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  globalTimeout: 900_000,
  timeout: 120_000,
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
