import { parseTenantSeed, SpecValidationError, type TenantSeed } from '@glidepath/spec';
import { z } from 'zod';
import {
  type Checklist,
  checklistStepForDim,
  checklistStepForVariable,
  ChecklistStepId,
  ONBOARDING_CHECKLIST,
} from '../onboarding/checklist';
import { Confidence } from './plan';

/** `target` of the provenance entry that covers the tenant record (every other target is a variable id). */
export const TENANT_TARGET = 'tenant';

/** Source and confidence of one seeded value (checklist step 9: every value carries both). */
export const ValueProvenance = z.strictObject({
  /** A variable id from `variable_values.json`, or `tenant` for the tenant record. */
  target: z.string().min(1),
  source: z.string().nullable(),
  confidence: Confidence,
  factIds: z.array(z.string()),
});
export type ValueProvenance = z.infer<typeof ValueProvenance>;

/**
 * The assembled step 3 draft: the five files of `seed/<tenant>/` in the same shape as the AA seed, validated
 * with the SPEC-03 seed reader (`parseTenantSeed`), plus the provenance of every value. Parsing yields the
 * typed `TenantSeed` the rest of tier 2 uses.
 */
export const TenantSeedDraft = z
  .strictObject({
    tenant: z.unknown(),
    dimensionMembers: z.unknown(),
    variableValues: z.unknown(),
    scenarios: z.unknown(),
    leverLibrary: z.unknown(),
    provenance: z.array(ValueProvenance).optional(),
  })
  .transform((draft, ctx): TenantSeed & { provenance: ValueProvenance[] } => {
    let seed: TenantSeed;
    try {
      seed = parseTenantSeed(draft);
    } catch (e) {
      if (!(e instanceof SpecValidationError)) throw e;
      for (const issue of e.issues) ctx.addIssue({ code: 'custom', message: `${issue.path}: ${issue.message}`, input: draft });
      return z.NEVER;
    }
    const provenance = draft.provenance ?? [];
    provenance.forEach((p, i) => {
      if (p.target !== TENANT_TARGET && !(p.target in seed.variableValues))
        ctx.addIssue({ code: 'custom', path: ['provenance', i, 'target'], message: `no seeded value '${p.target}'`, input: p });
    });
    return { ...seed, provenance };
  });
export type TenantSeedDraftInput = z.input<typeof TenantSeedDraft>;
export type TenantSeedDraft = z.output<typeof TenantSeedDraft>;

// ---------------------------------------------------------------------------------------------------------------
// Wire format of step 3. Structured outputs accept no maps (`additionalProperties` other than false) and no
// recursion, so the model writes each seed section as lists of entries; `assembleSeedDraft` turns them back into
// the seed's maps.

/** A member attribute value as it occurs in seeds: scalar or a list of ids (`lever_ids`). */
const AttrValue = z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string())]);
const Attr = z.strictObject({ name: z.string().min(1), value: AttrValue });

export const MemberDraft = z.strictObject({ id: z.string().min(1), attrs: z.array(Attr) });
export const DimensionDraft = z.strictObject({ dim: z.string().min(1), members: z.array(MemberDraft) });

/** One variable's tenant default with its provenance: `scalar` for a scalar variable, `perMember` otherwise. */
export const ValueDraft = z
  .strictObject({
    variable: z.string().min(1),
    scalar: z.number().nullable(),
    perMember: z.array(z.strictObject({ key: z.string().min(1), value: z.number() })).nullable(),
    source: z.string().nullable(),
    confidence: Confidence,
    factIds: z.array(z.string()),
  })
  .superRefine((v, ctx) => {
    if ((v.scalar === null) === (v.perMember === null))
      ctx.addIssue({ code: 'custom', path: ['scalar'], message: `${v.variable}: give exactly one of scalar and perMember` });
  });
export type ValueDraft = z.infer<typeof ValueDraft>;

/** `tenant.json`: the checklist step 1 fields, plus any further fields of the record as `extra`. */
export const TenantRecordDraft = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  currency: z.string().min(1),
  base_year: z.number().int(),
  target_year: z.number().int(),
  fiscal_calendar: z.string().min(1),
  ticker: z.string().nullable(),
  extra: z.array(Attr),
  source: z.string().nullable(),
  confidence: Confidence,
  factIds: z.array(z.string()),
});
export type TenantRecordDraft = z.infer<typeof TenantRecordDraft>;

/** Step 3 structured output for one checklist step's section of the seed. */
export const SeedSectionDraft = z.strictObject({
  step: ChecklistStepId,
  /** Only in the `tenant_record` section. */
  tenant: TenantRecordDraft.nullable(),
  dimensions: z.array(DimensionDraft),
  values: z.array(ValueDraft),
});
export type SeedSectionDraft = z.infer<typeof SeedSectionDraft>;

/** Parts of the seed copied rather than drafted (checklist step 8: global presets and the lever library). */
export interface SeedPresets {
  readonly scenarios: unknown;
  readonly leverLibrary: unknown;
}

const TENANT_FIXED = ['id', 'name', 'currency', 'base_year', 'target_year', 'fiscal_calendar', 'ticker'] as const;

/** Thrown when sections cannot be merged (a dimension or variable drafted twice, no or two tenant records). */
export class SeedAssemblyError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(problems.join('; '));
    this.name = 'SeedAssemblyError';
  }
}

