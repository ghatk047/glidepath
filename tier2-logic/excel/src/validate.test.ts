import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  VALIDATION_RULES,
  vr01DomainOwnership,
  vr02SharedServicesOwner,
  vr03UsageKeys,
  type InputValueRow,
  type ValidationState,
} from '@glidepath/domain';
import {
  seedToTenantData,
  type InputValue,
  type ModelBundle,
  type TenantMembers,
  type TenantSeed,
} from '@glidepath/spec';
import { ExcelTemplateSchema, type ExcelTemplate } from '@glidepath/spec/generated';
import { loadModelBundleFromDir, readTenantSeed } from '@glidepath/spec/node';
import {
  buildTemplate,
  buildWorkbook,
  parseLoadedWorkbook,
  writeWorkbook,
  validateParsed,
  type ExportMeta,
  type ExportValues,
  type SheetDef,
  type ValidationBundle,
  type ValidationEntry,
} from './index';

const here = dirname(fileURLToPath(import.meta.url));
const specDir = join(here, '../../../docs/spec');
const NOW = new Date(Date.UTC(2026, 11, 4, 9, 5, 59));

let template: ExcelTemplate;
let model: ModelBundle;
let seed: TenantSeed;
let members: TenantMembers;
let defs: SheetDef[];
let values: ExportValues;
let meta: ExportMeta;
let bytes: Uint8Array;
let vb: ValidationBundle;
let scenarios: { id: string; label: string }[];

const rowsOf = (v: Readonly<Record<string, InputValue>>): InputValueRow[] =>
  Object.entries(v).flatMap(([var_key, value]) =>
    typeof value === 'number'
      ? [{ var_key, member_key: '', value }]
      : Object.entries(value).map(([member_key, n]) => ({ var_key, member_key, value: n })),
  );

async function freshBook(): Promise<ExcelJS.Workbook> {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes as unknown as ArrayBuffer);
  return book;
}

const defOf = (name: string): SheetDef => {
  const d = defs.find((x) => x.name === name);
  if (d === undefined) throw new Error(`no def ${name}`);
  return d;
};
const sheetOf = (book: ExcelJS.Workbook, name: string): ExcelJS.Worksheet => {
  const ws = book.getWorksheet(name);
  if (ws === undefined) throw new Error(`no sheet ${name}`);
  return ws;
};
function colOf(ws: ExcelJS.Worksheet, header: string): number {
  for (let c = 1; c <= ws.columnCount; c += 1) if (ws.getCell(1, c).value === header) return c;
  throw new Error(`${ws.name}: no column '${header}'`);
}
function rowOf(ws: ExcelJS.Worksheet, key: string, member = ''): number {
  for (let r = 2; r <= ws.rowCount; r += 1)
    if (ws.getCell(r, 1).value === key && (ws.getCell(r, 2).value ?? '') === member) return r;
  throw new Error(`${ws.name}: no row ${key}|${member}`);
}
/** The first row below the data whose key cell is blank (a spare slot of a table sheet). */
function spareRow(ws: ExcelJS.Worksheet): number {
  for (let r = 2; r <= ws.rowCount; r += 1) if (ws.getCell(r, 1).value === null) return r;
  return ws.rowCount + 1;
}
const set = (
  book: ExcelJS.Workbook,
  sheet: string,
  key: string,
  member: string,
  header: string,
  value: ExcelJS.CellValue,
): void => {
  const ws = sheetOf(book, sheet);
  ws.getCell(rowOf(ws, key, member), colOf(ws, header)).value = value;
};
const headerOf = (sheet: string, colId: string): string => {
  const h = defOf(sheet).columns.find((c) => c.id === colId)?.header;
  if (h === undefined) throw new Error(`no column ${sheet}/${colId}`);
  return h;
};

const validate = (book: ExcelJS.Workbook, bundle: ValidationBundle = vb): ValidationEntry[] =>
  validateParsed(parseLoadedWorkbook(book, defs, { scenarios }), bundle);
const byCode = (entries: readonly ValidationEntry[], code: ValidationEntry['code']) =>
  entries.filter((e) => e.code === code);
const textOf = (entries: readonly ValidationEntry[]): string =>
  entries.map((e) => e.message).join('\n');

