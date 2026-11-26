import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SOURCING_DIMENSIONS, sourcingRowEntries } from '@glidepath/domain';
import type { Member } from '@glidepath/spec';
import { beforeAll, describe, expect, it } from 'vitest';
import { dimensionMemberRow } from './drafts';
import { findTier3Data, readSeedInputs, type SeedInputs } from './files';
import { SOURCING_SEED_FILE, missingSourcingMembers, parseSourcingSeed, type SourcingSeed } from './sourcing';

/** SRC-01 acceptance on tier3-data/seed/aa/sourcing.json (pure: reads the files only). */

const tier3Data = findTier3Data();
let inputs: SeedInputs;
let sourcing: SourcingSeed;
let lines: Map<string, Member>;
let thirdParty: Set<string>;
let amount: Record<string, number>;

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const monthIndex = (ym: string): number => {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  return y * 12 + m - 1;
};
const str = (m: Member, k: string): string => m[k] as string;
const num = (m: Member, k: string): number => m[k] as number;
const ids = (m: Member, k: string): string[] => m[k] as string[];

beforeAll(async () => {
  inputs = await readSeedInputs(tier3Data, 'aa');
  sourcing = inputs.sourcing!;
  const dm = inputs.tenant.dimensionMembers;
  lines = new Map(dm.line!.map((l) => [l.id, l]));
  thirdParty = new Set(dm.pool!.filter((p) => Number(p.third_party) === 1).map((p) => p.id));
  amount = inputs.tenant.variableValues['line.amount'] as Record<string, number>;
});

/** In-scope lines of a third-party pool: the spend a contract can cover. */
const isThirdPartyLine = (l: Member | undefined): boolean =>
  l !== undefined && l.in_scope === 1 && thirdParty.has(str(l, 'pool'));

