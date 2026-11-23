import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { seedToTenantData, type ModelBundle, type TenantMembers } from '@glidepath/spec';
import { ExcelTemplateSchema, type ExcelTemplate } from '@glidepath/spec/generated';
import { loadModelBundleFromDir, readTenantSeed } from '@glidepath/spec/node';
import {
  LIST_BOOL,
  LIST_SCALE_DRIVERS,
  TemplateError,
  buildTemplate,
  cellRef,
  enumListId,
  placeVariables,
  type SheetDef,
} from './index';

const here = dirname(fileURLToPath(import.meta.url));
const specDir = join(here, '../../../docs/spec');

let template: ExcelTemplate;
let bundle: ModelBundle;
let aaMembers: TenantMembers;
let aa: SheetDef[];

const sheet = (defs: readonly SheetDef[], name: string): SheetDef => {
  const s = defs.find((d) => d.name === name);
  if (s === undefined) throw new Error(`no sheet ${name}`);
  return s;
};

/** Tenant zz, inline: five VPs and a different set of labor groups (QA-02 will ship the full seed). */
function zzMembers(base: TenantMembers): TenantMembers {
  const vps = ['ops', 'revenue', 'customer', 'infra', 'corporate'].map((id) => ({
    id: `vp_${id}`,
    label: `VP ${id}`,
  }));
  const lgroups = ['pilots_zz', 'cabin_zz', 'ground_zz'].map((id) => ({ id, label: id }));
  return { ...base, vp: vps, lgroup: lgroups };
}

beforeAll(async () => {
  template = ExcelTemplateSchema.parse(
    JSON.parse(readFileSync(join(specDir, 'excel_template.json'), 'utf8')),
  );
  bundle = await loadModelBundleFromDir(specDir);
  const seed = await readTenantSeed(join(specDir, 'seed/aa'));
  aaMembers = seedToTenantData(seed, 'C', bundle).members;
  aa = buildTemplate(template, bundle, aaMembers);
});

describe('buildTemplate: sheets', () => {
  it('sheet defs for README, Targets, Workforce (+ vendor.book rows), Pools, Levers, Lever_Timing, Org_Map, Line_Items, Corporate, Overrides, Outputs, _lists, _meta (11 editable sheets + 2 hidden)', () => {
    expect(aa.map((s) => s.name)).toEqual([
      'README',
      'Targets',
      'Workforce',
      'Pools',
      'Levers',
      'Lever_Timing',
      'Org_Map',
      'Line_Items',
      'Corporate',
      'Overrides',
      'Outputs',
      '_lists',
      '_meta',
    ]);
    expect(aa.filter((s) => !s.hidden)).toHaveLength(11);
    expect(aa.filter((s) => s.hidden).map((s) => s.name)).toEqual(['_lists', '_meta']);
    expect(sheet(aa, '_meta').protected).toBe(true);
    expect(sheet(aa, '_meta').fields).toEqual(
      template.sheets.find((s) => s.name === '_meta')?.fields,
    );
    for (const name of ['README', 'Outputs', '_lists', '_meta'])
      expect(sheet(aa, name).editable).toBe(false);
    for (const name of [
      'Targets',
      'Workforce',
      'Pools',
      'Levers',
      'Lever_Timing',
      'Org_Map',
      'Line_Items',
      'Corporate',
      'Overrides',
    ]) {
      expect(sheet(aa, name).editable).toBe(true);
    }
    // Workforce carries the preferred-SI book: one vendor.book row per vendor.
    const book = sheet(aa, 'Workforce').rows.filter((r) => r.varId === 'vendor.book');
    expect(book.map((r) => r.member)).toEqual((aaMembers['vendor'] ?? []).map((m) => m.id));
    expect(book.length).toBeGreaterThan(1);
  });

  it('columns per scalar_inputs_columns incl. locked, hidden key/member/_hash, per-scenario value columns', () => {
    for (const name of ['Targets', 'Workforce', 'Pools', 'Levers']) {
      const cols = sheet(aa, name).columns;
      expect(cols.map((c) => c.header)).toEqual(
        template.scalar_inputs_columns.map((c) => c.header),
      );
      const by = Object.fromEntries(cols.map((c) => [c.role, c]));
      for (const role of ['key', 'member', 'hash'])
        expect(by[role]?.hidden, `${name} ${role}`).toBe(true);
      for (const role of [
        'group',
        'label',
        'unit',
        'default',
        'scenario',
        'source',
        'confidence',
        'note',
      ]) {
        expect(by[role]?.hidden, `${name} ${role}`).toBe(false);
      }
      for (const role of ['key', 'member', 'min', 'max', 'source', 'confidence']) {
        expect(by[role]?.locked, `${name} ${role}`).toBe(true);
      }
      for (const role of ['default', 'scenario', 'note']) {
        expect(by[role]?.editable, `${name} ${role}`).toBe(true);
        expect(by[role]?.locked, `${name} ${role}`).toBe(false);
      }
      expect(cols.filter((c) => c.perScenario).map((c) => c.role)).toEqual(['scenario']);
      expect(by['scenario']?.blankMeans).toBe('inherit default');
      expect(by['scenario']?.mapsTo).toBe('scenario_value');
      expect(by['default']?.mapsTo).toBe('variable_value');
      expect(by['note']?.mapsTo).toBe('variable_value.note');
    }
  });

  it('tenant zz (five VPs) yields five Org_Map VP columns', () => {
    const zz = buildTemplate(template, bundle, zzMembers(aaMembers));
    const org = sheet(zz, 'Org_Map');
    const vpCols = org.columns.filter((c) => c.role === 'matrix_col');
    expect(vpCols.map((c) => c.bind?.['vp'])).toEqual([
      'vp_ops',
      'vp_revenue',
      'vp_customer',
      'vp_infra',
      'vp_corporate',
    ]);
    expect(vpCols.map((c) => c.header)).toContain('VP revenue');
    expect(org.rows.filter((r) => r.varId === 'org.dom_share')).toHaveLength(15);
    for (const r of org.rows.filter((r) => r.varId === 'org.dom_share'))
      expect(r.cells).toHaveLength(5);
    // The AA tenant has four.
    expect(sheet(aa, 'Org_Map').columns.filter((c) => c.role === 'matrix_col')).toHaveLength(4);
    // Different labor groups give different Corporate rows.
    const corpRows = (defs: SheetDef[]) =>
      sheet(defs, 'Corporate')
        .rows.filter((r) => r.varId === 'corp.lab_hc_g')
        .map((r) => r.member);
    expect(corpRows(zz)).toEqual(['pilots_zz', 'cabin_zz', 'ground_zz']);
    expect(corpRows(aa)).toHaveLength(5);
  });
});

