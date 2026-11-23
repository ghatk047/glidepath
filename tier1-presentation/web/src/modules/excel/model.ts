import {
  ExcelSheet,
  type BundleResponse,
  type DeltaChange,
  type DeltaReport,
  type ImportDecision,
  type MembersResponse,
  type Scenario,
} from '@glidepath/api-contract';
import { formatByUnit } from '@glidepath/ui/inputs/slider';
import { EM_DASH } from '@glidepath/ui/format';
import type { DiffChoice, DiffStatus } from '@glidepath/ui/rows';

/**
 * Display mapping for the Excel module. Nothing here parses a workbook, diffs two values or
 * decides a status: tier 2 sent the delta report, this only picks labels and units for it.
 */

/** The editable-sheet chips: every sheet of the template except the hidden `_` ones. */
export const EXPORT_SHEETS: readonly ExcelSheet[] = ExcelSheet.options.filter(
  (s) => !s.startsWith('_'),
);

export type ScenarioChoice = 'C' | 'D' | 'C+D' | 'all';

export const SCENARIO_CHOICES: readonly { id: ScenarioChoice; label: string }[] = [
  { id: 'C', label: 'C' },
  { id: 'D', label: 'D' },
  { id: 'C+D', label: 'C + D' },
  { id: 'all', label: 'All five' },
];

/** Preset scenarios in the order tier 2 lists them (`kind: preset`). */
export function presets(scenarios: readonly Scenario[]): Scenario[] {
  return scenarios.filter((s) => s.kind === 'preset' && !s.archived);
}

/** The scenarios a choice names; unknown keys are skipped. */
export function scenariosFor(choice: ScenarioChoice, scenarios: readonly Scenario[]): Scenario[] {
  const all = presets(scenarios);
  if (choice === 'all') return all;
  const keys = choice === 'C+D' ? ['C', 'D'] : [choice];
  return keys.flatMap((k) => all.filter((s) => s.key === k));
}

/** `excel_template.json` `file.name_pattern`, shown until tier 2 answers with the real name. */
export function namePattern(tenant: string, keys: readonly string[]): string {
  return `${tenant}_it_savings_${keys.join('-')}_{yyyymmdd-hhmm}.xlsx`;
}

export type RowKey = string;

export interface ReviewRow {
  id: RowKey;
  change: DeltaChange;
  status: DiffStatus;
  sheet: string;
  item: string;
  exported: string;
  file: string;
  appNow: string;
}

const STATUS: Partial<Record<DeltaChange['status'], DiffStatus>> = {
  conflict: 'conflict',
  changed_in_excel: 'ok',
  new_row: 'new',
  deleted_row: 'removed',
};
const ORDER: Record<DiffStatus, number> = { conflict: 0, new: 1, removed: 2, ok: 3 };

export const rowId = (c: Pick<DeltaChange, 'sheet' | 'key' | 'member' | 'scenario'>): RowKey =>
  [c.sheet, c.key, c.member, c.scenario ?? ''].join('|');

export interface Labels {
  bundle: BundleResponse | undefined;
  members: MembersResponse | undefined;
}

function memberLabel(members: MembersResponse | undefined, key: string): string {
  for (const list of Object.values(members?.dimensions ?? {})) {
    const hit = list.find((m) => m.key === key);
    if (hit) return hit.label;
  }
  return key;
}

function itemLabel(c: DeltaChange, { bundle, members }: Labels): string {
  const def = bundle?.variables.find((v) => v.id === c.key);
  const parts: string[] = [];
  const memberParts = c.member === '' ? [] : String(c.member).split(',');
  if (def === undefined && c.key === '') parts.push('New');
  else parts.push(def?.label ?? c.key);
  for (const m of memberParts) parts.push(memberLabel(members, m));
  const text = parts.join(' · ');
  return c.scenario === null ? text : `${text} (${c.scenario})`;
}

function valueText(
  v: DeltaChange['workbook'],
  c: DeltaChange,
  bundle: BundleResponse | undefined,
): string {
  if (v === null) return EM_DASH;
  if (typeof v === 'string') return v;
  const def = bundle?.variables.find((d) => d.id === c.key);
  return def ? formatByUnit(v, def.unit, def.step ?? 0.01) : String(v);
}

/** Rows tier 2 says need a look (conflict, changed in file, new, deleted), conflicts first. */
export function reviewRows(report: DeltaReport, labels: Labels): ReviewRow[] {
  const rows: ReviewRow[] = [];
  for (const change of report.changes) {
    const status = STATUS[change.status];
    if (status === undefined) continue;
    rows.push({
      id: rowId(change),
      change,
      status,
      sheet: change.sheet,
      item: itemLabel(change, labels),
      exported: valueText(change.export, change, labels.bundle),
      file: valueText(change.workbook, change, labels.bundle),
      appNow: valueText(change.current, change, labels.bundle),
    });
  }
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => ORDER[a.r.status] - ORDER[b.r.status] || a.i - b.i)
    .map((x) => x.r);
}

/** Rows tier 2 flagged `invalid`, with its messages, for the error list. */
export function invalidRows(report: DeltaReport, labels: Labels): { id: RowKey; text: string }[] {
  return report.changes
    .filter((c) => c.status === 'invalid')
    .map((c) => ({
      id: rowId(c),
      text: `${c.sheet} · ${itemLabel(c, labels)}: ${c.messages.join(' ') || 'invalid value'}`,
    }));
}

/**
 * The apply body's decisions: every conflict needs one (File = excel, App = app); a row the
 * user switched off is kept as the app value. Rows taken as the file's default need none.
 */
export function decisionsFor(
  rows: readonly ReviewRow[],
  choices: Readonly<Record<RowKey, DiffChoice>>,
  accepted: Readonly<Record<RowKey, boolean>>,
): ImportDecision[] {
  const out: ImportDecision[] = [];
  for (const r of rows) {
    const { sheet, key, member, scenario } = r.change;
    const base = { sheet, key, member, scenario };
    if (r.status === 'conflict') {
      out.push({ ...base, take: (choices[r.id] ?? 'file') === 'file' ? 'excel' : 'app' });
    } else if (accepted[r.id] === false) {
      out.push({ ...base, take: 'app' });
    }
  }
  return out;
}
