import { z } from 'zod';
import {
  CellKey,
  DimKey,
  InputHash,
  MemberKey,
  ModelVersionId,
  NodeKey,
  OneLine,
  ScenarioId,
  TenantId,
  TenantSlug,
  Timestamp,
  UserId,
  VarKey,
  Version,
} from './ids';
import { Outputs } from './changeset';

// ---------------------------------------------------------------------------
// Path params
// ---------------------------------------------------------------------------

export const TenantParams = z.object({ tenant: TenantSlug });
export const ScenarioParams = z.object({ tenant: TenantSlug, id: ScenarioId });

// ---------------------------------------------------------------------------
// GET /api/me, GET /api/tenants
// ---------------------------------------------------------------------------

/** Verbatim from `tables.tenant_membership.role`. */
export const MembershipRole = z.enum(['owner', 'editor', 'viewer', 'advisor']);
export type MembershipRole = z.infer<typeof MembershipRole>;

/** Verbatim from `tables.tenant.status`. */
export const TenantStatus = z.enum(['setup', 'active', 'archived']);
export type TenantStatus = z.infer<typeof TenantStatus>;

export const User = z.object({
  id: UserId,
  email: z.email(),
  name: z.string(),
});
export type User = z.infer<typeof User>;

export const Membership = z.object({
  tenantId: TenantId,
  tenantSlug: TenantSlug,
  tenantName: z.string(),
  role: MembershipRole,
});
export type Membership = z.infer<typeof Membership>;

export const MeResponse = z.object({
  user: User,
  memberships: z.array(Membership),
});
export type MeResponse = z.infer<typeof MeResponse>;