describe('buildTemplate: placement', () => {
  it('puts every input variable on exactly one sheet', () => {
    const placed = placeVariables(template, bundle);
    const inputs = bundle.variables.filter((v) => v.role !== 'simulation');
    expect(placed.size).toBe(inputs.length);
    expect(placed.has('lev.realize')).toBe(false);
    const counts: Record<string, number> = {};
    for (const s of aa)
      for (const id of new Set(s.rows.flatMap((r) => (r.varId ? [r.varId] : []))))
        counts[id] = (counts[id] ?? 0) + 1;
    for (const c of aa.flatMap((s) => s.columns.flatMap((col) => (col.varId ? [col.varId] : [])))) {
      counts[c] = (counts[c] ?? 0) + 1;
    }
    for (const v of inputs) expect(counts[v.id], v.id).toBe(1);
  });

  it('follows the layout of 05 section 2', () => {
    const where = (id: string): string | undefined => placeVariables(template, bundle).get(id);
    expect(where('g.target_net')).toBe('Targets');
    expect(where('g.it_dep_life')).toBe('Targets');
    expect(where('hc.us')).toBe('Workforce');
    expect(where('addr.share')).toBe('Pools');
    expect(where('pool.shared')).toBe('Pools');
    expect(where('pool.swb_flag')).toBe('Pools');
    expect(where('portfolio.apps')).toBe('Pools');
    expect(where('lev.L05.nb')).toBe('Levers');
    expect(where('lev.start')).toBe('Lever_Timing');
    expect(where('org.manual_target')).toBe('Org_Map');
    expect(where('g.vp_alloc_method')).toBe('Org_Map');
    expect(where('line.amount')).toBe('Line_Items');
    expect(where('corp.cust_opex28')).toBe('Corporate');
  });

  it('reports an input that no sheet carries', () => {
    const slim: ExcelTemplate = {
      ...template,
      sheets: template.sheets.filter((s) => s.name !== 'Targets'),
    };
    expect(() => buildTemplate(slim, bundle, aaMembers)).toThrow(TemplateError);
    expect(() => buildTemplate(slim, bundle, aaMembers)).toThrow(/g\.target_net/);
  });
});

