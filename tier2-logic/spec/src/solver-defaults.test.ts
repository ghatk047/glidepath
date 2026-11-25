/**
 * MOD-11: the solver constraint defaults tier 2 ships (`src/reference/solver-defaults.ts`) are generated from the
 * prose of docs/spec/solvers.json and fail here when the spec text changes.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { REFERENCE_SOLVER_DEFAULTS, solverDefaultsFor } from './index';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..');
const script = resolve(here, '../scripts/dump_solver_defaults.py');

describe('MOD-11 solver defaults (generated from solvers.json)', () => {
  it('the generated gcc_hiring default matches the solvers.json text', () => {
    const out = execFileSync('python3', ['-I', script, repo, '--json'], { encoding: 'utf8', timeout: 60_000 });
    expect(REFERENCE_SOLVER_DEFAULTS).toEqual(JSON.parse(out));
    expect(REFERENCE_SOLVER_DEFAULTS.gcc_hiring).toBeGreaterThan(0);
  }, 60_000);

  it('records its sources, unchanged since', () => {
    for (const [rel, sha] of Object.entries(REFERENCE_SOLVER_DEFAULTS.sources)) {
      const digest = createHash('sha256').update(readFileSync(resolve(repo, rel))).digest('hex');
      expect(digest, `${rel} changed: regenerate with python3 -I tier2-logic/spec/scripts/dump_solver_defaults.py .`).toBe(sha);
    }
  });

  it('answers its own model version and null for any other', () => {
    expect(solverDefaultsFor(REFERENCE_SOLVER_DEFAULTS.specVersion)).toBe(REFERENCE_SOLVER_DEFAULTS);
    expect(solverDefaultsFor(`${REFERENCE_SOLVER_DEFAULTS.specVersion}-other`)).toBeNull();
  });
});
