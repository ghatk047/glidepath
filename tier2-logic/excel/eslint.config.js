// tier2-logic/excel is pure (CLAUDE.md rule 5): src imports no IO module and touches no IO global.
// ExcelJS is allowed (it works on buffers); callers pass buffers in and take buffers out.
// Tests (*.test.ts) may read spec files from disk.
import { builtinModules } from 'node:module';
import root from '../../eslint.config.js';

const message =
  'tier2-logic/excel is pure: read files and talk to the database in the caller (worker, data-access).';

const builtins = builtinModules.filter((m) => !m.startsWith('_'));

const ioPackages = [
  'pg',
  'postgres',
  'drizzle-orm',
  'pg-boss',
  'ws',
  'hono',
  'undici',
  'axios',
  'node-fetch',
  'minio',
  '@glidepath/data-access',
  '@glidepath/server',
  '@glidepath/worker',
  '@glidepath/spec/node',
];

const ioGlobals = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'process', 'require'];

export default [
  ...root,
  {
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.test.ts', 'src/test-support/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [...builtins, ...ioPackages].map((name) => ({ name, message })),
          patterns: [
            { group: ['node:*', 'drizzle-orm/*', 'hono/*', '@aws-sdk/*', 'pg-*'], message },
          ],
        },
      ],
      'no-restricted-globals': ['error', ...ioGlobals.map((name) => ({ name, message }))],
    },
  },
];
