import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BundleResponse,
  CellKey,
  ChangeTarget,
  ChangesetOrigin,
  ChangesetStatus,
  coreRoutes,
  DimensionScope,
  MembershipRole,
  ScenarioKind,
  TenantStatus,
  toCellKey,
  type CoreRouteId,
  type RouteDef,
} from './index';
import { coreRouteFixtures } from './fixtures/core';
import { specFixtures } from './testing';

const specDir = fileURLToPath(new URL('../../../docs/spec/', import.meta.url));
const readSpec = (file: string): unknown => JSON.parse(readFileSync(specDir + file, 'utf8'));

interface SpecColumn {
  name: string;
  type: string;
}
interface SpecSchema {
  tables: Record<string, { columns: SpecColumn[] }>;
}
const schemaJson = readSpec('schema.json') as SpecSchema;
const specEnum = (table: string, column: string): string[] => {
  const col = schemaJson.tables[table]?.columns.find((c) => c.name === column);
  const match = col?.type.match(/^enum\((.*)\)$/);
  if (!match?.[1]) throw new Error(`no enum ${table}.${column} in schema.json`);
  return match[1].split(',');
};

const roundTrip = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
const parts = ['params', 'query', 'body', 'response'] as const;

describe('schemas.spec: core REST routes (04 §3)', () => {
  it('covers exactly the core routes named in CON-01', () => {
    const table = Object.values(coreRoutes)
      .map((r) => `${r.method} ${r.path}`)
      .sort();
    expect(table).toEqual(
      [
        'GET /api/me',
        'GET /api/tenants',
        'GET /api/t/:tenant/bundle',
        'GET /api/t/:tenant/members',
        'GET /api/t/:tenant/scenarios',
        'POST /api/t/:tenant/scenarios',
        'PATCH /api/t/:tenant/scenarios/:id',
        'GET /api/t/:tenant/scenarios/:id/inputs',
        'POST /api/t/:tenant/changesets',
        'POST /api/t/:tenant/changesets/:id/revert',
        'GET /api/t/:tenant/scenarios/:id/changesets',
        'GET /api/t/:tenant/scenarios/:id/calc',
        'GET /api/t/:tenant/nodes/:cell/explain',
        'GET /api/t/:tenant/search',
      ].sort(),
    );
  });

  it('has one fixture per route and no stray fixtures', () => {
    expect(Object.keys(coreRouteFixtures).sort()).toEqual(Object.keys(coreRoutes).sort());
  });

  it('declares path params for every :param in the path', () => {
    for (const route of Object.values(coreRoutes) as RouteDef[]) {
      const names = [...route.path.matchAll(/:(\w+)/g)].map((m) => m[1]).sort();
      const declared = route.params ? Object.keys(route.params.shape).sort() : [];
      expect(declared, route.path).toEqual(names);
    }
  });

  for (const id of Object.keys(coreRoutes) as CoreRouteId[]) {
    it(`round-trips the ${id} fixture`, () => {
      const route = coreRoutes[id];
      const fixture = coreRouteFixtures[id] as Partial<Record<(typeof parts)[number], unknown>>;
      for (const part of parts) {
        const schema = route[part as keyof typeof route] as
          { parse: (v: unknown) => unknown } | undefined;
        if (!schema || typeof schema !== 'object' || !('parse' in schema)) {
          expect(fixture[part], `${id}.${part} has a fixture but no schema`).toBeUndefined();
          continue;
        }
        expect(fixture[part], `${id}.${part} has a schema but no fixture`).toBeDefined();
        const parsed = schema.parse(fixture[part]);
        // JSON → parse → JSON is lossless: no field is stripped, renamed or coerced.
        expect(roundTrip(parsed), `${id}.${part}`).toEqual(fixture[part]);
        expect(schema.parse(roundTrip(parsed)), `${id}.${part} re-parse`).toEqual(parsed);
      }
    });
  }

  it('rejects a response that drops a required field', () => {
    const broken: Record<string, unknown> = { ...coreRouteFixtures.scenarioCreate.response };
    delete broken.version;
    expect(coreRoutes.scenarioCreate.response.safeParse(broken).success).toBe(false);
  });
});

