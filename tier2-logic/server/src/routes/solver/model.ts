import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { QuickSolverSpec } from '@glidepath/api-contract';
import { listScenarios, loadResolvedInputs } from '@glidepath/data-access';
import type { TenantTx } from '@glidepath/data-access';
import type { SolverModel } from '@glidepath/solvers';
import { ApiError } from '../../app/problem';
import { inputCells } from '../../session/loader';
import type { ScenarioState } from '../../session/loader';

/**
 * The model a short solver runs on (03 section 2): the session's compiled model and committed evaluation of the
 * scenario (the loader's `ModelCache`, the same objects a WebSocket session holds), plus the tenant data the
 * solvers are given and never read themselves (04 section 1, `SolverModel`): the stretch presets, the resolved
 * inputs of a blend's two scenarios, and the named stress shocks of `solvers.json`.
 */

/** `solvers.json` `decision_variable_sets.lever_intensity`: "stretch cap default = max(C, D) preset value". */
export const STRETCH_PRESET_KEYS: readonly string[] = ['C', 'D'];

export type StressPresets = NonNullable<SolverModel['presets']>;
type StressPreset = StressPresets[number];

/** The `examples` of the `stress_presets` problem of a parsed `solvers.json`; shape-checked, order kept. */
export function parseStressPresets(solversJson: unknown): StressPresets {
  const problems = (solversJson as { problems?: unknown } | null)?.problems;
  const problem = Array.isArray(problems)
    ? (problems as { id?: unknown; examples?: unknown }[]).find((p) => p?.id === 'stress_presets')
    : undefined;
  const examples = problem?.examples;
  if (examples === undefined) return [];
  if (!Array.isArray(examples)) throw new Error('solvers.json: stress_presets.examples is not a list');
  return examples.map((e: unknown, i): StressPreset => {
    const x = e as { name?: unknown; set?: unknown; shift?: unknown } | null;
    if (typeof x?.name !== 'string') throw new Error(`solvers.json: stress_presets.examples[${i}] has no name`);
    return {
      name: x.name,
      ...(x.set === undefined ? {} : { set: x.set as NonNullable<StressPreset['set']> }),
      ...(x.shift === undefined ? {} : { shift: x.shift as NonNullable<StressPreset['shift']> }),
    };
  });
}

/** `docs/spec` of the repository this file sits in (source checkouts and tests). */
const REPO_SPEC_DIR = fileURLToPath(new URL('../../../../../docs/spec', import.meta.url));

/** The stress presets of `solvers.json` in `dir`, else `SPEC_DIR`, else the repository's `docs/spec`; read once. */
export function stressPresetsFromDir(dir?: string): () => Promise<StressPresets> {
  let loaded: Promise<StressPresets> | undefined;
  return () => {
    loaded ??= readFile(join(dir ?? process.env.SPEC_DIR ?? REPO_SPEC_DIR, 'solvers.json'), 'utf8').then(
      (text) => parseStressPresets(JSON.parse(text)),
    );
    loaded.catch(() => {
      loaded = undefined;
    });
    return loaded;
  };
}

export interface ModelSources {
  readonly stressPresets: () => Promise<StressPresets>;
}

/** Resolved input cells of a scenario of the tenant, or null when it is not one of its scenarios. */
async function resolvedInputs(tx: TenantTx, scenarioId: string): Promise<ReadonlyMap<string, number> | null> {
  const resolved = await loadResolvedInputs(tx, scenarioId);
  return resolved === null ? null : inputCells(resolved).values;
}

/**
 * The `SolverModel` of `spec` on the scenario `state`. Only what the problem reads is loaded: stretch presets
 * for breakeven (the `lever_intensity` bounds), both scenarios of a blend, the shocks for stress runs.
 * Rows are read in the request's tenant transaction, so RLS applies and a blend can only name the tenant's own scenarios.
 */
export async function solverModelFor(
  tx: TenantTx,
  state: ScenarioState,
  spec: QuickSolverSpec,
  sources: ModelSources,
): Promise<SolverModel> {
  const base: SolverModel = {
    compiled: state.model.model,
    base: state.committed,
    bundle: state.model.bundle,
    members: state.model.members,
  };
  switch (spec.problem) {
    case 'breakeven': {
      const presets = (await listScenarios(tx)).filter((s) => s.kind === 'preset' && STRETCH_PRESET_KEYS.includes(s.key));
      const stretch: ReadonlyMap<string, number>[] = [];
      for (const p of presets) {
        const values = await resolvedInputs(tx, p.id);
        if (values !== null) stretch.push(values);
      }
      return { ...base, stretch };
    }
    case 'scenario_blend': {
      const scenarios = new Map<string, ReadonlyMap<string, number>>();
      for (const id of new Set([spec.params.from, spec.params.to])) {
        const values = await resolvedInputs(tx, id);
        if (values === null) throw ApiError.notFound(`No such scenario in this tenant: ${id}. Check the blend's from and to scenario ids.`);
        scenarios.set(id, values);
      }
      return { ...base, scenarios };
    }
    case 'stress_presets':
      return { ...base, presets: await sources.stressPresets() };
    default:
      return base;
  }
}
