/**
 * SOL-12 acceptance 1: the decision set and bounds the production solvers use are spec data generated from
 * docs/spec/reference/solvers_demo.py (`src/reference/decision-bounds.ts`), and still match it. The check runs
 * the generator against the unchanged reference and compares its output with the module tier 2 ships.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decisionBoundsFor, REFERENCE_DECISION_BOUNDS } from './index';
import { loadModelBundleFromDir } from './node';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..');
const script = resolve(here, '../scripts/dump_decision_bounds.py');

describe('SOL-12 reference decision bounds (generated from solvers_demo.py)', () => {
  it('generated decision bounds match solvers_demo.py DEC, lo, hi, step and NEG', () => {
    const out = execFileSync('python3', ['-I', script, repo, '--json'], { encoding: 'utf8', timeout: 60_000 });
    const fromReference = JSON.parse(out) as unknown;
    expect(REFERENCE_DECISION_BOUNDS).toEqual(fromReference);
  }, 60_000);

  it('records the sources it was generated from, unchanged since', () => {
    expect(Object.keys(REFERENCE_DECISION_BOUNDS.sources)).toContain('docs/spec/reference/solvers_demo.py');
    for (const [rel, sha] of Object.entries(REFERENCE_DECISION_BOUNDS.sources)) {
      const digest = createHash('sha256').update(readFileSync(resolve(repo, rel))).digest('hex');
      expect(digest, `${rel} changed: regenerate with python3 -I tier2-logic/spec/scripts/dump_decision_bounds.py .`).toBe(sha);
    }
  });

  it('every decision id is a registry variable, with a bound and a step for each', async () => {
    const bundle = await loadModelBundleFromDir(resolve(repo, 'docs/spec'));
    const ids = new Set(bundle.variables.map((v) => v.id));
    const b = REFERENCE_DECISION_BOUNDS;
    expect(b.dec.length).toBeGreaterThan(0);
    expect(new Set(b.dec).size).toBe(b.dec.length);
    for (const id of b.dec) {
      expect(ids.has(id), id).toBe(true);
      expect(b.lo[id]! <= b.hi[id]!, id).toBe(true);
      expect(b.step[id]! > 0, id).toBe(true);
    }
    expect(Object.keys(b.hi).sort()).toEqual([...b.dec].sort());
    expect(b.specVersion).toBe(bundle.specVersion);
  });

  it('decisionBoundsFor answers the bounds of their model version and null for any other', () => {
    expect(decisionBoundsFor(REFERENCE_DECISION_BOUNDS.specVersion)).toBe(REFERENCE_DECISION_BOUNDS);
    expect(decisionBoundsFor(`${REFERENCE_DECISION_BOUNDS.specVersion}-other`)).toBeNull();
  });
});
