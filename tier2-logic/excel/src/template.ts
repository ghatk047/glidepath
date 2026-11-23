import { memberKey } from '@glidepath/domain';
import type {
  AttrValue,
  DimId,
  Member,
  MemberId,
  ModelBundle,
  NodeDef,
  TenantMembers,
  VarId,
  VariableDef,
} from '@glidepath/spec';
import type { ExcelTemplate } from '@glidepath/spec/generated';
import type {
  ColumnDef,
  ColumnRole,
  ListDef,
  ListEntry,
  RowDef,
  SheetDef,
  SheetKind,
} from './types';

/**
 * template.ts: `excel_template.json` + model bundle + tenant members -> sheet definitions.
 * Pure: the caller loads the template (zod: `ExcelTemplateSchema` in `@glidepath/spec/generated`), the
 * bundle (`loadModelBundle`) and the members (`seedToTenantData` or the tenant's rows) and passes them in.
 * Spec: docs/spec/05_excel_template.md section 2, docs/architecture/05_excel_roundtrip.md sections 1 and 5.
 */

export type TemplateSheet = ExcelTemplate['sheets'][number];
type TemplateColumn = ExcelTemplate['scalar_inputs_columns'][number];

/** Thrown when the template, the bundle and the members do not fit together. */
export class TemplateError extends Error {
  override readonly name = 'TemplateError';
}

/** Sheets that have no `kind` in the template are recognised by name. */
const README_SHEET = 'README';
const LISTS_SHEET = '_lists';
const META_SHEET = '_meta';

/** Validation list ids on `_lists`. Tenant lists are named after the dimension they list. */
export const LIST_BOOL = 'bool';
export const LIST_SCALE_DRIVERS = 'scale_drivers';
export const enumListId = (varId: VarId): string => `enum.${varId}`;
const dimListId = (dim: DimId): string => `dim.${dim}`;

/** Header text of `scalar_inputs_columns` -> role. The template is global, so the set of headers is closed. */
const HEADER_ROLES: Readonly<Record<string, ColumnRole>> = {
  key: 'key',
  member: 'member',
  Group: 'group',
  Input: 'label',
  Unit: 'unit',
  Min: 'min',
  Max: 'max',
  Default: 'default',
  Source: 'source',
  Confidence: 'confidence',
  Note: 'note',
  _hash: 'hash',
};
const SCENARIO_ROLE: ColumnRole = 'scenario';

/** Docs/architecture/05 section 3: `key`, `member` and `_hash` columns are hidden. */
const HIDDEN_ROLES: ReadonlySet<ColumnRole> = new Set<ColumnRole>(['key', 'member', 'hash']);

/** Line_Items column tokens (excel_template.json) -> attribute of a `line` member. */
const LINE_ATTR: Readonly<Record<string, string>> = {
  pool_id: 'pool',
  domain_key: 'domain',
  addr_tag: 'addr',
  scale_driver: 'drv',
};
/** Line_Items column tokens -> the dimension whose members the dropdown lists. */
const LINE_DIM_LISTS: Readonly<Record<string, DimId>> = {
  pool_id: 'pool',
  domain_key: 'domain',
  addr_tag: 'addr_tag',
};
const LINE_BOOL_COLUMNS: ReadonlySet<string> = new Set(['in_scope']);
const LINE_DIM: DimId = 'line';

const asArray = (v: string | readonly string[] | undefined): readonly string[] =>
  v === undefined ? [] : typeof v === 'string' ? [v] : v;