describe('buildTemplate: sheet contents', () => {
  it('Levers: one row per lever input, grouped by lever in lever order, only the tenant levers', () => {
    const levers = sheet(aa, 'Levers');
    const groups = [...new Set(levers.rows.map((r) => r.group))];
    expect(groups).toHaveLength(17);
    expect(levers.rows[0]?.group.startsWith('L01')).toBe(true);
    expect(levers.rows.every((r) => r.member === '')).toBe(true);
    const fewer = { ...aaMembers, lever: (aaMembers['lever'] ?? []).slice(0, 2) };
    const small = sheet(buildTemplate(template, bundle, fewer), 'Levers');
    expect(new Set(small.rows.map((r) => r.group)).size).toBe(2);
  });

  it('Lever_Timing: lever rows with the four blocks, once per scenario', () => {
    const lt = sheet(aa, 'Lever_Timing');
    expect(lt.rows).toHaveLength(17);
    const blocks = lt.columns.filter((c) => c.role === 'block');
    expect(blocks.map((c) => c.varId)).toEqual(['lev.start', 'lev.ramp', 'lev.conf', 'lev.on']);
    expect(blocks.every((c) => c.perScenario && c.editable && c.mapsTo === 'scenario_value')).toBe(
      true,
    );
    expect(lt.rows[0]?.cells).toEqual(blocks.map((c) => c.id));
    expect(cellRef(bundle, lt.rows[4] as never, blocks[0] as never)).toEqual({
      varId: 'lev.start',
      memberKey: 'L05',
    });
  });

  it('Org_Map: domain x VP matrix with a row check, VP inputs and org settings', () => {
    const org = sheet(aa, 'Org_Map');
    expect(org.rowCheck).toEqual({ column: 'row_check', rule: 'sum = 100%' });
    expect(org.matrix).toEqual({ rows: 'domain', cols: 'vp' });
    const check = org.columns.find((c) => c.role === 'check');
    expect(check?.locked).toBe(true);
    const share = org.rows.filter((r) => r.varId === 'org.dom_share');
    expect(share).toHaveLength(15);
    expect(share.every((r) => r.checked)).toBe(true);
    const vpCol = org.columns.find((c) => c.role === 'matrix_col');
    expect(cellRef(bundle, share[0] as never, vpCol as never).memberKey).toBe(
      `${share[0]?.member},${vpCol?.bind?.['vp']}`,
    );
    for (const id of ['org.ss_flag', 'org.manual_target', 'org.usage_override']) {
      const row = org.rows.find((r) => r.varId === id);
      expect(row?.member).toBe('');
      expect(row?.cells).toHaveLength(4);
    }
    const single = org.rows.find((r) => r.varId === 'g.vp_alloc_method');
    expect(single?.cells).toEqual(['value']);
    expect(single?.listRef).toBe(enumListId('g.vp_alloc_method'));
  });

  it('Corporate: year columns for year inputs, a value column for the rest', () => {
    const corp = sheet(aa, 'Corporate');
    const years = corp.columns.filter((c) => c.role === 'year');
    expect(years.map((c) => c.bind?.['iyear'])).toEqual(['fy25', 'fy26', 'fy27']);
    expect(years.map((c) => c.header)).toEqual(
      ['fy25', 'fy26', 'fy27'].map(
        (id) => (aaMembers['iyear'] ?? []).find((m) => m.id === id)?.label,
      ),
    );
    expect(corp.columns.some((c) => c.role === 'value')).toBe(true);
    const lab = corp.rows.find((r) => r.varId === 'corp.lab_hc_g' && r.member === 'pilots');
    expect(lab?.cells).toEqual(years.map((c) => c.id));
    expect(cellRef(bundle, lab as never, years[2] as never).memberKey).toBe('pilots,fy27');
    const scalar = corp.rows.find((r) => r.varId === 'corp.price_now');
    expect(scalar?.cells).toEqual(['value']);
    expect(corp.rows.every((r) => r.varId?.startsWith('corp.'))).toBe(true);
    const lacking = { ...aaMembers, iyear: [] };
    expect(() => buildTemplate(template, bundle, lacking)).toThrow(
      /no input dimension has the members/,
    );
  });

  it('Line_Items: one row per baseline line, the template columns, DELETE action, dropdown lists', () => {
    const li = sheet(aa, 'Line_Items');
    expect(li.rows).toHaveLength((aaMembers['line'] ?? []).length);
    expect(li.columns.map((c) => c.id)).toEqual([
      'member_key',
      ...(template.sheets.find((s) => s.name === 'Line_Items')?.editable_columns ?? []),
      'action',
      'hash',
    ]);
    expect(li.columns[0]).toMatchObject({ role: 'key', hidden: true, locked: true });
    expect(li.rowActions).toMatchObject({ column: 'action', values: ['', 'DELETE'] });
    const c = (id: string) => li.columns.find((x) => x.id === id);
    expect(c('pool_id')).toMatchObject({ attr: 'pool', listRef: 'dim.pool', editable: true });
    expect(c('scale_driver')).toMatchObject({ attr: 'drv', listRef: LIST_SCALE_DRIVERS });
    expect(c('in_scope')?.listRef).toBe(LIST_BOOL);
    expect(c('line.amount')).toMatchObject({
      varId: 'line.amount',
      mapsTo: 'variable_value',
      editable: true,
    });
    expect(c('action')?.choices).toEqual(['', 'DELETE']);
    expect(li.rows[0]?.attrs?.['pool']).toBe('internal_labour');
    expect(cellRef(bundle, li.rows[0] as never, c('line.amount') as never)).toEqual({
      varId: 'line.amount',
      memberKey: li.rows[0]?.id,
    });
  });

  it('Overrides, Outputs, README, _lists, _meta', () => {
    const ov = sheet(aa, 'Overrides');
    expect(ov.columns.map((c) => c.id)).toEqual([
      'node_key',
      'member_key',
      'value',
      'reason',
      'hash',
    ]);
    expect(ov.rows).toEqual([]);
    const out = sheet(aa, 'Outputs');
    expect(out.rows.some((r) => r.key === 'res.net' && r.member === '')).toBe(true);
    expect(out.rows.some((r) => r.key === 'vp.gap' && r.member === 'vp_commercial')).toBe(true);
    expect(out.columns.find((c) => c.role === 'scenario')).toMatchObject({
      perScenario: true,
      editable: false,
    });
    const readme = sheet(aa, 'README');
    expect(readme.text?.join(' ')).toContain(template.file.units_note);
    expect(readme.fields).toEqual(['export_job_id', 'exported_at']);
    const lists = sheet(aa, '_lists').lists ?? [];
    const byId = Object.fromEntries(lists.map((l) => [l.id, l.entries]));
    expect(byId['dim.vp']).toHaveLength(4);
    expect(byId['dim.pool']).toHaveLength(11);
    expect(byId[LIST_BOOL]).toEqual([
      { code: 0, label: '0' },
      { code: 1, label: '1' },
    ]);
    expect(byId[enumListId('g.vp_target_method')]).toEqual([
      { code: 1, label: 'proportional to addressable' },
      { code: 2, label: 'equal' },
      { code: 3, label: 'manual' },
    ]);
    expect((byId[LIST_SCALE_DRIVERS] ?? []).length).toBeGreaterThan(0);
  });

  it('rows carry the registry facts and number formats', () => {
    const t = sheet(aa, 'Targets');
    const row = t.rows.find((r) => r.varId === 'g.target_pct');
    expect(row).toMatchObject({
      unit: '%',
      numberFormat: '0.0%',
      type: 'number',
      scenarioVaries: false,
    });
    expect(t.rows.find((r) => r.varId === 'g.head_start')?.scenarioVaries).toBe(true);
    expect(t.rows.find((r) => r.varId === 'g.absorb_growth')?.listRef).toBe(LIST_BOOL);
    const wf = sheet(aa, 'Workforce').rows.find((r) => r.varId === 'wf.us_attrition');
    expect(wf?.unit).toBe('%/yr');
    expect(wf?.numberFormat).toBe('0.0%');
  });
});

