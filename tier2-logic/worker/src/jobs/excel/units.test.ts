import type { ChangesetDraft, InputState } from '@glidepath/domain';
import { describe, expect, it } from 'vitest';
import { defaultRegistry } from '../../runtime';
import '../../handlers';
import { newKeyGenerator } from './apply';
import { applyDraftsToState } from './impact';
import { fromUri, toUri } from './storage';

describe('newKeyGenerator', () => {
  it('continues the most common prefix at the highest number, same width', () => {
    const next = newKeyGenerator(['it_001', 'it_002', 'it_410', 'x1']);
    expect(next()).toBe('it_411');
    expect(next()).toBe('it_412');
  });
  it('falls back to a neutral prefix when no key ends in a number', () => {
    expect(newKeyGenerator(['a', 'b'])()).toBe('new_1');
  });
});

describe('storage uris', () => {
  it('round-trips bucket and key and refuses a foreign bucket', () => {
    expect(fromUri(toUri('exports', 'id/file.xlsx'))).toEqual({ bucket: 'exports', key: 'id/file.xlsx' });
    expect(() => fromUri('nowhere/x')).toThrow(/not a stored file/);
  });
});

describe('applyDraftsToState', () => {
  const state: InputState = {
    defaults: [{ var_key: 'a', member_key: '', value: 1 }],
    chain: [{ scenario_id: 's1', values: [{ var_key: 'b', member_key: '', value: 2 }] }],
    overrides: [],
  };
  const draft = (scenario_id: string | null, changes: ChangesetDraft['changes']): ChangesetDraft => ({
    origin: 'excel_import',
    scenario_id,
    base_scenario_version: 0,
    changes,
  });
  it('puts defaults, scenario values and pins on the stored rows without writing anything', () => {
    const out = applyDraftsToState(
      state,
      's1',
      [
        draft(null, [{ target: 'variable', key: 'a', member_key: '', op: 'set', new_value: 5 }]),
        draft('s1', [
          { target: 'variable', key: 'b', member_key: '', op: 'unset', new_value: null },
          { target: 'override', key: 'n', member_key: '', op: 'set', new_value: 9, note: 'pin' },
        ]),
        draft('other', [{ target: 'variable', key: 'a', member_key: '', op: 'set', new_value: 7 }]),
      ],
    );
    expect(out.state.defaults).toEqual([{ var_key: 'a', member_key: '', value: 5 }]);
    expect(out.state.chain[0]?.values).toEqual([]);
    expect(out.state.overrides).toEqual([{ node_key: 'n', member_key: '', value: 9, reason: 'pin' }]);
    expect(state.defaults[0]?.value).toBe(1);
  });
  it('counts structural changes, which the preview does not model', () => {
    const out = applyDraftsToState(state, 's1', [
      draft(null, [{ target: 'structural', key: 'line', member_key: 'it_999', op: 'insert', new_value: {} }]),
    ]);
    expect(out.skippedStructural).toBe(1);
  });
});

describe('registration', () => {
  it('handlers.ts registers excel.export, excel.import and excel.apply', () => {
    expect(defaultRegistry.queues().filter((q) => q.startsWith('excel.'))).toEqual(['excel.apply', 'excel.export', 'excel.import']);
  });
});
