import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import { formatLintConfig, formatModuleGlobs } from './eslint-rule';

const root = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..');

const lint = async (code: string, file: string) => {
  const eslint = new ESLint({
    cwd: root,
    overrideConfigFile: true,
    overrideConfig: [formatLintConfig],
  });
  const [res] = await eslint.lintText(code, { filePath: path.join(root, file) });
  return res?.messages.map((m) => m.ruleId).filter((r) => r !== null) ?? [];
};

describe('format lint rule: formatting is the only presentation transform', () => {
  const web = 'tier1-presentation/web/src/x.ts';

  it('flags toFixed, Intl and toLocaleString in web code', async () => {
    expect(await lint('export const a = (1).toFixed(1);', web)).toContain('no-restricted-syntax');
    expect(await lint('export const a = new Intl.NumberFormat("en-US");', web)).toContain(
      'no-restricted-syntax',
    );
    expect(await lint('export const a = (1).toLocaleString();', web)).toContain(
      'no-restricted-syntax',
    );
    expect(await lint('export const a = x["toFixed"](1);', web)).toContain('no-restricted-syntax');
  });

  it('flags the same calls in ui code outside the format module', async () => {
    expect(
      await lint('export const a = (1).toFixed(1);', 'tier1-presentation/ui/src/charts/x.ts'),
    ).toContain('no-restricted-syntax');
  });

  it('allows ordinary code, and the format module itself', async () => {
    expect(await lint('export const a = Math.round(1.2);', web)).toEqual([]);
    expect(formatModuleGlobs).toContain('tier1-presentation/ui/src/format/**');
    expect(formatLintConfig.ignores).toContain('tier1-presentation/ui/src/format/**');
    expect(
      await lint('export const a = (1).toFixed(1);', 'tier1-presentation/ui/src/format/x.ts'),
    ).toEqual([]);
  });
});