beforeAll(async () => {
  template = ExcelTemplateSchema.parse(
    JSON.parse(readFileSync(join(specDir, 'excel_template.json'), 'utf8')),
  );
  model = await loadModelBundleFromDir(specDir);
  seed = await readTenantSeed(join(specDir, 'seed/aa'));
  members = seedToTenantData(seed, 'C', model).members;
  defs = buildTemplate(template, model, members);
  scenarios = ['A', 'C'].map((id) => {
    const s = seed.scenarios.scenarios.find((x) => x.id === id);
    if (s === undefined) throw new Error(`no scenario ${id}`);
    return { id, label: s.label };
  });
  // The AA seed holds a few values outside the registry's min/max (lev.L15.pct is 10%, the maximum 8%). VR04
  // reports those, so the fixture pulls every stored value inside its bounds to start from a clean export.
  const bounds = new Map(model.variables.map((v) => [v.id, v]));
  const inside = (rows: InputValueRow[]): InputValueRow[] =>
    rows.map((r) => {
      const { min = null, max = null } = bounds.get(r.var_key) ?? {};
      return { ...r, value: Math.min(max ?? Infinity, Math.max(min ?? -Infinity, r.value)) };
    });
  values = {
    defaults: inside(rowsOf(seed.variableValues)),
    scenarios: scenarios.map(({ id, label }) => ({
      id,
      label,
      values: inside(rowsOf(seed.scenarios.scenarios.find((x) => x.id === id)?.values ?? {})),
    })),
  };
  meta = {
    tenantId: seed.tenant.id,
    tenantSlug: 'aa',
    modelVersion: 'mv-test',
    templateVersion: template.template_version,
    exportJobId: 'exp-0001',
    exportedAt: NOW,
    exportedBy: 'user-1',
  };
  bytes = await writeWorkbook(buildWorkbook(defs, values, meta).workbook);
  vb = { sheets: defs, model, members };
});

describe('validateParsed: an unchanged export', () => {
  it('has no entries', async () => {
    expect(validate(await freshBook())).toEqual([]);
  });
});

// ----------------------------------------------------------------------------------------------
// Acceptance 1: one entry per kind of per-cell problem
// ----------------------------------------------------------------------------------------------

