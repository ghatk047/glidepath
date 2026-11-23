// tier2-logic/domain is pure (CLAUDE.md rule 5, ADR-019): src imports no IO module and touches no
// IO global. Persistence goes through the ports in src/ports.ts, implemented in data-access.
// Tests (*.test.ts) and src/test-support/ may read spec files from disk.
import { builtinModules } from 'node:module';
import root from '../../eslint.config.js';

const message =
  'tier2-logic/domain is pure (ADR-019): do IO in data-access behind a port (src/ports.ts).';

/** Node builtins (fs, net, http, child_process, ...), with and without the node: prefix. */
const builtins = builtinModules.filter((m) => !m.startsWith('_'));

/** Packages that open connections, files, sockets or processes, and the IO packages of this repo. */
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
  'exceljs',
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
      'no-restricted-syntax': [
        'error',
        { selector: 'ImportExpression', message: `No dynamic import. ${message}` },
      ],
    },
  },
];
