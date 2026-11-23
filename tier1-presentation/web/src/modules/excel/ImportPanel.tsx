import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import type { ExportResult, ImportApplyResult, ImportJob } from '@glidepath/api-contract';
import { GlassPanel } from '@glidepath/ui/glass';
import { useEditableStyles } from '@glidepath/ui/inputs/editable';
import { StatusChip } from '@glidepath/ui/hud';
import { formatByUnit } from '@glidepath/ui/inputs/slider';
import { DiffRow, DiffTable, type DiffChoice } from '@glidepath/ui/rows';
import { useBindContext } from '../../bind';
import { useApiClient, useBundle, useMembers } from '../../data';
import { errorText } from './ExportPanel';
import { decisionsFor, invalidRows, reviewRows, type RowKey } from './model';

/** How often a queued import is asked about again (ADR-024: the client polls). */
export const POLL_MS = 400;

/** Tier 2's ISO timestamp as `2026-12-04 09:30` (no locale formatting: the time is shown as sent). */
const stamp = (iso: string): string => iso.replace('T', ' ').slice(0, 16);

function readBytes(file: File): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === 'function') {
    return file.arrayBuffer().then((b) => new Uint8Array(b));
  }
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer));
    r.onerror = () => reject(r.error ?? new Error('Could not read the file.'));
    r.readAsArrayBuffer(file);
  });
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Import review: drop a workbook, tier 2 parses and diffs it (`POST imports`, then `GET imports/:id`
 * until it has a report), the user takes File or App per row, and tier 2 applies the result as
 * one changeset. Nothing here reads the workbook or compares values.
 */
