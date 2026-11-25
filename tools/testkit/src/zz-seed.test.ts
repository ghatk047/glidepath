import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { INPUT_RULE_IDS, INPUT_RULES, resolveInputs, validateInputs } from '@glidepath/domain';
import type { InputValueRow, ValidationState } from '@glidepath/domain';
import { compile } from '@glidepath/engine';
import type { InputValue, ModelBundle, TenantSeed } from '@glidepath/spec';
import { readTenantSeed } from '@glidepath/spec/node';
import { aaSeed, aaSeedDir, specBundle } from './index';
import { zzSeed, zzSeedDir, zzTenantData } from '../seed/zz';

/**
 * QA-02: the synthetic second tenant `zz` (tools/testkit/seed/zz). One group of tests per acceptance line:
 *  1. shape and completeness (readTenantSeed validates),
 *  2. VR01-VR04, VR06, VR07, VR09, VR10 and engine evaluation,
 *  3. lint: no airline names or marks.
 */

const POOLS = 11;
const RULES = ['VR01', 'VR02', 'VR03', 'VR04', 'VR06', 'VR07', 'VR09', 'VR10'] as const;

const rowsOf = (values: Readonly<Record<string, InputValue>>): InputValueRow[] =>
  Object.entries(values).flatMap(([var_key, v]) =>
    typeof v === 'number'
      ? [{ var_key, member_key: '', value: v }]
      : Object.entries(v).map(([member_key, value]) => ({ var_key, member_key, value })),
  );

/** The state the input rules validate: tenant defaults, then (optionally) one scenario, as v_inputs_resolved does. */
function stateOf(seed: TenantSeed, bundle: ModelBundle, scenario: string | null): ValidationState {
  const chain =
    scenario === null
      ? []
      : [{ scenario_id: scenario, values: rowsOf(seed.scenarios.scenarios.find((s) => s.id === scenario)!.values) }];
  const { values } = resolveInputs(rowsOf(seed.variableValues), chain, [], { variables: bundle.variables.map((v) => v.id) });
  return { bundle, members: seed.dimensionMembers, values };
}

const ids = (seed: TenantSeed, dim: string): string[] => (seed.dimensionMembers[dim] ?? []).map((m) => m.id);

