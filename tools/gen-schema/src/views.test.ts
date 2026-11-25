import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  checkMigrations,
  RLS_MIGRATION,
  SCHEMA_MIGRATION,
  VIEWS_MIGRATION,
} from './generate';
import { buildModel, type ModelTable } from './model';
import { loadSchema, loadViewInputs, repoRoot } from './spec';
import { startTestCluster, sqlError, type Session, type TestCluster } from './testing/db';
import { insertSql, rowFor, type Row } from './testing/rows';
import { INPUTS_VIEW, LINE_ATTRIBUTES, MEMBERS_VIEW, modelDimensions, renderViewsSql } from './views';

/**
 * DATA-03 acceptance, on a pg-local cluster bootstrapped with tier3-data/postgres/init, migrated as
 * glidepath_owner (0001 schema, 0002 RLS, 0003 views), queried as glidepath_app.
 */

const APP = 'glidepath_app';
const OWNER = 'glidepath_owner';

interface Fixture {
  tenant_id: string;
  variable_def: { var_key: string; dims: string[] }[];
  variable_value: { var_key: string; member_key: string; value: number }[];
  scenario: { id: string; key: string; parent_id: string | null }[];
  scenario_value: { scenario_id: string; var_key: string; member_key: string; value: number }[];
  node_override: { scenario_id: string; node_key: string; member_key: string; value: number; reason: string }[];
  expected: Record<
    string,
    {
      chain: string[];
      values: { var_key: string; member_key: string; value: number; scenario_id: string | null }[];
      overrides: { node_key: string; member_key: string; value: number; reason: string }[];
    }
  >;
}

// The fixture DOM-01's resolveInputs is tested with: root -> child -> grandchild, plus a sibling.
const fixture: Fixture = JSON.parse(
  readFileSync(resolve(repoRoot, 'tier2-logic/domain/fixtures/scenario-chain-3.json'), 'utf8'),
);
const schema = loadSchema();
const model = buildModel(schema);
const inputs = loadViewInputs();
const table = (n: string): ModelTable => model.tables.find((t) => t.name === n)!;

const A = fixture.tenant_id;
const B = randomUUID();
/** Tenant B holds the same cells under other scenario ids and other values: any leak changes an answer. */
const OFFSET = 1000;
const idB = new Map(fixture.scenario.map((s) => [s.id, randomUUID()]));

let db: TestCluster;

/** One transaction as `role` with SET LOCAL app.tenant_id; rolled back unless `commit`. */
async function asTenant<T>(
  role: string,
  tenant: string | null,
  fn: (s: Session) => Promise<T>,
  commit = false,
): Promise<T> {
  return db.withSession({ role }, async (s) => {
    await s.query('BEGIN');
    try {
      if (tenant) await s.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant]);
      const r = await fn(s);
      await s.query(commit ? 'COMMIT' : 'ROLLBACK');
      return r;
    } catch (e) {
      await s.query('ROLLBACK').catch(() => undefined);
      throw e;
    }
  });
}

const put = (s: Session, t: string, row: Row) => {
  const { text, values } = insertSql(table(t), row);
  return s.query(text, values);
};
const arr = (xs: string[]) => `{${xs.join(',')}}`;

interface Cell {
  key: string;
  member_key: string;
  value: number;
  resolved_from: string;
  from_scenario_id: string | null;
}

async function resolved(s: Session, tenant: string, scenario: string | null, kind = 'input'): Promise<Cell[]> {
  const r = await s.query(
    `SELECT key, member_key, value, resolved_from, from_scenario_id FROM v_inputs_resolved
     WHERE tenant_id = $1 AND scenario_id IS NOT DISTINCT FROM $2 AND kind = $3
     ORDER BY key COLLATE "C", member_key COLLATE "C"`,
    [tenant, scenario, kind],
  );
  return r.rows.map((x: Record<string, string | null>) => ({
    key: x.key!,
    member_key: x.member_key!,
    value: Number(x.value),
    resolved_from: x.resolved_from!,
    from_scenario_id: x.from_scenario_id ?? null,
  }));
}

