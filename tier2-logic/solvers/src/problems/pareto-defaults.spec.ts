/**
 * The pareto sweep default is spec data: `PARETO_DEFAULTS.sweep` is checked against the text of `solvers.json`
 * `problems[pareto].do` and 04 §2.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readRepoJson, repo } from '../../test/helpers';
import { PARETO_DEFAULTS } from './pareto-defaults';

const pareto = readRepoJson<{ problems: { id: string; do?: string }[] }>('docs/spec/solvers.json').problems.find(
  (p) => p.id === 'pareto',
)!;
const doc = readFileSync(resolve(repo, 'docs/spec/04_solvers_simulation.md'), 'utf8');

describe('SOL-09 defaults: the solvers.json pareto sweep', () => {
  it('bar levels from..to step = solvers.json "100..200 step 5" and 04 §2 "bar = 100…200"', () => {
    const { from, to, step } = PARETO_DEFAULTS.sweep;
    expect(pareto.do).toContain(`over bar levels ${from}..${to} step ${step}`);
    expect(doc).toContain(`over bar = ${from}…${to}`);
  });
});
