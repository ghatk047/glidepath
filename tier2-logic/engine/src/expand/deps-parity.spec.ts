import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadSeedModel, readFixture, repo, type DepsFixture } from '../../test/helpers';
import { expand, type Cell } from './expand';

const fixture = readFixture<DepsFixture>('deps.json');
let cells: Cell[];

beforeAll(async () => {
  const { bundle, seed } = await loadSeedModel();
  cells = expand(bundle, seed.dimensionMembers);
});

describe('dependency parity with engine.py (deps-parity.spec.ts)', () => {
  it('the fixture was generated from the current spec, seed members and engine.py', () => {
    for (const [rel, sha] of Object.entries(fixture.sources)) {
      const actual = createHash('sha256')
        .update(readFileSync(resolve(repo, rel)))
        .digest('hex');
      expect(actual, `${rel} changed: re-run test/fixtures/dump_deps.py`).toBe(sha);
    }
  });

  it('per-cell dependency sets equal Python cdeps for every cell', () => {
    expect(cells).toHaveLength(fixture.cell_count);
    let edges = 0;
    const mismatches: string[] = [];
    for (const cell of cells) {
      const ref = fixture.cells[cell.key];
      if (!ref) {
        mismatches.push(`${cell.key}: not a Python cell`);
        continue;
      }
      const deps = [...cell.deps].sort();
      if (JSON.stringify(deps) !== JSON.stringify(ref.deps)) {
        mismatches.push(`${cell.key}: ${JSON.stringify(deps)} vs ${JSON.stringify(ref.deps)}`);
      }
      expect(new Set(cell.deps).size, cell.key).toBe(cell.deps.length);
      edges += cell.deps.length;
    }
    expect(mismatches.slice(0, 10)).toEqual([]);
    expect(edges).toBe(fixture.edge_count);
    expect(edges).toBe(17843);
  });

  it('cells come in Python expansion order with the expression Model.pick_expr chooses', () => {
    expect(cells.map((c) => c.key)).toEqual(Object.keys(fixture.cells));
    for (const cell of cells) {
      expect(cell.expr, cell.key).toBe(fixture.exprs[fixture.cells[cell.key]!.expr]);
    }
  });
});