export const Tenant = z.object({
  id: TenantId,
  slug: TenantSlug,
  name: z.string(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  baseYear: z.number().int(),
  targetYear: z.number().int(),
  fiscalCalendar: z.string(),
  ticker: z.string().nullable(),
  status: TenantStatus,
  modelVersionId: ModelVersionId,
  role: MembershipRole,
});
export type Tenant = z.infer<typeof Tenant>;

export const TenantsResponse = z.object({
  tenants: z.array(Tenant),
});
export type TenantsResponse = z.infer<typeof TenantsResponse>;

// ---------------------------------------------------------------------------
// GET /api/t/:tenant/bundle  (definitions and labels for rendering; no formulas)
// ---------------------------------------------------------------------------

/** Registry `kind`: decision vs estimate thumbs (07 §3). */
export const VariableKind = z.enum(['decision', 'estimate', 'fact_or_estimate', 'simulation']);
export type VariableKind = z.infer<typeof VariableKind>;

/** `variable_def.type`. */
export const VariableType = z.enum(['number', 'int', 'bool', 'enum']);
export type VariableType = z.infer<typeof VariableType>;

/** `variable_def.role`. */
export const VariableRole = z.enum(['driver', 'calibration', 'simulation']);
export type VariableRole = z.infer<typeof VariableRole>;

export const UiControl = z.enum([
  'slider',
  'number',
  'toggle',
  'segmented',
  'hidden',
  'table',
  'matrix',
]);
export type UiControl = z.infer<typeof UiControl>;

export const Confidence = z.enum(['H', 'M', 'L']);
export type Confidence = z.infer<typeof Confidence>;

/** `dimension_def.scope`. */
export const DimensionScope = z.enum(['global', 'tenant', 'system', 'global+tenant']);
export type DimensionScope = z.infer<typeof DimensionScope>;

/**
 * How a percent-unit value is stored (set by tier 2 from the registry, WEB-10): `fraction` 0.1 is
 * 10% (levers, targets, baseline, VPs); `points` 2.0 is 2.0% (corporate drivers such as `corp.gdp`).
 * `null` when the unit is not a percent. Tier 1 shows and parses by this and never by id.
 */
export const PercentScale = z.enum(['fraction', 'points']);
export type PercentScale = z.infer<typeof PercentScale>;

export const VariableDef = z.object({
  id: VarKey,
  label: z.string(),
  unit: z.string(),
  type: VariableType,
  kind: VariableKind,
  dims: z.array(DimKey),
  min: z.number().nullable(),
  max: z.number().nullable(),
  step: z.number().nullable(),
  group: z.string(),
  layer: z.string(),
  role: VariableRole,
  ui: z.object({ control: UiControl, hero: z.boolean() }),
  source: z.string(),
  confidence: Confidence,
  note: z.string(),
  scenarioVaries: z.boolean(),
  /** Scale of a percent-unit variable (`%`, `%/yr`, ...); `null` for any other unit. */
  percentScale: PercentScale.nullable(),
});
export type VariableDef = z.infer<typeof VariableDef>;

/**
 * A formula node as tier 1 needs it: label, unit, dims. Strict: the expression (`expr`,
 * `cases`) and any other key stay in tier 2, and a bundle that carries one fails to parse.
 */
export const NodeDef = z.strictObject({
  id: NodeKey,
  label: z.string(),
  unit: z.string(),
  dims: z.array(DimKey),
  layer: z.string(),
  output: z.boolean(),
  overridable: z.boolean(),
  /** Scale of a percent-unit node; `null` for any other unit. */
  percentScale: PercentScale.nullable(),
});
export type NodeDef = z.infer<typeof NodeDef>;

export const DimensionDef = z.object({
  id: DimKey,
  label: z.string(),
  scope: DimensionScope,
  attributes: z.array(z.string()),
});
export type DimensionDef = z.infer<typeof DimensionDef>;

/**
 * Defaults of the solvers' optional constraints that the spec states in prose (MOD-11), so tier 1 prefills a
 * constraint's value without a number of its own. `gcc_hiring`: the GCC hiring capacity (the contract's
 * `gcc_hiring.value` stays required); absent when the pinned model version has no generated default.
 */
export const SolverDefaults = z.object({ gcc_hiring: z.number().optional() });
export type SolverDefaults = z.infer<typeof SolverDefaults>;

export const BundleResponse = z.object({
  modelVersion: z.object({ id: ModelVersionId, semver: z.string().min(1) }),
  variables: z.array(VariableDef),
  nodes: z.array(NodeDef),
  dimensions: z.array(DimensionDef),
  solverDefaults: SolverDefaults,
});
export type BundleResponse = z.infer<typeof BundleResponse>;

// ---------------------------------------------------------------------------
// GET /api/t/:tenant/members
// ---------------------------------------------------------------------------

export const Member = z.object({
  key: MemberKey,
  label: z.string(),
  attrs: z.record(z.string(), z.json()),
  sort: z.number().int().nullable(),
  active: z.boolean(),
});
export type Member = z.infer<typeof Member>;

export const MembersResponse = z.object({
  membersHash: z.string().min(1),
  dimensions: z.record(DimKey, z.array(Member)),
});
export type MembersResponse = z.infer<typeof MembersResponse>;

// ---------------------------------------------------------------------------
// Scenarios: GET list, POST create, PATCH
// ---------------------------------------------------------------------------

/** Verbatim from `tables.scenario.kind`. */
export const ScenarioKind = z.enum(['preset', 'user', 'solver', 'blend']);
export type ScenarioKind = z.infer<typeof ScenarioKind>;

/**
 * A scenario. `parentId`: the scenario inherits the input values it does not set itself
 * (`v_inputs_resolved`: registry → tenant default → parent → this scenario, last one wins).
 * Node overrides (pins) are not inherited; each scenario has only its own.
 * `editsCount` is the scenario's edits counter, as `ChangesetResult.editsCount` reports it
 * after a commit (0 for a preset), so the scenario bar shows it without a commit.
 */
export const Scenario = z.object({
  id: ScenarioId,
  key: z.string().min(1),
  label: z.string(),
  /** Short name for the scenario bar chips (`Rates only`, `Balanced`); tier 2 builds it, tier 1 never derives it. */
  shortLabel: z.string().min(1),
  kind: ScenarioKind,
  parentId: ScenarioId.nullable(),
  modelVersionId: ModelVersionId,
  version: Version,
  editsCount: z.number().int().nonnegative(),
  locked: z.boolean(),
  archived: z.boolean(),
  createdBy: UserId.nullable(),
  createdAt: Timestamp,
});
export type Scenario = z.infer<typeof Scenario>;

export const ScenariosResponse = z.object({
  scenarios: z.array(Scenario),
  /**
   * The preset the tenant seed names as its default (`default_scenario`); where `/` opens.
   * Null when there is none (or the server predates WEB-12).
   */
  defaultScenarioId: ScenarioId.nullable().default(null),
});
export type ScenariosResponse = z.infer<typeof ScenariosResponse>;

/**
 * Create by copy, blend, or empty child. A child starts with no values of its own and
 * resolves its inputs through its parent (see `Scenario`); it has no node overrides.
 */
export const CreateScenarioRequest = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('copy'),
    from: ScenarioId,
    label: z.string().min(1).optional(),
  }),
  z.object({
    mode: z.literal('blend'),
    parts: z.array(z.object({ scenarioId: ScenarioId, weight: z.number().nonnegative() })).min(2),
    label: z.string().min(1).optional(),
  }),
  z.object({
    mode: z.literal('child'),
    parentId: ScenarioId,
    label: z.string().min(1).optional(),
  }),
]);
export type CreateScenarioRequest = z.infer<typeof CreateScenarioRequest>;

/** Rename, lock, archive. At least one field. */
export const PatchScenarioRequest = z
  .object({
    label: z.string().min(1).optional(),
    locked: z.boolean().optional(),
    archived: z.boolean().optional(),
  })
  .refine((p) => Object.values(p).some((v) => v !== undefined), {
    message: 'nothing to change',
  });
export type PatchScenarioRequest = z.infer<typeof PatchScenarioRequest>;

// ---------------------------------------------------------------------------
// GET /api/t/:tenant/scenarios/:id/inputs  (v_inputs_resolved)
// ---------------------------------------------------------------------------

