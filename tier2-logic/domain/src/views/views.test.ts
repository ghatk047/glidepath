// DOM-06 view-models, checked on the seed tenant (docs/spec/seed/aa) evaluated by the real engine.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  compileModel,
  findScenario,
  resolveInputs as engineInputs,
  type Evaluation,
} from '@glidepath/engine';
import type { Member, TenantMembers } from '@glidepath/spec';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../test-support/schema-json';
import { SEED_DIR, SPEC_DIR } from '../test-support/seed-state';
import { loadModelBundleFromDir, readTenantSeed } from '@glidepath/spec/node';
import * as domain from '../index';
import { OUT_OF_SCOPE_MEMO_DOMAIN } from '../validation';
import {
  BASELINE_GROUP_BY,
  MONTHS_IN_YEAR,
  VIEWS,
  VIEW_NAMES,
  baselineGroups,
  baselineSummary,
  bridge,
  domShareKey,
  engineCell,
  leversFamilies,
  leversMonthly,
  leversScale,
  rampWeights,
  vpsDomainOutlay,
  type ViewEvaluation,
} from './index';

type GoldenScenario = Record<string, unknown> & {
  levers: Record<string, { iy: number }>;
  vp: Record<string, { outlay: number }>;
};
const golden = JSON.parse(
  readFileSync(resolve(repoRoot, 'docs/spec/reference/golden_results.json'), 'utf8'),
) as { scenarios: Record<string, GoldenScenario> };
const goldenNum = (sid: string, key: string): number => golden.scenarios[sid]![key] as number;

/** 1e-6 relative (golden_results.json holds 6 decimals) with a 1e-9 absolute floor. */
const closeGolden = (a: number, b: number): boolean =>
  Math.abs(a - b) <= Math.max(1e-6 * Math.abs(b), 1e-9);
/** Float noise only: the same sum in another order. */
const near = (a: number, b: number): boolean =>
  Math.abs(a - b) <= Math.max(1e-9 * Math.abs(b), 1e-9);
const sum = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0);

const [bundle, seed] = await Promise.all([
  loadModelBundleFromDir(SPEC_DIR),
  readTenantSeed(SEED_DIR),
]);
const members: TenantMembers = seed.dimensionMembers;
const model = compileModel(bundle, members);
const PRESETS = seed.scenarios.scenarios.map((s) => s.id);
const evals = new Map<string, Evaluation>(
  PRESETS.map((sid) => {
    const { values, overrides } = engineInputs(
      bundle,
      seed.variableValues,
      findScenario(seed.scenarios, sid),
    );
    return [sid, model.evaluate(values, overrides)];
  }),
);
const evalOf = (sid: string): Evaluation => evals.get(sid)!;
const inputsOf = (sid: string) =>
  engineInputs(bundle, seed.variableValues, findScenario(seed.scenarios, sid));
const get = (ev: ViewEvaluation, id: string, key = ''): number => ev.get(engineCell(id, key));
const ids = (dim: string): string[] => (members[dim] ?? []).map((m) => m.id);

