import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GENERATED_DIR, REPO_ROOT, SPEC_DIR, generateAll, readJson } from './generate';
import * as ids from '../../../tier2-logic/spec/src/generated/ids';
import * as generated from '../../../tier2-logic/spec/src/generated/index';

const variables = readJson(join(SPEC_DIR, 'variables.json')) as { count: number; variables: unknown[] };
const formulaGraph = readJson(join(SPEC_DIR, 'formula_graph.json')) as {
  dimensions: unknown[];
  nodes: unknown[];
};
const solvers = readJson(join(SPEC_DIR, 'solvers.json')) as { problems: unknown[] };
const schema = readJson(join(SPEC_DIR, 'schema.json')) as { validation_rules: unknown[] };

describe('gen-types', () => {
  it('emits zod schemas and TS types for all spec inputs and seed files', () => {
    const files = generateAll();
    const expected: Array<[string, string]> = [
      ['variables.ts', 'VariablesSchema'],
      ['formula-graph.ts', 'FormulaGraphSchema'],
      ['solvers.ts', 'SolversSchema'],
      ['excel-template.ts', 'ExcelTemplateSchema'],
      ['db-schema.ts', 'DbSchemaSchema'],
      ['seed-aa-tenant.ts', 'SeedAaTenantSchema'],
      ['seed-aa-scenarios.ts', 'SeedAaScenariosSchema'],
      ['seed-aa-lever-library.ts', 'SeedAaLeverLibrarySchema'],
      ['seed-aa-dimension-members.ts', 'SeedAaDimensionMembersSchema'],
      ['seed-aa-variable-values.ts', 'SeedAaVariableValuesSchema'],
    ];
    for (const [file, schemaName] of expected) {
      const source = files.get(file);
      expect(source, file).toBeDefined();
      expect(source).toContain(`export const ${schemaName} = z.`);
      const typeName = schemaName.replace(/Schema$/, '');
      expect(source).toContain(`export type ${typeName} = z.infer<typeof ${schemaName}>;`);
    }
  });

  it('output compiles (typecheck of @glidepath/spec)', () => {
    const tsc = join(REPO_ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
    const project = join(REPO_ROOT, 'tier2-logic', 'spec', 'tsconfig.json');
    expect(() => execFileSync(process.execPath, [tsc, '--noEmit', '-p', project], { stdio: 'pipe' })).not.toThrow();
  }, 60_000); // spawns a full tsc run; CI runners take ~6 s

  it('generated schemas accept the real spec JSON', () => {
    expect(generated.VariablesSchema.safeParse(variables).success).toBe(true);
    expect(generated.FormulaGraphSchema.safeParse(formulaGraph).success).toBe(true);
    expect(generated.SolversSchema.safeParse(solvers).success).toBe(true);
    expect(generated.DbSchemaSchema.safeParse(schema).success).toBe(true);
  });

  it('id unions VarId, NodeId, DimId, ProblemId, VRId have the JSON counts', () => {
    expect(variables.count).toBe(194);
    expect(ids.VarIds).toHaveLength(variables.variables.length);
    expect(ids.VarIds).toHaveLength(194);
    expect(ids.NodeIds).toHaveLength(formulaGraph.nodes.length);
    expect(ids.NodeIds).toHaveLength(307);
    expect(ids.DimIds).toHaveLength(formulaGraph.dimensions.length);
    expect(ids.ProblemIds).toHaveLength(solvers.problems.length);
    expect(ids.VRIds).toHaveLength(schema.validation_rules.length);
    expect(ids.VarIds).toContain('g.target_net');
    expect(ids.VRIds).toContain('VR01');
    expect(ids.VarIdSchema.options).toEqual(ids.VarIds);
  });

  it('generated files carry a do-not-edit header and regenerate with no diff', () => {
    const fresh = generateAll();
    const onDisk = readdirSync(GENERATED_DIR).filter((f) => f.endsWith('.ts')).sort();
    expect([...fresh.keys()].sort()).toEqual(onDisk);
    for (const [file, source] of fresh) {
      expect(source.startsWith('// DO NOT EDIT'), file).toBe(true);
      expect(readFileSync(join(GENERATED_DIR, file), 'utf8'), file).toBe(source);
    }
    expect(existsSync(join(GENERATED_DIR, 'ids.ts'))).toBe(true);
  });
});
