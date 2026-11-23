import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, expectTypeOf, it } from 'vitest';
import * as contract from './index';
import { ChangesetId, ScenarioId, TenantSlug, type ScenarioId as ScenarioIdT } from './index';

const srcDir = fileURLToPath(new URL('.', import.meta.url));
const pkgDir = join(srcDir, '..');

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? sourceFiles(join(dir, e.name))
      : /\.(ts|tsx|js|mjs)$/.test(e.name)
        ? [join(dir, e.name)]
        : [],
  );

const importSpecifiers = (code: string): string[] =>
  [
    ...code.matchAll(
      /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g,
    ),
  ].map((m) => (m[1] ?? m[2])!);

describe('boundaries (G13): ids are plain branded strings; no tier 2 / tier 3 imports', () => {
  it('ids parse to the same plain string', () => {
    expect(ScenarioId.parse('sc-1')).toBe('sc-1');
    expect(typeof ChangesetId.parse('cs-1')).toBe('string');
    expect(ScenarioId.safeParse('').success).toBe(false);
    expect(ScenarioId.safeParse(42).success).toBe(false);
    expect(TenantSlug.parse('zz')).toBe('zz');
  });

  it('ids are branded: a ScenarioId is not a ChangesetId at the type level', () => {
    const sc = ScenarioId.parse('sc-1');
    expectTypeOf(sc).toEqualTypeOf<ScenarioIdT>();
    expectTypeOf(sc).toMatchTypeOf<string>();
    expectTypeOf<string>().not.toMatchTypeOf<ScenarioIdT>();
    expectTypeOf(ChangesetId.parse('cs-1')).not.toMatchTypeOf<ScenarioIdT>();
  });

  it('runtime source imports only zod and relative modules', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(srcDir)) {
      const isTest = /\.(spec|test)\.ts$/.test(file);
      for (const spec of importSpecifiers(readFileSync(file, 'utf8'))) {
        const ok =
          spec === 'zod' ||
          spec.startsWith('./') ||
          (spec.startsWith('../') && !/tier[23]/.test(spec)) ||
          (isTest && (spec === 'vitest' || spec.startsWith('node:')));
        if (!ok || /tier2-logic|tier3-data/.test(spec)) offenders.push(`${file}: ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('package.json depends on zod only', () => {
    const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies ?? {})).toEqual(['zod']);
    const all = { ...pkg.peerDependencies, ...pkg.devDependencies };
    expect(Object.keys(all).filter((d) => d.startsWith('@glidepath/'))).toEqual([]);
  });

  it('exports schemas and types only (no runtime behaviour beyond parsing)', () => {
    expect(contract.packageName).toBe('@glidepath/api-contract');
  });
});
