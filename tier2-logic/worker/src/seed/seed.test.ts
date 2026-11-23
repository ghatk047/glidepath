import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { optionsFromEnv, parseArgs } from './args';
import { GLOBAL_SEED_FILES, TENANT_SEED_FILES, findTier3Data, readSeedInputs } from './files';
import { uuidV5, seedIds } from './ids';
import { cellsOf, missingDefaults, presetChanges, splitCellKey, cellId } from './drafts';
import { parseDemoEmail } from './tenant';

const tier3Data = findTier3Data();
const repoRoot = resolve(tier3Data, '..');

describe('seed files', () => {
  it('tier3-data/seed is an exact copy of the docs/spec JSON (pnpm --filter @glidepath/worker seed:sync)', () => {
    for (const f of GLOBAL_SEED_FILES) {
      expect(readFileSync(join(tier3Data, 'seed', f), 'utf8'), f).toBe(readFileSync(join(repoRoot, 'docs/spec', f), 'utf8'));
    }
    for (const f of TENANT_SEED_FILES) {
      expect(readFileSync(join(tier3Data, 'seed/aa', f), 'utf8'), f).toBe(
        readFileSync(join(repoRoot, 'docs/spec/seed/aa', f), 'utf8'),
      );
    }
  });

  it('reads and validates the global spec and the tenant folder', async () => {
    const inputs = await readSeedInputs(tier3Data, 'aa');
    expect(inputs.global.bundle.variables.length).toBeGreaterThan(0);
    expect(inputs.global.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(inputs.tenant.scenarios.default_scenario).toBe('C');
    await expect(readSeedInputs(tier3Data, 'zz')).rejects.toThrow(/no seed folder/);
    await expect(readSeedInputs(tier3Data, '../x')).rejects.toThrow(/invalid tenant slug/);
  });
});

describe('command line', () => {
  it('takes --seed <slug> (compose) or --tenant <slug> (pnpm seed), also as --seed=<slug>', () => {
    expect(parseArgs(['--seed', 'aa'])).toEqual({ seed: 'aa' });
    expect(parseArgs(['--tenant', 'aa'])).toEqual({ seed: 'aa' });
    expect(parseArgs(['--seed=aa'])).toEqual({ seed: 'aa' });
    expect(parseArgs([])).toEqual({ seed: undefined });
    expect(parseArgs(['--seed', 'aa', '--ai-cache', 'dir', '--ai-cache-tenant=aa'])).toEqual({ seed: 'aa', aiCache: 'dir', aiCacheTenant: 'aa' });
    expect(() => parseArgs(['--ai-cache'])).toThrow(/needs a bundle folder/);
    expect(() => parseArgs(['--seed'])).toThrow(/needs a tenant slug/);
    expect(() => parseArgs(['--seed', '--tenant'])).toThrow(/needs a tenant slug/);
    expect(() => parseArgs(['--wat'])).toThrow(/unknown argument/);
  });

  it('reads settings from the environment only', () => {
    expect(() => optionsFromEnv(['--seed', 'aa'], {})).toThrow(/DATABASE_URL_MIGRATE is required/);
    expect(
      optionsFromEnv(['--seed', 'aa'], { DATABASE_URL_MIGRATE: 'postgres://x/y', DEMO_USER_EMAIL: ' ', DEMO_USER_NAME: 'N' }),
    ).toEqual({ databaseUrl: 'postgres://x/y', seed: 'aa', demoUserName: 'N' });
  });

  it('DEMO_USER_EMAIL is normalised, optional, and must be an address', () => {
    expect(parseDemoEmail(undefined)).toBeNull();
    expect(parseDemoEmail('  ')).toBeNull();
    expect(parseDemoEmail(' Demo@Example.COM ')).toBe('demo@example.com');
    expect(() => parseDemoEmail('nope')).toThrow(/email address/);
  });
});

describe('ids and diffs', () => {
  it('uuidV5 is deterministic and a version 5 uuid; ids differ per name', () => {
    const a = uuidV5('x');
    expect(a).toBe(uuidV5('x'));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(seedIds.tenant('aa')).not.toBe(seedIds.tenant('bb'));
    expect(seedIds.user('A@x.io')).toBe(seedIds.user(' a@x.io '));
  });

  it('only missing defaults are set, and only differing preset cells are repaired', async () => {
    const { tenant } = await readSeedInputs(tier3Data, 'aa');
    const all = cellsOf(tenant.variableValues);
    expect(missingDefaults(tenant, new Set(all.map((c) => cellId(c.key, c.member_key))))).toEqual([]);
    const some = new Set(all.slice(1).map((c) => cellId(c.key, c.member_key)));
    expect(missingDefaults(tenant, some)).toEqual([
      { target: 'variable', key: all[0]!.key, member_key: all[0]!.member_key, op: 'set', new_value: all[0]!.value },
    ]);

    const preset = tenant.scenarios.scenarios[0]!;
    const cells = cellsOf(preset.values);
    const stored = new Map(cells.map((c) => [cellId(c.key, c.member_key), c.value]));
    expect(presetChanges(preset, stored, new Map())).toEqual([]);
    stored.set(cellId(cells[0]!.key, cells[0]!.member_key), cells[0]!.value + 1);
    expect(presetChanges(preset, stored, new Map())).toHaveLength(1);
  });

  it('splits cell keys of dimensioned cells', () => {
    expect(splitCellKey('res.net')).toEqual({ key: 'res.net', member_key: '' });
    expect(splitCellKey('lev.on[L05]')).toEqual({ key: 'lev.on', member_key: 'L05' });
    expect(splitCellKey('vp.t[a,b]')).toEqual({ key: 'vp.t', member_key: 'a,b' });
  });
});
