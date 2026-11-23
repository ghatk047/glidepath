import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';
import {
  formatLintConfig,
  formatModuleGlobs,
} from '../../../tier1-presentation/ui/src/format/eslint-rule.ts';

/**
 * Shared ESLint flat config (FND-02). Spec: docs/architecture/02_repo_and_conventions.md §1, §3;
 * 06 §1 (airline strings); 08 §1 (G1 lint, G13 tier separation).
 *
 * Paths are relative to the repo root (the directory of the root eslint.config.js).
 */

export const SOURCE_GLOB = '**/*.{ts,tsx,js,jsx}';
export const TEST_GLOBS = ['**/*.test.*', '**/*.spec.*', '**/test/**', '**/tests/**'];

/** Dependency rules of 02 §1: package -> allowed target packages (own package always allowed). */
export const dependencyMatrix = {
  'tier1-ui': ['contract'],
  'tier1-web': ['contract', 'tier1-ui'],
  contract: [],
  server: ['contract', 'domain', 'engine', 'solvers', 'excel', 'ai', 'data-access', 'spec'],
  worker: ['contract', 'domain', 'engine', 'solvers', 'excel', 'ai', 'data-access', 'spec'],
  spec: [],
  engine: ['spec'],
  solvers: ['engine', 'spec'],
  domain: ['spec', 'engine'],
  excel: ['domain', 'engine', 'spec'],
  ai: ['domain', 'engine', 'spec'],
  'data-access': ['spec', 'domain'],
};

const elements = [
  { type: 'tier1-ui', pattern: 'tier1-presentation/ui' },
  { type: 'tier1-web', pattern: 'tier1-presentation/web' },
  { type: 'contract', pattern: 'contract/api-contract' },
  ...Object.keys(dependencyMatrix)
    .filter((t) => !t.startsWith('tier1-') && t !== 'contract')
    .map((type) => ({ type, pattern: `tier2-logic/${type}` })),
  { type: 'tier3', pattern: 'tier3-data' },
];

/** Banned database drivers outside tier2-logic/data-access. */
export const dbPackages = ['pg', 'pg-*', 'pg/*', 'drizzle-orm', 'drizzle-orm/*', 'drizzle-kit'];

export const airlineWords = ['AA', 'American', 'Sabre', 'DXC', 'Hyderabad'];
export const airlineExemptGlobs = [
  '**/seed/**',
  '**/seeds/**',
  '**/fixtures/**',
  '**/__fixtures__/**',
  'docs/**',
  // The rule definitions themselves, and the spec package's seed-reader tests (they name the seed tenant).
  'tools/eslint-config/src/**',
  'tier2-logic/spec/**/*.test.ts',
];

const airlineRe = `\\b(${airlineWords.join('|')})\\b`;
const airlineRule = {
  selector: `Literal[value=/${airlineRe}/], TemplateElement[value.raw=/${airlineRe}/]`,
  message: `Airline names (${airlineWords.join(', ')}) may appear only in seed/, fixtures and docs (06 §1).`,
};

const hexRe = '#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\\b';
const colourPxRules = [
  {
    selector: `Literal[value=/${hexRe}/], TemplateElement[value.raw=/${hexRe}/]`,
    message: 'No hex colours in tier 1 outside ui/src/tokens: use design tokens.',
  },
  {
    selector: 'Literal[value=/\\d(px)\\b/], TemplateElement[value.raw=/\\d(px)\\b/]',
    message: 'No raw px literals in tier 1 outside ui/src/tokens: use design tokens.',
  },
];

/** The existing format rule: toFixed / toLocaleString / Intl only inside the format module. */
const formatRules = formatLintConfig.rules['no-restricted-syntax'].slice(1);

const syntax = (...rules) => ['error', ...rules.flat()];

/**
 * @param {{ magicNumberAllow?: number[] }} [options]
 */
export function createConfig(options = {}) {
  const allow = options.magicNumberAllow ?? [0, 1, -1];
  const tier1 = 'tier1-presentation/**/*.{ts,tsx,js,jsx}';
  const tokens = 'tier1-presentation/ui/src/tokens/**';
  const tier1Tests = TEST_GLOBS.map((g) => `tier1-presentation/${g}`);
  const core = ['engine', 'solvers', 'domain', 'excel'].map(
    (p) => `tier2-logic/${p}/**/*.{ts,tsx,js,jsx}`,
  );

  const policies = Object.entries(dependencyMatrix).map(([from, to]) => ({
    from: { element: { type: from } },
    allow: { to: { element: { types: [from, ...to] } } },
  }));

  return [
    { ignores: ['**/node_modules/**', '**/dist/**', '**/.turbo/**', '**/fixtures/**'] },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
      files: [SOURCE_GLOB],
      plugins: { boundaries },
      settings: {
        'boundaries/elements': elements,
        'import/resolver': { typescript: { alwaysTryTypes: true } },
      },
      rules: {
        'boundaries/dependencies': ['error', { default: 'disallow', policies }],
        'no-restricted-syntax': syntax(airlineRule),
      },
    },
    // Database drivers: data-access only.
    {
      files: [tier1, 'tier2-logic/**/*.{ts,tsx,js,jsx}', 'contract/**/*.ts'],
      ignores: ['tier2-logic/data-access/**'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: dbPackages,
                message: 'Only tier2-logic/data-access may import pg or drizzle (G13).',
              },
            ],
          },
        ],
      },
    },
    // Tier 1: format module restrictions; no hex colours or raw px outside tokens.
    {
      files: [tier1],
      ignores: [...formatModuleGlobs, tokens, ...tier1Tests],
      rules: { 'no-restricted-syntax': syntax(airlineRule, formatRules, colourPxRules) },
    },
    {
      files: [tokens],
      ignores: formatModuleGlobs,
      rules: { 'no-restricted-syntax': syntax(airlineRule, formatRules) },
    },
    {
      files: formatModuleGlobs,
      ignores: tier1Tests,
      rules: { 'no-restricted-syntax': syntax(airlineRule, colourPxRules) },
    },
    {
      files: tier1Tests,
      ignores: formatModuleGlobs,
      rules: { 'no-restricted-syntax': syntax(airlineRule, formatRules) },
    },
    // Magic numbers in the pure core, not in tests.
    {
      files: core,
      ignores: TEST_GLOBS,
      rules: {
        'no-magic-numbers': [
          'error',
          { ignore: allow, ignoreArrayIndexes: true, enforceConst: true },
        ],
      },
    },
    // Airline strings are allowed in seeds, fixtures and docs.
    {
      files: airlineExemptGlobs,
      rules: { 'no-restricted-syntax': 'off' },
    },
  ];
}

export default createConfig();
