import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { specBundle } from '@glidepath/testkit';
import { afterEach, describe, expect, it } from 'vitest';
import { etagOf, ifNoneMatch } from './etag';
import { specBundleFromDir } from './spec-source';

describe('etag', () => {
  it('is a quoted SHA-256 of the body, stable and sensitive to every byte', () => {
    expect(etagOf('a')).toMatch(/^"[0-9a-f]{64}"$/);
    expect(etagOf('a')).toBe(etagOf('a'));
    expect(etagOf('a')).not.toBe(etagOf('b'));
  });

  it('If-None-Match: lists, weak tags and * match; others and absence do not', () => {
    const t = etagOf('x');
    expect(ifNoneMatch(t, t)).toBe(true);
    expect(ifNoneMatch(`W/${t}`, t)).toBe(true);
    expect(ifNoneMatch(`"a", ${t} , "b"`, t)).toBe(true);
    expect(ifNoneMatch('*', t)).toBe(true);
    expect(ifNoneMatch('"a"', t)).toBe(false);
    expect(ifNoneMatch('', t)).toBe(false);
    expect(ifNoneMatch(undefined, t)).toBe(false);
  });
});

describe('specBundleFromDir', () => {
  const saved = process.env.SPEC_DIR;
  afterEach(() => {
    if (saved === undefined) delete process.env.SPEC_DIR;
    else process.env.SPEC_DIR = saved;
  });

  it('answers the bundle for the version the spec declares and null for any other', async () => {
    const source = specBundleFromDir();
    const spec = await specBundle();
    expect((await source(spec.specVersion))?.variables).toHaveLength(spec.variables.length);
    expect(await source('99.0.0')).toBeNull();
  });

  it('reads SPEC_DIR when no directory is given, and does not keep a failed load', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'gp-spec-'));
    try {
      process.env.SPEC_DIR = empty;
      const source = specBundleFromDir();
      await expect(source('1.0.0')).rejects.toThrow();
      delete process.env.SPEC_DIR; // repository docs/spec again
      expect(await source((await specBundle()).specVersion)).not.toBeNull();
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