/** The expected cells for `scenario` from the fixture, in the view's terms. */
function expectedCells(key: string, scenarioId: string): Cell[] {
  return fixture.expected[key]!.values.map((v) => ({
    key: v.var_key,
    member_key: v.member_key,
    value: v.value,
    resolved_from: v.scenario_id === null ? 'tenant' : v.scenario_id === scenarioId ? 'scenario' : 'parent',
    from_scenario_id: v.scenario_id ?? null,
  }));
}

interface MemberRow {
  tenant_id: string | null;
  dim_key: string;
  member_key: string;
  label: string;
  attrs: Record<string, unknown>;
  sort: string;
  active: string;
  origin: string;
  t: string;
}
const jsonRows = async (s: Session, sql: string, params?: unknown[]): Promise<MemberRow[]> =>
  (await s.query(sql, params)).rows.map((r: Record<string, string>) => ({
    ...r,
    attrs: JSON.parse(r.attrs!) as Record<string, unknown>,
  })) as MemberRow[];

beforeAll(async () => {
  db = await startTestCluster('gp_views');
  await db.migrate([SCHEMA_MIGRATION, RLS_MIGRATION, VIEWS_MIGRATION], { role: OWNER });

  const mv = rowFor(table('model_version'), 'mv', {});
  const pool = [
    rowFor(table('canonical_pool'), 'p1', {}, { id: 'pool_a', label: 'Pool A', third_party: 'true', sort: '1' }),
    rowFor(table('canonical_pool'), 'p2', {}, { id: 'pool_b', label: 'Pool B', third_party: 'false', sort: '2' }),
  ];
  const tags = ['locked', 'partly', 'addressable'].map((id) =>
    rowFor(table('addr_tag'), id, {}, { id, label: `Tag ${id}` }),
  );
  await asTenant(
    OWNER,
    null,
    async (s) => {
      await put(s, 'model_version', mv);
      for (const d of fixture.variable_def)
        await put(
          s,
          'variable_def',
          rowFor(table('variable_def'), d.var_key, { model_version: mv }, { var_key: d.var_key, dims: arr(d.dims) }),
        );
      for (const r of [...pool.map((p) => ['canonical_pool', p] as const), ...tags.map((t) => ['addr_tag', t] as const)])
        await put(s, r[0], r[1]);
    },
    true,
  );

  for (const tenant of [A, B]) {
    const isA = tenant === A;
    const sid = (id: string) => (isA ? id : idB.get(id)!);
    const bump = (v: number) => (isA ? v : v + OFFSET);
    await asTenant(
      OWNER,
      tenant,
      async (s) => {
        const t = rowFor(table('tenant'), isA ? 'A' : 'B', { model_version: mv }, { id: tenant, slug: isA ? 'a' : 'b' });
        await put(s, 'tenant', t);
        const parents = { model_version: mv, tenant: t };
        // parents before children
        const byId = new Map(fixture.scenario.map((x) => [x.id, x]));
        const depth = (x: { id: string; parent_id: string | null }): number =>
          x.parent_id ? 1 + depth(byId.get(x.parent_id)!) : 0;
        for (const sc of [...fixture.scenario].sort((x, y) => depth(x) - depth(y)))
          await put(
            s,
            'scenario',
            rowFor(table('scenario'), sc.key, parents, {
              tenant_id: tenant,
              id: sid(sc.id),
              key: sc.key,
              parent_id: sc.parent_id ? sid(sc.parent_id) : null,
            }),
          );
        for (const v of fixture.variable_value)
          await put(
            s,
            'variable_value',
            rowFor(table('variable_value'), 'vv', parents, {
              tenant_id: tenant,
              var_key: v.var_key,
              member_key: v.member_key,
              value: String(bump(v.value)),
              confidence: 'M',
              note: `default of ${v.var_key}`,
            }),
          );
        for (const v of fixture.scenario_value)
          await put(
            s,
            'scenario_value',
            rowFor(table('scenario_value'), 'sv', parents, {
              tenant_id: tenant,
              scenario_id: sid(v.scenario_id),
              var_key: v.var_key,
              member_key: v.member_key,
              value: String(bump(v.value)),
            }),
          );
        for (const o of fixture.node_override)
          await put(
            s,
            'node_override',
            rowFor(table('node_override'), 'no', parents, {
              tenant_id: tenant,
              scenario_id: sid(o.scenario_id),
              node_key: o.node_key,
              member_key: o.member_key,
              value: String(bump(o.value)),
              reason: o.reason,
            }),
          );

        // members: tenant dimension rows (one in a dimension the model serves, which must not show), lines
        const dm = (dim: string, key: string, over: Row = {}) =>
          put(
            s,
            'dimension_member',
            rowFor(table('dimension_member'), key, parents, {
              tenant_id: tenant,
              dim_key: dim,
              member_key: key,
              label: `${isA ? 'A' : 'B'} ${key}`,
              attrs: '{}',
              active: 'true',
              ...over,
            }),
          );
        await dm('vp', 'vp_one', { sort: '2' });
        await dm('vp', 'vp_two', { sort: '1', active: 'false' });
        await dm('lever', 'L01', { attrs: JSON.stringify({ alloc_key: 'pool_a' }), sort: '1' });
        await dm('year', 'fy99', { label: 'must not show' });
        await dm('pool', 'pool_zz', { label: 'must not show' });
        const src = rowFor(table('source'), 'src', parents, { tenant_id: tenant, code: `S-${isA ? 'A' : 'B'}` });
        await put(s, 'source', src);
        const line = async (key: string, over: Row = {}) => {
          const row = rowFor(table('line_item'), key, { ...parents, canonical_pool: pool[0]!, addr_tag: tags[0]! }, {
              tenant_id: tenant,
              member_key: key,
              legacy_id: `L-${key}`,
              name: `${isA ? 'A' : 'B'} line ${key}`,
              pool_id: 'pool_a',
              addr_tag: 'partly',
              domain_key: 'dom_x',
              vendor_key: 'dxc',
              scale_driver: 'gcc',
              in_scope: 'true',
              memo: 'false',
              confidence: 'M',
              active: 'true',
              ...over,
            });
          await put(s, 'line_item', row);
          return row;
        };
        await line('it_002', { source_id: src.id!, in_scope: 'false', memo: 'true', vendor_key: null });
        const it001 = await line('it_001', { source_id: src.id! });
        await line('it_003', { active: 'false', source_id: null });
        for (const code of ['L09', 'L01'])
          await put(
            s,
            'line_item_lever',
            rowFor(table('line_item_lever'), code, { ...parents, line_item: it001 }, {
              tenant_id: tenant,
              line_key: 'it_001',
              lever_code: code,
            }),
          );
      },
      true,
    );
  }
}, 180_000);
afterAll(() => db?.stop());