describe('validateParsed: per-cell checks', () => {
  it('flags an unknown key, an unknown member and an override of an unknown node', async () => {
    const book = await freshBook();
    const targets = sheetOf(book, 'Targets');
    const at = targets.rowCount + 1;
    targets.getCell(at, 1).value = 'g.no_such_input';
    targets.getCell(at, colOf(targets, 'Default')).value = 5;
    const pools = sheetOf(book, 'Pools');
    const pat = pools.rowCount + 1;
    pools.getCell(pat, 1).value = 'addr.share';
    pools.getCell(pat, 2).value = 'no_such_tag';
    pools.getCell(pat, colOf(pools, 'Default')).value = 0.5;
    const over = sheetOf(book, 'Overrides');
    const oat = spareRow(over);
    over.getCell(oat, colOf(over, 'Node key')).value = 'no.such.node';
    over.getCell(oat, colOf(over, 'Value')).value = 1;

    const entries = byCode(validate(book), 'unknown_key');
    expect(entries).toHaveLength(3);
    expect(entries.every((e) => e.severity === 'error')).toBe(true);
    expect(entries.map((e) => [e.locations[0]?.sheet, e.locations[0]?.row])).toEqual([
      ['Targets', at],
      ['Pools', pat],
      ['Overrides', oat],
    ]);
    expect(entries[0]?.message).toContain("key 'g.no_such_input'");
    expect(entries[1]?.message).toContain("member 'no_such_tag' of 'addr.share'");
    expect(entries[2]?.message).toContain("node 'no.such.node'");
  });

  it('flags a value of the wrong type: text in a number cell, a fraction in a whole-number cell', async () => {
    const book = await freshBook();
    set(book, 'Targets', 'g.target_net', '', 'Default', 'about 100');
    set(book, 'Workforce', 'hc.us', '', 'Default', 3000.5);
    set(book, 'Workforce', 'hc.us', '', 'Note', 'a note is text, never a type error');

    const entries = validate(book);
    expect(entries.map((e) => e.code)).toEqual(['type', 'type']);
    expect(entries.every((e) => e.severity === 'error')).toBe(true);
    expect(entries[0]?.cells).toEqual(['g.target_net[]']);
    expect(entries[0]?.message).toContain("'about 100' is not a number");
    expect(entries[1]?.cells).toEqual(['hc.us[]']);
    expect(entries[1]?.message).toContain('3000.5 is not a whole number');
  });

  it('flags a value outside min/max as VR04, below and above, and leaves the bounds themselves valid', async () => {
    const book = await freshBook();
    const row = defOf('Targets').rows.find((r) => r.key === 'g.target_net');
    const min = row?.min ?? 0;
    const max = row?.max ?? 0;
    set(book, 'Targets', 'g.target_net', '', 'Default', min - 1);
    set(book, 'Workforce', 'hc.us', '', 'Default', 999999);
    set(book, 'Targets', 'g.target_net', '', 'Note', 'edge');
    const entries = validate(book);
    expect(entries.map((e) => [e.code, e.rule, e.cells[0]])).toEqual([
      ['out_of_range', 'VR04', 'g.target_net[]'],
      ['out_of_range', 'VR04', 'hc.us[]'],
    ]);
    expect(entries.every((e) => e.severity === VALIDATION_RULES.VR04.severity)).toBe(true);
    expect(entries[0]?.message).toContain('below the minimum');
    expect(entries[1]?.message).toContain('above the maximum');

    const edge = await freshBook();
    set(edge, 'Targets', 'g.target_net', '', 'Default', min);
    set(
      edge,
      'Workforce',
      'hc.us',
      '',
      'Default',
      max === 0 ? 3000 : (defOf('Workforce').rows.find((r) => r.key === 'hc.us')?.max ?? 3000),
    );
    expect(validate(edge)).toEqual([]);
  });

  it('flags a value that is not one of the choices: enum, bool, a Line_Items dropdown and the action column', async () => {
    const book = await freshBook();
    set(book, 'Targets', 'g.target_mode', '', 'Default', 7);
    set(book, 'Org_Map', 'g.chargeback_on', '', 'Value', 'maybe');
    const items = sheetOf(book, 'Line_Items');
    items.getCell(2, colOf(items, headerOf('Line_Items', 'pool_id'))).value = 'no_such_pool';
    const spare = spareRow(items);
    items.getCell(spare, colOf(items, headerOf('Line_Items', 'action'))).value = 'REMOVE';

    const entries = validate(book);
    expect(entries.map((e) => e.code)).toEqual([
      'not_in_list',
      'not_in_list',
      'not_in_list',
      'not_in_list',
    ]);
    expect(entries.map((e) => e.locations[0]?.sheet)).toEqual([
      'Targets',
      'Org_Map',
      'Line_Items',
      'Line_Items',
    ]);
    expect(entries[0]?.message).toContain('7 is not one of the choices');
    expect(entries[0]?.cells).toEqual(['g.target_mode[]']);
    expect(entries[2]?.message).toContain("'no_such_pool'");
    expect(entries[3]?.message).toContain("'REMOVE' is not an action");

    // A dropdown label and a valid code pass.
    const ok = await freshBook();
    set(ok, 'Targets', 'g.target_mode', '', 'Default', '% of CY26 base');
    set(ok, 'Org_Map', 'g.chargeback_on', '', 'Value', 'TRUE');
    expect(validate(ok)).toEqual([]);
  });

  it('flags edits to locked columns and locked cells', async () => {
    const book = await freshBook();
    set(book, 'Targets', 'g.target_net', '', 'Unit', 'EUR');
    set(book, 'Targets', 'g.target_net', '', 'Min', 1);
    set(book, 'Workforce', 'hc.us', '', 'Input', 'Renamed input');
    // g.target_net does not vary by scenario: its scenario cells are locked.
    set(book, 'Targets', 'g.target_net', '', scenarios[1]?.label ?? '', 99);

    const entries = validate(book);
    expect(entries.map((e) => e.code)).toEqual([
      'locked_edit',
      'locked_edit',
      'locked_edit',
      'locked_edit',
    ]);
    const bySheet = entries.map(
      (e) => `${e.locations[0]?.sheet}:${e.locations[0]?.column}:${e.severity}`,
    );
    expect(bySheet).toEqual([
      'Targets:unit:warning',
      'Targets:min:warning',
      'Targets:scenario@C:error',
      'Workforce:label:warning',
    ]);
    const unit = defOf('Targets').rows.find((r) => r.key === 'g.target_net')?.unit ?? '';
    expect(entries[0]?.message).toContain(`it stays '${unit}'`);
    expect(entries[2]?.message).toContain('does not vary by scenario');
  });
});

// ----------------------------------------------------------------------------------------------
// Acceptance 2: cross-row rules reuse the domain's rule functions
// ----------------------------------------------------------------------------------------------