const humanize = (token: string): string => {
  const spaced = token.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

// ----------------------------------------------------------------------------------------------
// Context
// ----------------------------------------------------------------------------------------------

interface Ctx {
  readonly template: ExcelTemplate;
  readonly bundle: ModelBundle;
  readonly members: TenantMembers;
  readonly varById: ReadonlyMap<VarId, VariableDef>;
  readonly varIndex: ReadonlyMap<VarId, number>;
  /** variable id -> name of the sheet that carries it */
  readonly placement: ReadonlyMap<VarId, string>;
}

const memberList = (ctx: Ctx, dim: DimId): readonly Member[] => ctx.members[dim] ?? [];
const memberIds = (ctx: Ctx, dim: DimId): readonly MemberId[] =>
  memberList(ctx, dim).map((m) => m.id);

const memberLabel = (m: Member): string => {
  const label = m['label'];
  return typeof label === 'string' && label !== '' ? label : m.id;
};

/** Cartesian product of the members of `dims`, as bindings. No dims: one empty binding. */
function expand(ctx: Ctx, dims: readonly DimId[]): Record<DimId, MemberId>[] {
  let out: Record<DimId, MemberId>[] = [{}];
  for (const dim of dims) {
    const ids = memberIds(ctx, dim);
    out = out.flatMap((b) => ids.map((id) => ({ ...b, [dim]: id })));
  }
  return out;
}

/** Member ids of `bind` in the dims order of `def`, comma-joined. */
function ownMember(def: VariableDef, bind: Readonly<Record<DimId, MemberId>>): string {
  const dims = def.dims.filter((d) => bind[d] !== undefined);
  return memberKey({ id: def.id, dims }, bind);
}

function numberFormatFor(
  unit: string,
  formats: Readonly<Record<string, string>>,
): string | undefined {
  const exact = formats[unit];
  if (exact !== undefined) return exact;
  const percent = '%';
  if (unit.startsWith(percent)) return formats[percent];
  return undefined;
}

// ----------------------------------------------------------------------------------------------
// Which sheet carries which variable
// ----------------------------------------------------------------------------------------------

/**
 * Assign every input variable to one sheet, driven by the template: explicit ids first (matrix blocks,
 * Line_Items columns, `var` / `also`), then `filter.prefix`, then member-input sheets (which also take
 * the other variables over the dimensions they list), then the group of a matrix `var`, then group filters.
 * Variables with role `simulation` are model outputs of the Monte Carlo, not inputs, and get no cell.
 */
export function placeVariables(template: ExcelTemplate, bundle: ModelBundle): Map<VarId, string> {
  const placed = new Map<VarId, string>();
  const inputs = bundle.variables.filter((v) => v.role !== 'simulation');
  const claim = (sheet: string, pick: (v: VariableDef) => boolean): void => {
    for (const v of inputs) if (!placed.has(v.id) && pick(v)) placed.set(v.id, sheet);
  };
  const byId = (sheet: string, ids: readonly string[]): void =>
    claim(sheet, (v) => ids.includes(v.id));

  for (const s of template.sheets) {
    byId(s.name, [...(s.column_blocks ?? []), ...(s.editable_columns ?? [])]);
    if (s.var !== undefined) byId(s.name, [s.var, ...asArray(s.also)]);
  }
  for (const s of template.sheets) {
    const prefix = s.filter?.prefix;
    if (prefix !== undefined) claim(s.name, (v) => v.id.startsWith(prefix));
  }
  for (const s of template.sheets) {
    if (s.kind !== 'member_inputs') continue;
    const groups = s.filter?.groups ?? [];
    const exclude = new Set(s.filter?.exclude_dims ?? []);
    const inGroups = inputs.filter((v) => v.group !== undefined && groups.includes(v.group));
    const dims = new Set(inGroups.flatMap((v) => v.dims).filter((d) => !exclude.has(d)));
    claim(
      s.name,
      (v) =>
        (inGroups.includes(v) && !v.dims.some((d) => exclude.has(d))) ||
        (v.dims.length > 0 && v.dims.every((d) => dims.has(d))),
    );
  }
  for (const s of template.sheets) {
    const anchor =
      s.kind === 'matrix' && s.var !== undefined
        ? bundle.variables.find((v) => v.id === s.var)
        : undefined;
    if (anchor?.group !== undefined) {
      const group = anchor.group;
      claim(s.name, (v) => v.group === group && v.dims.length === 0);
    }
  }
  for (const s of template.sheets) {
    if (s.kind !== 'scalar_inputs') continue;
    const groups = s.filter?.groups;
    if (groups !== undefined)
      claim(s.name, (v) => v.group !== undefined && groups.includes(v.group));
  }

  const missing = inputs.filter((v) => !placed.has(v.id)).map((v) => v.id);
  if (missing.length > 0) {
    throw new TemplateError(
      `no sheet in excel_template.json carries input variable(s): ${missing.join(', ')}`,
    );
  }
  return placed;
}

// ----------------------------------------------------------------------------------------------
// Columns
// ----------------------------------------------------------------------------------------------

function templateColumn(c: TemplateColumn): ColumnDef {
  const role: ColumnRole | undefined =
    c.repeat !== undefined ? SCENARIO_ROLE : HEADER_ROLES[c.header];
  if (role === undefined)
    throw new TemplateError(`scalar_inputs_columns: unknown header '${c.header}'`);
  const editable = c.editable === true;
  return {
    id: role,
    header: c.header,
    role,
    locked: c.locked === true || !editable,
    editable,
    hidden: HIDDEN_ROLES.has(role) || c.hidden === true || c.width === 0,
    perScenario: c.repeat !== undefined,
    blankMeans: c.blank_means,
    mapsTo: c.maps_to,
    width: c.width,
    note: c.note,
  };
}

/** The scalar_inputs_columns of the template, in order, with the column of `role` found by role. */
function scalarColumns(ctx: Ctx): ColumnDef[] {
  return ctx.template.scalar_inputs_columns.map(templateColumn);
}

function columnOf(ctx: Ctx, role: ColumnRole): ColumnDef {
  const col = scalarColumns(ctx).find((c) => c.role === role);
  if (col === undefined) throw new TemplateError(`scalar_inputs_columns has no '${role}' column`);
  return col;
}

/** A column that is not in `scalar_inputs_columns`: system columns of the matrix, table and meta sheets. */
function plainColumn(
  id: string,
  header: string,
  role: ColumnRole,
  over: Partial<ColumnDef> = {},
): ColumnDef {
  return {
    id,
    header,
    role,
    locked: true,
    editable: false,
    hidden: HIDDEN_ROLES.has(role),
    perScenario: false,
    ...over,
  };
}

/** An editable value column (a clone of the template's `Default` column: stored as variable_value). */
function valueColumn(
  ctx: Ctx,
  id: string,
  header: string,
  role: ColumnRole,
  over: Partial<ColumnDef> = {},
): ColumnDef {
  return { ...columnOf(ctx, 'default'), id, header, role, ...over };
}

// ----------------------------------------------------------------------------------------------
// Rows
// ----------------------------------------------------------------------------------------------

function varRow(
  ctx: Ctx,
  def: VariableDef,
  bind: Readonly<Record<DimId, MemberId>>,
  group?: string,
): RowDef {
  const formats = ctx.template.cell_rules.number_formats;
  const listRef =
    def.type === 'bool' ? LIST_BOOL : def.type === 'enum' ? enumListId(def.id) : undefined;
  const member = ownMember(def, bind);
  return {
    id: member === '' ? def.id : `${def.id}|${member}`,
    key: def.id,
    member,
    varId: def.id,
    bind,
    group: group ?? def.group ?? '',
    label: def.label,
    unit: def.unit,
    type: def.type,
    min: def.min,
    max: def.max,
    numberFormat: numberFormatFor(def.unit, formats),
    source: def.source,
    confidence: def.confidence,
    scenarioVaries: def.scenario_varies,
    listRef,
  };
}

const varsOf = (ctx: Ctx, sheet: string): VariableDef[] =>
  ctx.bundle.variables.filter((v) => ctx.placement.get(v.id) === sheet);

const sheetFlags = (s: TemplateSheet) => ({
  hidden: s.hidden === true,
  protected: s.protected === true,
  editable: s.editable !== false && s.hidden !== true,
});

function sheetOf(
  s: TemplateSheet,
  kind: SheetKind,
  columns: readonly ColumnDef[],
  rows: readonly RowDef[],
  extra: Partial<SheetDef> = {},
): SheetDef {
  return { name: s.name, kind, ...sheetFlags(s), columns, rows, note: s.note, ...extra };
}

// ----------------------------------------------------------------------------------------------
// Sheet builders
// ----------------------------------------------------------------------------------------------

/** Targets, Workforce, Pools, Levers: one row per variable (per member for dimensioned ones). */
function inputsSheet(ctx: Ctx, s: TemplateSheet): SheetDef {
  // Layout "grouped by <dim>": the variable id's second segment names a member of that dim (lev.L05.nb -> L05).
  const groupDim = /grouped by (\w+)/.exec(s.layout ?? '')?.[1];
  const groupMembers = groupDim === undefined ? [] : memberList(ctx, groupDim);
  let vars = varsOf(ctx, s.name);
  const groupOf = new Map<VarId, Member>();
  if (groupDim !== undefined && groupMembers.length > 0) {
    const kept: VariableDef[] = [];
    for (const v of vars) {
      const owner = groupMembers.find((m) => m.id === v.id.split('.')[1]);
      if (owner !== undefined) {
        groupOf.set(v.id, owner);
        kept.push(v);
      }
    }
    const order = (v: VariableDef): number => groupMembers.indexOf(groupOf.get(v.id) as Member);
    vars = kept.sort(
      (a, b) =>
        order(a) - order(b) || (ctx.varIndex.get(a.id) ?? 0) - (ctx.varIndex.get(b.id) ?? 0),
    );
  }
  const rows = vars.flatMap((v) => {
    const owner = groupOf.get(v.id);
    const group = owner === undefined ? undefined : `${owner.id} · ${memberLabel(owner)}`;
    return expand(ctx, v.dims).map((bind) => varRow(ctx, v, bind, group));
  });
  const kind: SheetKind = s.kind === 'member_inputs' ? 'member_inputs' : 'scalar_inputs';
  return sheetOf(s, kind, scalarColumns(ctx), rows);
}

/** Lever_Timing: lever x block (start, ramp, confidence, on), each block once per scenario. */
function leverTimingSheet(ctx: Ctx, s: TemplateSheet): SheetDef {
  const rowDim = s.rows ?? '';
  const blocks = (s.column_blocks ?? []).map((id) => {
    const def = ctx.varById.get(id);
    if (def === undefined)
      throw new TemplateError(`${s.name}: column block '${id}' is not a variable`);
    return def;
  });
  const columns: ColumnDef[] = [
    columnOf(ctx, 'key'),
    columnOf(ctx, 'member'),
    { ...columnOf(ctx, 'label'), header: humanize(rowDim) },
    ...blocks.map((def) =>
      valueColumn(ctx, def.id, def.label, 'block', {
        perScenario: s.per_scenario === true,
        mapsTo: 'scenario_value',
        blankMeans: columnOf(ctx, 'scenario').blankMeans,
        varId: def.id,
      }),
    ),
    columnOf(ctx, 'hash'),
  ];
  const rows: RowDef[] = memberList(ctx, rowDim).map((m) => ({
    id: m.id,
    key: rowDim,
    member: m.id,
    bind: { [rowDim]: m.id },
    group: '',
    label: memberLabel(m),
    unit: '',
    cells: blocks.map((b) => b.id),
  }));
  return sheetOf(s, 'matrix', columns, rows, { matrix: { rows: rowDim } });
}

/** Org_Map: domain x VP shares with a row check, then the VP-wise inputs and the remaining org settings. */
function orgMapSheet(ctx: Ctx, s: TemplateSheet): SheetDef {
  const anchor = ctx.varById.get(s.var ?? '');
  if (anchor === undefined)
    throw new TemplateError(`${s.name}: var '${s.var ?? ''}' is not a variable`);
  const rowDim = s.rows ?? '';
  const colDim = asArray(s.cols)[0] ?? '';
  const colMembers = memberList(ctx, colDim);
  const vpCols = colMembers.map((m) =>
    valueColumn(ctx, `${colDim}.${m.id}`, memberLabel(m), 'matrix_col', {
      bind: { [colDim]: m.id },
    }),
  );
  const vpIds = vpCols.map((c) => c.id);
  const checkColumn = 'row_check';
  const hasCheck = s.row_check !== undefined;
  const columns: ColumnDef[] = [
    columnOf(ctx, 'key'),
    columnOf(ctx, 'member'),
    columnOf(ctx, 'label'),
    columnOf(ctx, 'unit'),
    valueColumn(ctx, 'value', 'Value', 'value'),
    ...vpCols,
    ...(hasCheck ? [plainColumn(checkColumn, 'Row check', 'check', { note: s.row_check })] : []),
    columnOf(ctx, 'hash'),
  ];
  const rows: RowDef[] = memberList(ctx, rowDim).map((m) => ({
    ...varRow(ctx, anchor, { [rowDim]: m.id }, anchor.group),
    label: memberLabel(m),
    cells: vpIds,
    checked: hasCheck,
  }));
  for (const v of varsOf(ctx, s.name)) {
    if (v.id === anchor.id) continue;
    const onCols = v.dims.length === 1 && v.dims[0] === colDim;
    if (onCols) rows.push({ ...varRow(ctx, v, {}), cells: vpIds });
    else
      for (const bind of expand(ctx, v.dims))
        rows.push({ ...varRow(ctx, v, bind), cells: ['value'] });
  }
  return sheetOf(s, 'matrix', columns, rows, {
    matrix: { rows: rowDim, cols: colDim },
    ...(hasCheck ? { rowCheck: { column: checkColumn, rule: s.row_check as string } } : {}),
  });
}

/** Corporate: drivers x year columns; a driver without a year dimension has a single value column. */
function corporateSheet(ctx: Ctx, s: TemplateSheet): SheetDef {
  const years = asArray(s.cols);
  const vars = varsOf(ctx, s.name);
  const yearDim = [...new Set(vars.flatMap((v) => v.dims))].find((d) => {
    const ids = memberIds(ctx, d);
    return years.length > 0 && years.every((y) => ids.includes(y));
  });
  if (yearDim === undefined) {
    throw new TemplateError(`${s.name}: no input dimension has the members ${years.join(', ')}`);
  }
  const yearMembers = memberList(ctx, yearDim);
  const yearCols = years.map((y) => {
    const m = yearMembers.find((x) => x.id === y);
    return valueColumn(ctx, `${yearDim}.${y}`, m === undefined ? y : memberLabel(m), 'year', {
      bind: { [yearDim]: y },
    });
  });
  const yearIds = yearCols.map((c) => c.id);
  const columns: ColumnDef[] = [
    columnOf(ctx, 'key'),
    columnOf(ctx, 'member'),
    columnOf(ctx, 'group'),
    columnOf(ctx, 'label'),
    columnOf(ctx, 'unit'),
    columnOf(ctx, 'min'),
    columnOf(ctx, 'max'),
    valueColumn(ctx, 'value', 'Value', 'value'),
    ...yearCols,
    columnOf(ctx, 'source'),
    columnOf(ctx, 'confidence'),
    columnOf(ctx, 'note'),
    columnOf(ctx, 'hash'),
  ];
  const rows = vars.flatMap((v) => {
    const hasYear = v.dims.includes(yearDim);
    const rowDims = v.dims.filter((d) => d !== yearDim);
    return expand(ctx, rowDims).map((bind) => ({
      ...varRow(ctx, v, bind),
      cells: hasYear ? yearIds : ['value'],
    }));
  });
  return sheetOf(s, 'year_matrix', columns, rows);
}

/** Line_Items: one row per baseline line; the editable columns of the template, then the action column. */
function lineItemsSheet(ctx: Ctx, s: TemplateSheet): SheetDef {
  const tokens = s.editable_columns ?? [];
  const fieldColumns = tokens.map((token) => {
    const def = ctx.varById.get(token);
    if (def !== undefined) {
      return valueColumn(ctx, token, def.label, 'field', {
        varId: def.id,
        mapsTo: 'variable_value',
        blankMeans: undefined,
      });
    }
    const dimList = LINE_DIM_LISTS[token];
    const listRef = LINE_BOOL_COLUMNS.has(token)
      ? LIST_BOOL
      : token === 'scale_driver'
        ? LIST_SCALE_DRIVERS
        : dimList === undefined
          ? undefined
          : dimListId(dimList);
    return plainColumn(token, humanize(token), 'field', {
      attr: LINE_ATTR[token] ?? token,
      locked: false,
      editable: true,
      listRef,
    });
  });
  const actions = s.row_actions;
  const columns: ColumnDef[] = [
    plainColumn(s.key ?? 'member_key', s.key ?? 'member_key', 'key'),
    ...fieldColumns,
    ...(actions === undefined
      ? []
      : [
          plainColumn(actions.column, humanize(actions.column), 'action', {
            locked: false,
            editable: true,
            choices: actions.values,
          }),
        ]),
    columnOf(ctx, 'hash'),
  ];
  const rows: RowDef[] = memberList(ctx, LINE_DIM).map((m) => {
    const attrs: Record<string, AttrValue | undefined> = {};
    for (const [k, v] of Object.entries(m)) if (k !== 'id') attrs[k] = v;
    return {
      id: m.id,
      key: m.id,
      member: m.id,
      bind: { [LINE_DIM]: m.id },
      group: '',
      label: typeof attrs['name'] === 'string' ? attrs['name'] : m.id,
      unit: '',
      attrs,
    };
  });
  return sheetOf(s, 'table', columns, rows, {
    ...(actions === undefined
      ? {}
      : {
          rowActions: { column: actions.column, values: actions.values, newRows: actions.new_rows },
        }),
  });
}

/** Overrides: the template's columns; the rows are the pinned nodes, which `build.ts` fills in. */
function overridesSheet(ctx: Ctx, s: TemplateSheet): SheetDef {
  const columns: ColumnDef[] = [
    ...(s.columns ?? []).map((token) =>
      plainColumn(token, humanize(token), 'field', { locked: false, editable: true }),
    ),
    columnOf(ctx, 'hash'),
  ];
  return sheetOf(s, 'table', columns, []);
}

/** Outputs: key results of the output nodes, one column per exported scenario, for reference only. */
function outputsSheet(ctx: Ctx, s: TemplateSheet): SheetDef {
  const scenario = {
    ...columnOf(ctx, 'scenario'),
    locked: true,
    editable: false,
    mapsTo: undefined,
    blankMeans: undefined,
  };
  const columns: ColumnDef[] = [
    columnOf(ctx, 'key'),
    columnOf(ctx, 'member'),
    columnOf(ctx, 'group'),
    { ...columnOf(ctx, 'label'), header: 'Output' },
    columnOf(ctx, 'unit'),
    scenario,
  ];
  const rows = ctx.bundle.nodes
    .filter((n: NodeDef) => n.output)
    .flatMap((n) =>
      expand(ctx, n.dims).map((bind): RowDef => {
        const member = n.dims.map((d) => bind[d] as string).join(',');
        return {
          id: member === '' ? n.id : `${n.id}|${member}`,
          key: n.id,
          member,
          bind,
          group: n.layer,
          label: n.label === '' ? n.id : n.label,
          unit: n.unit,
        };
      }),
    );
  return sheetOf(s, 'snapshot', columns, rows);
}

/** README: the generic text of the template. `build.ts` adds export id and time. */
function readmeSheet(ctx: Ctx, s: TemplateSheet): SheetDef {
  const t = ctx.template;
  const rules = t.cell_rules;
  const text = [
    ...(s.content === undefined ? [] : [s.content]),
    ...t.principles,
    t.file.units_note,
    `Editable cells: ${rules.editable_fill}. Locked cells: ${rules.locked_cells}. Data validation: ${rules.data_validation}.`,
  ];
  const wanted = ['export_job_id', 'exported_at'];
  const metaFields = ctx.template.sheets.find((x) => x.name === META_SHEET)?.fields ?? [];
  return sheetOf(s, 'readme', [plainColumn('text', 'README', 'text')], [], {
    text,
    fields: wanted.filter((f) => metaFields.includes(f)),
  });
}

function parseEnumEntries(def: VariableDef): ListEntry[] {
  const found = [...def.label.matchAll(/(-?\d+)\s*=\s*([^,;]+)/g)].map((m): ListEntry => ({
    code: Number(m[1]),
    label: (m[2] ?? '').trim(),
  }));
  if (found.length > 0) return found;
  const entries: ListEntry[] = [];
  if (def.min === null || def.max === null) return entries;
  for (let code = def.min; code <= def.max; code += def.step ?? 1)
    entries.push({ code, label: String(code) });
  return entries;
}

/** `_lists`: dropdown sources for the tenant's dimensions, scale drivers, booleans and enums. */
function listsSheet(ctx: Ctx, s: TemplateSheet): SheetDef {
  const dimList = (dim: DimId): ListDef => ({
    id: dimListId(dim),
    entries: memberList(ctx, dim).map((m) => ({ code: m.id, label: memberLabel(m) })),
  });
  const drivers = [
    ...new Set(
      memberList(ctx, LINE_DIM)
        .map((m) => m[LINE_ATTR['scale_driver'] ?? ''])
        .filter((v): v is string => typeof v === 'string' && v !== ''),
    ),
  ];
  const lists: ListDef[] = [
    ...Object.values(LINE_DIM_LISTS).map(dimList),
    dimList('vp'),
    { id: LIST_SCALE_DRIVERS, entries: drivers.map((d) => ({ code: d, label: d })) },
    {
      id: LIST_BOOL,
      entries: [0, 1].map((code) => ({ code, label: String(code) })),
    },
    ...ctx.bundle.variables
      .filter((v) => v.type === 'enum')
      .map((v): ListDef => ({ id: enumListId(v.id), entries: parseEnumEntries(v) })),
  ];
  const columns = lists.flatMap((l) => [
    plainColumn(`${l.id}.code`, `${l.id} code`, 'list_code'),
    plainColumn(`${l.id}.label`, `${l.id} label`, 'list_label'),
  ]);
  return sheetOf(s, 'lists', columns, [], {
    lists,
    text: s.content === undefined ? [] : [s.content],
  });
}

/** `_meta`: the field names of the template; `build.ts` writes the values. */
function metaSheet(_ctx: Ctx, s: TemplateSheet): SheetDef {
  const columns = [plainColumn('field', 'field', 'text'), plainColumn('value', 'value', 'text')];
  return sheetOf(s, 'meta', columns, [], { fields: s.fields ?? [] });
}

// ----------------------------------------------------------------------------------------------
// Entry point
// ----------------------------------------------------------------------------------------------

function buildSheet(ctx: Ctx, s: TemplateSheet): SheetDef {
  switch (s.kind) {
    case 'scalar_inputs':
    case 'member_inputs':
      return inputsSheet(ctx, s);
    case 'matrix':
      return s.column_blocks !== undefined ? leverTimingSheet(ctx, s) : orgMapSheet(ctx, s);
    case 'year_matrix':
      return corporateSheet(ctx, s);
    case 'table':
      return s.editable_columns !== undefined ? lineItemsSheet(ctx, s) : overridesSheet(ctx, s);
    case 'snapshot':
      return outputsSheet(ctx, s);
    case undefined:
      if (s.name === README_SHEET) return readmeSheet(ctx, s);
      if (s.name === LISTS_SHEET) return listsSheet(ctx, s);
      if (s.name === META_SHEET) return metaSheet(ctx, s);
      throw new TemplateError(`sheet '${s.name}' has no kind and is not README, _lists or _meta`);
    default:
      throw new TemplateError(`sheet '${s.name}': unknown kind '${s.kind}'`);
  }
}

/**
 * Sheet definitions for one tenant, in the template's sheet order.
 *
 * - `template`: parsed `excel_template.json`.
 * - `bundle`: the model version (variables define rows, min/max, units, enums; output nodes define Outputs).
 * - `members`: the tenant's dimension members (VPs become Org_Map columns, labor groups Corporate rows,
 *   lines Line_Items rows, levers Lever_Timing rows).
 *
 * Throws `TemplateError` when an input variable has no sheet or the template is malformed.
 */
export function buildTemplate(
  template: ExcelTemplate,
  bundle: ModelBundle,
  members: TenantMembers,
): SheetDef[] {
  const ctx: Ctx = {
    template,
    bundle,
    members,
    varById: new Map(bundle.variables.map((v) => [v.id, v])),
    varIndex: new Map(bundle.variables.map((v, i) => [v.id, i])),
    placement: placeVariables(template, bundle),
  };
  return template.sheets.map((s) => buildSheet(ctx, s));
}

/** The variable and member key of one cell: the row's binding plus the column's. */
export function cellRef(
  bundle: ModelBundle,
  row: RowDef,
  col: ColumnDef,
): { readonly varId: VarId; readonly memberKey: string } {
  const varId = col.varId ?? row.varId;
  const def = bundle.variables.find((v) => v.id === varId);
  if (varId === undefined || def === undefined) {
    throw new TemplateError(`row '${row.id}' / column '${col.id}' names no variable`);
  }
  return { varId, memberKey: memberKey(def, { ...row.bind, ...col.bind }) };
}
