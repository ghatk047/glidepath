import { ident, lit } from './ddl';
import type { Model } from './model';
import { APP_ROLE } from './rls';
import type { SpecMember, SpecSchema, ViewInputs } from './spec';

/**
 * The two read views the engine loads (DATA-03; docs/spec/01_data_model.md section 4,
 * docs/architecture/04_data_and_api.md "Generation, not hand-writing"), as SQL.
 *
 * Both are `security_invoker`: the underlying tables are read with the caller's
 * privileges, so the row-level security of 0002_rls.sql (app.tenant_id) applies to
 * whoever queries the view. A default (owner-privileged) view would bypass it.
 */

export const INPUTS_VIEW = 'v_inputs_resolved';
export const MEMBERS_VIEW = 'v_dimension_members';

/** `kind` of a v_inputs_resolved row. */
export const KIND_INPUT = 'input';
export const KIND_OVERRIDE = 'override';
/** `resolved_from` of a v_inputs_resolved row (contract/api-contract ResolvedFrom). */
export const FROM_TENANT = 'tenant';
export const FROM_SCENARIO = 'scenario';
export const FROM_PARENT = 'parent';
/** `origin` of a v_dimension_members row. */
export const ORIGIN_GLOBAL = 'global';
export const ORIGIN_SYSTEM = 'system';
export const ORIGIN_TENANT = 'tenant';
export const ORIGIN_LINE_ITEM = 'line_item';

/** Dimension id of the line items (their own table, 04 section 1). */
export const LINE_DIM = 'line';

/** Global dimensions held in a table of their own: dim id -> table. Their members are not tenant rows. */
export const GLOBAL_DIM_TABLES: Record<string, string> = {
  pool: 'canonical_pool',
  addr_tag: 'addr_tag',
};

/**
 * Attribute names of a `line` member (formula_graph.json dimension `line`, used by expressions such
 * as `line.pool`) -> the SQL that yields them. `li` is line_item, `src` its source, `lv` the lever
 * ids of the line. Flags are 0/1 numbers like in the seed (expressions compare `in_scope == 1`).
 */
export const LINE_ATTRIBUTES: Record<string, string> = {
  pool: 'li.pool_id',
  domain: 'li.domain_key',
  addr: 'li.addr_tag',
  drv: 'li.scale_driver::text',
  l2: 'li.l2',
  name: 'li.name',
  vendor: 'li.vendor_key',
  nature: 'li.nature',
  accounting: 'li.accounting',
  lever_ids: 'lv.lever_ids',
  in_scope: 'li.in_scope::int',
  memo: 'li.memo::int',
  confidence: 'li.confidence::text',
  source: 'src.code',
  legacy_id: 'li.legacy_id',
};

/** Columns the views read, checked against the model so a schema.json change fails generation, not the migration. */
const READS: Record<string, string[]> = {
  tenant: ['id', 'model_version_id'],
  scenario: ['id', 'tenant_id', 'parent_id'],
  variable_def: ['model_version_id', 'var_key'],
  variable_value: ['tenant_id', 'var_key', 'member_key', 'value', 'confidence', 'note'],
  scenario_value: ['tenant_id', 'scenario_id', 'var_key', 'member_key', 'value'],
  node_override: ['tenant_id', 'scenario_id', 'node_key', 'member_key', 'value', 'reason'],
  canonical_pool: ['id', 'label', 'third_party', 'sort'],
  addr_tag: ['id', 'label'],
  dimension_member: ['tenant_id', 'dim_key', 'member_key', 'label', 'attrs', 'sort', 'active'],
  line_item: [
    'tenant_id',
    'member_key',
    'legacy_id',
    'pool_id',
    'l2',
    'name',
    'vendor_key',
    'nature',
    'accounting',
    'addr_tag',
    'domain_key',
    'scale_driver',
    'in_scope',
    'memo',
    'confidence',
    'source_id',
    'active',
  ],
  line_item_lever: ['tenant_id', 'line_key', 'lever_code'],
  source: ['id', 'code'],
};

function checkReads(model: Model): void {
  for (const [table, cols] of Object.entries(READS)) {
    const t = model.tables.find((x) => x.name === table);
    if (!t) throw new Error(`views: table ${table} is not in schema.json`);
    for (const c of cols)
      if (!t.columns.some((x) => x.name === c)) throw new Error(`views: ${table}.${c} is not in schema.json`);
  }
}

/** Dimension ids served from the model, not from tenant rows: the global tables' and the system dimensions. */
export function modelDimensions(inputs: ViewInputs): { global: string[]; system: string[] } {
  const global: string[] = [];
  const system: string[] = [];
  for (const d of inputs.dimensions) {
    if (d.scope === 'system') system.push(d.id);
    else if (d.scope === 'global') global.push(d.id);
  }
  for (const id of global)
    if (!GLOBAL_DIM_TABLES[id]) throw new Error(`views: global dimension ${id} has no table; add it to GLOBAL_DIM_TABLES`);
  for (const id of Object.keys(GLOBAL_DIM_TABLES))
    if (!global.includes(id)) throw new Error(`views: ${id} is not a global dimension in formula_graph.json`);
  return { global, system };
}

