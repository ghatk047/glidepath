import { useState } from 'react';
import { ApiError, type ExcelSheet, type ExportResult } from '@glidepath/api-contract';
import { GlassPanel } from '@glidepath/ui/glass';
import { useEditableStyles } from '@glidepath/ui/inputs/editable';
import { Segmented } from '@glidepath/ui/inputs/controls';
import { useBindContext } from '../../bind';
import { useApiClient, useScenarios } from '../../data';
import {
  EXPORT_SHEETS,
  SCENARIO_CHOICES,
  namePattern,
  scenariosFor,
  type ScenarioChoice,
} from './model';

export const errorText = (e: unknown): string =>
  e instanceof ApiError
    ? e.problem.detail
    : e instanceof Error
      ? e.message
      : 'Something went wrong.';

/** Hands the bytes tier 2 served to the browser as a download. */
function saveBytes(bytes: Uint8Array, contentType: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: contentType }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Export panel: scenario choice, sheet chips, file name, "Export workbook". The export runs in
 * tier 2 (`POST exports`); the file comes back through `GET files/:id`.
 */
export function ExportPanel({ onExported }: { onExported?: (e: ExportResult) => void }) {
  useEditableStyles();
  const { tenant } = useBindContext();
  const api = useApiClient();
  const scenarios = useScenarios(tenant);
  const [choice, setChoice] = useState<ScenarioChoice>('C+D');
  const [sheets, setSheets] = useState<ReadonlySet<ExcelSheet>>(new Set(EXPORT_SHEETS));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<ExportResult | null>(null);

  const picked = scenariosFor(choice, scenarios.data?.scenarios ?? []);
  const keys = picked.map((s) => s.key);

  const toggle = (s: ExcelSheet) => {
    setDone(null);
    setSheets((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  };

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.exportCreate({
        params: { tenant },
        body: {
          scenarioIds: picked.map((s) => s.id),
          ...(sheets.size < EXPORT_SHEETS.length
            ? { sheets: EXPORT_SHEETS.filter((s) => sheets.has(s)) }
            : {}),
        },
      });
      const file = await api.fileDownload({ params: { tenant, id: result.file.id } });
      saveBytes(file.bytes, file.contentType, file.filename ?? result.file.filename);
      setDone(result);
      onExported?.(result);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const filename = done?.file.filename ?? namePattern(tenant, keys);
  return (
    <GlassPanel
      span={4}
      header={{
        label: 'Export',
        status:
          done === null ? undefined : (
            <span className="gp-chip" data-testid="template-version">
              {`template v${done.templateVersion}`}
            </span>
          ),
      }}
    >
      <div className="gp-xl-section">
        <h3 className="gp-xl-eyebrow" id="xl-scenarios">
          Scenarios
        </h3>
        <Segmented<ScenarioChoice>
          label="Scenarios to export"
          options={SCENARIO_CHOICES}
          value={choice}
          onChange={(c) => {
            setChoice(c);
            setDone(null);
          }}
        />
      </div>
      <div className="gp-xl-section">
        <h3 className="gp-xl-eyebrow">Sheets</h3>
        <div className="gp-xl-chips" role="group" aria-label="Sheets to export">
          {EXPORT_SHEETS.map((s) => (
            <button
              key={s}
              type="button"
              className="gp-chip gp-xl-chip"
              aria-pressed={sheets.has(s)}
              data-sheet={s}
              onClick={() => toggle(s)}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
      <div className="gp-xl-section">
        <div className="gp-xl-file">
          <span className="gp-xl-file-icon" aria-hidden="true">
            ▤
          </span>
          <span className="gp-xl-file-text">
            <span className="gp-xl-file-name" data-testid="export-filename">
              {filename}
            </span>
            <span className="gp-xl-file-sub">
              Yellow cells are editable · rows keyed, not positional
            </span>
          </span>
        </div>
      </div>
      <button
        type="button"
        className="gp-btn gp-xl-primary"
        data-variant="primary"
        disabled={busy || picked.length === 0 || sheets.size === 0}
        onClick={() => void run()}
      >
        {busy ? 'Exporting…' : 'Export workbook'}
      </button>
      {error !== null && (
        <p className="gp-xl-error" role="alert">
          {error}
        </p>
      )}
    </GlassPanel>
  );
}
