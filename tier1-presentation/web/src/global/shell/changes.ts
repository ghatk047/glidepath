import type {
  BundleResponse,
  ChangeRecord,
  ChangesetHistoryResponse,
  ChangesetOrigin,
} from '@glidepath/api-contract';
import { EM_DASH } from '@glidepath/ui/format';
import type { EditChange } from '@glidepath/ui/overlays/palette';
import { formatFor } from '../../bind';

/**
 * Tray rows from tier 2's changeset history (`GET /scenarios/:id/changesets`), newest first as
 * sent. Only changesets tier 2 reports as `applied` are listed (reverted and rejected ones are
 * not in effect); one row per stored change. Values are shown as tier 2 stored them, formatted
 * by the variable's unit from the bundle. Nothing is computed.
 */

/** Who made a changeset when tier 2 names no person. UX copy. */
const ORIGIN_WHO: Readonly<Record<ChangesetOrigin, string>> = {
  ui: 'You',
  excel_import: 'Excel',
  api: 'API',
  solver: 'Solver',
  ai_reconfig: 'AI',
  market_refresh: 'Market',
  seed: 'Seed',
};

export interface ChangeLabels {
  /** The bundle the labels and units come from. */
  bundle: BundleResponse | undefined;
  /** The viewer's user id: their own changes read "You". */
  me: string | undefined;
}

function describe(change: ChangeRecord, bundle: BundleResponse | undefined) {
  const def =
    change.target === 'variable'
      ? bundle?.variables.find((v) => v.id === change.key)
      : change.target === 'override'
        ? bundle?.nodes.find((n) => n.id === change.key)
        : undefined;
  const label = def?.label ?? change.key;
  const what = change.member ? `${label} · ${change.member}` : label;
  const step = def && 'step' in def ? def.step : undefined;
  const show = formatFor(undefined, def?.unit, step, def?.percentScale);
  const text = (v: unknown): string => {
    if (v === null || v === undefined) return EM_DASH;
    if (typeof v === 'number') return Number.isFinite(v) ? show(v) : String(v);
    if (typeof v === 'string' || typeof v === 'boolean') return String(v);
    return JSON.stringify(v);
  };
  return { what, from: text(change.oldValue), to: text(change.newValue) };
}

export function editChanges(
  pages: readonly ChangesetHistoryResponse[] | undefined,
  { bundle, me }: ChangeLabels,
): EditChange[] {
  const rows: EditChange[] = [];
  for (const page of pages ?? []) {
    for (const cs of page.changesets) {
      if (cs.status !== 'applied') continue;
      const who =
        me !== undefined && cs.createdBy === me
          ? ORIGIN_WHO.ui
          : (cs.createdByName ?? ORIGIN_WHO[cs.origin]);
      for (const change of cs.changes) {
        rows.push({ id: `${cs.id}:${String(change.seq)}`, who, ...describe(change, bundle) });
      }
    }
  }
  return rows;
}
