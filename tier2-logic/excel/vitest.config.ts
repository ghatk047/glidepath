import { defineConfig } from 'vitest/config';

// G2 (docs/architecture/08_quality_and_testing.md): excel keeps >= 90% line coverage.
export default defineConfig({
  test: {
    // Tests build and parse whole workbooks; under a parallel run the default 5 s is too tight.
    testTimeout: 60_000,
    hookTimeout: 120_000,
    coverage: {
      enabled: true,
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/test-support/**', 'src/types.ts'],
      reporter: ['text-summary'],
      thresholds: { lines: 90 },
    },
  },
});
