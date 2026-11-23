import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadModelBundleFromDir } from '@glidepath/spec/node';
import { describe, expect, it } from 'vitest';
import { LINE_ITEM_ATTRIBUTES, LINE_ITEM_JOINED_ATTRIBUTES, memberOfRow } from './member-rows';
import { columnsOf, repoRoot } from './test-support/schema-json';

/** `'attr', li.column` pairs of the line_item branch of v_dimension_members in the generated SQL. */
function viewLineAttributes(): Map<string, string> {
  const sql = readFileSync(resolve(repoRoot, 'tier3-data/migrations/0003_views.sql'), 'utf8');
  const branch = sql.slice(sql.indexOf("SELECT li.tenant_id, 'line'"));
  const object = branch.slice(
    branch.indexOf('jsonb_build_object('),
    branch.indexOf('FROM line_item'),
  );
  return new Map(
    [...object.matchAll(/'(\w+)',\s*(\w+)\.(\w+)/g)].map((m) => [m[1]!, `${m[2]}.${m[3]}`]),
  );
}

describe('memberOfRow: structural rows seen as v_dimension_members does', () => {
  it('a dimension_member row is { id, label, ...attrs }', () => {
    expect(
      memberOfRow('vendor', 'acme', {
        label: 'Acme',
        attrs: { preferred: 1, role: 'SI' },
        sort: 7,
        active: true,
      }),
    ).toEqual({ id: 'acme', label: 'Acme', preferred: 1, role: 'SI' });
    expect(memberOfRow('vp', 'vp_x', { attrs: null })).toEqual({ id: 'vp_x' });
  });

  it('an inactive row (soft delete) is no member', () => {
    expect(memberOfRow('vp', 'vp_x', { label: 'X', active: false })).toBeNull();
    expect(memberOfRow('line', 'it_1', { name: 'X', active: false })).toBeNull();
  });

  it('a line_item row takes the attribute names expressions read, flags as 0/1, label = name; joined attributes stay', () => {
    const previous = { id: 'it_1', lever_ids: ['L05'], source: 'S02', pool: 'cloud' };
    expect(
      memberOfRow(
        'line',
        'it_1',
        {
          name: 'Base salaries',
          pool_id: 'internal_labour',
          domain_key: 'commercial_applications',
          addr_tag: 'partly',
          scale_driver: 'us',
          vendor_key: null,
          in_scope: true,
          memo: false,
          qty: 660,
          notes: 'not an attribute',
        },
        previous,
      ),
    ).toEqual({
      id: 'it_1',
      label: 'Base salaries',
      name: 'Base salaries',
      pool: 'internal_labour',
      domain: 'commercial_applications',
      addr: 'partly',
      drv: 'us',
      vendor: null,
      in_scope: 1,
      memo: 0,
      lever_ids: ['L05'],
      source: 'S02',
    });
  });

  it('LINE_ITEM_ATTRIBUTES is the view’s mapping: line_item columns, the line dimension’s attributes', async () => {
    const view = viewLineAttributes();
    const fromRow = Object.fromEntries(
      Object.entries(LINE_ITEM_ATTRIBUTES).map(([column, attr]) => [attr, `li.${column}`]),
    );
    const joined = [...view]
      .filter(([, source]) => !source.startsWith('li.'))
      .map(([attr]) => attr);
    expect(Object.fromEntries([...view].filter(([, source]) => source.startsWith('li.')))).toEqual(
      fromRow,
    );
    expect(joined.sort()).toEqual([...LINE_ITEM_JOINED_ATTRIBUTES].sort());

    for (const column of Object.keys(LINE_ITEM_ATTRIBUTES))
      expect(columnsOf('line_item')).toContain(column);
    const bundle = await loadModelBundleFromDir(resolve(repoRoot, 'docs/spec'));
    const line = bundle.dimensions.find((d) => d.id === 'line')!;
    expect([...Object.values(LINE_ITEM_ATTRIBUTES), ...LINE_ITEM_JOINED_ATTRIBUTES].sort()).toEqual(
      [...line.attributes].sort(),
    );
  });
});