describe('sourcing.json (SRC-01)', () => {
  it('is read with the aa seed, holds the four sourcing dimensions, and is not one of the spec seed files', () => {
    expect(sourcing).not.toBeNull();
    expect(Object.keys(sourcing.dimensions).sort()).toEqual([...SOURCING_DIMENSIONS].sort());
    for (const dim of SOURCING_DIMENSIONS) expect(sourcing.dimensions[dim].length, dim).toBeGreaterThan(0);
    const raw = JSON.parse(readFileSync(join(tier3Data, 'seed/aa', SOURCING_SEED_FILE), 'utf8')) as unknown;
    expect(parseSourcingSeed(raw)).toEqual(sourcing);
  });

  it('every member is marked an estimate: source "SRC estimate", confidence L or M', () => {
    for (const dim of ['contract', 'benchmark'] as const) {
      for (const m of sourcing.dimensions[dim]) {
        expect(m.source, `${dim}.${m.id}`).toBe('SRC estimate');
        expect(['L', 'M'], `${dim}.${m.id}`).toContain(m.confidence);
      }
    }
  });

  describe('contract', () => {
    it('covers every third-party vendor with in-scope spend above the file coverage threshold (aggregates excepted)', () => {
      const coverage = sourcing.coverage as { min_vendor_spend_musd: number; aggregate_vendor_names: string[] };
      const spend = new Map<string, number>();
      for (const l of lines.values()) {
        if (isThirdPartyLine(l)) spend.set(str(l, 'vendor'), (spend.get(str(l, 'vendor')) ?? 0) + amount[l.id]!);
      }
      const due = [...spend]
        .filter(([v, s]) => s >= coverage.min_vendor_spend_musd && !coverage.aggregate_vendor_names.includes(v))
        .map(([v]) => v)
        .sort();
      const covered = [...new Set(sourcing.dimensions.contract.map((c) => str(c, 'vendor_name')))].sort();
      expect(covered).toEqual(due);
      expect(due.length).toBeGreaterThanOrEqual(30);
      // internal labour never has a contract
      expect(covered).not.toContain('AA employees');
      expect(covered).not.toContain('AA India (Hyderabad)');
    });

    it('links each contract to a vendor and its lines: every line exists, is in scope, third-party and names the vendor; no line is in two contracts', () => {
      const vendors = new Map(inputs.tenant.dimensionMembers.vendor!.map((v) => [String(v.label), v.id]));
      const seen = new Map<string, string>();
      for (const c of sourcing.dimensions.contract) {
        const name = str(c, 'vendor_name');
        expect(c.vendor, c.id).toBe(vendors.get(name) ?? null);
        expect(ids(c, 'lines').length, c.id).toBeGreaterThan(0);
        for (const id of ids(c, 'lines')) {
          const l = lines.get(id);
          expect(l, `${c.id}: line ${id}`).toBeDefined();
          expect(isThirdPartyLine(l), `${c.id}: line ${id}`).toBe(true);
          expect(l!.vendor, `${c.id}: line ${id}`).toBe(name);
          expect(seen.get(id), `line ${id} in two contracts`).toBeUndefined();
          seen.set(id, c.id);
        }
      }
      // all of a covered vendor's lines are under contract
      const names = new Set(sourcing.dimensions.contract.map((c) => str(c, 'vendor_name')));
      for (const l of lines.values()) {
        if (isThirdPartyLine(l) && names.has(str(l, 'vendor'))) expect(seen.has(l.id), l.id).toBe(true);
      }
    });

    it('carries the renewal terms: months YYYY-MM, start + term = renewal, renewals spread over 2026-06..2029-12, sane rates', () => {
      for (const c of sourcing.dimensions.contract) {
        for (const k of ['start_month', 'renewal_month']) expect(str(c, k), `${c.id}.${k}`).toMatch(MONTH);
        expect(monthIndex(str(c, 'start_month')) + num(c, 'term_months'), c.id).toBe(monthIndex(str(c, 'renewal_month')));
        expect(str(c, 'renewal_month') >= '2026-06' && str(c, 'renewal_month') <= '2029-12', c.id).toBe(true);
        expect(Number.isInteger(num(c, 'notice_days')) && num(c, 'notice_days') > 0, c.id).toBe(true);
        expect([0, 1], c.id).toContain(c.auto_renew);
        for (const k of ['escalator_pct', 'target_cut_pct']) {
          expect(num(c, k) >= 0 && num(c, k) < 0.5, `${c.id}.${k} is a fraction`).toBe(true);
        }
        expect(c).not.toHaveProperty('annual_value');
      }
      const years = new Set(sourcing.dimensions.contract.map((c) => str(c, 'renewal_month').slice(0, 4)));
      expect([...years].sort()).toEqual(['2026', '2027', '2028', '2029']);
    });
  });

  describe('benchmark', () => {
    it('covers the line units with the most spend; each line exists, has its unit and sits in one benchmark', () => {
      const seen = new Set<string>();
      for (const b of sourcing.dimensions.benchmark) {
        for (const id of ids(b, 'lines')) {
          const l = lines.get(id);
          expect(l, `${b.id}: line ${id}`).toBeDefined();
          expect(l!.in_scope, `${b.id}: line ${id}`).toBe(1);
          expect(l!.unit, `${b.id}: line ${id}`).toBe(b.unit);
          expect(typeof l!.unit_cost_usd, `${b.id}: line ${id}`).toBe('number');
          expect(seen.has(id), `line ${id} in two benchmarks`).toBe(false);
          seen.add(id);
        }
      }
      // the largest per-unit spend families are benchmarked: SI FTEs, contractors, seats, devices, PSS
      for (const id of ['it_097', 'it_143', 'it_168', 'it_191', 'it_380', 'it_274', 'it_351']) expect(seen.has(id), id).toBe(true);
      const total = [...seen].reduce((a, id) => a + amount[id]!, 0);
      expect(total).toBeGreaterThan(150);
    });

    it('has p25 <= median <= p75, and is plausible against unit costs: some lines above the median, some below', () => {
      let above = 0;
      let below = 0;
      for (const b of sourcing.dimensions.benchmark) {
        const [p25, median, p75] = [num(b, 'p25_usd'), num(b, 'median_usd'), num(b, 'p75_usd')];
        expect(p25 > 0 && p25 <= median && median <= p75, b.id).toBe(true);
        for (const id of ids(b, 'lines')) {
          const uc = num(lines.get(id)!, 'unit_cost_usd');
          if (uc > median) above++;
          else below++;
          expect(uc / median > 0.3 && uc / median < 3, `${b.id}: line ${id} cost ${uc} vs median ${median}`).toBe(true);
        }
      }
      expect(above).toBeGreaterThan(0);
      expect(below).toBeGreaterThan(0);
    });
  });

  describe('sourcing_param', () => {
    const REQUIRED = {
      business_case: ['discount_rate', 'horizon_years'],
      renewals: ['asof_year', 'asof_month', 'window_months', 'act_now_days'],
      benchmarks: ['target_percentile', 'capture_pct'],
      consolidation: ['rate_discount_pct', 'transition_cost_pct', 'concentration_cap_pct', 'min_vendor_count', 'max_moves'],
      wave_plan: ['quarterly_onetime_cap_musd', 'max_launches_per_quarter', 'earliest_start_month', 'latest_start_month'],
    };

    it('holds every parameter the sourcing and plan features read, in its group', () => {
      const byId = new Map(sourcing.dimensions.sourcing_param.map((p) => [p.id, p]));
      for (const [group, keys] of Object.entries(REQUIRED)) {
        for (const k of keys) expect(byId.get(k)?.group, k).toBe(group);
      }
    });

    it('each carries value, unit, min, max, step and a label, with value inside [min, max] (domain sourcingRowEntries is clean)', () => {
      sourcing.dimensions.sourcing_param.forEach((p, i) => {
        expect(typeof p.label === 'string' && p.label !== '', p.id).toBe(true);
        expect(typeof p.unit, p.id).toBe('string');
        for (const k of ['value', 'min', 'max', 'step']) expect(Number.isFinite(p[k]), `${p.id}.${k}`).toBe(true);
        expect(num(p, 'min') <= num(p, 'value') && num(p, 'value') <= num(p, 'max'), p.id).toBe(true);
        expect(num(p, 'step'), p.id).toBeGreaterThan(0);
        expect(sourcingRowEntries('sourcing_param', p.id, dimensionMemberRow(p, i + 1)), p.id).toEqual([]);
      });
    });

    it('start-month bounds use lev.start encoding (month of 2027, registry range) and the as-of month is a month', () => {
      const lev = inputs.global.bundle.variables.find((v) => v.id === 'lev.start')!;
      const byId = new Map(sourcing.dimensions.sourcing_param.map((p) => [p.id, p]));
      for (const k of ['earliest_start_month', 'latest_start_month']) {
        expect(num(byId.get(k)!, 'min'), k).toBeGreaterThanOrEqual(lev.min!);
        expect(num(byId.get(k)!, 'max'), k).toBeLessThanOrEqual(lev.max!);
      }
      expect(num(byId.get('earliest_start_month')!, 'value')).toBeLessThanOrEqual(num(byId.get('latest_start_month')!, 'value'));
      expect(num(byId.get('asof_month')!, 'max')).toBe(12);
    });
  });
});