describe('DOM-06 bridge', () => {
  it('bridge: base, growth, savings, one-time, CY27 outlay and target outlay = base.total − res.target from node values (test)', () => {
    for (const sid of PRESETS) {
      const ev = evalOf(sid);
      const view = bridge(ev);
      const [base, growth, savings, oneTime, outlay] = view.steps;
      expect(view.steps.map((s) => s.key)).toEqual([
        'base',
        'growth',
        'savings',
        'oneTime',
        'outlay',
      ]);
      expect(view.steps.map((s) => s.cell)).toEqual([
        'base.total[]',
        'base.headwinds[]',
        'res.tot_iy[]',
        'res.tot_ot_it[]',
        'res.cy27_outlay[]',
      ]);
      // Values are the nodes' (savings signed as a reduction of outlay).
      expect(base.value).toBe(get(ev, 'base.total'));
      expect(growth.value).toBe(get(ev, 'base.headwinds'));
      expect(savings.value).toBe(-get(ev, 'res.tot_iy'));
      expect(oneTime.value).toBe(get(ev, 'res.tot_ot_it'));
      expect(outlay.value).toBe(get(ev, 'res.cy27_outlay'));
      // Extents chain, so tier 1 draws without summing; the chain lands on the CY27 outlay node.
      expect([base.from, base.to]).toEqual([0, base.value]);
      expect(growth.from).toBe(base.to);
      expect(savings.from).toBe(growth.to);
      expect(oneTime.from).toBe(savings.to);
      for (const s of [growth, savings, oneTime]) expect(near(s.to - s.from, s.value)).toBe(true);
      expect(near(oneTime.to, outlay.value)).toBe(true);
      expect([outlay.from, outlay.to]).toEqual([0, outlay.value]);
      // Target outlay and the gap bracket.
      expect(view.targetOutlay).toBe(get(ev, 'base.total') - get(ev, 'res.target'));
      expect(view.gap).toBe(outlay.value - view.targetOutlay);
      // Golden: target outlay = base.total − res.target, CY27 outlay = res.cy27_outlay.
      const target = goldenNum(sid, 'base.total') - goldenNum(sid, 'res.target');
      expect(closeGolden(view.targetOutlay, target), `${sid} ${view.targetOutlay}`).toBe(true);
      expect(closeGolden(outlay.value, goldenNum(sid, 'res.cy27_outlay'))).toBe(true);
    }
    // Preset C (the Cockpit render): target outlay 907.6, gap = CY27 outlay − target outlay.
    const c = bridge(evalOf('C'));
    expect(
      closeGolden(c.targetOutlay, goldenNum('C', 'base.total') - goldenNum('C', 'res.target')),
    ).toBe(true);
    expect(closeGolden(c.gap, goldenNum('C', 'res.cy27_outlay') - c.targetOutlay)).toBe(true);
  });
});

