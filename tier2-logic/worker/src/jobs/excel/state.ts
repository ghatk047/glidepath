import {
  changesetTx,
  getTenant,
  listScenarios,
  loadMembers,
  loadModelDefs,
  loadResolvedInputs,
} from '@glidepath/data-access';
import type { ScenarioRecord, TenantRow, TenantTx } from '@glidepath/data-access';
import { engineOverrides, engineValues, modelCacheKey, nodeMemberKeys, resolveInputs } from '@glidepath/domain';
import type { InputState, InputValueRow } from '@glidepath/domain';
import { compile } from '@glidepath/engine';
import type { CompiledModel, Evaluation } from '@glidepath/engine';
import { buildTemplate } from '@glidepath/excel';
import type { ExportScenario, ExportValues, NoteRow, OutputValue, SheetDef } from '@glidepath/excel';
import type { ModelBundle, TenantMembers } from '@glidepath/spec';
import type { ExcelTemplate } from '@glidepath/spec/generated';
import type { ExcelJobDeps } from './deps';

/** A job fails with a message the user can act on (the API maps it to a problem body). */
export class ExcelJobError extends Error {
  override readonly name = 'ExcelJobError';
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** The tenant as the jobs need it: model, members, scenarios and the stored input rows, read in one transaction. */
export interface TenantState {
  readonly tenant: TenantRow;
  readonly modelVersionId: string;
  readonly bundle: ModelBundle;
  readonly template: ExcelTemplate;
  readonly members: TenantMembers;
  readonly scenarios: readonly ScenarioRecord[];
  /** Tenant defaults (`variable_value`), their notes, and the number of tenant-default changesets applied. */
  readonly defaults: readonly InputValueRow[];
  readonly notes: readonly NoteRow[];
  readonly defaultsVersion: number;
  /** Stored rows per scenario uuid: `loadInputs` of the changeset store (defaults, chain, pins). */
  readonly inputs: ReadonlyMap<string, InputState>;
  readonly model: CompiledModel;
}

/**
 * Reads what an export, an import preview or an apply needs of the tenant. `scenarioIds` limits the
 * per-scenario input rows that are loaded (`'live'`: every scenario not archived).
 */
export async function loadTenantState(
  tx: TenantTx,
  deps: ExcelJobDeps,
  scenarioIds: readonly string[] | 'live',
): Promise<TenantState> {
  const tenant = await getTenant(tx);
  if (tenant === null) throw new ExcelJobError('tenant_not_found', 'The tenant is not visible to this job.');
  const defs = await loadModelDefs(tx);
  if (defs === null) throw new ExcelJobError('model_not_found', 'The tenant pins no readable model version.');
  const [bundle, template] = await Promise.all([deps.bundle(defs.modelVersion.semver), deps.template()]);
  if (bundle === null) {
    throw new ExcelJobError('model_not_found', `No spec bundle for model version ${defs.modelVersion.semver}.`);
  }
  const snapshot = await loadMembers(tx);
  const members = snapshot.members;
  const scenarios = await listScenarios(tx);
  const store = changesetTx(tx);
  const base = await store.loadInputs(null);
  const noted = await loadResolvedInputs(tx, null);
  const notes: NoteRow[] = (noted?.values ?? []).flatMap((r) =>
    r.resolved_from === 'tenant' && r.note !== null && r.note !== ''
      ? [{ var_key: r.var_key, member_key: r.member_key, note: r.note }]
      : [],
  );
  const inputs = new Map<string, InputState>();
  const wanted = scenarioIds === 'live' ? scenarios.filter((s) => !s.archived).map((s) => s.id) : scenarioIds;
  for (const id of new Set(wanted)) inputs.set(id, await store.loadInputs(id));
  const defaultsVersion = (await store.changesSince(null, 0)).length;
  const model = deps.cache.getOrCompile(modelCacheKey(tenant.id, tenant.model_version_id, members), () =>
    compile(bundle, members),
  );
  return {
    tenant,
    modelVersionId: tenant.model_version_id,
    bundle,
    template,
    members,
    scenarios,
    defaults: base.defaults,
    notes,
    defaultsVersion,
    inputs,
    model,
  };
}

/** Sheet definitions of the tenant now (`buildTemplate`), optionally only the named input sheets. */
export function sheetDefs(state: TenantState, only?: readonly string[]): SheetDef[] {
  const all = buildTemplate(state.template, state.bundle, state.members);
  if (only === undefined) return all;
  const keep = new Set(only);
  return all.filter((d) => d.kind === 'readme' || d.kind === 'lists' || d.kind === 'meta' || keep.has(d.name));
}

/** Names of the sheets that carry input cells (what the snapshot covers). */
export const inputSheetNames = (defs: readonly SheetDef[]): string[] =>
  defs.filter((d) => d.kind !== 'readme' && d.kind !== 'lists' && d.kind !== 'meta').map((d) => d.name);

/** The scenario's own `scenario_value` rows: the last level of its chain. */
const ownRows = (state: InputState): InputValueRow[] => [...(state.chain[state.chain.length - 1]?.values ?? [])];

/** Engine maps of a scenario's resolved inputs (defaults, then each ancestor, then its own rows; pins are its own). */
export function resolvedMaps(
  state: InputState,
  bundle: ModelBundle,
): { values: Map<string, number>; overrides: Map<string, number> } {
  const resolved = resolveInputs(state.defaults, state.chain, state.overrides, {
    variables: bundle.variables.map((v) => v.id),
  });
  return { values: engineValues(resolved.values), overrides: engineOverrides(resolved.overrides) };
}

/** Every output cell of the evaluation, for the Outputs sheet. */
export function outputValues(bundle: ModelBundle, members: TenantMembers, evaluation: Evaluation): OutputValue[] {
  const out: OutputValue[] = [];
  for (const node of bundle.nodes) {
    if (!node.output) continue;
    for (const k of nodeMemberKeys(node, members)) {
      const cell = k === '' ? node.id : `${node.id}[${k}]`;
      if (evaluation.has(cell)) out.push({ node_key: node.id, member_key: k, value: evaluation.get(cell) });
    }
  }
  return out;
}

/** What one exported column is: a scenario row, the id its columns carry and its header label. */
export interface ColumnScenario {
  readonly record: ScenarioRecord;
  /** `ExportScenario.id`: the scenario key, or its label in a foreign workbook. */
  readonly id: string;
}

/** The current values of the given scenarios in the form `buildWorkbook` takes (export now, and D of an import). */
export function exportValues(
  state: TenantState,
  columns: readonly ColumnScenario[],
  withOutputs: boolean,
): ExportValues {
  const scenarios: ExportScenario[] = columns.map(({ record, id }) => {
    const inputs = state.inputs.get(record.id);
    if (inputs === undefined) throw new ExcelJobError('scenario_not_found', `Scenario ${record.id} was not loaded.`);
    const outputs = withOutputs
      ? outputValues(state.bundle, state.members, evaluate(state, inputs))
      : undefined;
    return {
      id,
      label: record.label,
      values: ownRows(inputs),
      overrides: inputs.overrides,
      ...(outputs === undefined ? {} : { outputs }),
    };
  });
  return { defaults: state.defaults, scenarios, notes: state.notes };
}

/** Full evaluation of a scenario's stored inputs. */
export function evaluate(state: TenantState, inputs: InputState): Evaluation {
  const { values, overrides } = resolvedMaps(inputs, state.bundle);
  return state.model.evaluate(values, overrides);
}