/** Where a resolved value came from: the scenario itself, an ancestor, or the tenant default. */
export const ResolvedFrom = z.enum(['scenario', 'parent', 'tenant']);
export type ResolvedFrom = z.infer<typeof ResolvedFrom>;

export const ResolvedInput = z.object({
  var: VarKey,
  member: MemberKey,
  /** `null` when no layer sets the cell (surfaces as a VR10 violation on calc). */
  value: z.number().nullable(),
  from: ResolvedFrom.nullable(),
  /** Scenario that set the value when `from` is `scenario` or `parent`. */
  fromScenarioId: ScenarioId.nullable(),
  confidence: Confidence.nullable(),
  note: z.string().nullable(),
});
export type ResolvedInput = z.infer<typeof ResolvedInput>;

export const NodeOverride = z.object({
  node: NodeKey,
  member: MemberKey,
  value: z.number(),
  reason: z.string(),
});
export type NodeOverride = z.infer<typeof NodeOverride>;

export const InputsResponse = z.object({
  scenarioId: ScenarioId,
  version: Version,
  inputs: z.array(ResolvedInput),
  overrides: z.array(NodeOverride),
});
export type InputsResponse = z.infer<typeof InputsResponse>;

// ---------------------------------------------------------------------------
// GET /api/t/:tenant/scenarios/:id/calc
// ---------------------------------------------------------------------------

/**
 * Latest stored `calc_run`. `stale` is true when it predates the scenario's current version
 * or the tenant's pinned model version (IA §6 "Stale": show the recalculate chip).
 */
export const CalcResponse = z.object({
  scenarioId: ScenarioId,
  scenarioVersion: Version,
  modelVersionId: ModelVersionId,
  inputHash: InputHash,
  ms: z.number().int().nonnegative(),
  createdAt: Timestamp,
  stale: z.boolean(),
  outputs: Outputs,
});
export type CalcResponse = z.infer<typeof CalcResponse>;

// ---------------------------------------------------------------------------
// GET /api/t/:tenant/nodes/:cell/explain  (trace drawer)
// ---------------------------------------------------------------------------

export const ExplainParams = z.object({ tenant: TenantSlug, cell: CellKey });
export const ExplainQuery = z.object({ scenario: ScenarioId });

export const TraceRef = z.object({
  cell: CellKey,
  kind: z.enum(['input', 'node']),
  label: z.string(),
  unit: z.string(),
  value: z.number().nullable(),
  /** Distance from the explained cell along the upstream chain (1 = direct input). */
  depth: z.number().int().positive(),
});
export type TraceRef = z.infer<typeof TraceRef>;

export const Driver = z.object({
  cell: CellKey,
  label: z.string(),
  unit: z.string(),
  value: z.number().nullable(),
  /** Local sensitivity of the explained cell to this driver, as computed by tier 2. */
  impact: z.number(),
});
export type Driver = z.infer<typeof Driver>;

export const ExplainResponse = z.object({
  cell: CellKey,
  node: NodeKey,
  member: MemberKey,
  label: z.string(),
  unit: z.string(),
  value: z.number().nullable(),
  /** The spec expression as display text; tier 1 never evaluates it. */
  expression: z.string().nullable(),
  /** Formula in words, labels from the spec. */
  words: z.string(),
  override: z.object({ value: z.number(), reason: z.string() }).nullable(),
  upstream: z.array(TraceRef),
  drivers: z.array(Driver),
});
export type ExplainResponse = z.infer<typeof ExplainResponse>;

// ---------------------------------------------------------------------------
// GET /api/t/:tenant/search?q=  (⌘K)
// ---------------------------------------------------------------------------

/** The eleven app modules a result can jump to (07 §1, SRC-03 adds `sourcing` and `plan` after `path`); `wizard` is second, so the rail reads Cockpit, Build, ... */
export const AppModule = z.enum([
  'cockpit',
  'wizard',
  'baseline',
  'levers',
  'vps',
  'path',
  'sourcing',
  'plan',
  'market',
  'excel',
  'airlines',
]);
export type AppModule = z.infer<typeof AppModule>;

export const SearchKind = z.enum(['input', 'lever', 'node', 'line', 'screen']);
export type SearchKind = z.infer<typeof SearchKind>;

export const SearchQuery = z.object({
  q: z.string().trim().min(1),
  limit: z.coerce.number().int().positive().optional(),
  scenario: ScenarioId.optional(),
});
export type SearchQuery = z.infer<typeof SearchQuery>;

export const SearchResult = z.object({
  kind: SearchKind,
  /** Var key, node key, lever or line member key, or module id for screens. */
  id: z.string().min(1),
  label: z.string(),
  unit: z.string().nullable(),
  group: z.string().nullable(),
  /** Where Enter jumps; tier 1 focuses `id` there. */
  module: AppModule.nullable(),
  hint: OneLine.nullable(),
});
export type SearchResult = z.infer<typeof SearchResult>;

export const SearchResponse = z.object({
  q: z.string(),
  results: z.array(SearchResult),
});
export type SearchResponse = z.infer<typeof SearchResponse>;
