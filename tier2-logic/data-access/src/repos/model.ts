import { eq, sql } from 'drizzle-orm';
import { dimension_def, lever_template, model_version, node_def, tenant, variable_def } from '../schema';
import { tenantScope } from '../scope';
import type { TenantTx } from '../tenant';
import { iso, numOrNull } from './rows';

/** model_version (global). */
export interface ModelVersionRow {
  readonly id: string;
  readonly semver: string;
  readonly status: 'draft' | 'published' | 'retired';
  readonly notes: string;
  readonly created_at: string;
}

/** dimension_def (global), without model_version_id. */
export interface DimensionDefRow {
  readonly dim_key: string;
  readonly scope: 'global' | 'tenant' | 'system' | 'global+tenant';
  readonly attributes: readonly string[];
}

/** variable_def (global), without model_version_id; numeric columns as numbers. */
export interface VariableDefRow {
  readonly var_key: string;
  readonly dims: readonly string[];
  readonly label: string;
  readonly unit: string;
  readonly type: 'number' | 'int' | 'bool' | 'enum';
  readonly min: number | null;
  readonly max: number | null;
  readonly step: number | null;
  readonly group: string;
  readonly layer: string;
  readonly role: 'driver' | 'calibration' | 'simulation';
  readonly ui: unknown;
  readonly dist: unknown;
  readonly validation: unknown;
  readonly legacy: unknown;
}

/** node_def (global), without model_version_id. */
export interface NodeDefRow {
  readonly node_key: string;
  readonly dims: readonly string[];
  readonly expr: string | null;
  readonly cases: unknown;
  readonly members: unknown;
  readonly unit: string;
  readonly label: string;
  readonly layer: string;
  readonly output: boolean;
  readonly overridable: boolean;
}

/** lever_template (global), without model_version_id. */
export interface LeverTemplateRow {
  readonly code: string;
  readonly label: string;
  readonly category: string;
  readonly default_alloc_key: string;
  readonly node_keys: readonly string[];
  readonly var_keys: readonly string[];
  readonly library: unknown;
}

/** The definitions of one model_version: what the bundle is built from. Each list ordered by key. */
export interface ModelDefs {
  readonly modelVersion: ModelVersionRow;
  readonly dimensions: readonly DimensionDefRow[];
  readonly variables: readonly VariableDefRow[];
  readonly nodes: readonly NodeDefRow[];
  readonly leverTemplates: readonly LeverTemplateRow[];
}

/** Code-point order, as everywhere in data-access (independent of the database collation). */
const byKey = (col: unknown) => sql`${col} collate "C"`;

/**
 * Model bundle definitions (global tables) of the model_version the current tenant pins: model_version,
 * dimension_def, variable_def, node_def, lever_template. Null when the tenant row is not visible.
 * Spec ids verbatim; lists in code-point order of their keys (the tables keep no spec order).
 */
export async function loadModelDefs(tx: TenantTx): Promise<ModelDefs | null> {
  const { tenantId } = tenantScope(tx, 'loadModelDefs');
  const [pin] = await tx
    .select({ model_version_id: tenant.model_version_id })
    .from(tenant)
    .where(eq(tenant.id, tenantId));
  if (!pin) return null;
  const mv = pin.model_version_id;

  const [version] = await tx.select().from(model_version).where(eq(model_version.id, mv));
  if (!version) return null;
  const dims = await tx.select().from(dimension_def).where(eq(dimension_def.model_version_id, mv)).orderBy(byKey(dimension_def.dim_key));
  const vars = await tx.select().from(variable_def).where(eq(variable_def.model_version_id, mv)).orderBy(byKey(variable_def.var_key));
  const nodes = await tx.select().from(node_def).where(eq(node_def.model_version_id, mv)).orderBy(byKey(node_def.node_key));
  const levers = await tx.select().from(lever_template).where(eq(lever_template.model_version_id, mv)).orderBy(byKey(lever_template.code));

  return {
    modelVersion: { ...version, created_at: iso(version.created_at) },
    dimensions: dims.map((d) => ({ dim_key: d.dim_key, scope: d.scope, attributes: d.attributes })),
    variables: vars.map((v) => ({
      var_key: v.var_key,
      dims: v.dims,
      label: v.label,
      unit: v.unit,
      type: v.type,
      min: numOrNull(v.min),
      max: numOrNull(v.max),
      step: numOrNull(v.step),
      group: v.group,
      layer: v.layer,
      role: v.role,
      ui: v.ui,
      dist: v.dist,
      validation: v.validation,
      legacy: v.legacy,
    })),
    nodes: nodes.map((n) => ({
      node_key: n.node_key,
      dims: n.dims,
      expr: n.expr,
      cases: n.cases,
      members: n.members,
      unit: n.unit,
      label: n.label,
      layer: n.layer,
      output: n.output,
      overridable: n.overridable,
    })),
    leverTemplates: levers.map((l) => ({
      code: l.code,
      label: l.label,
      category: l.category,
      default_alloc_key: l.default_alloc_key,
      node_keys: l.node_keys,
      var_keys: l.var_keys,
      library: l.library,
    })),
  };
}
