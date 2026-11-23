import { defineConfig } from '@playwright/test';
import { config } from '@glidepath/int';
import { DEVICE_SCALE_FACTOR, MAX_DIFF_PIXELS, PIXEL_THRESHOLD } from './src/visual';

/**
 * Visual baselines (QA-06, G11): every module in both themes at 1440 and 390 px, compared with the
 * approved baselines at a pixel threshold. Same stack, sign-in and browser set-up as the smoke.
 * `pnpm e2e:visual -- --trace off` compares; `pnpm e2e:visual -- --update` approves (see `visual.mjs`).
 * Baselines are per platform: `visual/baselines/chromium-<platform>/<module>-<theme>-<width>.png`.
 */
export default defineConfig({
  testDir: 'visual',
  snapshotDir: 'visual/baselines',
  snapshotPathTemplate: '{snapshotDir}/{projectName}-{platform}/{arg}{ext}',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  globalTimeout: 600_000,
  timeout: 90_000,
  expect: {
    timeout: 15_000,
    toHaveScreenshot: {
      threshold: PIXEL_THRESHOLD,
      maxDiffPixels: MAX_DIFF_PIXELS,
      animations: 'disabled',
      caret: 'hide',
      // device pixels (2x), like the UX pack's renders; the default 'css' would write 1x files
      scale: 'device',
    },
  },
  reporter: [['list']],
  use: {
    baseURL: config.baseUrl,
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: DEVICE_SCALE_FACTOR,
    trace: 'off',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
