import { SolverResult } from '@glidepath/api-contract';
import type { CellKey, ProblemId } from '@glidepath/api-contract';
import { checked } from '../read/mappers';
import { splitWireCell, toWireCell } from '../../session/cells';

/**
 * A solver's result as the contract's `SolverResult` (03 section 3). The solvers speak engine cells
 * (`res.net`, `lev.start[L03]`) and variable changes `{ target, cell, value }`; the wire has `res.net[]` and
 * `{ target, key, member, value }`. The conversion is idempotent, so a result a worker stored already in wire
 * form passes through unchanged, and display series (`detail`) are mapped cell by cell, never recomputed.
 * Values the wire cannot carry (NaN, infinity) are dropped from `metrics`.
 */

type Raw = Readonly<Record<string, unknown>>;

const isObject = (v: unknown): v is Raw => v !== null && typeof v === 'object' && !Array.isArray(v);
const wire = (cell: unknown): CellKey => toWireCell(String(cell)) as CellKey;
const list = (v: unknown): readonly Raw[] => (Array.isArray(v) ? (v as unknown[]).filter(isObject) : []);

function change(c: Raw): Raw {
  if (typeof c.key === 'string') return c; // already a contract change
  const parts = splitWireCell(wire(c.cell)) ?? { id: String(c.cell), member: '' };
  return {
    target: c.target ?? 'variable',
    key: parts.id,
    member: parts.member,
    value: c.value,
    ...(c.note === undefined ? {} : { note: c.note }),
  };
}

const withWireCell = (r: Raw, ...fields: string[]): Raw => {
  const out: Record<string, unknown> = { ...r };
  for (const f of fields) if (typeof r[f] === 'string') out[f] = wire(r[f]);
  return out;
};

const wireKeys = (rec: unknown): Record<string, unknown> =>
  isObject(rec) ? Object.fromEntries(Object.entries(rec).map(([k, v]) => [wire(k), v])) : {};

function detail(problem: string, d: Raw): Raw {
  switch (problem) {
    case 'breakeven':
      return { ...d, rows: list(d.rows).map((r) => withWireCell(r, 'cell')) };
    case 'sensitivity':
      return { ...withWireCell(d, 'output'), rows: list(d.rows).map((r) => withWireCell(r, 'cell')) };
    case 'stress_presets':
      return { ...d, presets: list(d.presets).map((p) => ({ ...p, outputs: wireKeys(p.outputs), delta: wireKeys(p.delta) })) };
    case 'monte_carlo':
      return {
        ...d,
        percentiles: list(d.percentiles).map((r) => withWireCell(r, 'cell')),
        probabilities: list(d.probabilities).map((r) => withWireCell(r, 'cell', 'against')),
        histograms: list(d.histograms).map((r) => withWireCell(r, 'cell')),
      };
    case 'pareto':
      return { ...d, points: list(d.points).map((p) => ({ scenarioId: null, ...p, changes: undefined })) };
    default:
      return d;
  }
}

/** The contract result of a stored or fresh solver result; throws `ContractViolation` (a 500) when it does not fit. */
export function toContractResult(raw: unknown): SolverResult {
  if (!isObject(raw)) throw new TypeError('a solver result is an object');
  const problem = String(raw.problem) as ProblemId;
  const metrics = isObject(raw.metrics)
    ? Object.fromEntries(Object.entries(raw.metrics).filter(([, v]) => typeof v === 'number' && Number.isFinite(v)))
    : {};
  return checked('solver result', SolverResult, {
    problem,
    status: raw.status,
    changes: list(raw.changes).map(change),
    ranked: list(raw.ranked).map((r) => withWireCell(r, 'cell')),
    ...(Array.isArray(raw.binding) ? { binding: raw.binding } : {}),
    metrics,
    diagnostics: raw.diagnostics,
    ...(isObject(raw.detail) ? { detail: { ...detail(problem, raw.detail), problem } } : {}),
  });
}
