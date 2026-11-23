import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModelBundleFromDir } from '@glidepath/spec/node';
import { describe, expect, it } from 'vitest';
import { toPyTuple } from './ast';
import { parse, type ParseCache } from './parse';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../../..');

/** Written by `python3 -I tier2-logic/engine/test/fixtures/dump_ast.py .` from the unchanged engine.py. */
interface AstFixture {
  sources: Record<string, string>;
  node_count: number;
  expression_count: number;
  nodes: Record<string, string[]>;
  asts: Record<string, unknown>;
}
const fixture = JSON.parse(
  readFileSync(resolve(here, '../../test/fixtures/ast.json'), 'utf8'),
) as AstFixture;

describe('AST parity with engine.py (ast-parity.spec.ts)', () => {
  it('the fixture was generated from the current formula_graph.json and engine.py', () => {
    for (const [rel, sha] of Object.entries(fixture.sources)) {
      const actual = createHash('sha256')
        .update(readFileSync(resolve(repo, rel)))
        .digest('hex');
      expect(actual, `${rel} changed: re-run test/fixtures/dump_ast.py`).toBe(sha);
    }
  });

  it('every expr and case expr in formula_graph.json parses to the Python AST (all 307 nodes)', async () => {
    const bundle = await loadModelBundleFromDir(resolve(repo, 'docs/spec'));
    expect(bundle.nodes).toHaveLength(fixture.node_count);
    expect(fixture.node_count).toBe(307);

    const cache: ParseCache = new Map();
    let checked = 0;
    for (const node of bundle.nodes) {
      const exprs = [
        ...(node.expr !== undefined ? [node.expr] : []),
        ...(node.cases ?? []).map((c) => c.expr),
      ];
      expect(exprs, node.id).toEqual(fixture.nodes[node.id]);
      for (const src of exprs) {
        expect(toPyTuple(parse(src, cache)), `${node.id}: ${src}`).toEqual(fixture.asts[src]);
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(fixture.node_count);
    expect(cache.size).toBe(fixture.expression_count);
    expect(cache.size).toBe(381);
  });

  it('every spec expression is ASCII (PORTING.md S28)', () => {
    for (const src of Object.keys(fixture.asts)) expect(src, src).toMatch(/^[\x20-\x7e]*$/);
  });
});