describe('zz seed: five VPs, different labor groups, lines across all 11 pools, every input present', () => {
  it('readTenantSeed validates the five files and the tenant is zz', async () => {
    const seed = await readTenantSeed(zzSeedDir);
    expect(seed.tenant.id).toBe('zz');
    expect(seed.scenarios.tenant).toBe('zz');
    expect(await zzSeed()).toEqual(seed);
    const scenarioIds = seed.scenarios.scenarios.map((s) => s.id);
    expect(scenarioIds).toEqual(['rates', 'A', 'B', 'C', 'D']);
    expect(seed.scenarios.default_scenario).toBe('C');
  });

  it('has five VPs and exactly one shared-services owner', async () => {
    const seed = await zzSeed();
    expect(ids(seed, 'vp')).toHaveLength(5);
    const ss = seed.variableValues['org.ss_flag'] as Record<string, number>;
    expect(Object.entries(ss).filter(([, v]) => v === 1)).toHaveLength(1);
  });

  it('uses other VPs, domains, labor groups, vendors and line ids than the AA seed', async () => {
    const [zz, aa] = [await zzSeed(), await aaSeed()];
    for (const dim of ['vp', 'lgroup', 'domain', 'vendor', 'line']) {
      const zzIds = ids(zz, dim);
      expect(zzIds.length).toBeGreaterThan(0);
      const aaIds = new Set(ids(aa, dim));
      expect(zzIds.filter((i) => i !== 'out_of_scope_memo' && aaIds.has(i))).toEqual([]);
    }
    expect(ids(zz, 'lgroup').length).toBeGreaterThan(0);
    expect(ids(zz, 'lgroup')).not.toEqual(ids(aa, 'lgroup'));
  });

  it('has baseline lines in all 11 canonical pools, each mapped to a pool, a domain and an addressability tag', async () => {
    const seed = await zzSeed();
    const pools = ids(seed, 'pool');
    expect(pools).toHaveLength(POOLS);
    const lines = seed.dimensionMembers['line'] ?? [];
    const perPool = new Map<string, number>();
    for (const l of lines) {
      expect(pools).toContain(l['pool']);
      expect(ids(seed, 'domain')).toContain(l['domain']);
      expect(ids(seed, 'addr_tag')).toContain(l['addr']);
      expect(['L', 'M', 'H']).toContain(l['confidence']);
      expect(String(l['source']).length).toBeGreaterThan(0);
      perPool.set(String(l['pool']), (perPool.get(String(l['pool'])) ?? 0) + 1);
    }
    expect([...perPool.keys()].sort()).toEqual([...pools].sort());
    expect(lines.length).toBeGreaterThanOrEqual(100);
    // memo lines exist, carry no amount and sit in the memo domain
    const memo = lines.filter((l) => l['memo'] === 1);
    expect(memo.length).toBeGreaterThan(0);
    const amount = seed.variableValues['line.amount'] as Record<string, number>;
    for (const l of memo) {
      expect(l['domain']).toBe('out_of_scope_memo');
      expect(amount[l.id]).toBe(0);
    }
  });

  it('has a value for every registry input, and for every member of every dimension it is keyed by', async () => {
    const [seed, bundle] = [await zzSeed(), await specBundle()];
    expect(Object.keys(seed.variableValues).sort()).toEqual(bundle.variables.map((v) => v.id).sort());
    const missing: string[] = [];
    for (const v of bundle.variables) {
      const value = seed.variableValues[v.id];
      if (v.dims.length === 0) {
        if (typeof value !== 'number') missing.push(`${v.id}: scalar expected`);
        continue;
      }
      if (typeof value === 'number' || value === undefined) {
        missing.push(`${v.id}: per-member values expected`);
        continue;
      }
      const plain = v.dims.filter((d) => d !== 'iyear');
      const keys = Object.keys(value).map((k) => k.split(','));
      // every member of the other dims is present (for iyear a variable may skip years it never reads: VR10 checks those)
      const want = plain.reduce<string[][]>((acc, d) => acc.flatMap((p) => ids(seed, d).map((m) => [...p, m])), [[]]);
      const have = new Set(keys.map((k) => k.filter((_, i) => v.dims[i] !== 'iyear').join(',')));
      for (const w of want) if (!have.has(w.join(','))) missing.push(`${v.id}: no value for ${w.join(',')}`);
      for (const k of keys) {
        if (k.length !== v.dims.length) missing.push(`${v.id}: bad key ${k.join(',')}`);
        k.forEach((m, i) => {
          if (!ids(seed, v.dims[i] ?? '').includes(m)) missing.push(`${v.id}: unknown member ${m}`);
        });
      }
      if (!v.dims.includes('iyear')) expect(keys.length).toBe(want.length);
    }
    expect(missing).toEqual([]);
  });

  it('resolves every scenario against the spec bundle (member keys and variable ids check out)', async () => {
    for (const id of [undefined, 'rates', 'A', 'B', 'C', 'D']) {
      const data = await zzTenantData(id);
      expect(data.values.size).toBeGreaterThan(0);
      expect(data.members['vp']).toHaveLength(5);
    }
  });
});

