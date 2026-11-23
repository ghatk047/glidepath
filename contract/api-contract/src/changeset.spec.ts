import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BundleResponse,
  ChangesetConflict,
  ChangesetRequest,
  ChangesetResult,
  NodeDef,
  Problem,
  Scenario,
  ScenariosResponse,
  coreRoutes,
  problemTypes,
} from './index';
import { changesetConflictFixture, coreRouteFixtures } from './fixtures/core';

const omit = (o: object, k: string): Record<string, unknown> => {
  const copy: Record<string, unknown> = { ...o };
  delete copy[k];
  return copy;
};

const request = {
  scenarioId: 'sc-user-1',
  baseVersion: 7,
  changes: [
    { target: 'variable', key: 'g.target_net', member: '', value: 150 },
    { target: 'variable', key: 'hc.rate', member: 'pilots,fy27', value: 0.031, note: 'COLA' },
    { target: 'override', key: 'base.pool_outlay', member: 'si', value: 118, note: 'Finance' },
    { target: 'override', key: 'base.pool_outlay', member: 'cloud', value: null },
    {
      target: 'structural',
      key: 'vendor',
      member: 'vendor_new',
      value: { label: 'New SI', preferred: true },
    },
    { target: 'structural', key: 'line', member: 'it_415', value: null },
  ],
};

const result = {
  changesetId: 'cs-9',
  scenarioId: 'sc-user-1',
  version: 8,
  editsCount: 12,
  inputHash: 'sha256:abc',
  outputs: { 'res.net[]': 119.3, 'res.gap[]': -23.7 },
  warnings: [
    { rule: 'VR04', cells: ['hc.us[]'], severity: 'warning', message: 'Above registry max.' },
  ],
};

const conflict = changesetConflictFixture;
const coreSource = readFileSync(fileURLToPath(new URL('./core.ts', import.meta.url)), 'utf8');

describe('changeset: request {baseVersion, changes[]}', () => {
  it('parses variable, override and structural changes', () => {
    expect(ChangesetRequest.parse(request)).toEqual(request);
  });

  it('only accepts targets variable | override | structural', () => {
    const bad = { ...request, changes: [{ ...request.changes[0], target: 'scenario_value' }] };
    expect(ChangesetRequest.safeParse(bad).success).toBe(false);
  });

  it('requires key, member and value on each change; note is optional', () => {
    for (const field of ['key', 'member', 'value'] as const) {
      const change: Record<string, unknown> = { ...request.changes[0] };
      delete change[field];
      expect(ChangesetRequest.safeParse({ ...request, changes: [change] }).success, field).toBe(
        false,
      );
    }
  });

  it('variable and override values are finite numbers (null clears); structural values are objects', () => {
    const one = (c: object) => ChangesetRequest.safeParse({ ...request, changes: [c] }).success;
    expect(one({ target: 'variable', key: 'g.x', member: '', value: '5' })).toBe(false);
    expect(one({ target: 'variable', key: 'g.x', member: '', value: Infinity })).toBe(false);
    expect(one({ target: 'variable', key: 'g.x', member: '', value: null })).toBe(true);
    expect(one({ target: 'override', key: 'n.x', member: '', value: { a: 1 } })).toBe(false);
    expect(one({ target: 'structural', key: 'line', member: 'it_1', value: 5 })).toBe(false);
  });

  it('requires a non-negative integer baseVersion and at least one change', () => {
    expect(ChangesetRequest.safeParse({ ...request, baseVersion: -1 }).success).toBe(false);
    expect(ChangesetRequest.safeParse({ ...request, baseVersion: 1.5 }).success).toBe(false);
    expect(ChangesetRequest.safeParse({ ...request, changes: [] }).success).toBe(false);
    expect(ChangesetRequest.safeParse(omit(request, 'baseVersion')).success).toBe(false);
  });
});

describe('changeset: response {scenarioId, version, editsCount, inputHash, outputs, warnings, forkedFrom?}', () => {
  it('parses a result without a fork', () => {
    const parsed = ChangesetResult.parse(result);
    expect(parsed).toEqual(result);
    expect(parsed.forkedFrom).toBeUndefined();
  });

  it('parses a result that forked a locked preset', () => {
    const forked = { ...result, scenarioId: 'sc-custom-c', forkedFrom: 'sc-preset-c' };
    expect(ChangesetResult.parse(forked).forkedFrom).toBe('sc-preset-c');
  });

  it('requires every named field', () => {
    for (const field of [
      'scenarioId',
      'version',
      'editsCount',
      'inputHash',
      'outputs',
      'warnings',
    ]) {
      const broken: Record<string, unknown> = { ...result };
      delete broken[field];
      expect(ChangesetResult.safeParse(broken).success, field).toBe(false);
    }
  });

  it('outputs are keyed by cell key', () => {
    expect(ChangesetResult.safeParse({ ...result, outputs: { 'res.net': 1 } }).success).toBe(false);
  });

  it('is the response of POST /changesets', () => {
    expect(coreRoutes.changesetApply.body).toBe(ChangesetRequest);
    expect(coreRoutes.changesetApply.response).toBe(ChangesetResult);
  });
});

