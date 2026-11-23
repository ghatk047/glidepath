import { BundleResponse } from '@glidepath/api-contract';
import type { ModelDefs } from '@glidepath/data-access';
import type { ModelBundle } from '@glidepath/spec';

/** The bundle cannot be built: the spec bundle lacks something the pinned model version defines. */
export class BundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BundleError';
  }
}

/** `items` in the order `ids` lists their keys (the spec's); keys the list does not know follow, by key. */
function inSpecOrder<T>(items: readonly T[], keyOf: (t: T) => string, ids: readonly string[]): T[] {
  const rank = new Map(ids.map((id, i) => [id, i] as const));
  return [...items].sort((a, b) => {
    const ra = rank.get(keyOf(a));
    const rb = rank.get(keyOf(b));
    if (ra !== undefined && rb !== undefined) return ra - rb;
    if (ra !== undefined) return -1;
    if (rb !== undefined) return 1;
    return keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0;
  });
}

/**
 * The bundle of the pinned model version: what the database holds (`defs`, DATA-05) with the fields its
 * tables lack taken from the spec bundle of the same version: variable `kind`, `scenario_varies`,
 * `source`, `confidence`, `note` and the dimension `label`. Nothing but labels and metadata: node
 * expressions (`expr`, `cases`) stay in tier 2. Lists follow the spec's order (registry and graph order).
 * The result is validated against the contract; a gap in the spec bundle throws {@link BundleError}.
 */
export function buildBundle(defs: ModelDefs, spec: ModelBundle): BundleResponse {
  const specVar = new Map(spec.variables.map((v) => [v.id, v] as const));
  const specDim = new Map(spec.dimensions.map((d) => [d.id, d] as const));

  const variables = inSpecOrder(defs.variables, (v) => v.var_key, spec.variables.map((v) => v.id)).map((v) => {
    const s = specVar.get(v.var_key);
    if (!s) throw new BundleError(`variable ${v.var_key} is in model version ${defs.modelVersion.semver} but not in the spec bundle`);
    return {
      id: v.var_key,
      label: v.label,
      unit: v.unit,
      type: v.type,
      kind: s.kind,
      dims: [...v.dims],
      min: v.min,
      max: v.max,
      step: v.step,
      group: v.group,
      layer: v.layer,
      role: v.role,
      ui: v.ui,
      source: s.source ?? '',
      confidence: s.confidence,
      note: s.note ?? '',
      scenarioVaries: s.scenario_varies,
    };
  });

  const nodes = inSpecOrder(defs.nodes, (n) => n.node_key, spec.nodes.map((n) => n.id)).map((n) => ({
    id: n.node_key,
    label: n.label,
    unit: n.unit,
    dims: [...n.dims],
    layer: n.layer,
    output: n.output,
    overridable: n.overridable,
  }));

  const dimensions = inSpecOrder(defs.dimensions, (d) => d.dim_key, spec.dimensions.map((d) => d.id)).map((d) => {
    const s = specDim.get(d.dim_key);
    if (!s) throw new BundleError(`dimension ${d.dim_key} is in model version ${defs.modelVersion.semver} but not in the spec bundle`);
    return { id: d.dim_key, label: s.label, scope: d.scope, attributes: [...d.attributes] };
  });

  const parsed = BundleResponse.safeParse({
    modelVersion: { id: defs.modelVersion.id, semver: defs.modelVersion.semver },
    variables,
    nodes,
    dimensions,
  });
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new BundleError(`the bundle does not match the contract at ${first?.path.join('.') ?? '?'}: ${first?.message ?? 'invalid'}`);
  }
  return parsed.data;
}
