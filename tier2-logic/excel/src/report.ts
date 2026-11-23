import type {
  CellDiff,
  CellStatus,
  CellTarget,
  DeltaEntry,
  DiffMode,
  DiffResult,
  DiffValue,
  RowDiff,
  RowStatus,
  UnmatchedDiff,
} from './diff';
import { toDeltaEntry } from './diff';
import type { CellLocation, ValidationEntry } from './validate';

/**
 * report.ts: diff + validation -> the delta report (`delta_report_schema` of docs/spec/excel_template.json,
 * docs/architecture/05_excel_roundtrip.md section 1, import_pipeline steps 3 and 4).
 *
 * The report is the schema's object: `import_job_id`, `export_job_id`, `mode`, `summary` (counts), `changes[]`
 * (one entry per cell or row that is not unchanged, plus one per problem validation found that the diff did not
 * list) and the `impact` slot. The types mirror `DeltaReport` of `contract/api-contract` (CON-03) without importing
 * it: tier 2 core packages stay off the contract, and a test keeps the keys equal to the spec's.
 *
 * `invalid`: a validation entry that blocks (severity `error`, or VR04 `out_of_range`, which `applyChangeset` rejects
 * for origin `excel_import`) turns every entry it points at into `invalid`. Invalid entries are reported, never
 * applied (`toChangeset.ts`).
 *
 * `changes[]` entries carry only the schema's keys, so they cannot say which column of a row a cell is (the Default,
 * the Note and the attribute cells of one row share sheet, key, member and scenario). `BuiltReport.items` therefore
 * keeps one detail record per entry, at the same index, with the column, the file row and the write target;
 * `toChangeset` reads it. Both are plain JSON: the worker stores them together.
 *
 * Pure: no IO. Import job and export ids and the impact preview come from the caller.
 */

// ----------------------------------------------------------------------------------------------
// Public types (the delta report, mirrored)
// ----------------------------------------------------------------------------------------------

/** `delta_report_schema.summary`: counts per status. */
export interface DeltaSummary {
  readonly unchanged: number;
  readonly changed_in_excel: number;
  readonly changed_in_app: number;
  readonly conflict: number;
  readonly invalid: number;
  readonly new_rows: number;
  readonly deleted_rows: number;
  /** `already_applied` and `missing_row` entries, plus rows and cells that could not be placed (`unmatched`) and warnings that point at no change. */
  readonly ignored: number;
}

/**
 * `delta_report_schema.impact`: the scenario and, per hero node id (`res.net`, `res.gap`, `br.eps27`),
 * `[before, after]` as the engine recomputes it (import_pipeline step 5).
 */
export interface DeltaImpact {
  readonly scenario: string;
  readonly [node: string]: string | readonly [number, number];
}

/** The delta report, `delta_report_schema` verbatim. */
export interface DeltaReport {
  readonly import_job_id: string;
  readonly export_job_id: string | null;
  readonly mode: DiffMode;
  readonly summary: DeltaSummary;
  readonly changes: readonly DeltaEntry[];
  readonly impact: DeltaImpact;
}

/** Detail of a cell entry: what `changes[i]` leaves out. */
export interface CellItem {
  readonly kind: 'cell';
  /** Index into `report.changes`. */
  readonly index: number;
  /** Column id as in the snapshot (`default`, `scenario@C`, `note`, `name`). */
  readonly column: string;
  /** 1-based row of the sheet in the workbook. */
  readonly rowNumber: number;
  readonly target: CellTarget;
  /** The diff's status before validation: `report.changes[index].status` is `invalid` when validation blocks the cell. */
  readonly diffStatus: CellStatus;
}

/** Detail of a row entry (new, deleted or missing row). */
export interface RowItem {
  readonly kind: 'row';
  readonly index: number;
  /** 1-based row of the sheet; `null` for a missing row. */
  readonly rowNumber: number | null;
  readonly diffStatus: RowStatus;
  readonly inExport: boolean;
  readonly inApp: boolean;
  /** Workbook values (new, deleted row) or the app's (missing row), by column id. */
  readonly cells: Readonly<Record<string, DiffValue>>;
}

/** A problem validation found at a cell or row that the diff did not list (an unchanged cell, an unknown key): always `invalid`. */
export interface IssueItem {
  readonly kind: 'issue';
  readonly index: number;
  readonly rowNumber: number;
  readonly column: string;
}

export type ReportItem = CellItem | RowItem | IssueItem;

/** What `buildReport` returns: the schema's report and the detail `toChangeset` needs. */
export interface BuiltReport {
  readonly report: DeltaReport;
  /** One record per `report.changes[i]`, same index. */
  readonly items: readonly ReportItem[];
  /** Rows and cells the diff could not place (never applied; counted in `summary.ignored`). */
  readonly unmatched: readonly UnmatchedDiff[];
  /** Validation entries that do not block and point at no change (e.g. an edited locked label): reported, counted as ignored. */
  readonly warnings: readonly ValidationEntry[];
}