export function ImportPanel({ lastExport }: { lastExport: ExportResult | null }) {
  useEditableStyles();
  const { tenant } = useBindContext();
  const api = useApiClient();
  const bundle = useBundle(tenant);
  const members = useMembers(tenant);
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [job, setJob] = useState<ImportJob | null>(null);
  const [busy, setBusy] = useState<'upload' | 'apply' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choices, setChoices] = useState<Record<RowKey, DiffChoice>>({});
  const [accepted, setAccepted] = useState<Record<RowKey, boolean>>({});
  const [showImpact, setShowImpact] = useState(false);
  const [applied, setApplied] = useState<ImportApplyResult | null>(null);

  const parsing = job !== null && job.status === null;
  const jobId = job?.id;
  useEffect(() => {
    if (!parsing || jobId === undefined) return;
    let live = true;
    const timer = setTimeout(() => {
      api
        .importGet({ params: { tenant, id: jobId } })
        .then((next) => live && setJob(next))
        .catch((e: unknown) => {
          if (!live) return;
          setError(errorText(e));
          setJob(null);
        });
    }, POLL_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [api, tenant, parsing, jobId, job]);

  const upload = useCallback(
    async (file: File) => {
      setBusy('upload');
      setError(null);
      setApplied(null);
      setShowImpact(false);
      setChoices({});
      setAccepted({});
      setJob(null);
      try {
        const body = await readBytes(file);
        setJob(
          await api.importCreate({ params: { tenant }, query: { filename: file.name }, body }),
        );
      } catch (e) {
        setError(errorText(e));
      } finally {
        setBusy(null);
      }
    },
    [api, tenant],
  );

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer.files[0];
    if (file) void upload(file);
  };

  const report = job?.report ?? null;
  const labels = useMemo(
    () => ({ bundle: bundle.data, members: members.data }),
    [bundle.data, members.data],
  );
  const rows = useMemo(() => (report ? reviewRows(report, labels) : []), [report, labels]);
  const invalid = useMemo(() => (report ? invalidRows(report, labels) : []), [report, labels]);

  const apply = async () => {
    if (!job) return;
    setBusy('apply');
    setError(null);
    try {
      setApplied(
        await api.importApply({
          params: { tenant, id: job.id },
          body: { accept: 'all', decisions: decisionsFor(rows, choices, accepted) },
        }),
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const conflicts = rows.filter((r) => r.status === 'conflict').length;
  const errors =
    (report?.summary.invalid ?? 0) +
    (job?.violations.filter((v) => v.severity === 'error').length ?? 0);
  const failed = job?.status === 'failed';
  const reviewable = job !== null && report !== null && !failed;

  const exportedLine = (() => {
    if (!job || !report) return null;
    if (report.mode === 'foreign') {
      return 'Foreign file · no export to compare, so the file is checked against the app now';
    }
    const known = lastExport && lastExport.id === job.exportId ? lastExport : null;
    const when = known ? `Exported ${stamp(known.createdAt)}` : `Uploaded ${stamp(job.createdAt)}`;
    return `${when} · compared three ways: export, file, app now`;
  })();

  const impactNodes = report
    ? Object.entries(report.impact).filter((e): e is [string, [number, number]] =>
        Array.isArray(e[1]),
      )
    : [];
  const nodeText = (id: string, v: number) => {
    const n = bundle.data?.nodes.find((d) => d.id === id);
    return n ? formatByUnit(v, n.unit, n.unit === '%' ? 0.001 : 0.1) : String(v);
  };

  return (
    <GlassPanel
      span={8}
      header={{
        label: `Import review${job ? ` · ${job.filename}` : ''}`,
        status: reviewable ? (
          <span className="gp-xl-head-chips">
            <StatusChip status="info" label={plural(rows.length, 'change')} />
            <StatusChip
              status={conflicts > 0 ? 'conflict' : 'info'}
              label={plural(conflicts, 'conflict')}
            />
            <StatusChip status={errors > 0 ? 'short' : 'clear'} label={plural(errors, 'error')} />
          </span>
        ) : undefined,
      }}
    >
      <input
        ref={input}
        type="file"
        className="gp-xl-hidden"
        tabIndex={-1}
        aria-label="Workbook file"
        accept=".xlsx,.csv"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void upload(file);
        }}
      />
      <div
        className="gp-xl-file"
        data-drop=""
        data-over={over}
        data-testid="drop-zone"
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <span className="gp-xl-file-icon" aria-hidden="true">
          ⤓
        </span>
        <span className="gp-xl-file-text">
          <span className="gp-xl-file-name">
            {job ? job.filename : 'Drop an edited workbook here'}
          </span>
          <span className="gp-xl-file-sub" role="status">
            {busy === 'upload'
              ? 'Uploading…'
              : parsing
                ? `Reading the workbook… ${job?.progressNote ?? ''}`.trim()
                : (exportedLine ??
                  'An .xlsx exported from here, or any workbook with the same keys')}
          </span>
        </span>
        <button
          type="button"
          className="gp-btn"
          disabled={busy !== null}
          onClick={() => input.current?.click()}
        >
          {job ? 'Replace' : 'Choose file'}
        </button>
      </div>

      {failed && (
        <p className="gp-xl-error" role="alert">
          {job.error?.detail ?? 'The import failed. Check the file and try again.'}
        </p>
      )}
      {error !== null && (
        <p className="gp-xl-error" role="alert">
          {error}
        </p>
      )}

      {reviewable && (
        <div className="gp-xl-review">
          {rows.length > 0 ? (
            <DiffTable>
              {rows.map((r) => (
                <DiffRow
                  key={r.id}
                  rowId={r.id}
                  sheet={r.sheet}
                  item={r.item}
                  exported={r.exported}
                  file={r.file}
                  appNow={r.appNow}
                  status={r.status}
                  accepted={accepted[r.id] ?? true}
                  onAccept={(v) => setAccepted((p) => ({ ...p, [r.id]: v }))}
                  choice={choices[r.id] ?? 'file'}
                  onChoice={(v) => setChoices((p) => ({ ...p, [r.id]: v }))}
                />
              ))}
            </DiffTable>
          ) : (
            <p className="gp-xl-note">No differences to apply.</p>
          )}

          {invalid.length > 0 && (
            <ul className="gp-xl-list" aria-label="Rows with errors">
              {invalid.map((i) => (
                <li key={i.id}>{i.text}</li>
              ))}
            </ul>
          )}
          {job.ignored.sheets.length + job.ignored.columns.length > 0 && (
            <p className="gp-xl-note">
              {`Ignored: ${[
                ...job.ignored.sheets.map((s) => `sheet ${s}`),
                ...job.ignored.columns.map((c) => `${c.sheet} · ${c.header}`),
              ].join(', ')}`}
            </p>
          )}

          {showImpact && (
            <ul className="gp-xl-impact" aria-label="Impact preview" data-testid="impact">
              {impactNodes.map(([id, [before, after]]) => (
                <li key={id} data-node={id}>
                  <span>{bundle.data?.nodes.find((n) => n.id === id)?.label ?? id}</span>
                  <strong>{`${nodeText(id, before)} → ${nodeText(id, after)}`}</strong>
                </li>
              ))}
            </ul>
          )}

          <div className="gp-xl-foot">
            <span data-testid="validation-line">
              {job.violations.length === 0 ? (
                'Validation VR01–VR10 passed'
              ) : (
                <>{job.violations.map((v) => `${v.rule}: ${v.message}`).join(' · ')}</>
              )}
            </span>
            <span className="gp-xl-foot-actions">
              <button
                type="button"
                className="gp-btn"
                aria-pressed={showImpact}
                onClick={() => setShowImpact((s) => !s)}
              >
                Preview impact
              </button>
              <button
                type="button"
                className="gp-btn"
                data-variant="primary"
                disabled={busy !== null || applied !== null || errors > 0}
                onClick={() => void apply()}
              >
                <span aria-hidden="true">✓</span> Apply as changeset
              </button>
            </span>
          </div>
          {applied !== null && (
            <p className="gp-xl-note" role="status">
              {`Applied as changeset ${applied.changesetId} · ${plural(applied.editsCount, 'edit')}`}
              {applied.warnings.length > 0 &&
                ` · ${applied.warnings.map((w) => `${w.rule}: ${w.message}`).join(' · ')}`}
            </p>
          )}
        </div>
      )}
    </GlassPanel>
  );
}
