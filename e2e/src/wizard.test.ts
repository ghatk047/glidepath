import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readRepoJson, repoRoot } from '@glidepath/int';
import type { GoldenFile } from '@glidepath/parity';
import {
  STEP_LABELS,
  TOUR_CHAPTER_STEPS,
  TOUR_STEP_SPECS,
  cellsOfLever,
  expectedInYear,
  goldenLeverInYear,
  leverSliders,
  numberIn,
  registryVariable,
  variableOfCell,
} from './wizard';

const golden = readRepoJson<GoldenFile>('docs', 'spec', 'reference', 'golden_results.json');
const webSrc = (...p: string[]) =>
  readFileSync(join(repoRoot, 'tier1-presentation', 'web', 'src', ...p), 'utf8');

describe('cells of a lever', () => {
  it('strips the member and matches the lever prefix only', () => {
    expect(variableOfCell('lev.L10.shelf[]')).toBe('lev.L10.shelf');
    expect(variableOfCell('lev.start[L03]')).toBe('lev.start');
    const cells = ['lev.L06.gain[]', 'lev.L060.x[]', 'lev.L10.shelf[]', 'lev.start[L06]', 'g.target_net[]'];
    expect(cellsOfLever(cells, 'L06')).toEqual(['lev.L06.gain[]']);
    expect(cellsOfLever(cells, 'L11')).toEqual([]);
  });
});

describe('numberIn', () => {
  it('reads signed money texts and nothing from a dash', () => {
    expect(numberIn('$119.3M')).toBe(119.3);
    expect(numberIn('−$4.9M short')).toBe(-4.9);
    expect(numberIn('$1,007.6M')).toBe(1007.6);
    expect(numberIn('—')).toBeNaN();
  });
});

describe('golden-based expectations', () => {
  it('lever in-year values sum to the preset total', () => {
    const levers = Object.keys(golden.scenarios['C']!['levers' as never] as object);
    expect(levers).toHaveLength(17);
    const total = levers.reduce((s, l) => s + goldenLeverInYear('C', l), 0);
    expect(total).toBeCloseTo(golden.scenarios['C']!['res.tot_iy'] as number, 4);
  });
  it('switching a lever off takes its in-year out of the tape total', () => {
    const tot = golden.scenarios['C']!['res.tot_iy'] as number;
    expect(expectedInYear('C', tot, ['L11'])).toBeCloseTo(tot - goldenLeverInYear('C', 'L11'), 9);
    expect(expectedInYear('C', tot, [])).toBe(tot);
  });
  it('knows the registry controls the Tune step shows', () => {
    expect(leverSliders('L10')).toContain('lev.L10.shelf');
    expect(registryVariable('lev.L10.shelf').step).toBeGreaterThan(0);
    expect(registryVariable('g.ot_out_share').label).not.toBe('');
  });
});

describe('the tour table follows the app source (plan §4.2)', () => {
  const steps = webSrc('global', 'tour', 'steps.ts');
  const defs = [...steps.matchAll(/id: '([a-z]+)',\s+module: (null|'[a-z]+'),\s+anchor: (null|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"),/g)];
  it('has the same 24 ids, screens and anchors in the same order', () => {
    expect(defs).toHaveLength(TOUR_STEP_SPECS.length);
    defs.forEach((m, i) => {
      const spec = TOUR_STEP_SPECS[i]!;
      expect(m[1]).toBe(spec.id);
      expect(m[2] === 'null' ? null : m[2]!.slice(1, -1)).toBe(spec.module);
      expect(m[3] === 'null' ? null : m[3]!.slice(1, -1)).toBe(spec.anchor);
    });
  });
  it('has the chapters of the deep link', () => {
    for (const [chapter, id] of Object.entries(TOUR_CHAPTER_STEPS)) {
      expect(steps).toContain(`${chapter}: '${id}'`);
      expect(TOUR_STEP_SPECS.map((s) => s.id)).toContain(id);
    }
  });
});

describe('the wizard hooks exist in the app source (plan §3.9)', () => {
  it('has the data attributes the specs select', () => {
    const all = ['Stepper', 'StepNav', 'Tape', 'optimizer', 'StepResult', 'StepLevers', 'StepTune']
      .map((f) => webSrc('modules', 'wizard', `${f}.tsx`))
      .join('\n');
    for (const hook of [
      'data-wizard-stepper',
      'data-wizard-tape',
      'data-wizard-optimize',
      'data-wizard-next',
      'data-wizard-back',
      'data-wizard-optimizer',
      'data-wizard-find',
      'data-wizard-use',
      'data-wizard-step="1"',
      'data-wizard-step="2"',
      'data-lever-detail',
      'data-term',
    ]) {
      expect(all, hook).toContain(hook);
    }
    expect(STEP_LABELS).toHaveLength(4);
  });
});

describe('oracle path numbers', () => {
  it('reads the minimum-risk path EPS from the solver demo results', async () => {
    const { demoPathEps27 } = await import('./wizard');
    expect(demoPathEps27()).toBeGreaterThan(0);
  });
});
