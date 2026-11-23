/**
 * `stress_presets` problem (SOL-08): named shocks of `solvers.json` (`problems[stress_presets].examples`),
 * each applied to the start point as input changes and evaluated, in one engine batch (one lane per
 * preset). Reports the outputs and their deltas from the start point. The shocks are data: the caller
 * passes them on `model.presets` (`parseStressPresets(solversJson)`); nothing here names one.
 *
 * Shock semantics (the spec's examples, generalised):
 * - `set[id] = number`: every cell of variable `id` becomes that value;
 * - `set[id] = "+x"` / `"-x"` (a signed string): every cell moves by that amount from its start value;
 *   any other numeric string is an absolute value;
 * - `shift[id] = n`: every cell moves by n from its start value (after `set`), kept within the registry range.
 */
import { cellKey, type CellKey } from '@glidepath/engine';
import { SolverError } from '../errors';
import type { SolverModel } from '../model';
import type { ProblemSolver } from '../run';
import type { Change } from '../types';

/** One named shock (`solvers.json` example). */
export interface StressPreset {
  readonly name: string;
  readonly set?: Readonly<Record<string, number | string>>;
  readonly shift?: Readonly<Record<string, number>>;
}

/** Outputs a stress run reports: net, gap to the bar, and the IT effect on CY27 EPS (04 §3 demo figures). */
export const STRESS_OUTPUTS: readonly CellKey[] = ['res.net', 'res.gap', 'br.eps27'];

/** The `examples` of the `stress_presets` problem in a parsed `solvers.json`; shape-checked, order kept. */
export function parseStressPresets(solversJson: unknown): StressPreset[] {
  const problems = (solversJson as { problems?: unknown } | null)?.problems;
  const problem = Array.isArray(problems)
    ? (problems as { id?: unknown; examples?: unknown }[]).find((p) => p?.id === 'stress_presets')
    : undefined;
  const examples = problem?.examples;
  if (examples === undefined) return [];
  if (!Array.isArray(examples)) throw new SolverError('BAD_MODEL', 'stress_presets.examples is not a list');
  return examples.map((e: unknown, i): StressPreset => {
    const x = e as { name?: unknown; set?: unknown; shift?: unknown } | null;
    if (typeof x?.name !== 'string') throw new SolverError('BAD_MODEL', `stress_presets.examples[${i}] has no name`);
    return {
      name: x.name,
      ...(x.set === undefined ? {} : { set: x.set as StressPreset['set'] }),
      ...(x.shift === undefined ? {} : { shift: x.shift as StressPreset['shift'] }),
    };
  });
}

const SIGNED = /^[+-]\d+(\.\d+)?$/;

/** Cells of variable `id` the model reads, with members in tenant order. */
function cellsOf(model: SolverModel, id: string): CellKey[] {
  const v = model.bundle.variables.find((x) => x.id === id);
  if (v === undefined) throw new SolverError('BAD_PARAMS', `stress preset: unknown variable ${id}`);
  let combos: string[][] = [[]];
  for (const dim of v.dims) {
    const members = model.members[dim];
    if (members === undefined) throw new SolverError('BAD_MODEL', `variable ${id}: no members for dimension ${dim}`);
    combos = combos.flatMap((prefix) => members.map((m) => [...prefix, m.id]));
  }
  return combos.map((m) => cellKey(id, m)).filter((c) => model.base.has(c));
}

/** The input changes of one preset from the start point. A cell set and shifted ends at the shifted value. */
export function presetChanges(model: SolverModel, preset: StressPreset): Change[] {
  const value = new Map<CellKey, number>();
  for (const [id, raw] of Object.entries(preset.set ?? {})) {
    for (const cell of cellsOf(model, id)) {
      if (typeof raw === 'number') value.set(cell, raw);
      else if (SIGNED.test(raw)) value.set(cell, model.base.get(cell) + Number(raw));
      else if (raw.trim() !== '' && Number.isFinite(Number(raw))) value.set(cell, Number(raw));
      else throw new SolverError('BAD_PARAMS', `stress preset ${preset.name}: bad value ${JSON.stringify(raw)} for ${id}`);
    }
  }
  for (const [id, by] of Object.entries(preset.shift ?? {})) {
    const v = model.bundle.variables.find((x) => x.id === id);
    for (const cell of cellsOf(model, id)) {
      let x = (value.get(cell) ?? model.base.get(cell)) + by;
      if (v?.min != null) x = Math.max(v.min, x);
      if (v?.max != null) x = Math.min(v.max, x);
      value.set(cell, x);
    }
  }
  return [...value].map(([cell, v]): Change => ({ target: 'variable', cell, value: v }));
}

export const stressPresetsProblem: ProblemSolver<'stress_presets'> = async (run, params) => {
  const { model } = run;
  const known = model.presets ?? [];
  const wanted =
    params.presets.length === 0
      ? known
      : params.presets.map((n) => {
          const p = known.find((k) => k.name === n);
          if (p === undefined) throw new SolverError('BAD_PARAMS', `unknown stress preset ${n}`);
          return p;
        });
  for (const o of STRESS_OUTPUTS) {
    if (!model.base.has(o)) throw new SolverError('BAD_MODEL', `stress presets need output ${o}`);
  }

  const perPreset = wanted.map((p) => presetChanges(model, p));
  const n = wanted.length;
  const lanes = new Map<CellKey, Float64Array>();
  perPreset.forEach((changes, lane) => {
    for (const c of changes) {
      let v = lanes.get(c.cell);
      if (v === undefined) {
        v = new Float64Array(n).fill(model.base.get(c.cell));
        lanes.set(c.cell, v);
      }
      v[lane] = c.value;
    }
  });

  const base: Record<CellKey, number> = Object.fromEntries(STRESS_OUTPUTS.map((o) => [o, model.base.get(o)]));
  let batch: Awaited<ReturnType<typeof run.evaluateBatch>> | undefined;
  if (n > 0) batch = await run.evaluateBatch({ size: n, values: lanes });
  else await run.batch();

  const presets = wanted.map((p, lane) => {
    if (batch?.failed[lane]) {
      throw new SolverError('BAD_PARAMS', `stress preset ${p.name} does not evaluate: ${batch.errors.get(lane)?.message ?? ''}`);
    }
    const outputs: Record<CellKey, number> = {};
    const delta: Record<CellKey, number> = {};
    for (const o of STRESS_OUTPUTS) {
      outputs[o] = batch?.values.get(o)?.[lane] ?? base[o]!;
      delta[o] = outputs[o] - base[o]!;
    }
    return { name: p.name, outputs, delta };
  });
  run.progress(1);

  return {
    // One preset is a plan the user can apply as a scenario; several are alternatives, like breakeven rows.
    status: 'feasible',
    changes: n === 1 ? perPreset[0]! : [],
    ranked: [],
    metrics: base,
    detail: { presets },
  };
};