describe('schemas.spec: enums match docs/spec/schema.json', () => {
  it('scenario.kind', () =>
    expect([...ScenarioKind.options]).toEqual(specEnum('scenario', 'kind')));
  it('tenant.status', () =>
    expect([...TenantStatus.options]).toEqual(specEnum('tenant', 'status')));
  it('tenant_membership.role', () =>
    expect([...MembershipRole.options]).toEqual(specEnum('tenant_membership', 'role')));
  it('changeset.origin', () =>
    expect([...ChangesetOrigin.options]).toEqual(specEnum('changeset', 'origin')));
  it('changeset.status', () =>
    expect([...ChangesetStatus.options]).toEqual(specEnum('changeset', 'status')));
  it('dimension_def.scope', () =>
    expect([...DimensionScope.options]).toEqual(specEnum('dimension_def', 'scope')));
  it('change.target maps onto the API targets variable | override | structural', () => {
    expect([...ChangeTarget.options]).toEqual(['variable', 'override', 'structural']);
    expect(specEnum('change', 'target')).toEqual([
      'variable_value',
      'scenario_value',
      'node_override',
      'line_item',
      'dimension_member',
    ]);
  });
});

describe('schemas.spec: bundle accepts the real model spec', () => {
  interface SpecVariable {
    id: string;
    kind: string;
    label: string;
    unit: string;
    type: string;
    dims: string[];
    min: number | null;
    max: number | null;
    step: number | null;
    group: string;
    layer: string;
    role: string;
    ui: { control: string; hero: boolean };
    source: string;
    confidence: string;
    note: string;
    scenario_varies: boolean;
  }
  interface SpecNode {
    id: string;
    dims: string[];
    unit: string;
    label: string;
    layer: string;
    output: boolean;
  }
  interface SpecDim {
    id: string;
    label: string;
    scope: string;
    attributes: string[];
  }

  it('every variable, node and dimension in the spec fits the bundle schema', () => {
    // The scale is tier 2's (the spec has none): taken from the generated fixture bundle.
    const scaleOf = new Map(
      [...specFixtures.bundle.variables, ...specFixtures.bundle.nodes].map(
        (d) => [d.id, d.percentScale] as const,
      ),
    );
    const vars = (readSpec('variables.json') as { variables: SpecVariable[] }).variables;
    const graph = readSpec('formula_graph.json') as { nodes: SpecNode[]; dimensions: SpecDim[] };
    const bundle = {
      modelVersion: { id: 'mv-1', semver: '1.0.0' },
      variables: vars.map((v) => ({
        id: v.id,
        label: v.label,
        unit: v.unit,
        type: v.type,
        kind: v.kind,
        dims: v.dims,
        min: v.min,
        max: v.max,
        step: v.step,
        group: v.group,
        layer: v.layer,
        role: v.role,
        ui: v.ui,
        source: v.source,
        confidence: v.confidence,
        note: v.note,
        scenarioVaries: v.scenario_varies,
        percentScale: scaleOf.get(v.id),
      })),
      nodes: graph.nodes.map((n) => ({
        id: n.id,
        label: n.label,
        unit: n.unit,
        dims: n.dims,
        layer: n.layer,
        output: n.output,
        overridable: true,
        percentScale: scaleOf.get(n.id),
      })),
      dimensions: graph.dimensions,
    };
    const result = BundleResponse.safeParse(bundle);
    expect(result.success, JSON.stringify(result.error?.issues.slice(0, 3))).toBe(true);
    expect(roundTrip(result.data)).toEqual(bundle);
  });

  it('bundle nodes carry no formula: tier 1 never sees expressions in the bundle', () => {
    const parsed = BundleResponse.parse(coreRouteFixtures.bundle.response);
    for (const node of parsed.nodes) {
      expect(node).not.toHaveProperty('expr');
      expect(node).not.toHaveProperty('cases');
    }
  });
});

describe('schemas.spec: cell keys', () => {
  it('formats cells as id[member] (03 §1 CellKey)', () => {
    expect(toCellKey('res.net')).toBe('res.net[]');
    expect(toCellKey('hc.rate', 'pilots,fy27')).toBe('hc.rate[pilots,fy27]');
    expect(CellKey.parse('lev.rr[L09]')).toBe('lev.rr[L09]');
  });
  it('rejects malformed cells', () => {
    for (const bad of ['res.net', '[x]', 'a[b]c', 'a b[]', 'a[[b]]']) {
      expect(CellKey.safeParse(bad).success, bad).toBe(false);
    }
  });
});