export interface ReportOptions {
  /** `import_job.id`. Default `''` (the worker sets it). */
  readonly importJobId?: string;
  /** `export_job.id` of the workbook; default `null` (a foreign workbook). */
  readonly exportJobId?: string | null;
  /** The impact preview (step 5). Default: an empty slot for the first scenario the changes touch. */
  readonly impact?: DeltaImpact;
}

// ----------------------------------------------------------------------------------------------
// Validation entries -> blocking, places
// ----------------------------------------------------------------------------------------------

/** VR04 is a warning in `validate.ts`, but `applyChangeset` rejects an out-of-bounds value from an Excel import. */
const BOUNDS_RULE = 'VR04';

/** Does the entry stop the cells it points at from being applied? */
export function blocks(entry: ValidationEntry): boolean {
  return entry.severity === 'error' || entry.rule === BOUNDS_RULE || entry.code === 'out_of_range';
}

const CELL_KEY = /^(.*)\[(.*)\]$/;

/** The location of an entry without file positions: from its first CellKey (`id[member_key]`). */
function locationOfCellKey(entry: ValidationEntry): CellLocation | undefined {
  const m = CELL_KEY.exec(entry.cells[0] ?? '');
  if (m === null) return undefined;
  return { sheet: '', row: 0, key: m[1] ?? '', member: m[2] ?? '', column: '' };
}

const at = (sheet: string, row: number | null, column?: string): string =>
  `${sheet}\u0001${row ?? ''}\u0001${column ?? ''}`;

// ----------------------------------------------------------------------------------------------
// buildReport
// ----------------------------------------------------------------------------------------------

type Draft =
  | { readonly kind: 'cell'; readonly diff: CellDiff; messages: string[]; invalid: boolean }
  | { readonly kind: 'row'; readonly diff: RowDiff; messages: string[]; invalid: boolean }
  | {
      readonly kind: 'issue';
      readonly entry: DeltaEntry;
      readonly rowNumber: number;
      readonly column: string;
      messages: string[];
    };

const sheetOfDraft = (d: Draft): string => (d.kind === 'issue' ? d.entry.sheet : d.diff.sheet);
const rowOfDraft = (d: Draft): number | null =>
  d.kind === 'issue' ? d.rowNumber : d.diff.rowNumber;

/**
 * The delta report of one import.
 *
 * - `diff`: `diff(E, W, D, sheets)` (`diff.ts`). `validation`: `validateParsed(...)` of the same workbook.
 * - `changes[]`: every `CellDiff` and `RowDiff` (`toDeltaEntry`), in workbook order grouped by sheet, with the
 *   messages of the validation entries that point at them. A blocking entry (error, or VR04) sets the status to
 *   `invalid`. Entries that point at nothing the diff listed (an unchanged cell with a bad type, an unknown key,
 *   a cross-row rule on cells the diff did not change) get one `invalid` entry at their first location, with `null`
 *   values.
 * - `summary`: `unchanged` from the diff, the other counts from `changes[]` (a cell turned `invalid` counts as
 *   invalid only). `ignored` is `already_applied` + `missing_row` + unplaced rows and cells + warnings that point
 *   at no change.
 */