describe('DOM-06 baseline', () => {
  it('baseline.groups(by pool|domain|vp): two-level group → line values; pool groups equal base.pool_outlay; group totals sum to base.total; VP grouping splits lines by org.dom_share and agrees with the VP module (test)', () => {
    for (const sid of PRESETS) {
      const ev = evalOf(sid);
      const total = get(ev, 'base.total');
      for (const by of BASELINE_GROUP_BY) {
        const view = baselineGroups(ev, members, by);
        expect(view.total).toBe(total);
        // Group totals sum to base.total; every group's value is the sum of its lines.
        expect(near(sum(view.groups.map((g) => g.value)), total), `${sid} ${by}`).toBe(true);
        for (const g of view.groups) {
          expect(near(sum(g.lines.map((l) => l.value)), g.value), `${sid} ${by} ${g.key}`).toBe(
            true,
          );
        }
        // Groups are the grouping dimension's members, labelled.
        expect(new Set(view.groups.map((g) => g.key))).toEqual(new Set(ids(by)));
        for (const g of view.groups) expect(g.label).not.toBe('');
      }

      const pools = baselineGroups(ev, members, 'pool');
      for (const g of pools.groups) {
        expect(g.value).toBe(get(ev, 'base.pool_outlay', g.key));
        for (const l of g.lines) expect(l.value).toBe(get(ev, 'base.line_outlay', l.key));
      }
      // Pool groups follow the pool `order` attribute; each line sits in exactly one group.
      const order = (members['pool'] ?? []).map((p) => [p.id, p['order'] as number] as const);
      expect(pools.groups.map((g) => g.key)).toEqual(
        [...order].sort((a, b) => a[1] - b[1]).map(([id]) => id),
      );
      expect(pools.groups.flatMap((g) => g.lines.map((l) => l.key)).sort()).toEqual(
        ids('line').sort(),
      );
      const domains = baselineGroups(ev, members, 'domain');
      expect(domains.groups.flatMap((g) => g.lines.map((l) => l.key)).sort()).toEqual(
        ids('line').sort(),
      );

      const vps = baselineGroups(ev, members, 'vp');
      for (const g of vps.groups) {
        // Totals agree with the VP module's outlay (the node, and golden_results.json).
        expect(g.value).toBe(get(ev, 'vp.outlay', g.key));
        expect(
          closeGolden(g.value, golden.scenarios[sid]!.vp[g.key]!.outlay),
          `${sid} ${g.key}`,
        ).toBe(true);
        // Each line is its outlay times its domain's share owned by the VP.
        for (const l of g.lines) {
          const line = members['line']!.find((m) => m.id === l.key)!;
          const share = get(ev, 'org.dom_share', domShareKey(line['domain'] as string, g.key));
          expect(share).not.toBe(0);
          expect(l.value).toBe(get(ev, 'base.line_outlay', l.key) * share);
        }
      }
    }
  });

  it('baseline.groups by vp splits a shared domain across its owners', () => {
    const { values, overrides } = inputsOf('C');
    const split = new Map(values);
    const domain = 'data_analytics';
    for (const vp of ids('vp')) split.set(engineCell('org.dom_share', domShareKey(domain, vp)), 0);
    split.set(engineCell('org.dom_share', domShareKey(domain, 'vp_commercial')), 0.25);
    split.set(engineCell('org.dom_share', domShareKey(domain, 'vp_corporate')), 0.75);
    const ev = model.evaluate(split, overrides);
    const view = baselineGroups(ev, members, 'vp');
    const lineIds = members['line']!.filter((l) => l['domain'] === domain).map((l) => l.id);
    expect(lineIds.length).toBeGreaterThan(0);
    const byVp = new Map(
      view.groups.map((g) => [g.key, new Map(g.lines.map((l) => [l.key, l.value]))]),
    );
    for (const id of lineIds) {
      const outlay = get(ev, 'base.line_outlay', id);
      expect(byVp.get('vp_commercial')!.get(id)).toBe(outlay * 0.25);
      expect(byVp.get('vp_corporate')!.get(id)).toBe(outlay * 0.75);
      expect(byVp.get('vp_operations')!.has(id)).toBe(false);
    }
    for (const g of view.groups) {
      expect(g.value).toBe(get(ev, 'vp.outlay', g.key));
      expect(near(sum(g.lines.map((l) => l.value)), g.value)).toBe(true);
    }
    expect(near(sum(view.groups.map((g) => g.value)), view.total)).toBe(true);
  });

  it('baseline.summary counts every line and the lines in scope', () => {
    const lines = members['line']!;
    expect(baselineSummary(members)).toEqual({
      lines: lines.length,
      linesInScope: lines.filter((l) => l['in_scope'] === 1).length,
    });
    expect(baselineSummary(members).linesInScope).toBeLessThan(lines.length);
    expect(
      baselineSummary({
        line: [{ id: 'a', in_scope: true }, { id: 'b', in_scope: false }, { id: 'c' }],
      }),
    ).toEqual({ lines: 3, linesInScope: 1 });
  });
});