function checkLineAttributes(inputs: ViewInputs): void {
  const line = inputs.dimensions.find((d) => d.id === LINE_DIM);
  if (!line) throw new Error(`views: dimension ${LINE_DIM} is not in formula_graph.json`);
  const want = [...line.attributes].sort();
  const have = Object.keys(LINE_ATTRIBUTES).sort();
  if (JSON.stringify(want) !== JSON.stringify(have))
    throw new Error(
      `views: line attributes differ from formula_graph.json (spec: ${want.join(',')}; views: ${have.join(',')})`,
    );
}

function systemMembersSql(dim: string, members: SpecMember[]): string {
  if (!members?.length) throw new Error(`views: system dimension ${dim} has no members in the spec bundle`);
  const rows = members.map((m, i) => {
    const { id, label, ...attrs } = m;
    for (const v of Object.values(attrs))
      if (typeof v !== 'number' && typeof v !== 'string' && typeof v !== 'boolean')
        throw new Error(`views: ${dim}.${id}: attribute values must be scalars`);
    return `    (${lit(dim)}, ${lit(id)}, ${lit(label)}, ${lit(JSON.stringify(attrs))}::jsonb, ${i + 1})`;
  });
  return rows.join(',\n');
}

function renderInputsView(): string {
  return `CREATE VIEW ${INPUTS_VIEW} WITH (security_invoker = true) AS
WITH RECURSIVE chain (tenant_id, scenario_id, ancestor_id, parent_id, depth, path) AS (
  -- every scenario with its ancestors: depth 0 is the scenario itself, then its parent, and so on to the root
  SELECT s.tenant_id, s.id, s.id, s.parent_id, 0, ARRAY[s.id]
  FROM scenario s
  UNION ALL
  SELECT c.tenant_id, c.scenario_id, p.id, p.parent_id, c.depth + 1, c.path || p.id
  FROM chain c
  JOIN scenario p ON p.id = c.parent_id AND p.tenant_id = c.tenant_id
  WHERE p.id <> ALL (c.path) -- a parent cycle ends the chain instead of looping
),
targets AS (
  SELECT s.tenant_id, s.id AS scenario_id FROM scenario s
  UNION ALL
  SELECT t.id, NULL::uuid FROM tenant t -- scenario_id NULL: the tenant defaults alone
),
candidates AS (
  -- tenant default (depth NULL: the lowest level)
  SELECT g.tenant_id, g.scenario_id, v.var_key, v.member_key, v.value,
         NULL::integer AS depth, NULL::uuid AS from_scenario_id, v.confidence, v.note
  FROM targets g
  JOIN variable_value v ON v.tenant_id = g.tenant_id
  UNION ALL
  -- the scenario's own values (depth 0) and its ancestors' (depth 1 = parent, up to the root)
  SELECT c.tenant_id, c.scenario_id, sv.var_key, sv.member_key, sv.value,
         c.depth, c.ancestor_id, NULL::bpchar, NULL::text
  FROM chain c
  JOIN scenario_value sv ON sv.tenant_id = c.tenant_id AND sv.scenario_id = c.ancestor_id
),
resolved AS (
  -- last level wins per (scenario, var_key, member_key): nearest ancestor first, tenant default last.
  -- Only variables of the model version the tenant pins (stale rows of an older model are dropped).
  SELECT DISTINCT ON (c.tenant_id, c.scenario_id, c.var_key, c.member_key)
         c.tenant_id, c.scenario_id, c.var_key, c.member_key, c.value, c.depth, c.from_scenario_id, c.confidence, c.note
  FROM candidates c
  JOIN tenant t ON t.id = c.tenant_id
  JOIN variable_def d ON d.model_version_id = t.model_version_id AND d.var_key = c.var_key
  ORDER BY c.tenant_id, c.scenario_id, c.var_key, c.member_key, c.depth NULLS LAST
)
SELECT r.tenant_id,
       r.scenario_id,
       '${KIND_INPUT}'::text AS kind,
       r.var_key AS key,
       r.member_key,
       r.value,
       CASE WHEN r.depth IS NULL THEN '${FROM_TENANT}' WHEN r.depth = 0 THEN '${FROM_SCENARIO}' ELSE '${FROM_PARENT}' END::text AS resolved_from,
       r.from_scenario_id,
       r.confidence,
       r.note,
       NULL::text AS reason
FROM resolved r
UNION ALL
-- the scenario's own node overrides: not inherited from ancestors
SELECT o.tenant_id,
       o.scenario_id,
       '${KIND_OVERRIDE}'::text,
       o.node_key,
       o.member_key,
       o.value,
       '${FROM_SCENARIO}'::text,
       o.scenario_id,
       NULL::bpchar,
       NULL::text,
       o.reason
FROM node_override o;`;
}