describe('missingSourcingMembers', () => {
  it('inserts only the members the tenant lacks, as dimension_member rows with their file position as sort', () => {
    const all = missingSourcingMembers(sourcing, new Map());
    const n = SOURCING_DIMENSIONS.reduce((a, d) => a + sourcing.dimensions[d].length, 0);
    expect(all).toHaveLength(n);
    const first = sourcing.dimensions.sourcing_param[0]!;
    expect(all.find((c) => c.key === 'sourcing_param' && c.member_key === first.id)).toEqual({
      target: 'structural',
      key: 'sourcing_param',
      member_key: first.id,
      op: 'insert',
      new_value: dimensionMemberRow(first, 1),
    });
    const have = new Map(SOURCING_DIMENSIONS.map((d) => [d, new Set(sourcing.dimensions[d].map((m) => m.id))] as const));
    expect(missingSourcingMembers(sourcing, have)).toEqual([]);
    have.get('contract')!.delete(sourcing.dimensions.contract[0]!.id);
    expect(missingSourcingMembers(sourcing, have).map((c) => c.member_key)).toEqual([sourcing.dimensions.contract[0]!.id]);
  });

  it('parseSourcingSeed refuses a wrong format, an unknown dimension, a member without id or label, or a duplicate', () => {
    const ok = { format: 'glidepath.sourcing/1', dimensions: { contract: [], benchmark: [], sourcing_param: [] } };
    expect(() => parseSourcingSeed(ok)).not.toThrow();
    expect(() => parseSourcingSeed({ ...ok, format: 'x' })).toThrow(/format/);
    expect(() => parseSourcingSeed({ ...ok, dimensions: { ...ok.dimensions, vendor: [] } })).toThrow(/unknown dimension vendor/);
    expect(() => parseSourcingSeed({ ...ok, dimensions: { ...ok.dimensions, contract: [{ label: 'x' }] } })).toThrow(/string id/);
    expect(() => parseSourcingSeed({ ...ok, dimensions: { ...ok.dimensions, contract: [{ id: 'a' }] } })).toThrow(/label/);
    // vendor_bucket (added later) may be left out: no members
    expect(parseSourcingSeed(structuredClone(ok)).dimensions.vendor_bucket).toEqual([]);
    expect(parseSourcingSeed(structuredClone(ok)).dimensions.consolidation_scope).toEqual([]);
    expect(() => parseSourcingSeed({ ...ok, dimensions: { ...ok.dimensions, vendor_bucket: [{ id: 'v' }] } })).toThrow(/label/);
    const dup = [{ id: 'a', label: 'A' }, { id: 'a', label: 'B' }];
    expect(() => parseSourcingSeed({ ...ok, dimensions: { ...ok.dimensions, benchmark: dup } })).toThrow(/twice/);
  });
});