describe('DOM-06 levers', () => {
  it('levers.families: Σ lev.iy by lever category, sums to res.tot_iy (test)', () => {
    for (const sid of PRESETS) {
      const ev = evalOf(sid);
      const view = leversFamilies(ev, members);
      expect(view.total).toBe(get(ev, 'res.tot_iy'));
      expect(closeGolden(view.total, goldenNum(sid, 'res.tot_iy'))).toBe(true);
      expect(near(sum(view.families.map((f) => f.value)), view.total), sid).toBe(true);
      // Every lever in exactly one family, the family being its category.
      expect(view.families.flatMap((f) => f.levers).sort()).toEqual(ids('lever').sort());
      for (const f of view.families) {
        expect(f.label).toBe(f.key);
        for (const id of f.levers) {
          expect(members['lever']!.find((l) => l.id === id)!['category']).toBe(f.key);
        }
        expect(f.value).toBe(sum(f.levers.map((id) => get(ev, 'lev.iy', id))));
      }
    }
    // Families come in order of their first lever (`order` attribute), levers in display order.
    const byOrder = [...members['lever']!].sort(
      (a, b) => (a['order'] as number) - (b['order'] as number),
    );
    const expected = new Map<string, string[]>();
    for (const l of byOrder) {
      const cat = l['category'] as string;
      expected.set(cat, [...(expected.get(cat) ?? []), l.id]);
    }
    const view = leversFamilies(evalOf('C'), members);
    expect(view.families.map((f) => [f.key, f.levers])).toEqual([...expected]);
  });

  it('levers.scale: max lev.iy across levers in preset D (test)', () => {
    const max = Math.max(...Object.values(golden.scenarios['D']!.levers).map((l) => l.iy));
    const view = leversScale(evalOf('D'), members);
    expect(closeGolden(view.max, max)).toBe(true);
    expect(view.max).toBe(Math.max(...ids('lever').map((id) => get(evalOf('D'), 'lev.iy', id))));
    // Every preset's bars fit under D's scale on the seed tenant.
    for (const sid of PRESETS) {
      for (const id of ids('lever'))
        expect(get(evalOf(sid), 'lev.iy', id)).toBeLessThanOrEqual(view.max);
    }
    expect(leversScale(evalOf('D'), {})).toEqual({ max: 0 });
  });

  it("levers.monthly: 12 monthly values per lever derived with the formula graph's own ramp semantics so Σ months = lev.iy per lever (test)", () => {
    for (const sid of PRESETS) {
      const ev = evalOf(sid);
      const view = leversMonthly(ev, members);
      expect(view.levers.map((l) => l.key).sort()).toEqual(ids('lever').sort());
      for (const l of view.levers) {
        expect(l.values).toHaveLength(MONTHS_IN_YEAR);
        expect(near(sum(l.values), get(ev, 'lev.iy', l.key)), `${sid} ${l.key}`).toBe(true);
        expect(closeGolden(sum(l.values), golden.scenarios[sid]!.levers[l.key]!.iy)).toBe(true);
        // The shape is the formula graph's: Σ weights / 12 = lev.ramp_factor, and month m is
        // lev.rr × lev.realize × w_m / 12.
        const w = rampWeights(get(ev, 'lev.eff_start', l.key), get(ev, 'lev.ramp', l.key));
        expect(near(sum(w) / MONTHS_IN_YEAR, get(ev, 'lev.ramp_factor', l.key))).toBe(true);
        const rr = get(ev, 'lev.rr', l.key) * get(ev, 'lev.realize', l.key);
        l.values.forEach((v, m) => expect(near(v, (rr * w[m]!) / MONTHS_IN_YEAR)).toBe(true));
        // Nothing before the effective start month; non-decreasing after it.
        const start = get(ev, 'lev.eff_start', l.key);
        l.values.forEach((v, m) => {
          if (m + 1 < start) expect(v).toBe(0);
          if (m > 0) expect(v).toBeGreaterThanOrEqual(l.values[m - 1]! - 1e-12);
        });
      }
      // Family series are the month-by-month sums of their levers, in levers.families order.
      const families = leversFamilies(ev, members);
      expect(view.families.map((f) => f.key)).toEqual(families.families.map((f) => f.key));
      for (const f of view.families) {
        expect(f.values).toHaveLength(MONTHS_IN_YEAR);
        const own = view.levers.filter((l) => l.family === f.key);
        f.values.forEach((v, m) => expect(near(v, sum(own.map((l) => l.values[m]!)))).toBe(true));
        expect(near(sum(f.values), families.families.find((x) => x.key === f.key)!.value)).toBe(
          true,
        );
      }
    }
  });

  it('levers.monthly follows lev.start, lev.ramp and g.head_start edits, and a pinned lev.iy', () => {
    const { values, overrides } = inputsOf('C');
    const edited = new Map(values);
    edited.set(engineCell('lev.start', 'L01'), 7);
    edited.set(engineCell('lev.ramp', 'L01'), 4);
    edited.set(engineCell('g.head_start'), 2);
    const pins = new Map(overrides);
    pins.set(engineCell('lev.iy', 'L02'), 3);
    const ev = model.evaluate(edited, pins);
    const view = leversMonthly(ev, members);
    const l01 = view.levers.find((l) => l.key === 'L01')!;
    // eff_start = 7 − 2 = 5: Jan–Apr empty, then 1/4, 2/4, 3/4, then full months.
    expect(get(ev, 'lev.eff_start', 'L01')).toBe(5);
    const full = l01.values[11]!;
    expect(l01.values.slice(0, 4)).toEqual([0, 0, 0, 0]);
    expect(near(l01.values[4]!, full / 4)).toBe(true);
    expect(near(l01.values[6]!, (full * 3) / 4)).toBe(true);
    expect(near(sum(l01.values), get(ev, 'lev.iy', 'L01'))).toBe(true);
    const l02 = view.levers.find((l) => l.key === 'L02')!;
    expect(near(sum(l02.values), 3)).toBe(true);
  });

  it('rampWeights: linear ramp from the start month, step when the ramp is 0', () => {
    expect(rampWeights(1, 3)).toEqual([1 / 3, 2 / 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(rampWeights(11, 4)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.25, 0.5]);
    expect(rampWeights(12, 0)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
    expect(rampWeights(13, 1)).toEqual(new Array(MONTHS_IN_YEAR).fill(0));
  });
});

describe('DOM-06 vps', () => {
  it('vps.domain_outlay: outlay per domain for the ownership editor (test)', () => {
    for (const sid of PRESETS) {
      const ev = evalOf(sid);
      const view = vpsDomainOutlay(ev, members);
      // Every domain but the memo one, in domain order.
      expect(view.domains.map((d) => d.key)).toEqual(
        ids('domain').filter((d) => d !== OUT_OF_SCOPE_MEMO_DOMAIN),
      );
      for (const d of view.domains) {
        const own = members['line']!.filter((l) => l['domain'] === d.key);
        expect(near(d.value, sum(own.map((l) => get(ev, 'base.line_outlay', l.id))))).toBe(true);
      }
      // Agrees with the baseline grouping by domain and, through the shares, with vp.outlay.
      const byDomain = new Map(
        baselineGroups(ev, members, 'domain').groups.map((g) => [g.key, g.value]),
      );
      for (const d of view.domains) expect(d.value).toBe(byDomain.get(d.key));
      for (const vp of ids('vp')) {
        const owned = sum(
          view.domains.map((d) => d.value * get(ev, 'org.dom_share', domShareKey(d.key, vp))),
        );
        expect(near(owned, get(ev, 'vp.outlay', vp)), `${sid} ${vp}`).toBe(true);
      }
      expect(near(sum(view.domains.map((d) => d.value)), get(ev, 'base.total'))).toBe(true);
    }
  });
});

describe('DOM-06 views: registry, purity, edge cases', () => {
  it('all functions pure, no IO (lint)', { timeout: 60_000 }, async () => {
    const pkgDir = resolve(repoRoot, 'tier2-logic/domain');
    const eslint = new ESLint({ cwd: pkgDir });
    const results = await eslint.lintFiles([join(pkgDir, 'src/views/*.ts')]);
    const linted = results.filter((r) => !r.filePath.endsWith('.test.ts'));
    expect(linted.length).toBeGreaterThanOrEqual(6);
    const errors = linted.flatMap((r) =>
      r.messages
        .filter((m) => m.severity === 2)
        .map((m) => `${r.filePath}: ${m.ruleId} ${m.message}`),
    );
    expect(errors).toEqual([]);
    // The purity rules apply to these files: an IO import in src/views is rejected.
    const [probe] = await eslint.lintText(
      "import { readFileSync } from 'node:fs';\nexport const f = readFileSync;\n",
      {
        filePath: join(pkgDir, 'src/views/probe.ts'),
      },
    );
    expect(probe!.messages.map((m) => m.ruleId)).toContain('no-restricted-imports');
  });

  it("names every contract view and uses the contract's month count (ws.ts, read as text)", () => {
    // Domain may not import the contract (02 §1); the server validates payloads with viewSchemas.
    const ws = readFileSync(resolve(repoRoot, 'contract/api-contract/src/ws.ts'), 'utf8');
    const names = /export const viewNames = \[([^\]]*)\]/.exec(ws)![1]!;
    expect([...names.matchAll(/'([^']+)'/g)].map((m) => m[1])).toEqual([...VIEW_NAMES]);
    expect(Object.keys(VIEWS).sort()).toEqual([...VIEW_NAMES].sort());
    expect(/export const MONTHS_IN_YEAR = (\d+);/.exec(ws)![1]).toBe(String(MONTHS_IN_YEAR));
    const by = /export const BaselineGroupBy = z\.enum\(\[([^\]]*)\]\)/.exec(ws)![1]!;
    expect([...by.matchAll(/'([^']+)'/g)].map((m) => m[1])).toEqual([...BASELINE_GROUP_BY]);
    // The month count is also the registry's last start month.
    expect(bundle.variables.find((v) => v.id === 'lev.start')!.max).toBe(MONTHS_IN_YEAR);
    // org.dom_share keys are `domain,vp`.
    expect(bundle.variables.find((v) => v.id === 'org.dom_share')!.dims).toEqual(['domain', 'vp']);
  });

  it('VIEWS dispatches each view by its contract name', () => {
    const ev = evalOf('C');
    expect(VIEWS.bridge(ev, members, {})).toEqual(bridge(ev));
    expect(VIEWS['baseline.groups'](ev, members, { by: 'domain' })).toEqual(
      baselineGroups(ev, members, 'domain'),
    );
    expect(VIEWS['baseline.summary'](ev, members, {})).toEqual(baselineSummary(members));
    expect(VIEWS['levers.families'](ev, members, {})).toEqual(leversFamilies(ev, members));
    expect(VIEWS['levers.monthly'](ev, members, {})).toEqual(leversMonthly(ev, members));
    expect(VIEWS['levers.scale'](evalOf('D'), members, {})).toEqual(
      leversScale(evalOf('D'), members),
    );
    expect(VIEWS['vps.domain_outlay'](ev, members, {})).toEqual(vpsDomainOutlay(ev, members));
  });

  it('reads absent cells as 0 and falls back to ids, array order and the category-less lever', () => {
    const empty: ViewEvaluation = { get: () => Number.NaN, has: () => false };
    const tiny: Record<string, Member[]> = {
      line: [
        { id: 'l1', pool: 'p1', domain: 'd1' },
        { id: 'l2', pool: 'p1' },
      ],
      pool: [{ id: 'p2' }, { id: 'p1', label: '' }],
      domain: [{ id: 'd1' }],
      vp: [{ id: 'v1', order: 1 }],
      lever: [
        { id: 'Lb', order: 2, category: 'x' },
        { id: 'La', order: 1 },
      ],
    };
    const pools = baselineGroups(empty, tiny, 'pool');
    expect(pools).toEqual({
      total: 0,
      groups: [
        { key: 'p2', label: 'p2', value: 0, lines: [] },
        {
          key: 'p1',
          label: 'p1',
          value: 0,
          lines: [
            { key: 'l1', value: 0 },
            { key: 'l2', value: 0 },
          ],
        },
      ],
    });
    expect(baselineGroups(empty, tiny, 'vp').groups).toEqual([
      { key: 'v1', label: 'v1', value: 0, lines: [] },
    ]);
    expect(vpsDomainOutlay(empty, tiny)).toEqual({ domains: [{ key: 'd1', value: 0 }] });
    expect(leversFamilies(empty, tiny).families.map((f) => [f.key, f.levers])).toEqual([
      ['La', ['La']],
      ['x', ['Lb']],
    ]);
    expect(leversMonthly(empty, tiny).levers[0]!.values).toEqual(new Array(MONTHS_IN_YEAR).fill(0));
    expect(baselineSummary({})).toEqual({ lines: 0, linesInScope: 0 });
    expect(bridge(empty).steps.map((s) => s.value)).toEqual([0, 0, -0, 0, 0]);
  });
});

describe('DOM-06 package exports', () => {
  it('exports the DOM-06 contract from @glidepath/domain: one function per view and VIEWS', () => {
    for (const fn of [
      'bridge',
      'baselineGroups',
      'baselineSummary',
      'leversFamilies',
      'leversMonthly',
      'leversScale',
      'vpsDomainOutlay',
    ] as const) {
      expect(typeof domain[fn]).toBe('function');
    }
    expect(domain.VIEWS).toBe(VIEWS);
    // An engine Evaluation is a ViewEvaluation.
    const ev: ViewEvaluation = evalOf('C');
    expect(domain.bridge(ev)).toEqual(bridge(ev));
  });
});
