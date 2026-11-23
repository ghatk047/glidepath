import { SolverRun, SolverSpec } from '@glidepath/api-contract';
import type { Problem } from '@glidepath/api-contract';
import type { SolverRunRecord } from '@glidepath/data-access';
import { problemTypes } from '@glidepath/api-contract';
import { storedKey } from '../../jobs';
import { checked } from '../read/mappers';
import { toContractResult } from './result';

/**
 * What the request adds to `solver_run.spec` beside `{problem, params}` (the table has no columns for it; JOB-02
 * keeps the cache key in the spec the same way): the contract's `quick`, `save` and `scenarioVersion`. The
 * contract's `SolverSpec` ignores the extra field, so the spec a client reads back is what it sent.
 */
export interface RunMeta {
  readonly quick: boolean;
  readonly save: boolean;
  /** `scenario.version` the run started from. */
  readonly scenarioVersion: number;
}

type Raw = Readonly<Record<string, unknown>>;
const isObject = (v: unknown): v is Raw => v !== null && typeof v === 'object' && !Array.isArray(v);

export function metaOf(spec: unknown): RunMeta {
  const m = isObject(spec) && isObject(spec.run) ? spec.run : {};
  return {
    quick: m.quick === true,
    save: m.save === true,
    scenarioVersion: typeof m.scenarioVersion === 'number' && Number.isInteger(m.scenarioVersion) && m.scenarioVersion >= 0 ? m.scenarioVersion : 0,
  };
}

const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** The problem a failed run answers: the worker stores `{ error }` (a message) in `result`. */
function errorOf(record: SolverRunRecord): Problem {
  const r = isObject(record.result) ? record.result : {};
  const message = typeof r.error === 'string' ? r.error : (record.progress_note ?? '');
  return {
    type: problemTypes.internal,
    title: 'Solver run failed',
    status: 500,
    detail: oneLine(message) || 'The solver run failed. Try again; if it persists, tell an administrator.',
  };
}

/** A solver_run row as the contract's `SolverRun` (`GET`, `DELETE`, the answers of both `POST`s). */
export function toSolverRun(record: SolverRunRecord): SolverRun {
  const meta = metaOf(record.spec);
  const key = storedKey(record.spec);
  const cache = isObject(record.spec) && isObject(record.spec.cache) ? record.spec.cache : {};
  const hasResult = (record.status === 'done' || record.status === 'cancelled') && isObject(record.result) && 'problem' in record.result;
  return checked('solver run', SolverRun, {
    id: record.id,
    scenarioId: record.scenario_id,
    scenarioVersion: meta.scenarioVersion,
    inputHash: key?.inputHash ?? null,
    spec: SolverSpec.parse(record.spec),
    quick: meta.quick,
    save: meta.save,
    status: record.status,
    progress: Math.min(1, Math.max(0, record.progress)),
    progressNote: record.progress_note === null ? null : oneLine(record.progress_note) || null,
    cancelRequested: record.cancel_requested,
    cached: typeof cache.cachedFrom === 'string',
    result: hasResult ? toContractResult(record.result) : null,
    resultScenarioId: record.result_scenario_id,
    error: record.status === 'failed' ? errorOf(record) : null,
    createdBy: null,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  });
}
