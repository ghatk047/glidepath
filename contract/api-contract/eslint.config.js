import root from '../../eslint.config.js';

/**
 * G13 boundary for the contract: it is shared by tier 1 and tier 2, so it may import zod and
 * its own files only, never tier 2 or tier 3 code or any other workspace package.
 */
export default [
  ...root,
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/tier2-logic/**', '**/tier3-data/**', 'tier2-logic/**', 'tier3-data/**'],
              message: 'contract/api-contract must not import tier 2 or tier 3 code (G13).',
            },
            {
              group: ['@glidepath/*', '!@glidepath/api-contract'],
              message: 'contract/api-contract imports only zod (G13).',
            },
          ],
        },
      ],
    },
  },
];
