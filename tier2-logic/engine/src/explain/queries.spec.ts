import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bundleOf, loadSeedModel, membersOf, readFixture, repo } from '../../test/helpers';
import { buildAdjacency, compileModel, EngineModel, type Adjacency } from '../compile';
import { EngineError } from '../errors';
import { findScenario, resolveInputs } from '../eval';
import { localSensitivities } from './drivers';

/** `closure.json` written by `test/fixtures/dump_closure.py` from the unchanged engine.py. */
interface ClosureFixture {
  sources: Record<string, string>;
  sample: { cell: string; up: [number, string][]; down: [number, string] }[];
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
/** `[count, sha256 of the keys joined by "\n"]`, as dump_closure.py writes it. */
const digest = (keys: readonly string[]): [number, string] => [
  keys.length,
  sha256(keys.join('\n')),
];

describe('dependency queries on the seed tenant (queries.spec.ts)', async () => {
  const { bundle, seed } = await loadSeedModel();
  const model = compileModel(bundle, seed.dimensionMembers);
  const fixture = readFixture<ClosureFixture>('closure.json');

  it('the fixture was generated from the current spec, seed members and engine.py', () => {
    for (const [rel, sha] of Object.entries(fixture.sources)) {
      const actual = createHash('sha256')
        .update(readFileSync(resolve(repo, rel)))
        .digest('hex');
      expect(actual, `${rel} changed: re-run test/fixtures/dump_closure.py`).toBe(sha);
    }
  });

  it('upstream(cell, depth) and downstream(cell) equal the Python cdeps/users closure on 50 sampled cells', () => {
    expect(fixture.sample).toHaveLength(50);
    const kinds = { node: 0, input: 0 };
    for (const { cell, up, down } of fixture.sample) {
      kinds[model.index.get(cell)! < model.program.nCells ? 'node' : 'input']++;
      expect(model.upstream(cell, 0), cell).toEqual([]);
      // Level d of the breadth-first walk = upstream(cell, d) minus upstream(cell, d - 1), whose keys
      // it extends in order; past the last level nothing is added.
      let previous: string[] = [];
      for (let depth = 1; depth <= up.length + 1; depth++) {
        const current = model.upstream(cell, depth);
        expect(current.slice(0, previous.length), `${cell} depth ${depth}`).toEqual(previous);
        const level = current.slice(previous.length);
        expect(digest([...level].sort()), `${cell} level ${depth}`).toEqual(
          depth <= up.length ? up[depth - 1] : digest([]),
        );
        previous = current;
      }
      expect(model.upstream(cell), `${cell} full closure`).toEqual(previous);
      expect(new Set(previous).size, cell).toBe(previous.length);
      // Downstream: the closure over Model.users in Model.order (= topological order, S22).
      expect(digest(model.downstream(cell)), `${cell} downstream`).toEqual(down);
    }
    expect(kinds).toEqual({ node: 40, input: 10 });
  });

  it('a variable cell no formula reads has no upstream or downstream; other unknown keys throw', () => {
    // Every variable cell the seed provides, read by a formula or not.
    const { values } = resolveInputs(
      bundle,
      seed.variableValues,
      findScenario(seed.scenarios, 'C'),
    );
    const unread = [...values.keys()].filter((k) => !model.index.has(k));
    expect(unread.length).toBeGreaterThan(0);
    for (const k of unread) {
      expect(model.upstream(k), k).toEqual([]);
      expect(model.downstream(k), k).toEqual([]);
    }
    for (const bad of [
      'nope',
      'res.net[x]',
      'line.amount',
      'line.amount[nope]',
      'line.amount[it_001,x]',
    ]) {
      expect(() => model.downstream(bad), bad).toThrow(EngineError);
      expect(() => model.upstream(bad), bad).toThrow(/unknown cell/);
    }
  });
});

describe('dependency queries are views over the CSR (queries.spec.ts)', () => {
  const bundle = bundleOf({
    variables: [{ id: 'i1' }, { id: 'i2' }, { id: 'w', dims: ['d'] }],
    nodes: [
      { id: 'a', expr: 'i1' },
      { id: 'b', expr: 'i2 * 2' },
      { id: 'c', expr: 'a + b' },
      { id: 'd', expr: 'IF(a > 0, c, i2)' },
      { id: 'e', expr: 'MAX(c, d)' },
    ],
  });
  const members = membersOf({ d: ['p', 'q'] });

  it('dependency queries are read-only views over the CSR built in ENG-04 (no second graph)', () => {
    const model = compileModel(bundle, members);
    const g = model.graph;
    const arrays = (x: Adjacency) => [x.depOff, x.depIds, x.userOff, x.userIds].map((a) => [...a]);
    const before = arrays(g);
    const ev = model.evaluate(
      new Map([
        ['i1', 1],
        ['i2', 3],
      ]),
    );

    // Read-only: queries and explain leave the CSR as compile built it.
    for (const k of g.keys) {
      model.upstream(k);
      model.upstream(k, 1);
      model.downstream(k);
    }
    for (const k of model.program.cellKeys) model.explain(k, ev);
    expect(arrays(g)).toEqual(before);
    expect(model.graph).toBe(g);

    // No second graph: the model holds exactly one adjacency (its `graph`), before and after queries.
    const adjacencies = Object.values(model).filter(
      (v) => v !== null && typeof v === 'object' && 'depIds' in v && 'userIds' in v,
    );
    expect(adjacencies).toEqual([g]);

    // Every query follows the CSR it is given: rewire `e` to read `b` only and the answers change.
    const rewired = buildAdjacency(
      g.keys,
      g.nCells,
      model.cells.map((c) => (c.key === 'e' ? ['b'] : c.deps)),
    );
    const view = new EngineModel(
      bundle,
      members,
      model.cells,
      model.program,
      rewired,
      model.diagnostics,
    );
    expect(model.upstream('e')).toEqual(['c', 'd', 'a', 'b', 'i2', 'i1']);
    expect(view.upstream('e')).toEqual(['b', 'i2']);
    expect(model.downstream('i1')).toEqual(['a', 'c', 'd', 'e']);
    expect(view.downstream('i1')).toEqual(['a', 'c', 'd']);
    expect(view.explain('e').inputs.map((r) => r.cell)).toEqual(['b']);
    // Drivers walk the same CSR: in the rewired view, i1 no longer feeds e.
    expect(localSensitivities(model, 'e', ev).map((d) => d.cell)).toEqual(['i2', 'i1']);
    expect(localSensitivities(view, 'e', ev).map((d) => d.cell)).toEqual(['i2']);
  });

  it('a well-formed variable cell that no formula reads is an input with no deps or users', () => {
    const model = compileModel(bundle, members);
    expect(model.index.has('w[p]')).toBe(false);
    expect(model.upstream('w[p]')).toEqual([]);
    expect(model.downstream('w[q]')).toEqual([]);
    for (const bad of ['w', 'w[r]', 'w[p,q]', 'w[]', 'i1[p]', 'a[p]', 'zz']) {
      expect(() => model.downstream(bad), bad).toThrow(/unknown cell/);
    }
  });
});
