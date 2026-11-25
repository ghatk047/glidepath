/**
 * `Model.input_cells` (engine.py L296-315): tenant values < scenario values < extra values, merged per
 * cell; overrides scenario < extra (S25). Production gets the same merge from `v_inputs_resolved`; this
 * pure mirror serves tests and `tools/parity`.
 */
import type { InputValue, ModelBundle, SeedScenario, SeedScenarios, VarId } from '@glidepath/spec';
import { EngineError } from '../errors';
import type { CellKey } from '../types';

/** Resolved inputs: what `evaluate(values, overrides)` takes. */
export interface ResolvedInputs {
  readonly values: Map<CellKey, number>;
  readonly overrides: Map<CellKey, number>;
}

/** Values and overrides layered on top of a scenario (`extra` in Python). */
export interface ExtraInputs {
  readonly values?: Readonly<Record<VarId, InputValue>>;
  readonly overrides?: Readonly<Record<CellKey, number>>;
}

/** What `resolveInputs` reads of a scenario. */
export type ScenarioInputs = Pick<SeedScenario, 'values' | 'overrides'>;

/** Variable id → number of dims, for `putValue`. */
export type VariableDims = ReadonlyMap<VarId, number>;

/** `dims` of every variable of the bundle. */
export function variableDims(bundle: Pick<ModelBundle, 'variables'>): VariableDims {
  return new Map(bundle.variables.map((v) => [v.id, v.dims.length]));
}

/**
 * `put` of `input_cells`: a dimensioned variable's `{memberKey: x}` writes cells `vid[memberKey]`, a scalar
 * variable's number writes cell `vid`. BAD_INPUT for an unknown variable, a scalar for a dimensioned
 * variable (Python `ValueError`) and a dict for a scalar variable (D7: Python keeps the last entry).
 */
export function putValue(
  cells: Map<CellKey, number>,
  dims: VariableDims,
  vid: VarId,
  value: InputValue,
): void {
  const n = dims.get(vid);
  if (n === undefined) throw new EngineError('BAD_INPUT', `unknown variable ${vid}`);
  if (typeof value === 'number') {
    if (n > 0) throw new EngineError('BAD_INPUT', `${vid} needs per-member values`);
    cells.set(vid, value);
    return;
  }
  if (n === 0) {
    throw new EngineError('BAD_INPUT', `${vid} is a scalar variable but has per-member values`);
  }
  for (const [memberKey, x] of Object.entries(value)) cells.set(`${vid}[${memberKey}]`, x);
}

/** The scenario with this id (Python `next(...)`: StopIteration → BAD_INPUT). */
export function findScenario(
  scenarios: Pick<SeedScenarios, 'scenarios'>,
  id: string,
): SeedScenario {
  const found = scenarios.scenarios.find((s) => s.id === id);
  if (found === undefined) throw new EngineError('BAD_INPUT', `unknown scenario ${id}`);
  return found;
}

/**
 * `input_cells(scenario, extra)`: tenant values, then the scenario's values, then `extra.values`, each
 * per cell (a dict replaces only the members it lists); overrides from the scenario, then `extra`.
 */
export function resolveInputs(
  bundle: Pick<ModelBundle, 'variables'>,
  tenantValues: Readonly<Record<VarId, InputValue>>,
  scenario?: ScenarioInputs,
  extra?: ExtraInputs,
): ResolvedInputs {
  const dims = variableDims(bundle);
  const values = new Map<CellKey, number>();
  const overrides = new Map<CellKey, number>();
  const layer = (
    vals: Readonly<Record<VarId, InputValue>> | undefined,
    pins: Readonly<Record<CellKey, number>> | undefined,
  ): void => {
    for (const [vid, v] of Object.entries(vals ?? {})) putValue(values, dims, vid, v);
    for (const [key, x] of Object.entries(pins ?? {})) overrides.set(key, x);
  };
  layer(tenantValues, undefined);
  if (scenario !== undefined) layer(scenario.values, scenario.overrides);
  if (extra !== undefined) layer(extra.values, extra.overrides);
  return { values, overrides };
}
