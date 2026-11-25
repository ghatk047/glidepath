/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  SeedAaDimensionMembersSchema,
  SeedAaLeverLibrarySchema,
  SeedAaScenariosSchema,
  SeedAaTenantSchema,
  SeedAaVariableValuesSchema,
} from './generated';
import { parseTenantSeed, SpecValidationError, seedToTenantData, type TenantSeedJson } from './index';
import { loadModelBundleFromDir, readTenantSeed } from './node';

const here = dirname(fileURLToPath(import.meta.url));
const specDir = resolve(here, '../../../docs/spec');
const seedDir = join(specDir, 'seed/aa');
const readSeedJson = (f: string): any => JSON.parse(readFileSync(join(seedDir, f), 'utf8'));
const freshJson = (): { -readonly [K in keyof TenantSeedJson]: any } => ({
  tenant: readSeedJson('tenant.json'),
  dimensionMembers: readSeedJson('dimension_members.json'),
  variableValues: readSeedJson('variable_values.json'),
  scenarios: readSeedJson('scenarios.json'),
  leverLibrary: readSeedJson('lever_library.json'),
});

/** Independent restatement of `Model.input_cells` straight from the raw JSON, keyed `vid` / `vid[memberKey]`. */
function expectedCells(scenarioId: string | undefined): Map<string, number> {
  const out = new Map<string, number>();
  const put = (vid: string, v: unknown): void => {
    if (typeof v === 'number') out.set(vid, v);
    else for (const [ck, x] of Object.entries(v as Record<string, number>)) out.set(`${vid}[${ck}]`, x);
  };
  for (const [vid, v] of Object.entries(readSeedJson('variable_values.json'))) put(vid, v);
  if (scenarioId) {
    const sc = readSeedJson('scenarios.json').scenarios.find((s: any) => s.id === scenarioId);
    for (const [vid, v] of Object.entries(sc.values)) put(vid, v);
  }
  return out;
}

function errorOf(fn: () => unknown): Error {
  try {
    fn();
  } catch (e) {
    return e as Error;
  }
  throw new Error('expected a throw');
}

describe('readTenantSeed', () => {
  it('loads the five AA seed files with zod validation', async () => {
    const seed = await readTenantSeed(seedDir);
    expect(seed.tenant.id).toBe('aa');
    expect(Object.keys(seed.dimensionMembers)).toContain('line');
    expect(seed.dimensionMembers['line']).toHaveLength(415);
    expect(Object.keys(seed.variableValues)).toHaveLength(194);
    expect(seed.scenarios.scenarios.map((s) => s.id)).toEqual(['rates', 'A', 'B', 'C', 'D']);
    expect(seed.scenarios.default_scenario).toBe('C');
    expect(seed.leverLibrary.levers).toHaveLength(17);
    // The AA-specific generated schemas accept the same files.
    const j = freshJson();
    SeedAaTenantSchema.parse(j.tenant);
    SeedAaDimensionMembersSchema.parse(j.dimensionMembers);
    SeedAaVariableValuesSchema.parse(j.variableValues);
    SeedAaScenariosSchema.parse(j.scenarios);
    SeedAaLeverLibrarySchema.parse(j.leverLibrary);
  });

  it('rejects invalid files with a JSON-path error', () => {
    const j = freshJson();
    j.tenant = { ...(j.tenant as object), currency: 5 };
    j.variableValues['g.target_net'] = 'high';
    j.scenarios.scenarios[2].values['g.head_start'] = null;
    const e = errorOf(() => parseTenantSeed(j));
    expect(e).toBeInstanceOf(SpecValidationError);
    const paths = (e as SpecValidationError).issues.map((i) => i.path);
    expect(paths).toContain('$.tenant.currency');
    expect(paths.some((p) => p.startsWith("$.variableValues.g.target_net"))).toBe(true);
    expect(paths.some((p) => p.startsWith('$.scenarios.scenarios[2].values.g.head_start'))).toBe(true);

    const k = freshJson();
    k.dimensionMembers['pool']![1] = { ...k.dimensionMembers['pool']![0]! };
    expect((errorOf(() => parseTenantSeed(k)) as SpecValidationError).issues[0]!.path).toBe('$.dimensionMembers.pool[1].id');

    const m = freshJson();
    m.scenarios.default_scenario = 'Z';
    expect((errorOf(() => parseTenantSeed(m)) as SpecValidationError).issues[0]!.path).toBe('$.scenarios.default_scenario');
  });
});

