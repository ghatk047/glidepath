import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import { noArithmeticLintConfig, receivedValueFiles } from './eslint-rule';

const root = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..');
const stateFile = 'tier1-presentation/web/src/session/state.ts';

const eslint = () =>
  new ESLint({
    cwd: root,
    overrideConfigFile: true,
    overrideConfig: [
      { files: ['**/*.ts'], languageOptions: { parser: tseslint.parser } },
      noArithmeticLintConfig,
    ],
  });

const lint = async (code: string, file = stateFile) => {
  const [res] = await eslint().lintText(code, { filePath: path.join(root, file) });
  return res?.messages.map((m) => m.ruleId).filter((r) => r !== null) ?? [];
};

describe('AC5: no arithmetic on received values (lint rule)', () => {
  it('flags arithmetic, Math and number coercion in the modules that handle received values', async () => {
    for (const code of [
      'export const f = (v: number) => v * 2;',
      'export const f = (a: number, b: number) => a + b;',
      'export const f = (a: number, b: number) => a - b;',
      'export const f = (a: number, b: number) => a / b;',
      'export const f = (a: number) => a % 2;',
      'export const f = (a: number) => a ** 2;',
      'export const f = (a: number) => a | 0;',
      'export const f = (a: number) => -a;',
      'export const f = (a: number) => +a;',
      'export function f(a: number) { a += 1; return a; }',
      'export function f(a: number) { a++; return a; }',
      'export const f = (a: number) => Math.round(a);',
      'export const f = (a: string) => Number(a);',
      'export const f = (a: string) => parseFloat(a);',
    ]) {
      expect(await lint(code), code).toContain('no-restricted-syntax');
    }
  });

  it('allows copying, comparing and template keys', async () => {
    expect(
      await lint(
        'export const f = (a: number, b: number, k: string) => ({ [`${k}?`]: a >= b ? a : b, same: a === b });',
      ),
    ).toEqual([]);
  });

  it('the session state module passes the rule', async () => {
    expect(receivedValueFiles).toContain(stateFile);
    const results = await eslint().lintFiles(receivedValueFiles.map((f) => path.join(root, f)));
    expect(
      results.flatMap((r) => r.messages.map((m) => `${r.filePath}:${m.line} ${m.message}`)),
    ).toEqual([]);
  });
});
