import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/**
 * Desktop fit audit (UIX-01): every module at 1280x720 and 1920x1080, the presenter's two screens.
 * Each screen is captured (viewport and full page, into `DESKTOP_SHOTS_DIR`, default
 * `desktop-shots/`, git-ignored) and checked for text that spills out of its panel and for
 * horizontal page scroll. Run: `pnpm e2e:desktop -- --trace off`.
 */
export default defineConfig({
  ...base,
  testDir: 'desktop',
  testIgnore: [],
  testMatch: ['desktop.spec.ts'],
  globalTimeout: 420_000,
  timeout: 90_000,
});