describe('changeset: 409 body {serverVersion, changesSince[]}', () => {
  it('parses a version conflict, which is also a problem', () => {
    expect(ChangesetConflict.parse(conflict)).toEqual(conflict);
    expect(Problem.safeParse(conflict).success).toBe(true);
  });

  it('requires status 409, serverVersion and changesSince', () => {
    expect(ChangesetConflict.safeParse({ ...conflict, status: 422 }).success).toBe(false);
    expect(ChangesetConflict.safeParse(omit(conflict, 'serverVersion')).success).toBe(false);
    expect(ChangesetConflict.safeParse(omit(conflict, 'changesSince')).success).toBe(false);
  });

  it('allows an empty changesSince (e.g. only a fork happened)', () => {
    expect(ChangesetConflict.safeParse({ ...conflict, changesSince: [] }).success).toBe(true);
  });

  it('is declared as the 409 of the changeset routes', () => {
    expect(coreRoutes.changesetApply.errors[409]).toBe(ChangesetConflict);
    expect(coreRoutes.changesetRevert.errors[409]).toBe(ChangesetConflict);
  });
});

describe('changeset: request clientRequestId (idempotency)', () => {
  it('is optional and passes through when given', () => {
    expect(ChangesetRequest.parse(request)).not.toHaveProperty('clientRequestId');
    const keyed = { ...request, clientRequestId: 'rq-7f3a' };
    expect(ChangesetRequest.parse(keyed).clientRequestId).toBe('rq-7f3a');
  });

  it('is a non-empty string of at most 128 characters', () => {
    for (const bad of ['', 7, 'x'.repeat(129)]) {
      expect(ChangesetRequest.safeParse({ ...request, clientRequestId: bad }).success).toBe(false);
    }
    expect(
      ChangesetRequest.safeParse({ ...request, clientRequestId: 'x'.repeat(128) }).success,
    ).toBe(true);
  });
});

describe('changeset: 409 fixture says tier 1 re-sends its edits', () => {
  it('detail tells the user the edits are re-sent, never re-applied or re-based by the server', () => {
    expect(conflict.type).toBe(problemTypes.versionConflict);
    expect(conflict.detail).toMatch(/re-sent/);
    expect(conflict.detail).not.toMatch(/re-applied|re-based/);
  });
});

describe('core: Scenario gains editsCount; its doc does not say a child inherits overrides', () => {
  const scenario = coreRouteFixtures.scenarios.response.scenarios[0]!;

  it('editsCount is a required non-negative integer', () => {
    expect(Scenario.parse(scenario).editsCount).toBe(0);
    const { editsCount: _drop, ...without } = scenario;
    void _drop;
    expect(Scenario.safeParse(without).success).toBe(false);
    for (const bad of [-1, 1.5, '3']) {
      expect(Scenario.safeParse({ ...scenario, editsCount: bad }).success).toBe(false);
    }
    expect(ScenariosResponse.safeParse(coreRouteFixtures.scenarios.response).success).toBe(true);
  });

  it('documents that node overrides are not inherited from the parent', () => {
    const scenarioDocs = coreSource.slice(
      coreSource.indexOf('// Scenarios: GET list'),
      coreSource.indexOf('// GET /api/t/:tenant/scenarios/:id/inputs'),
    );
    expect(scenarioDocs).toMatch(/Node overrides \(pins\) are not inherited/);
    expect(scenarioDocs).not.toMatch(/inherits (everything|all|its parent's overrides)/i);
    expect(scenarioDocs).not.toMatch(/inherits[^.]*overrides/i);
  });
});

describe('core: NodeDef is strict, so expr / cases never reach tier 1', () => {
  const node = coreRouteFixtures.bundle.response.nodes[0]!;

  it('a node with only the published keys parses', () => {
    expect(NodeDef.parse(node)).toEqual(node);
  });

  it.each([
    ['expr', 'base.total * (1 + g.growth)'],
    ['cases', [{ when: 'x', expr: 'y' }]],
    ['note', 'anything else'],
  ])('fails on an extra key %s, also inside a bundle', (key, value) => {
    expect(NodeDef.safeParse({ ...node, [key]: value }).success).toBe(false);
    const bundle = coreRouteFixtures.bundle.response;
    const leaky = { ...bundle, nodes: [{ ...node, [key]: value }] };
    expect(BundleResponse.safeParse(leaky).success).toBe(false);
  });
});
