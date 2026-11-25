// The YAML fallback must interpolate like Compose for the compose-config assertions to hold.
import { describe, expect, it } from 'vitest';
import {
  expandEnv,
  interpolate,
  interpolatedVariables,
  packageName,
  parseEnvFile,
} from '../src/index';

describe('ops helpers', () => {
  it('exports its package name', () => {
    expect(packageName).toBe('@glidepath/ops');
  });

  const env = new Map([
    ['SET', 'v'],
    ['EMPTY', ''],
  ]);

  it.each([
    ['${SET}', 'v'],
    ['${UNSET}', ''],
    ['${EMPTY:-d}', 'd'],
    ['${EMPTY-d}', ''],
    ['${UNSET-d}', 'd'],
    ['${SET:-d}', 'v'],
    ['${UNSET:-${SET}}', 'v'],
    ['${SET:+alt}', 'alt'],
    ['${EMPTY:+alt}', ''],
    ['$${SET}', '${SET}'],
    ['a:${SET:?x}:b', 'a:v:b'],
  ])('interpolates %s -> %s', (input, out) => {
    expect(interpolate(input, env)).toBe(out);
  });

  it('throws like Compose on a missing required variable', () => {
    expect(() => interpolate('${EMPTY:?set it}', env)).toThrow(/EMPTY is missing a value: set it/);
    expect(interpolate('${EMPTY?set it}', env)).toBe('');
  });

  it('expands env files in order and ignores comments', () => {
    const e = expandEnv(parseEnvFile('# c\nP=abc\nURL=x://u:${P}@h\n\nQ=\n'));
    expect(e.get('URL')).toBe('x://u:abc@h');
    expect(e.get('Q')).toBe('');
  });

  it('lists interpolated variable names, skipping $$ escapes', () => {
    expect(interpolatedVariables('a: ${A:-x}\nb: $${B}\nc: ${C:?m} ${A}')).toEqual(['A', 'C']);
  });
});
