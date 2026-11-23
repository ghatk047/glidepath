import { defineConfig } from 'vitest/config';

/** Unit tests of the helpers only; the Playwright specs in `tests/` need a running stack. */
export default defineConfig({ test: { include: ['src/**/*.test.ts'] } });