describe('seedToTenantData', () => {
  it('scenario C has the same cell set and values as the JSON, 30 sampled cells checked', async () => {
    const [seed, bundle] = await Promise.all([readTenantSeed(seedDir), loadModelBundleFromDir(specDir)]);
    const data = seedToTenantData(seed, 'C', bundle);
    const want = expectedCells('C');
    expect(data.values.size).toBe(want.size);
    expect(new Set(data.values.keys())).toEqual(new Set(want.keys()));
    for (const [k, v] of want) expect(data.values.get(k)).toBe(v);
    expect(data.overrides.size).toBe(0);

    // 30 sampled cells, spread evenly over the cell list, plus named cells with comma-joined member keys.
    const keys = [...want.keys()];
    const sample = Array.from({ length: 30 }, (_, i) => keys[Math.floor((i * keys.length) / 30)]!);
    expect(new Set(sample).size).toBe(30);
    for (const k of sample) expect(data.values.get(k)).toBe(want.get(k));
    expect(data.values.has('corp.lab_hc_g[pilots,fy27]')).toBe(true);
    expect(data.values.has('org.dom_share[commercial_applications,vp_commercial]')).toBe(true);
    expect(data.values.has('line.amount[it_001]')).toBe(true);
    expect(data.values.has('g.target_net')).toBe(true);
    // Without the bundle the shape of each value decides: same result.
    expect(seedToTenantData(seed, 'C').values).toEqual(data.values);
  });

  it('applies tenant defaults, then scenario values, then overrides', async () => {
    const [seed, bundle] = await Promise.all([readTenantSeed(seedDir), loadModelBundleFromDir(specDir)]);
    const defaults = seedToTenantData(seed, undefined, bundle);
    expect(defaults.values).toEqual(new Map([...expectedCells(undefined)]));
    const a = seed.scenarios.scenarios.find((s) => s.id === 'A')!;
    const pick = Object.entries(a.values).find(([vid, v]) => typeof v === 'number' && defaults.values.get(vid) !== v);
    expect(pick, 'scenario A differs from the defaults somewhere').toBeDefined();
    const dataA = seedToTenantData(seed, 'A', bundle);
    expect(dataA.values.get(pick![0])).toBe(pick![1]);
    expect(dataA.values.size).toBe(defaults.values.size);

    // Synthetic scenario: a dict overlays only its member keys; overrides are carried; last wins.
    const dimVar = [...bundle.variables].find((v) => v.dims.length === 1)!;
    const firstKey = Object.keys(seed.variableValues[dimVar.id] as object)[0]!;
    const custom = {
      ...seed,
      scenarios: {
        ...seed.scenarios,
        scenarios: [{ id: 'X', label: 'X', values: { [dimVar.id]: { [firstKey]: 12345 }, 'g.target_net': 7 }, overrides: { 'res.net': 99 } }],
      },
    };
    const x = seedToTenantData(custom, 'X', bundle);
    expect(x.values.get(`${dimVar.id}[${firstKey}]`)).toBe(12345);
    expect(x.values.get('g.target_net')).toBe(7);
    expect(x.values.size).toBe(defaults.values.size);
    expect(x.overrides).toEqual(new Map([['res.net', 99]]));
    const other = [...defaults.values.keys()].find((k) => k.startsWith(`${dimVar.id}[`) && k !== `${dimVar.id}[${firstKey}]`)!;
    expect(x.values.get(other)).toBe(defaults.values.get(other));
  });

  it('throws when a scalar is given for a per-member variable, as in Python', async () => {
    const [seed, bundle] = await Promise.all([readTenantSeed(seedDir), loadModelBundleFromDir(specDir)]);
    const bad = { ...seed, variableValues: { ...seed.variableValues, 'line.amount': 5 } };
    const e = errorOf(() => seedToTenantData(bad, 'C', bundle));
    expect(e).toBeInstanceOf(SpecValidationError);
    expect(e.message).toBe('$.variableValues.line.amount: line.amount needs per-member values');

    const badScenario = {
      ...seed,
      scenarios: { ...seed.scenarios, scenarios: [{ id: 'S', label: 'S', values: { 'pool.growth': 0.1 } }] },
    };
    expect(errorOf(() => seedToTenantData(badScenario, 'S', bundle)).message).toContain('pool.growth needs per-member values');
    // Not applied when the scenario is not selected.
    expect(() => seedToTenantData(badScenario, undefined, bundle)).not.toThrow();

    // Other malformed inputs.
    const scalarAsDict = { ...seed, variableValues: { ...seed.variableValues, 'g.target_net': { a: 1 } } };
    expect(errorOf(() => seedToTenantData(scalarAsDict, undefined, bundle)).message).toContain('is a scalar variable');
    const unknown = { ...seed, variableValues: { ...seed.variableValues, 'nope.var': 1 } };
    expect(errorOf(() => seedToTenantData(unknown, undefined, bundle)).message).toContain("unknown variable 'nope.var'");
    const arity = { ...seed, variableValues: { ...seed.variableValues, 'corp.lab_hc_g': { pilots: 1 } } };
    expect(errorOf(() => seedToTenantData(arity, undefined, bundle)).message).toContain('needs 2 member(s)');
    expect(errorOf(() => seedToTenantData(seed, 'nope', bundle)).message).toBe("unknown scenario 'nope'");
  });

  it('preserves member attributes (line.pool, line.domain, ...) for where-filters', async () => {
    const seed = await readTenantSeed(seedDir);
    const raw = readSeedJson('dimension_members.json');
    const data = seedToTenantData(seed, 'C');
    expect(data.members).toEqual(raw);
    const line = data.members['line']!;
    expect(line).toHaveLength(415);
    const first = line[0]!;
    expect(first['pool']).toBe(raw.line[0].pool);
    expect(first['domain']).toBe(raw.line[0].domain);
    expect(first['lever_ids']).toEqual(raw.line[0].lever_ids);
    expect(typeof first['unit_cost_usd']).toBe('number');
    // Every line's pool and domain are members of those dimensions, so where-filters resolve.
    const pools = new Set(data.members['pool']!.map((m) => m.id));
    const domains = new Set(data.members['domain']!.map((m) => m.id));
    for (const l of line) {
      expect(pools.has(l['pool'] as string)).toBe(true);
      expect(domains.has(l['domain'] as string)).toBe(true);
    }
    expect(data.members['year']!.map((m) => m['in'])).toEqual(raw.year.map((m: any) => m.in));
  });
});