describe('vendor_bucket (SRC-06)', () => {
  it('lists exactly the aggregate vendor names of the coverage rule, each named by in-scope third-party lines, with a reason', () => {
    const coverage = (sourcing as unknown as { coverage: { aggregate_vendor_names: string[] } }).coverage;
    const buckets = sourcing.dimensions.vendor_bucket;
    expect(buckets.map((b) => str(b, 'vendor_name')).sort()).toEqual([...coverage.aggregate_vendor_names].sort());
    for (const b of buckets) {
      expect(str(b, 'reason').length, b.id).toBeGreaterThan(0);
      expect([...lines.values()].some((l) => isThirdPartyLine(l) && str(l, 'vendor') === str(b, 'vendor_name')), b.id).toBe(true);
    }
  });
});

describe('consolidation_scope (SRC-10)', () => {
  it('names third-party services pools only, each once, with a reason; software, cloud, hardware and telecom are out', () => {
    const scope = sourcing.dimensions.consolidation_scope;
    expect(scope.length).toBeGreaterThan(0);
    const pools = scope.map((m) => str(m, 'pool'));
    expect(new Set(pools).size).toBe(pools.length);
    for (const m of scope) {
      expect(thirdParty.has(str(m, 'pool')), m.id).toBe(true);
      expect(str(m, 'reason').length, m.id).toBeGreaterThan(0);
    }
    expect(pools).toContain('si_contingent');
    for (const goods of ['software', 'cloud', 'dc_hardware', 'network', 'end_user']) expect(pools).not.toContain(goods);
  });
});