export function buildReport(
  diff: DiffResult,
  validation: readonly ValidationEntry[],
  options: ReportOptions = {},
): BuiltReport {
  const drafts: Draft[] = [
    ...diff.cells.map((c): Draft => ({ kind: 'cell', diff: c, messages: [], invalid: false })),
    ...diff.rows.map((r): Draft => ({ kind: 'row', diff: r, messages: [], invalid: false })),
  ];
  const byPlace = new Map<string, Draft[]>();
  for (const d of drafts) {
    const column = d.kind === 'cell' ? d.diff.column : undefined;
    const k = at(sheetOfDraft(d), rowOfDraft(d), column);
    byPlace.set(k, [...(byPlace.get(k) ?? []), d]);
  }
  const rowDrafts = new Map<string, Draft[]>();
  for (const d of drafts) {
    if (d.kind !== 'row' || d.diff.rowNumber === null) continue;
    const k = at(d.diff.sheet, d.diff.rowNumber);
    rowDrafts.set(k, [...(rowDrafts.get(k) ?? []), d]);
  }

  const issues = new Map<string, Extract<Draft, { kind: 'issue' }>>();
  const warnings: ValidationEntry[] = [];
  const covered = new Set<string>();

  for (const entry of validation) {
    const blocking = blocks(entry);
    const locations = entry.locations.length > 0 ? entry.locations : [];
    const hits = new Set<Draft>();
    for (const loc of locations) {
      for (const d of byPlace.get(at(loc.sheet, loc.row, loc.column)) ?? []) hits.add(d);
      // A row entry (new or deleted row) is hit by any cell of its file row.
      for (const d of rowDrafts.get(at(loc.sheet, loc.row)) ?? []) hits.add(d);
      if (blocking) covered.add(at(loc.sheet, loc.row, loc.column)).add(at(loc.sheet, loc.row));
    }
    for (const d of hits) {
      if (!d.messages.includes(entry.message)) d.messages.push(entry.message);
      if (blocking && d.kind !== 'issue') d.invalid = true;
    }
    if (hits.size > 0) continue;
    if (!blocking) {
      warnings.push(entry);
      continue;
    }
    const loc = locations[0] ?? locationOfCellKey(entry);
    if (loc === undefined) continue;
    const k = at(loc.sheet, loc.row, loc.column);
    const known = issues.get(k);
    if (known !== undefined) {
      if (!known.messages.includes(entry.message)) known.messages.push(entry.message);
      continue;
    }
    issues.set(k, {
      kind: 'issue',
      entry: {
        sheet: loc.sheet,
        key: loc.key,
        member: loc.member,
        scenario: loc.scenarioId ?? entry.scenarioId ?? null,
        export: null,
        workbook: null,
        current: null,
        status: 'invalid',
        messages: [],
      },
      rowNumber: loc.row,
      column: loc.column,
      messages: [entry.message],
    });
  }

  const all: Draft[] = [...drafts, ...issues.values()];
  // Group by sheet in order of first appearance, then by file row (stable).
  const sheetOrder = new Map<string, number>();
  for (const d of all)
    if (!sheetOrder.has(sheetOfDraft(d))) sheetOrder.set(sheetOfDraft(d), sheetOrder.size);
  const order = all
    .map((d, seq) => ({ d, seq }))
    .sort(
      (a, b) =>
        (sheetOrder.get(sheetOfDraft(a.d)) ?? 0) - (sheetOrder.get(sheetOfDraft(b.d)) ?? 0) ||
        (rowOfDraft(a.d) ?? Infinity) - (rowOfDraft(b.d) ?? Infinity) ||
        a.seq - b.seq,
    )
    .map((x) => x.d);

  const changes: DeltaEntry[] = [];
  const items: ReportItem[] = [];
  for (const d of order) {
    const index = changes.length;
    if (d.kind === 'issue') {
      changes.push({ ...d.entry, messages: d.messages });
      items.push({ kind: 'issue', index, rowNumber: d.rowNumber, column: d.column });
      continue;
    }
    const entry = toDeltaEntry(d.diff);
    changes.push({
      ...entry,
      status: d.invalid ? 'invalid' : entry.status,
      messages: [...entry.messages, ...d.messages],
    });
    if (d.kind === 'cell')
      items.push({
        kind: 'cell',
        index,
        column: d.diff.column,
        rowNumber: d.diff.rowNumber,
        target: d.diff.target,
        diffStatus: d.diff.status,
      });
    else
      items.push({
        kind: 'row',
        index,
        rowNumber: d.diff.rowNumber,
        diffStatus: d.diff.status,
        inExport: d.diff.inExport,
        inApp: d.diff.inApp,
        cells: d.diff.cells,
      });
  }

  const count = (status: DeltaEntry['status']): number =>
    changes.filter((c) => c.status === status).length;
  const unplaced = diff.unmatched.filter(
    (u) =>
      !covered.has(at(u.sheet, u.rowNumber, u.column ?? undefined)) &&
      !(u.column === null && covered.has(at(u.sheet, u.rowNumber))),
  );
  const summary: DeltaSummary = {
    unchanged: diff.counts.unchanged,
    changed_in_excel: count('changed_in_excel'),
    changed_in_app: count('changed_in_app'),
    conflict: count('conflict'),
    invalid: count('invalid'),
    new_rows: count('new_row'),
    deleted_rows: count('deleted_row'),
    ignored: count('already_applied') + count('missing_row') + unplaced.length + warnings.length,
  };
  const firstScenario = changes.find((c) => c.scenario !== null)?.scenario ?? '';
  return {
    report: {
      import_job_id: options.importJobId ?? '',
      export_job_id: options.exportJobId ?? null,
      mode: diff.mode,
      summary,
      changes,
      impact: options.impact ?? { scenario: firstScenario },
    },
    items,
    unmatched: diff.unmatched,
    warnings,
  };
}

/** The same report with the impact preview filled in (import_pipeline step 5 runs after the diff). */
export function withImpact(built: BuiltReport, impact: DeltaImpact): BuiltReport {
  return { ...built, report: { ...built.report, impact } };
}