describe('validateParsed: cross-row rules (VR01, VR02, VR03) from @glidepath/domain', () => {
  it('reports ownership not summing to 100%, two shared-services VPs and usage keys not summing to 100%, as the domain rule functions do', async () => {
    const book = await freshBook();
    const vp = (id: string): string => headerOf('Org_Map', `vp.${id}`);
    // VR01: Commercial applications is 100% Commercial Technology; add 20% to Operations Technology.
    set(book, 'Org_Map', 'org.dom_share', 'commercial_applications', vp('vp_operations'), 0.2);
    // VR02: chargeback is on; mark a second VP as the shared-services owner.
    set(book, 'Org_Map', 'org.ss_flag', '', vp('vp_commercial'), 1);
    // VR03: switch the usage override on and make the keys add up to 115%.
    set(book, 'Org_Map', 'org.usage_override_on', '', 'Value', 1);
    set(book, 'Org_Map', 'org.usage_override', '', vp('vp_commercial'), 0.4);

    const entries = validate(book);
    expect(entries.map((e) => e.code)).toEqual(['cross_row', 'cross_row', 'cross_row']);
    expect(entries.map((e) => e.rule)).toEqual(['VR01', 'VR02', 'VR03']);
    expect(entries.every((e) => e.severity === 'error' && e.scenarioId === undefined)).toBe(true);

    // The same state through the domain's rule functions gives the same cells and messages.
    const edited = new Map(
      rowsOf(seed.variableValues).map((r) => [`${r.var_key}|${r.member_key}`, r]),
    );
    const put = (var_key: string, member_key: string, value: number): void => {
      edited.set(`${var_key}|${member_key}`, { var_key, member_key, value });
    };
    put('org.dom_share', 'commercial_applications,vp_operations', 0.2);
    put('org.ss_flag', 'vp_commercial', 1);
    put('org.usage_override_on', '', 1);
    put('org.usage_override', 'vp_commercial', 0.4);
    const state: ValidationState = { bundle: model, members, values: [...edited.values()] };
    const expected = [
      ...vr01DomainOwnership(state),
      ...vr02SharedServicesOwner(state),
      ...vr03UsageKeys(state),
    ];
    expect(expected).toHaveLength(3);
    expect(entries.map((e) => ({ cells: e.cells, message: e.message }))).toEqual(
      expected.map((e) => ({ cells: e.cells, message: e.message })),
    );

    // Each entry points at the workbook cells that carry its values.
    const vr01 = entries[0];
    expect(vr01?.locations.every((l) => l.sheet === 'Org_Map')).toBe(true);
    expect(vr01?.locations).toHaveLength(4);
    expect(entries[1]?.locations.map((l) => l.column)).toContain('vp.vp_commercial');
    expect(textOf(entries)).toContain('Commercial applications ownership sums to 120%');
  });

  it('checks each scenario on its own: VR07 in the default layer and in each scenario that retires more apps than the portfolio holds', async () => {
    const apps = 150;
    const retired = (sc: { values: readonly InputValueRow[] }): number =>
      sc.values.find((r) => r.var_key === 'lev.L09.n')?.value ??
      values.defaults.find((r) => r.var_key === 'lev.L09.n')?.value ??
      0;
    const over = values.scenarios.filter((sc) => retired(sc) > apps).map((sc) => sc.id);
    expect(over.length).toBeGreaterThan(0);

    const book = await freshBook();
    set(book, 'Pools', 'portfolio.apps', '', 'Default', apps);
    const found = validate(book).filter((e) => e.rule === 'VR07');
    expect(found.map((e) => e.scenarioId)).toEqual([undefined, ...over]);
    const first = over[0];
    const label = scenarios.find((s) => s.id === first)?.label ?? '';
    expect(found[1]?.message).toContain(`(scenario ${label})`);
    expect(found[1]?.locations.map((l) => l.column)).toEqual([`scenario@${first}`]);
    expect(found[0]?.locations.map((l) => l.column)).toEqual(['default', 'default']);

    // Bring that scenario back under the portfolio: its entry goes, the others stay.
    set(book, 'Levers', 'lev.L09.n', '', label, apps);
    const after = validate(book).filter((e) => e.rule === 'VR07');
    expect(after.map((e) => e.scenarioId)).toEqual([
      undefined,
      ...over.filter((id) => id !== first),
    ]);
  });

  it('starts from the stored values: a blank cell leaves the stored value, and without stored values it counts as 0', async () => {
    const book = await freshBook();
    for (const name of [
      'Targets',
      'Workforce',
      'Pools',
      'Levers',
      'Lever_Timing',
      'Line_Items',
      'Corporate',
    ])
      book.removeWorksheet(sheetOf(book, name).id);
    const withCurrent: ValidationBundle = {
      ...vb,
      current: { defaults: rowsOf(seed.variableValues) },
    };
    expect(validate(book, withCurrent)).toEqual([]);

    set(
      book,
      'Org_Map',
      'org.dom_share',
      'commercial_applications',
      headerOf('Org_Map', 'vp.vp_commercial'),
      null,
    );
    expect(validate(book, withCurrent)).toEqual([]);
    expect(validate(book).map((e) => e.rule)).toEqual(['VR01']);
  });
});
