import { z } from 'zod';

// Structural schemas for a tenant seed (docs/spec/seed/<tenant>/*.json). Loose objects: unknown fields are kept.
// They are deliberately not the AA-specific generated schemas (`@glidepath/spec/generated`), which pin AA's exact
// variable ids and dimension ids; any tenant's seed must pass here. Tests also check the AA seed against the generated ones.

const attrValue: z.ZodType<unknown> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(attrValue)]),
);

export const TenantSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string(),
  currency: z.string(),
});

export const DimensionMembersSchema = z.record(
  z.string(),
  z.array(z.object({ id: z.string().min(1) }).catchall(attrValue)),
);

/** An input's tenant default or scenario value: a scalar, or `{ memberKey: value }` for a dimensioned variable. */
export const InputValueSchema = z.union([z.number(), z.record(z.string(), z.number())]);

export const VariableValuesSchema = z.record(z.string(), InputValueSchema);

export const ScenariosSchema = z.looseObject({
  tenant: z.string(),
  default_scenario: z.string(),
  scenarios: z.array(
    z.looseObject({
      id: z.string().min(1),
      label: z.string(),
      values: z.record(z.string(), InputValueSchema),
      /** Pinned node cells, keyed by cell key (`res.net`, `lev.rr[...]`). Absent in the AA presets. */
      overrides: z.record(z.string(), z.number()).optional(),
    }),
  ),
});

export const LeverLibrarySchema = z.looseObject({
  levers: z.array(z.looseObject({ id: z.string().min(1), label: z.string() })),
});

export const TenantSeedJsonSchema = z.object({
  tenant: TenantSchema,
  dimensionMembers: DimensionMembersSchema,
  variableValues: VariableValuesSchema,
  scenarios: ScenariosSchema,
  leverLibrary: LeverLibrarySchema,
});