describe('zz seed: passes VR01-VR04, VR06, VR07, VR09, VR10', () => {
  it('has the rules the item names, as input rules', () => {
    expect([...INPUT_RULE_IDS]).toEqual([...RULES]);
  });

  for (const rule of RULES) {
    it(`${rule} holds on the tenant defaults and on every scenario`, async () => {
      const [seed, bundle] = [await zzSeed(), await specBundle()];
      for (const scenario of [null, ...seed.scenarios.scenarios.map((s) => s.id)]) {
        expect(INPUT_RULES[rule](stateOf(seed, bundle, scenario)), `${rule} in ${scenario ?? 'defaults'}`).toEqual([]);
      }
    });
  }

  it('validateInputs returns no entries at all, warnings included', async () => {
    const [seed, bundle] = [await zzSeed(), await specBundle()];
    for (const scenario of [null, ...seed.scenarios.scenarios.map((s) => s.id)]) {
      expect(validateInputs(stateOf(seed, bundle, scenario))).toEqual([]);
    }
  });

  it('the rules are not vacuous on zz: breaking the seed makes VR01, VR02, VR03, VR06, VR07, VR09 and VR10 fire', async () => {
    const [seed, bundle] = [await zzSeed(), await specBundle()];
    const base = stateOf(seed, bundle, 'C');
    const set = (state: ValidationState, v: string, m: string, value: number): ValidationState => ({
      ...state,
      values: state.values.map((r) => (r.var_key === v && r.member_key === m ? { ...r, value } : r)),
    });
    const fires = (rule: (typeof RULES)[number], state: ValidationState): boolean => INPUT_RULES[rule](state).length > 0;
    expect(fires('VR01', set(base, 'org.dom_share', 'customer_digital,vp_digital', 0.5))).toBe(true);
    expect(fires('VR02', set(base, 'org.ss_flag', 'vp_digital', 1))).toBe(true);
    expect(fires('VR03', set(base, 'org.usage_override', 'vp_digital', 0.9))).toBe(true);
    expect(fires('VR06', set(set(base, 'lev.L09.split_sw', '', 0.7), 'lev.L09.split_cloud', '', 0.5))).toBe(true);
    expect(fires('VR07', set(base, 'lev.L09.n', '', 5000))).toBe(true);
    expect(fires('VR04', set(base, 'hc.us', '', 10))).toBe(true);
    const lines = (seed.dimensionMembers['line'] ?? []).map((l, i) => (i === 0 ? { ...l, pool: 'no_such_pool' } : l));
    expect(fires('VR09', { ...base, members: { ...base.members, line: lines } })).toBe(true);
    expect(fires('VR10', { ...base, values: base.values.filter((r) => !r.var_key.startsWith('corp.lab_wage_g')) })).toBe(true);
  });
});


describe('zz seed: evaluates with the engine', () => {
  it(
    'evaluates every scenario without error; VR05 and VR08 invariants hold',
    async () => {
      const bundle = await specBundle();
      const seed = await zzSeed();
      const levers = ids(seed, 'lever');
      for (const scenario of seed.scenarios.scenarios.map((s) => s.id)) {
        const data = await zzTenantData(scenario);
        const ev = compile(bundle, data.members).evaluate(data.values, data.overrides);
        for (const cell of ['base.total', 'res.net', 'res.bar', 'res.risk']) expect(Number.isFinite(ev.get(cell))).toBe(true);
        expect(ev.get('lv.ms0')).toBeGreaterThanOrEqual(0); // VR05
        expect(Math.abs(ev.get('vp.check'))).toBeLessThan(1e-6); // VR08
        for (const l of levers) expect(Math.abs(ev.get(`lev.rr_check[${l}]`))).toBeLessThan(1e-6); // VR08
      }
    },
  );
});

/**
 * Lint: no airline names or marks. Real airlines' names, IATA/ICAO designators and loyalty or alliance marks
 * must not appear in any text file of the zz seed folder (names and marks are matched case-insensitively as
 * words; two-letter codes as upper-case words). `zz` is the only designator the tenant uses.
 */
