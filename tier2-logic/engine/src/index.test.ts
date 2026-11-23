import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  compile,
  EngineError,
  packageName,
  type BatchInput,
  type BatchResult,
  type CellKey,
  type Change,
  type CompiledModel,
  type Evaluation,
  type Explanation,
  type ModelBundle,
  type TenantData,
  type TenantMembers,
} from './index';
import { METHOD_OWNERS, pendingModel } from './pending';

const here = dirname(fileURLToPath(import.meta.url));
type Cells = ReadonlyMap<CellKey, number>;

describe('engine', () => {
  it('exports its package name', () => {
    expect(packageName).toBe('@glidepath/engine');
  });
});

describe('03 §1 interfaces and stubs (index.test.ts)', () => {
  it('compile is a stub that throws "not implemented"', () => {
    const call = () => compile({} as ModelBundle, {});
    expect(call).toThrow(EngineError);
    expect(call).toThrow(/not implemented: compile \(ENG-04\)/);
    try {
      call();
    } catch (e) {
      expect((e as EngineError).code).toBe('NOT_IMPLEMENTED');
    }
  });

  it('every CompiledModel method has a stub that throws "not implemented" naming its item', () => {
    const model = pendingModel();
    const methods = Object.keys(METHOD_OWNERS) as (keyof CompiledModel)[];
    expect(methods.sort()).toEqual(
      [
        'downstream',
        'evaluate',
        'evaluateBatch',
        'explain',
        'inputHash',
        'rerun',
        'upstream',
      ].sort(),
    );
    for (const m of methods) {
      const fn = model[m] as () => unknown;
      expect(fn, m).toThrow(
        new RegExp(`not implemented: CompiledModel\\.${m} \\(${METHOD_OWNERS[m]}\\)`),
      );
    }
  });

  it('types match 03 §1 (checked by the typecheck gate)', () => {
    expectTypeOf(compile).parameters.toEqualTypeOf<[ModelBundle, TenantMembers]>();
    expectTypeOf(compile).returns.toEqualTypeOf<CompiledModel>();
    expectTypeOf<TenantData['members']>().toEqualTypeOf<TenantMembers>();
    expectTypeOf<TenantData['values']>().toEqualTypeOf<Map<CellKey, number>>();
    expectTypeOf<TenantData['overrides']>().toEqualTypeOf<Map<CellKey, number>>();
    expectTypeOf<ModelBundle>().toHaveProperty('variables');
    expectTypeOf<ModelBundle>().toHaveProperty('nodes');
    expectTypeOf<ModelBundle>().toHaveProperty('dimensions');

    expectTypeOf<CompiledModel['evaluate']>().parameters.toEqualTypeOf<[Cells, Cells?]>();
    expectTypeOf<CompiledModel['evaluate']>().returns.toEqualTypeOf<Evaluation>();
    expectTypeOf<CompiledModel['rerun']>().parameters.toEqualTypeOf<
      [Evaluation, readonly Change[]]
    >();
    expectTypeOf<CompiledModel['rerun']>().returns.toEqualTypeOf<Evaluation>();
    expectTypeOf<CompiledModel['evaluateBatch']>().parameters.toEqualTypeOf<
      [Evaluation, BatchInput]
    >();
    expectTypeOf<CompiledModel['evaluateBatch']>().returns.toEqualTypeOf<BatchResult>();
    expectTypeOf<CompiledModel['upstream']>().parameters.toEqualTypeOf<[CellKey, number?]>();
    expectTypeOf<CompiledModel['upstream']>().returns.toEqualTypeOf<CellKey[]>();
    expectTypeOf<CompiledModel['downstream']>().parameters.toEqualTypeOf<[CellKey]>();
    expectTypeOf<CompiledModel['downstream']>().returns.toEqualTypeOf<CellKey[]>();
    expectTypeOf<CompiledModel['explain']>().returns.toEqualTypeOf<Explanation>();
    expectTypeOf<CompiledModel['inputHash']>().parameters.toEqualTypeOf<[Cells, Cells]>();
    expectTypeOf<CompiledModel['inputHash']>().returns.toEqualTypeOf<string>();

    expectTypeOf<Extract<Change, { target: 'override' }>['value']>().toEqualTypeOf<number | null>();
    expectTypeOf<Extract<Change, { target: 'variable' }>['value']>().toEqualTypeOf<number>();
    expectTypeOf<BatchResult['values']>().toEqualTypeOf<ReadonlyMap<CellKey, Float64Array>>();
  });

  it('src (non-test files) imports no node builtin: the engine is pure', () => {
    const files = readdirSync(here, { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.ts') && !/\.(spec|test)\.ts$/.test(f))
      .map((f) => join(here, f));
    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      const specifiers = [...src.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map(
        (m) => m[1]!,
      );
      for (const s of specifiers) {
        expect(s, `${f} imports ${s}`).not.toMatch(
          /^(node:|fs$|fs\/|path$|crypto$|child_process$|os$)/,
        );
        expect(s, `${f} imports ${s}`).not.toMatch(/(^|\/)node(\/|$)/);
      }
    }
  });
});
