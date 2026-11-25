/**
 * ESLint flat-config fragment: number formatting (toFixed, toLocaleString, Intl) is allowed only
 * inside the format module. Spread `formatLintConfig` into the web/ui lint config.
 * Plain data, no imports, so any eslint.config.js can load it.
 */
export const formatModuleGlobs = ['tier1-presentation/ui/src/format/**'];

const message = 'Number formatting lives in tier1-presentation/ui/src/format (use fmt.*).';

export const formatLintConfig = {
  files: ['tier1-presentation/**/*.{ts,tsx,js,jsx}'],
  ignores: formatModuleGlobs,
  rules: {
    'no-restricted-syntax': [
      'error' as const,
      {
        selector:
          "MemberExpression[property.name=/^(toFixed|toLocaleString|toPrecision)$/], MemberExpression[computed=true][property.value=/^(toFixed|toLocaleString|toPrecision)$/]",
        message,
      },
      { selector: "Identifier[name='Intl']", message },
    ] as ['error', ...{ selector: string; message: string }[]],
  },
};
