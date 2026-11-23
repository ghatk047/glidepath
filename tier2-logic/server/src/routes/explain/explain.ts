import { ExplainResponse } from '@glidepath/api-contract';
import type { ResolvedInputsRecord } from '@glidepath/data-access';
import type { CompiledModel, Evaluation, ModelBundle } from '@glidepath/engine';
import { memberOfKey, symbolOfKey, toContractKey } from './keys';

/** Drivers shown in the trace drawer ("top drivers"). */
export const TOP_DRIVERS = 5;
/** Upstream cells listed, nearest first; a total over 400 lines would drown the drawer. */
export const UPSTREAM_LIMIT = 40;

/** Engine inputs of a scenario: resolved variable values and the scenario's node pins, as engine cell keys. */
export function engineInputs(resolved: ResolvedInputsRecord): {
  values: Map<string, number>;
  overrides: Map<string, number>;
} {
  const cell = (id: string, member: string): string => (member === '' ? id : `${id}[${member}]`);
  const values = new Map<string, number>();
  for (const v of resolved.values) values.set(cell(v.var_key, v.member_key), v.value);
  const overrides = new Map<string, number>();
  for (const o of resolved.overrides) overrides.set(cell(o.node_key, o.member_key), o.value);
  return { values, overrides };
}

const finite = (n: number | undefined): number | null => (n !== undefined && Number.isFinite(n) ? n : null);

interface Labels {
  label: string;
  unit: string;
  kind: 'input' | 'node';
}

/** Label, unit and kind of every spec symbol (nodes win over a variable of the same id, as in the engine). */
function labelsOf(bundle: ModelBundle): Map<string, Labels> {
  const m = new Map<string, Labels>();
  for (const v of bundle.variables) m.set(v.id, { label: v.label || v.id, unit: v.unit, kind: 'input' });
  for (const n of bundle.nodes) m.set(n.id, { label: n.label || n.id, unit: n.unit, kind: 'node' });
  return m;
}

/**
 * Upstream chain of `cell` with its distance (1 = read directly), nearest first, at most
 * {@link UPSTREAM_LIMIT} cells. The engine answers "everything within `depth` levels", so a cell's
 * depth is the first level at which it shows up.
 */
function upstreamChain(model: CompiledModel, cell: string): { key: string; depth: number }[] {
  const out: { key: string; depth: number }[] = [];
  const seen = new Set<string>();
  for (let depth = 1; out.length < UPSTREAM_LIMIT; depth++) {
    let grew = false;
    for (const key of model.upstream(cell, depth)) {
      if (seen.has(key)) continue;
      seen.add(key);
      grew = true;
      if (out.length < UPSTREAM_LIMIT) out.push({ key, depth });
    }
    if (!grew) break;
  }
  return out;
}

/**
 * The trace drawer's answer for one cell (04 §3 `nodes/:cell/explain`): value, node id, expression and
 * formula in words (spec labels), upstream chain, top drivers by local sensitivity, and the scenario's
 * pin (the "pinned" flag of the IA is `override !== null`). Everything comes from the engine's
 * `explain` and `upstream`; tier 1 only displays it.
 */
export function buildExplain(args: {
  model: CompiledModel;
  bundle: ModelBundle;
  at: Evaluation;
  resolved: ResolvedInputsRecord;
  engineKey: string;
}): ExplainResponse {
  const { model, bundle, at, resolved, engineKey } = args;
  const labels = labelsOf(bundle);
  const ex = model.explain(engineKey, at);
  const nodeId = symbolOfKey(engineKey);
  const member = memberOfKey(engineKey);

  const pin = resolved.overrides.find((o) => o.node_key === nodeId && o.member_key === member);
  const override = ex.pinned && pin ? { value: pin.value, reason: pin.reason } : null;

  const upstream = upstreamChain(model, engineKey).map(({ key, depth }) => {
    const l = labels.get(symbolOfKey(key)) ?? { label: symbolOfKey(key), unit: '', kind: 'node' as const };
    return {
      cell: toContractKey(key),
      kind: l.kind,
      label: l.label,
      unit: l.unit,
      value: at.has(key) ? finite(at.get(key)) : null,
      depth,
    };
  });

  const drivers = ex.drivers.slice(0, TOP_DRIVERS).map((d) => ({
    cell: toContractKey(d.cell),
    label: d.label,
    unit: d.unit,
    value: finite(d.value),
    impact: d.sensitivity,
  }));

  return ExplainResponse.parse({
    cell: toContractKey(engineKey),
    node: nodeId,
    member,
    label: ex.label,
    unit: ex.unit,
    value: finite(ex.value),
    expression: ex.expression,
    words: ex.words,
    override,
    upstream,
    drivers,
  });
}
