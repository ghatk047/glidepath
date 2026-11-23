import { describe, expect, it } from 'vitest';
import {
  ChangesetConflict,
  ChangesetRequest,
  ChangesetResult,
  Problem,
  coreRoutes,
  problemTypes,
} from './index';

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

const conflict = {
  type: problemTypes.versionConflict,
  title: 'Scenario changed',
  status: 409,
  detail: 'Someone else changed this scenario. Your edits were re-applied.',
  serverVersion: 9,
  changesSince: [
    {
      changesetId: 'cs-8',
      seq: 0,
      target: 'variable',
      key: 'hc.us',
      member: '',
      op: 'update',
      oldValue: 9000,
      newValue: 9100,
    },
  ],
};

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
