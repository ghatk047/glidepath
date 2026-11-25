// tier2-logic/data-access: every query is parameterised (DATA-05). Values reach Postgres as bind
// parameters of the drizzle `sql` tag or the query builder, never concatenated into SQL text.
// Runtime code (src, not tests or src/testing) may therefore not:
//   - pass anything but a sql`...` template to `.execute(...)` (no strings, no template literals);
//   - call `sql.raw(...)` with anything but a string literal;
//   - call node-postgres `.query(...)` (drizzle only), except the migration runner, which executes
//     migration files verbatim (DDL, no runtime values; src/migrate.ts).
import root from '../../eslint.config.js';

export const message =
  'data-access: build SQL with the drizzle sql`...` tag or the query builder so every value is a bind parameter; no string-built SQL (DATA-05).';

export const sqlSafetySelectors = [
  "CallExpression[callee.property.name='execute'][arguments.length>0]:not([arguments.0.type='TaggedTemplateExpression'][arguments.0.tag.name='sql'])",
  "CallExpression[callee.object.name='sql'][callee.property.name='raw']:not([arguments.0.type='Literal'])",
  "CallExpression[callee.property.name='query']",
];

/** The root config's no-restricted-syntax entries for every source file (airline names): kept. */
const rootSyntax =
  root.find((c) => c.files?.includes('**/*.{ts,tsx,js,jsx}') && c.rules?.['no-restricted-syntax'])?.rules[
    'no-restricted-syntax'
  ].slice(1) ?? [];

export default [
  ...root,
  {
    files: ['src/**/*.ts'],
    ignores: ['src/**/*.test.ts', 'src/testing/**', 'src/migrate.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...rootSyntax, ...sqlSafetySelectors.map((selector) => ({ selector, message }))],
    },
  },
];
