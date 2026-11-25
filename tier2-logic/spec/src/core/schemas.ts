import { z } from 'zod';

// Structural schemas for variables.json and formula_graph.json. Loose objects: unknown fields are kept,
// so a newer spec minor version does not break loading. Semantic checks (unknown dim, duplicates) are in load.ts.

const id = z.string().min(1);
const stringList = z.array(z.string());

export const VariableSchema = z.looseObject({
  id,
  kind: z.enum(['fact_or_estimate', 'decision', 'estimate', 'simulation']),
  label: z.string(),
  unit: z.string(),
  type: z.enum(['number', 'int', 'bool', 'enum']),
  dims: stringList,
  min: z.number().nullable(),
  max: z.number().nullable(),
  step: z.number().nullable(),
  group: z.string().optional(),
  layer: z.string(),
  role: z.enum(['driver', 'calibration', 'simulation']),
  ui: z.looseObject({ control: z.string(), hero: z.boolean() }),
  source: z.string().optional(),
  confidence: z.string().optional(),
  note: z.string().optional(),
  scenario_varies: z.boolean(),
  legacy: stringList.nullable().optional(),
  aa_default: z.union([z.string(), z.number(), z.record(z.string(), z.number())]).optional(),
});

export const VariablesDocSchema = z.looseObject({
  spec_version: z.string(),
  count: z.number().int().optional(),
  variables: z.array(VariableSchema),
});

export const DimensionSchema = z.looseObject({
  id,
  label: z.string(),
  scope: z.string(),
  attributes: stringList,
});

const memberSubset = z.record(z.string(), z.array(z.string()).min(1));

export const NodeCaseSchema = z.looseObject({
  when: memberSubset.nullable(),
  expr: z.string().min(1),
});

export const NodeSchema = z.looseObject({
  id,
  dims: stringList,
  unit: z.string(),
  label: z.string(),
  layer: z.string(),
  output: z.boolean(),
  expr: z.string().min(1).optional(),
  cases: z.array(NodeCaseSchema).min(1).optional(),
  members: memberSubset.optional(),
});

export const FormulaGraphDocSchema = z.looseObject({
  spec_version: z.string(),
  model_id: z.string(),
  units: z.string(),
  expression_language: z.string(),
  dimensions: z.array(DimensionSchema),
  layers: stringList,
  nodes: z.array(NodeSchema),
});

export const ModelBundleJsonSchema = z.object({
  variables: VariablesDocSchema,
  formulaGraph: FormulaGraphDocSchema,
});
