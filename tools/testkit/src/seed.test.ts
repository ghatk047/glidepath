import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { aaDefaultScenario, aaMembers, aaScenarioIds, aaSeed, aaSeedDir, aaTenantData, specBundle } from './index';

const json = (f: string): unknown => JSON.parse(readFileSync(join(aaSeedDir, f), 'utf8'));

describe('AA seed accessors', () => {
  it('aaSeed() returns the validated five-file seed for tenant aa', async () => {
    const seed = await aaSeed();
    expect(seed.tenant.id).toBe((json('tenant.json') as { id: string }).id);
    expect(seed.tenant.id).toBe('aa');
    expect(Object.keys(seed.variableValues).length).toBeGreaterThan(0);
    expect(seed.leverLibrary.levers.length).toBeGreaterThan(0);
  });

  it('scenario ids and the default scenario come from scenarios.json', async () => {
    const raw = json('scenarios.json') as { default_scenario: string; scenarios: { id: string }[] };
    expect(await aaScenarioIds()).toEqual(raw.scenarios.map((s) => s.id));
    expect(await aaDefaultScenario()).toBe(raw.default_scenario);
  });

  it('aaMembers(dim) lists member ids of a dimension and rejects unknown dims', async () => {
    const raw = json('dimension_members.json') as Record<string, { id: string }[]>;
    expect(await aaMembers('vp')).toEqual(raw.vp?.map((m) => m.id));
    expect(await aaMembers('pool')).toEqual(raw.pool?.map((m) => m.id));
    await expect(aaMembers('nope')).rejects.toThrow(/unknown dimension/);
  });

  it('aaTenantData(scenario) resolves inputs against the spec bundle; defaults only without a scenario', async () => {
    const bundle = await specBundle();
    expect(bundle.variables.length).toBeGreaterThan(0);
    const seed = await aaSeed();
    const raw = json('scenarios.json') as { scenarios: { id: string; values: Record<string, unknown> }[] };
    const c = raw.scenarios.find((s) => s.id === 'C');
    const [id, value] = Object.entries(c?.values ?? {}).find(([, v]) => typeof v === 'number') ?? [];
    const data = await aaTenantData('C');
    expect(data.values.get(id as string)).toBe(value);
    const defaults = await aaTenantData();
    expect(defaults.values.size).toBeGreaterThan(0);
    expect(data.members).toEqual(seed.dimensionMembers);
  });
});
