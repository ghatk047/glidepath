// tier2-logic/ai pipeline steps (src/steps) take the ModelClient as a port and do no other IO (AI-03): no Node
// builtins, no network or database packages, no IO globals, no dynamic import, no value import of the Anthropic SDK
// (types only), and none of this package's IO modules (the concrete client, audit sink, env config, retry timer,
// test support). The worker wires the real client in; tests pass one on a scripted transport.
import { builtinModules } from 'node:module';
import root from '../../eslint.config.js';
import { airlineWords } from '../../tools/eslint-config/src/index.js';

const message = 'Pipeline steps take the ModelClient as a port and do no other IO (AI-03).';

/** Node builtins (fs, net, http, child_process, ...), with and without the node: prefix. */
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

/** This package's modules that do IO or build the concrete client. */
const ioModules = '(^|/)(client|audit|config|retry)$|(^|/)testing(/|$)';

// The shared airline-name rule (06 §1) is a no-restricted-syntax rule too: keep it next to the dynamic-import ban.
const airlineRe = `\\b(${airlineWords.join('|')})\\b`;
const airlineRule = {
  selector: `Literal[value=/${airlineRe}/], TemplateElement[value.raw=/${airlineRe}/]`,
  message: `Airline names (${airlineWords.join(', ')}) may appear only in seed/, fixtures and docs (06 §1).`,
};

const ioGlobals = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'process', 'require'];

export default [
  ...root,
  {
    files: ['src/steps/**/*.ts'],
    ignores: ['src/steps/**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [...builtins, ...ioPackages].map((name) => ({ name, message })),
          patterns: [
            { group: ['node:*', 'drizzle-orm/*', 'hono/*', '@aws-sdk/*', 'pg-*'], message },
            { regex: '^@anthropic-ai/sdk(/|$)', allowTypeImports: true, message: `Type imports only. ${message}` },
            { regex: ioModules, message },
          ],
        },
      ],
      'no-restricted-globals': ['error', ...ioGlobals.map((name) => ({ name, message }))],
      'no-restricted-syntax': [
        'error',
        airlineRule,
        { selector: 'ImportExpression', message: `No dynamic import. ${message}` },
      ],
    },
  },
];
