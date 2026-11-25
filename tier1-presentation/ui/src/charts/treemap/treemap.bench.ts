/**
 * Treemap layout bench (UI-14): one re-layout of a 415-line `baseline.groups` view must fit in a
 * 60 Hz frame (< 16 ms). Run with `pnpm vitest bench --run src/charts/treemap`.
 */
import type { BaselineGroupsView } from '@glidepath/api-contract';
import { bench, describe } from 'vitest';
import { treemapLayout } from './layout';

type Group = BaselineGroupsView['groups'][number];
const key = (k: string) => k as Group['key'];

const view = (count: number, nGroups: number): BaselineGroupsView => {
  let s = 11;
  const groups: Group[] = Array.from({ length: nGroups }, (_, gi) => ({
    key: key(`g${gi}`),
    label: `Group ${gi}`,
    value: 0,
    lines: [],
  }));
  for (let i = 0; i < count; i++) {
    s = (s * 1664525 + 1013904223) % 4294967296;
    const value = 0.05 + (s / 4294967296) * 40;
    const g = groups[i % nGroups]!;
    g.lines.push({ key: key(`it_${i}`), value });
    g.value = g.value + value;
  }
  return { total: groups.reduce((a, g) => a + g.value, 0), groups };
};

const lines415 = view(415, 12);

describe('treemap layout, 415 lines', () => {
  bench('treemapLayout (squarify, two levels)', () => {
    treemapLayout(lines415);
  });
});
