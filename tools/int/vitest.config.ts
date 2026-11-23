import { defineConfig } from 'vitest/config';

/**
 * Integration specs run against a running compose stack, so they are not part of the unit run
 * (`turbo run test` has no stack): the package has no `test` script, only `m1` (root `pnpm int:m1`).
 */
export default defineConfig({
  test: {
    include: ['*.spec.ts'],
    setupFiles: ['src/setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // One stack, one seeded tenant: the steps of a spec run in order, one file at a time.
    fileParallelism: false,
  },
});
