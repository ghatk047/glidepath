import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  resolveInputs,
  resolveScenarioChain,
  type InputValueRow,
  type NodeOverrideRow,
  type ResolvedInput,
  type ScenarioLevel,
} from './resolve';
import { repoRoot } from './test-support/schema-json';

/** docs: tier2-logic/domain/fixtures/scenario-chain-3.json (shared with DATA-03). */
interface ChainFixture {
  semantics: string[];
  tenant_id: string;
  variable_def: { var_key: string; dims: string[] }[];
  variable_value: InputValueRow[];
  scenario: { id: string; key: string; parent_id: string | null }[];
  scenario_value: (InputValueRow & { scenario_id: string })[];
  node_override: (NodeOverrideRow & { scenario_id: string })[];
  expected: Record<
    string,
    { chain: string[]; values: ResolvedInput[]; overrides: NodeOverrideRow[] }
  >;
}

const fixture = JSON.parse(
  readFileSync(resolve(repoRoot, 'tier2-logic/domain/fixtures/scenario-chain-3.json'), 'utf8'),
) as ChainFixture;
const idOf = (key: string): string => fixture.scenario.find((s) => s.key === key)!.id;

/** What a store hands to resolveInputs for one scenario: defaults, the chain's rows, own overrides. */
function inputsFor(scenarioId: string) {
  const chain: ScenarioLevel[] = resolveScenarioChain(fixture.scenario, scenarioId).map((id) => ({
    scenario_id: id,
    values: fixture.scenario_value.filter((r) => r.scenario_id === id),
  }));
  const overrides = fixture.node_override.filter((r) => r.scenario_id === scenarioId);
  return { chain, overrides };
}

describe('resolveInputs = v_inputs_resolved semantics (3-level chain fixture shared with DATA-03)', () => {
  const variables = fixture.variable_def.map((v) => v.var_key);

  it('the fixture is a 3-level chain with a sibling branch', () => {
    expect(fixture.expected['grandchild']!.chain).toHaveLength(3);
    expect(Object.keys(fixture.expected).sort()).toEqual([
      'child',
      'grandchild',
      'root',
      'sibling',
    ]);
  });

  for (const key of ['root', 'child', 'grandchild', 'sibling']) {
    it(`resolves '${key}': definition -> default -> ancestors -> scenario, last wins; own overrides`, () => {
      const expected = fixture.expected[key]!;
      const id = idOf(key);
      expect(resolveScenarioChain(fixture.scenario, id)).toEqual(expected.chain);
      const { chain, overrides } = inputsFor(id);
      const resolved = resolveInputs(fixture.variable_value, chain, overrides, { variables });
      expect(resolved.values).toEqual(expected.values);
      expect(resolved.overrides).toEqual(expected.overrides);
    });
  }

  it('resolves per cell, not per variable: one variable mixes four levels in the grandchild', () => {
    const { chain, overrides } = inputsFor(idOf('grandchild'));
    const cells = resolveInputs(fixture.variable_value, chain, overrides, { variables })
      .values.filter((r) => r.var_key === 'corp.lab_hc_g')
      .map((r) => [r.member_key, r.scenario_id]);
    expect(cells).toEqual([
      ['flight_attendants,fy26', idOf('child')],
      ['flight_attendants,fy27', idOf('child')],
      ['pilots,fy26', null],
      ['pilots,fy27', idOf('grandchild')],
    ]);
  });

  it('without a definitions filter, every cell from every level is kept', () => {
    const { chain } = inputsFor(idOf('child'));
    const all = resolveInputs(fixture.variable_value, chain, []);
    expect(all.values.find((r) => r.var_key === 'zz.not_in_model')).toEqual({
      var_key: 'zz.not_in_model',
      member_key: '',
      value: 2,
      scenario_id: idOf('child'),
    });
  });

  it('tenant defaults alone (no scenario): every row from the default level', () => {
    const r = resolveInputs(fixture.variable_value, [], []);
    expect(r.values).toHaveLength(fixture.variable_value.length);
    expect(r.values.every((x) => x.scenario_id === null)).toBe(true);
    expect(r.overrides).toEqual([]);
  });

  it('does not mutate its inputs and is independent of row order', () => {
    const { chain, overrides } = inputsFor(idOf('grandchild'));
    const snapshot = JSON.stringify([fixture.variable_value, chain, overrides]);
    const a = resolveInputs(fixture.variable_value, chain, overrides, { variables });
    const reversed = chain.map((l) => ({ ...l, values: [...l.values].reverse() }));
    const b = resolveInputs(
      [...fixture.variable_value].reverse(),
      reversed,
      [...overrides].reverse(),
      {
        variables: new Set(variables),
      },
    );
    expect(b).toEqual(a);
    expect(JSON.stringify([fixture.variable_value, chain, overrides])).toBe(snapshot);
  });

  it('rejects two rows for one cell on the same level (a primary key violation)', () => {
    const dup = [...fixture.variable_value, fixture.variable_value[0]!];
    expect(() => resolveInputs(dup, [], [])).toThrow(/duplicate.*g\.target_net.*tenant default/);
    const level = {
      scenario_id: idOf('root'),
      values: [fixture.scenario_value[0]!, fixture.scenario_value[0]!],
    };
    expect(() => resolveInputs([], [level], [])).toThrow(
      /duplicate.*scenario 0+-0000-4000-8000-0+a1/,
    );
    const ov = fixture.node_override[0]!;
    expect(() => resolveInputs([], [], [ov, ov])).toThrow(
      /duplicate node override base\.pool_outlay/,
    );
  });
});

describe('resolveScenarioChain', () => {
  const s = (id: string, parent_id: string | null) => ({ id, parent_id });

  it('walks parent links from the root to the scenario', () => {
    expect(resolveScenarioChain([s('c', 'b'), s('a', null), s('b', 'a')], 'c')).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(resolveScenarioChain([s('a', null)], 'a')).toEqual(['a']);
  });

  it('rejects an unknown scenario, a missing parent and a cycle', () => {
    expect(() => resolveScenarioChain([s('a', null)], 'x')).toThrow(/unknown scenario x/);
    expect(() => resolveScenarioChain([s('b', 'a')], 'b')).toThrow(
      /unknown scenario a.*parent of b/,
    );
    expect(() => resolveScenarioChain([s('a', 'b'), s('b', 'a')], 'a')).toThrow(/cycle.*a/);
    expect(() => resolveScenarioChain([s('a', 'a')], 'a')).toThrow(/cycle/);
  });
});