/** Merge step 3 section outputs and the copied presets into the seed's own shape (not yet validated). */
export function assembleSeedDraft(sections: readonly SeedSectionDraft[], presets: SeedPresets): TenantSeedDraftInput {
  const problems: string[] = [];
  const tenants = sections.flatMap((s) => (s.tenant ? [s.tenant] : []));
  if (tenants.length !== 1) problems.push(`expected one tenant record, got ${tenants.length}`);

  const dimensionMembers: Record<string, Record<string, unknown>[]> = {};
  const variableValues: Record<string, number | Record<string, number>> = {};
  const provenance: ValueProvenance[] = [];
  for (const section of sections) {
    for (const d of section.dimensions) {
      if (d.dim in dimensionMembers) problems.push(`dimension '${d.dim}' drafted twice`);
      dimensionMembers[d.dim] = d.members.map((m) => ({ id: m.id, ...Object.fromEntries(m.attrs.map((a) => [a.name, a.value])) }));
    }
    for (const v of section.values) {
      if (v.variable in variableValues) problems.push(`variable '${v.variable}' drafted twice`);
      if (v.perMember) variableValues[v.variable] = Object.fromEntries(v.perMember.map((e) => [e.key, e.value]));
      else if (v.scalar !== null) variableValues[v.variable] = v.scalar;
      else problems.push(`variable '${v.variable}' has no value`);
      provenance.push({ target: v.variable, source: v.source, confidence: v.confidence, factIds: v.factIds });
    }
  }
  if (problems.length > 0) throw new SeedAssemblyError(problems);

  const t = tenants[0]!;
  const tenant: Record<string, unknown> = Object.fromEntries(TENANT_FIXED.map((k) => [k, t[k]]));
  if (t.ticker === null) delete tenant.ticker;
  for (const a of t.extra) tenant[a.name] = a.value;
  provenance.unshift({ target: TENANT_TARGET, source: t.source, confidence: t.confidence, factIds: t.factIds });

  return { tenant, dimensionMembers, variableValues, scenarios: presets.scenarios, leverLibrary: presets.leverLibrary, provenance };
}

/** Registry entries `splitSeedDraft` needs to place a variable in its checklist step. */
export type RegistryEntry = { readonly id: string; readonly group?: string };

/**
 * The inverse of `assembleSeedDraft`: a seed as step 3 section outputs, one per checklist step that owns part of it.
 * Used for the worked example in the cached prefix and to check that the chunking covers a whole seed. Values
 * without provenance get `source: null, confidence: 'L'` (no source means low confidence).
 */
export function splitSeedDraft(
  seed: TenantSeedDraft,
  registry: readonly RegistryEntry[],
  checklist: Checklist = ONBOARDING_CHECKLIST,
): SeedSectionDraft[] {
  const byId = new Map(registry.map((r) => [r.id, r]));
  const prov = new Map(seed.provenance.map((p) => [p.target, p]));
  const provOf = (target: string) => {
    const p = prov.get(target);
    return { source: p?.source ?? null, confidence: p?.confidence ?? ('L' as const), factIds: p ? [...p.factIds] : [] };
  };
  const sections = new Map<string, SeedSectionDraft>(
    checklist.steps.map((s) => [s.id, { step: s.id, tenant: null, dimensions: [], values: [] }]),
  );
  const sectionOf = (stepId: string | undefined, what: string): SeedSectionDraft => {
    const section = stepId === undefined ? undefined : sections.get(stepId);
    if (!section) throw new Error(`no checklist step owns ${what}`);
    return section;
  };

  const t = seed.tenant;
  const { base_year: baseYear, target_year: targetYear, fiscal_calendar: fiscalCalendar } = t;
  if (typeof baseYear !== 'number' || typeof targetYear !== 'number' || typeof fiscalCalendar !== 'string')
    throw new Error('tenant record needs base_year, target_year and fiscal_calendar');
  const tenantStep = checklist.steps.find((s) => s.seed.files.includes('tenant.json'));
  sectionOf(tenantStep?.id, 'tenant.json').tenant = {
    id: t.id,
    name: t.name,
    currency: t.currency,
    base_year: baseYear,
    target_year: targetYear,
    fiscal_calendar: fiscalCalendar,
    ticker: typeof t.ticker === 'string' ? t.ticker : null,
    extra: Object.entries(t)
      .filter(([k]) => !(TENANT_FIXED as readonly string[]).includes(k))
      .map(([name, value]) => ({ name, value: value as z.infer<typeof AttrValue> })),
    ...provOf(TENANT_TARGET),
  };

  for (const [dim, members] of Object.entries(seed.dimensionMembers)) {
    sectionOf(checklistStepForDim(dim, checklist)?.id, `dimension '${dim}'`).dimensions.push({
      dim,
      members: members.map(({ id, ...attrs }) => ({
        id,
        attrs: Object.entries(attrs).map(([name, value]) => ({ name, value: value as z.infer<typeof AttrValue> })),
      })),
    });
  }

  for (const [variable, value] of Object.entries(seed.variableValues)) {
    const entry = byId.get(variable) ?? { id: variable };
    sectionOf(checklistStepForVariable(entry, checklist)?.id, `variable '${variable}'`).values.push({
      variable,
      scalar: typeof value === 'number' ? value : null,
      perMember: typeof value === 'number' ? null : Object.entries(value).map(([key, v]) => ({ key, value: v })),
      ...provOf(variable),
    });
  }

  return [...sections.values()].filter((s) => s.tenant !== null || s.dimensions.length > 0 || s.values.length > 0);
}
