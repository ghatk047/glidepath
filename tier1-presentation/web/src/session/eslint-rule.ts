/**
 * ESLint flat-config fragment (WEB-03, 07 §3): the session module that handles values received
 * from tier 2 does no arithmetic on them. It copies, compares and keys; tier 2 computes.
 * Plain data, no imports, so any eslint.config.js can load it (like `ui/src/format/eslint-rule.ts`).
 *
 * `noArithmeticRules` are `no-restricted-syntax` entries: a config that already sets
 * `no-restricted-syntax` for these files must append them (flat config replaces, not merges).
 */
export const receivedValueFiles = ['tier1-presentation/web/src/session/state.ts'];

const message =
  'No arithmetic on values received from tier 2 (07 §3): copy, compare and key only; tier 2 computes.';

const arithmeticOperators = ['+', '-', '*', '/', '%', '**', '<<', '>>', '>>>', '&', '|', '^'];

const selectors = [
  ...arithmeticOperators.map((op) => `BinaryExpression[operator="${op}"]`),
  ...arithmeticOperators.map((op) => `AssignmentExpression[operator="${op}="]`),
  'UpdateExpression',
  'UnaryExpression[operator="-"]',
  'UnaryExpression[operator="+"]',
  'UnaryExpression[operator="~"]',
  "MemberExpression[object.name='Math']",
  'CallExpression[callee.name=/^(Number|parseFloat|parseInt)$/]',
];

export const noArithmeticRules = selectors.map((selector) => ({ selector, message }));

export const noArithmeticLintConfig = {
  files: receivedValueFiles,
  rules: {
    'no-restricted-syntax': ['error' as const, ...noArithmeticRules] as [
      'error',
      ...{ selector: string; message: string }[],
    ],
  },
};