describe('DATA-03 acceptance', () => {
  it('v_inputs_resolved returns definition -> tenant default -> parent chain -> scenario, last wins, plus the scenario node overrides (3-level scenario chain fixture)', async () => {
    expect(Object.keys(fixture.expected).sort()).toEqual(['child', 'grandchild', 'root', 'sibling']);
    await asTenant(APP, A, async (s) => {
      for (const sc of fixture.scenario) {
        const exp = fixture.expected[sc.key]!;
        // every level that supplied a value is on the scenario's chain, root first
        expect(exp.chain.at(-1), sc.key).toBe(sc.id);
        // the resolved cells: value, level that won (scenario / parent / tenant) and the scenario that set it
        expect(await resolved(s, A, sc.id), sc.key).toEqual(expectedCells(sc.key, sc.id));
        // node overrides: the scenario's own, not inherited
        const ov = (await resolved(s, A, sc.id, 'override')).map((o) => ({
          node_key: o.key,
          member_key: o.member_key,
          value: o.value,
          from: o.from_scenario_id,
          resolved_from: o.resolved_from,
        }));
        expect(ov, sc.key).toEqual(
          exp.overrides.map((o) => ({
            node_key: o.node_key,
            member_key: o.member_key,
            value: o.value,
            from: sc.id,
            resolved_from: 'scenario',
          })),
        );
      }
      // the levels, spelled out for the 3-level chain: grandchild reads the tenant default (head_start),
      // the root (L01.cut), the child (L05.nb) and itself (L09.n)
      const gc = fixture.scenario.find((x) => x.key === 'grandchild')!;
      const by = new Map((await resolved(s, A, gc.id)).map((c) => [`${c.key}[${c.member_key}]`, c]));
      expect(by.get('g.head_start[]')).toMatchObject({ value: 1, resolved_from: 'tenant', from_scenario_id: null });
      expect(by.get('lev.L01.cut[]')).toMatchObject({ value: 0.1, resolved_from: 'parent' });
      expect(by.get('lev.L05.nb[]')).toMatchObject({ value: 0.3, resolved_from: 'parent' });
      expect(by.get('lev.L09.n[]')).toMatchObject({ value: 40, resolved_from: 'scenario', from_scenario_id: gc.id });
      // a variable outside the pinned model version is dropped at every level
      expect([...by.keys()].some((k) => k.startsWith('zz.'))).toBe(false);

      // scenario_id NULL: the tenant defaults alone (of the pinned model version)
      const defined = new Set(fixture.variable_def.map((d) => d.var_key));
      expect(await resolved(s, A, null)).toEqual(
        fixture.variable_value
          .filter((v) => defined.has(v.var_key))
          .map((v) => ({ key: v.var_key, member_key: v.member_key, value: v.value, resolved_from: 'tenant', from_scenario_id: null }))
          .sort((x, y) => (x.key + '\0' + x.member_key < y.key + '\0' + y.member_key ? -1 : 1)),
      );
      // the tenant default carries its confidence and note; scenario levels carry none
      const r = await s.query(
        `SELECT confidence, note FROM v_inputs_resolved WHERE tenant_id = $1 AND scenario_id IS NULL AND key = 'g.target_net'`,
        [A],
      );
      expect(r.rows).toEqual([{ confidence: 'M', note: 'default of g.target_net' }]);
    });

    // a parent cycle (not prevented by the schema) ends the chain instead of looping
    await asTenant(OWNER, A, async (s) => {
      const root = fixture.scenario.find((x) => x.key === 'root')!;
      const gc = fixture.scenario.find((x) => x.key === 'grandchild')!;
      await s.query(`UPDATE scenario SET parent_id = $1 WHERE id = $2`, [gc.id, root.id]);
      const cells = await resolved(s, A, gc.id);
      expect(cells.length).toBeGreaterThan(0);
      expect(cells.find((c) => c.key === 'g.target_net')).toMatchObject({ value: 130, resolved_from: 'scenario' });
    });
  });

  it('v_dimension_members = UNION of global members (canonical_pool, addr_tag, system dims), dimension_member and line_item, with attrs as jsonb', async () => {
    const { system } = modelDimensions(inputs);
    expect(system.sort()).toEqual(['akey', 'iyear', 'year']);
    const rows = await asTenant(APP, A, (s) =>
      jsonRows(
        s,
        `SELECT tenant_id, dim_key, member_key, label, attrs, sort, active, origin, jsonb_typeof(attrs) AS t
         FROM v_dimension_members ORDER BY origin, dim_key, sort, member_key COLLATE "C"`,
      ),
    );
    const of = (origin: string, dim?: string) =>
      rows.filter((r) => r.origin === origin && (dim === undefined || r.dim_key === dim));
    expect(rows.every((r) => r.t === 'object')).toBe(true);

    // global: canonical_pool (third_party and order as the 0/1 and number expressions use)
    expect(of('global', 'pool').map((r) => [r.tenant_id, r.member_key, r.label, r.attrs, r.sort, r.active])).toEqual([
      [null, 'pool_a', 'Pool A', { third_party: 1, order: 1 }, '1', 't'],
      [null, 'pool_b', 'Pool B', { third_party: 0, order: 2 }, '2', 't'],
    ]);
    // global: addr_tag
    expect(of('global', 'addr_tag').map((r) => [r.member_key, r.label, r.attrs])).toEqual([
      ['addressable', 'Tag addressable', {}],
      ['locked', 'Tag locked', {}],
      ['partly', 'Tag partly', {}],
    ]);
    // global: system dimensions, members and attributes straight from the spec bundle, in spec order
    for (const dim of system) {
      const spec = inputs.members[dim]!;
      expect(spec.length, dim).toBeGreaterThan(0);
      expect(
        of('system', dim)
          .sort((x, y) => Number(x.sort) - Number(y.sort))
          .map((r) => ({ id: r.member_key, label: r.label, ...r.attrs })),
        dim,
      ).toEqual(spec.map((m) => ({ ...m })));
      expect(of('system', dim).every((r) => r.tenant_id === null && r.active === 't')).toBe(true);
    }
    expect(of('system', 'year').find((r) => r.member_key === 'fy27it')!.attrs).toEqual({ in: 'fy27', prev: 'fy26', it: 1 });

    // dimension_member: the tenant's rows, attrs as stored; never a dimension the model serves
    expect(of('tenant').map((r) => [r.tenant_id, r.dim_key, r.member_key, r.label, r.attrs, r.sort, r.active])).toEqual([
      [A, 'lever', 'L01', 'A L01', { alloc_key: 'pool_a' }, '1', 't'],
      [A, 'vp', 'vp_two', 'A vp_two', {}, '1', 'f'],
      [A, 'vp', 'vp_one', 'A vp_one', {}, '2', 't'],
    ]);

    // line_item: attributes under the names of formula_graph.json (line.pool, line.domain, ...)
    const lines = of('line_item');
    expect(lines.map((r) => [r.tenant_id, r.dim_key, r.member_key, r.label, r.sort, r.active])).toEqual([
      [A, 'line', 'it_001', 'A line it_001', '1', 't'],
      [A, 'line', 'it_002', 'A line it_002', '2', 't'],
      [A, 'line', 'it_003', 'A line it_003', '3', 'f'],
    ]);
    const line = inputs.dimensions.find((d) => d.id === 'line')!;
    for (const l of lines) expect(Object.keys(l.attrs).sort(), l.member_key).toEqual([...line.attributes].sort());
    expect(Object.keys(LINE_ATTRIBUTES).sort()).toEqual([...line.attributes].sort());
    const src = (await asTenant(APP, A, (s) => s.q(`SELECT code FROM source WHERE tenant_id = $1`, [A]))).trim();
    expect(lines[0]!.attrs).toEqual({
      pool: 'pool_a',
      domain: 'dom_x',
      addr: 'partly',
      drv: 'gcc',
      l2: 'it_001-l2',
      name: 'A line it_001',
      vendor: 'dxc',
      nature: 'it_001-nature',
      accounting: 'it_001-accounting',
      lever_ids: ['L01', 'L09'],
      in_scope: 1,
      memo: 0,
      confidence: 'M',
      source: src,
      legacy_id: 'L-it_001',
    });
    expect(lines[1]!.attrs).toMatchObject({ in_scope: 0, memo: 1, vendor: null, lever_ids: [] });
    expect(lines[2]!.attrs).toMatchObject({ source: null });
  });

  it('both views are security_invoker, so RLS applies to the caller (as glidepath_app: own tenant only, nothing without a tenant, read-only)', async () => {
    // catalog
    const opts = (
      await db.q(
        `select relname, relkind, coalesce(reloptions::text, '') from pg_class
         where relnamespace = 'public'::regnamespace and relname in ('${INPUTS_VIEW}', '${MEMBERS_VIEW}') order by 1`,
      )
    ).split('\n');
    expect(opts).toEqual([`${MEMBERS_VIEW}|v|{security_invoker=true}`, `${INPUTS_VIEW}|v|{security_invoker=true}`].sort());

    // tenant A sees A (and the global members), never B
    await asTenant(APP, A, async (s) => {
      expect((await s.q(`SELECT DISTINCT tenant_id FROM v_inputs_resolved ORDER BY 1`)).trim()).toBe(A);
      expect((await s.q(`SELECT DISTINCT coalesce(tenant_id::text, 'global') FROM v_dimension_members ORDER BY 1`)).trim().split('\n')).toEqual([A, 'global'].sort());
      // asking for B's scenario by id returns nothing
      const gcB = idB.get(fixture.scenario.find((x) => x.key === 'grandchild')!.id)!;
      expect(await resolved(s, B, gcB)).toEqual([]);
      expect(await resolved(s, B, null)).toEqual([]);
      expect((await s.q(`SELECT count(*) FROM v_dimension_members WHERE tenant_id = $1`, [B])).trim()).toBe('0');
    });
    // tenant B sees B's values
    await asTenant(APP, B, async (s) => {
      expect((await s.q(`SELECT DISTINCT tenant_id FROM v_inputs_resolved ORDER BY 1`)).trim()).toBe(B);
      const gc = fixture.scenario.find((x) => x.key === 'grandchild')!;
      const cells = await resolved(s, B, idB.get(gc.id)!);
      expect(cells.find((c) => c.key === 'g.target_net')).toMatchObject({ value: 130 + OFFSET, resolved_from: 'scenario' });
      expect(cells.find((c) => c.key === 'g.head_start')).toMatchObject({ value: 1 + OFFSET, resolved_from: 'tenant' });
    });
    // no tenant context: no inputs, no tenant members; the global members stay
    await asTenant(APP, null, async (s) => {
      expect((await s.q(`SELECT count(*) FROM v_inputs_resolved`)).trim()).toBe('0');
      expect((await s.q(`SELECT DISTINCT origin FROM v_dimension_members ORDER BY 1`)).trim().split('\n')).toEqual(['global', 'system']);
    });
    // the view is not a way around the policy: the owner is filtered too (FORCE), and the app cannot write through a view
    await asTenant(OWNER, null, async (s) => {
      expect((await s.q(`SELECT count(*) FROM v_inputs_resolved`)).trim()).toBe('0');
    });
    const priv = (view: string, p: string) =>
      db.q(`select has_table_privilege('${APP}', '${view}', '${p}')`);
    for (const view of [INPUTS_VIEW, MEMBERS_VIEW]) {
      expect(await priv(view, 'SELECT'), view).toBe('t');
      for (const p of ['INSERT', 'UPDATE', 'DELETE']) expect(await priv(view, p), `${view} ${p}`).toBe('f');
    }
    const err = await asTenant(APP, A, (s) =>
      sqlError(s.query(`INSERT INTO v_dimension_members (dim_key, member_key) VALUES ('x', 'y')`)),
    );
    expect(['42501', '55000']).toContain(err.code); // no privilege / views of a UNION cannot be written
  });

  it('is generated: the migration is up to date, system dimension members and line attributes are read from the spec, and drift in either fails generation', () => {
    expect(checkMigrations().problems).toEqual([]);
    // a system dimension without members cannot be rendered
    const bare = { ...inputs, members: { ...inputs.members, year: [] } };
    expect(() => renderViewsSql(model, schema, bare)).toThrow(/year has no members/);
    // a line attribute added to the spec needs a rule in views.ts
    const line = inputs.dimensions.map((d) => (d.id === 'line' ? { ...d, attributes: [...d.attributes, 'new_attr'] } : d));
    expect(() => renderViewsSql(model, schema, { ...inputs, dimensions: line })).toThrow(/line attributes differ/);
    // a view missing from schema.json
    expect(() => renderViewsSql(model, { ...schema, views: {} }, inputs)).toThrow(/not in schema.json views/);
  });
});