describe('buildTemplate: malformed templates', () => {
  const withSheets = (sheets: ExcelTemplate['sheets']): ExcelTemplate => ({ ...template, sheets });

  it('rejects a sheet with no kind and an unknown name', () => {
    expect(() =>
      buildTemplate(withSheets([...template.sheets, { name: 'Mystery' }]), bundle, aaMembers),
    ).toThrow(/Mystery/);
  });

  it('rejects an unknown kind', () => {
    expect(() =>
      buildTemplate(
        withSheets([...template.sheets, { name: 'Odd', kind: 'pivot' }]),
        bundle,
        aaMembers,
      ),
    ).toThrow(/unknown kind 'pivot'/);
  });

  it('rejects an unknown scalar_inputs_columns header', () => {
    const bad = {
      ...template,
      scalar_inputs_columns: [...template.scalar_inputs_columns, { header: 'Surprise' }],
    };
    expect(() => buildTemplate(bad, bundle, aaMembers)).toThrow(/Surprise/);
  });

  it('rejects a column block that is not a variable', () => {
    const sheets = template.sheets.map((s) =>
      s.name === 'Lever_Timing'
        ? { ...s, column_blocks: [...(s.column_blocks ?? []), 'lev.nope'] }
        : s,
    );
    expect(() => buildTemplate(withSheets(sheets), bundle, aaMembers)).toThrow(/lev\.nope/);
  });

  it('cellRef rejects a cell that names no variable', () => {
    const org = sheet(aa, 'Org_Map');
    expect(() =>
      cellRef(
        bundle,
        { ...(org.rows[0] as object), varId: undefined } as never,
        org.columns[0] as never,
      ),
    ).toThrow(TemplateError);
  });
});