const AIRLINE_NAMES = [
  'american airlines', 'us airways', 'aadvantage', 'oneworld', 'skyteam', 'star alliance', 'united airlines',
  'mileageplus', 'delta air', 'delta airlines', 'skymiles', 'southwest', 'rapid rewards', 'jetblue', 'trueblue',
  'alaska airlines', 'mileage plan', 'hawaiian airlines', 'spirit airlines', 'frontier airlines', 'allegiant',
  'sun country', 'air canada', 'westjet', 'aeromexico', 'avianca', 'latam', 'lufthansa', 'air france', 'klm',
  'british airways', 'iberia', 'virgin atlantic', 'virgin australia', 'ryanair', 'easyjet', 'wizz', 'turkish airlines',
  'emirates', 'etihad', 'qatar airways', 'qantas', 'singapore airlines', 'cathay', 'japan airlines', 'all nippon',
  'korean air', 'air india', 'finnair', 'swiss international', 'austrian airlines', 'tap air', 'saudia',
  'ethiopian airlines', 'american eagle', 'skywest', 'republic airways', 'dfw', 'phx',
];
const AIRLINE_CODES = [
  'AA', 'UA', 'DL', 'WN', 'B6', 'NK', 'F9', 'G4', 'SY', 'WS', 'AV', 'LH', 'AF', 'KL', 'BA', 'IB', 'VS', 'FR', 'U2',
  'W6', 'TK', 'EK', 'EY', 'QR', 'QF', 'SQ', 'CX', 'JL', 'NH', 'KE', '6E', 'AY', 'LX', 'TP', 'SV', 'ET', 'AAL', 'UAL',
  'DAL', 'SWA', 'JBU', 'ASA',
]; // designators that are also common abbreviations (AI, AS, US, AC, AM, LA, OS, HA) are left out: too many false hits
const NAME_RE = new RegExp(`\\b(${AIRLINE_NAMES.map((n) => n.replace(/ /g, '\\s+')).join('|')})\\b`, 'i');
const CODE_RE = new RegExp(`(?<![A-Za-z0-9])(${AIRLINE_CODES.join('|')})(?![A-Za-z0-9])`);

/** Airline names, codes and marks found in `text`. */
function airlineMarks(text: string): string[] {
  return [NAME_RE.exec(text)?.[0], CODE_RE.exec(text)?.[0]].filter((m): m is string => m !== undefined);
}

function textFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) textFiles(p, out);
    else if (/\.(json|md|ts|py|txt|csv)$/.test(name)) out.push(p);
  }
  return out;
}

describe('lint: no airline names or marks in the zz seed', () => {
  it('the matcher catches names, marks and codes (and not the tenant code)', () => {
    expect(airlineMarks('Fly American Airlines')).toEqual(['American Airlines']);
    expect(airlineMarks('earn AAdvantage miles')).toEqual(['AAdvantage']);
    expect(airlineMarks('ticker AAL')).toEqual(['AAL']);
    expect(airlineMarks('code UA 123')).toEqual(['UA']);
    expect(airlineMarks('carrier code AA')).toEqual(['AA']);
    expect(airlineMarks('hub at DFW')).toEqual(['DFW']);
    expect(airlineMarks('tenant zz, Zz Synthetic Test Airline, ZZTST')).toEqual([]);
  });

  it('no file of the zz seed folder names an airline, a designator or a mark', () => {
    const files = textFiles(zzSeedDir);
    expect(files.length).toBeGreaterThanOrEqual(7); // five JSON files, README.md, index.ts (and build.py)
    const found = files.flatMap((f) => airlineMarks(readFileSync(f, 'utf8')).map((m) => `${f.slice(zzSeedDir.length + 1)}: ${m}`));
    expect(found).toEqual([]);
  });

  it('the tenant record is fictional: code zz, a made-up name and ticker, and not the reference tenant', async () => {
    const [zz, aa] = [await zzSeed(), await aaSeed()];
    expect(zz.tenant.id).toBe('zz');
    expect(zz.tenant.name).toMatch(/synthetic/i);
    expect(zz.tenant['ticker']).not.toBe(aa.tenant['ticker']);
    expect(zz.tenant.name).not.toBe(aa.tenant.name);
    expect(readFileSync(join(zzSeedDir, 'tenant.json'), 'utf8')).not.toContain(aaSeedDir);
  });
});
