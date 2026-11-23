import { defineConfig } from 'vitest/config';

// G2 (docs/architecture/08_quality_and_testing.md): excel keeps >= 90% line coverage.
export default defineConfig({
  test: {
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