function renderMembersView(inputs: ViewInputs): string {
  const { global, system } = modelDimensions(inputs);
  const served = [...global, ...system];
  const sys = system.map((d) => systemMembersSql(d, inputs.members[d]!)).join(',\n');
  const attrs = Object.entries(LINE_ATTRIBUTES)
    .map(([name, sql]) => `${lit(name)}, ${sql}`)
    .join(',\n      ');
  return `CREATE VIEW ${MEMBERS_VIEW} WITH (security_invoker = true) AS
-- global members (tenant_id NULL): visible to every tenant
SELECT NULL::uuid AS tenant_id, 'pool'::text AS dim_key, p.id AS member_key, p.label,
       jsonb_build_object('third_party', p.third_party::int, 'order', p.sort) AS attrs,
       p.sort, true AS active, '${ORIGIN_GLOBAL}'::text AS origin
FROM canonical_pool p
UNION ALL
SELECT NULL::uuid, 'addr_tag', a.id, a.label, '{}'::jsonb,
       (row_number() OVER (ORDER BY a.id COLLATE "C"))::integer, true, '${ORIGIN_GLOBAL}'
FROM addr_tag a
UNION ALL
-- system dimensions: members of the model, no table holds them (spec bundle)
SELECT NULL::uuid, s.dim_key, s.member_key, s.label, s.attrs, s.sort, true, '${ORIGIN_SYSTEM}'
FROM (VALUES
${sys}
) AS s (dim_key, member_key, label, attrs, sort)
UNION ALL
-- tenant members (vp, domain, vendor, lgroup, lever, ...); never the dimensions served above
SELECT m.tenant_id, m.dim_key, m.member_key, m.label, m.attrs, m.sort, m.active, '${ORIGIN_TENANT}'
FROM dimension_member m
WHERE m.dim_key NOT IN (${served.map(lit).join(', ')})
UNION ALL
-- baseline lines: their own table, attributes under the names expressions use (line.pool, line.domain, ...)
SELECT li.tenant_id, '${LINE_DIM}', li.member_key, li.name,
       jsonb_build_object(
      ${attrs}
       ),
       (row_number() OVER (PARTITION BY li.tenant_id ORDER BY li.member_key COLLATE "C"))::integer,
       li.active, '${ORIGIN_LINE_ITEM}'
FROM line_item li
LEFT JOIN source src ON src.id = li.source_id
LEFT JOIN LATERAL (
  SELECT COALESCE(jsonb_agg(l.lever_code ORDER BY l.lever_code COLLATE "C"), '[]'::jsonb) AS lever_ids
  FROM line_item_lever l
  WHERE l.tenant_id = li.tenant_id AND l.line_key = li.member_key
) lv ON true;`;
}

/** Renders migration 0003: the two views, their comments and the read grant to the app role. */
export function renderViewsSql(model: Model, schema: SpecSchema, inputs: ViewInputs): string {
  checkReads(model);
  checkLineAttributes(inputs);
  const descriptions = schema.views ?? {};
  for (const v of [INPUTS_VIEW, MEMBERS_VIEW])
    if (!descriptions[v]) throw new Error(`views: ${v} is not in schema.json views`);
  const out: string[] = [];
  out.push(
    `-- GENERATED by tools/gen-schema from docs/spec/schema.json (spec_version ${model.specVersion}). Do not edit.\n` +
      `-- Regenerate: pnpm --filter @glidepath/gen-schema generate\n` +
      `-- Views the engine loads (DATA-03; docs/spec/01_data_model.md section 4).\n` +
      `-- security_invoker: the caller's privileges and row-level security apply to the underlying tables\n` +
      `-- (app.tenant_id, 0002_rls.sql). Without it a view runs as its owner and would bypass RLS.\n` +
      `-- A view cannot take parameters: "v_inputs_resolved(tenant, scenario)" is the view filtered on\n` +
      `-- tenant_id and scenario_id (scenario_id NULL = the tenant defaults alone), ordered by the caller.\n`,
  );
  out.push(renderInputsView() + '\n');
  out.push(
    `COMMENT ON VIEW ${INPUTS_VIEW} IS ${lit(
      `${descriptions[INPUTS_VIEW]} Columns: tenant_id, scenario_id (NULL = tenant defaults), kind (${KIND_INPUT} | ${KIND_OVERRIDE}), key (var_key or node_key), member_key, value, resolved_from (${FROM_TENANT} | ${FROM_PARENT} | ${FROM_SCENARIO}), from_scenario_id, confidence, note, reason. Filter on tenant_id and scenario_id.`,
    )};\n`,
  );
  out.push(renderMembersView(inputs) + '\n');
  out.push(
    `COMMENT ON VIEW ${MEMBERS_VIEW} IS ${lit(
      `${descriptions[MEMBERS_VIEW]} Columns: tenant_id (NULL = global), dim_key, member_key, label, attrs, sort, active, origin (${ORIGIN_GLOBAL} | ${ORIGIN_SYSTEM} | ${ORIGIN_TENANT} | ${ORIGIN_LINE_ITEM}).`,
    )};\n`,
  );
  out.push(`GRANT SELECT ON ${ident(INPUTS_VIEW)}, ${ident(MEMBERS_VIEW)} TO ${APP_ROLE};\n`);
  return out.join('\n');
}
