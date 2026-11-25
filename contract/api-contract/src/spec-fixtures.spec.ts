import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { defaultSpecDir, fixturesOutDir, generateSpecFixtures } from '../scripts/generate-fixtures';
import { BundleResponse, MembersResponse, ScenariosResponse, parseServerMessage } from './index';
import { presetSnapshot, specFixtures } from './testing';

const readSpec = <T>(rel: string): T =>
  JSON.parse(readFileSync(join(defaultSpecDir, rel), 'utf8')) as T;
type GoldenScenario = Record<string, number | Record<string, Record<string, number>>>;
const golden = readSpec<{ scenarios: Record<string, GoldenScenario> }>(
  'reference/golden_results.json',
);

const tmpDirs: string[] = [];
afterAll(() => tmpDirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('contract fixtures are generated from docs/spec and golden_results.json (regenerate-and-diff)', () => {
  const generated = generateSpecFixtures();

  it('regenerating gives exactly the files on disk (run `pnpm gen:fixtures` after a spec change)', () => {
    expect(readdirSync(fixturesOutDir).sort()).toEqual([...generated.keys()].sort());
    for (const [name, content] of generated) {
      expect(readFileSync(join(fixturesOutDir, name), 'utf8'), name).toBe(content);
    }
  });

  it('bundle, members and scenarios parse with the CON-01 schemas', () => {
    expect(BundleResponse.safeParse(specFixtures.bundle).success).toBe(true);
    expect(MembersResponse.safeParse(specFixtures.members).success).toBe(true);
    expect(ScenariosResponse.safeParse(specFixtures.scenarios).success).toBe(true);
  });

  it('bundle carries every registry variable and graph node, ids verbatim, no expressions', () => {
    const vars = readSpec<{ variables: { id: string }[] }>('variables.json').variables;
    const graph = readSpec<{ nodes: { id: string }[]; dimensions: { id: string }[] }>(
      'formula_graph.json',
    );
    expect(specFixtures.bundle.variables.map((v) => v.id)).toEqual(vars.map((v) => v.id));
    expect(specFixtures.bundle.nodes.map((n) => n.id)).toEqual(graph.nodes.map((n) => n.id));
    expect(specFixtures.bundle.dimensions.map((d) => d.id)).toEqual(
      graph.dimensions.map((d) => d.id),
    );
    const text = JSON.stringify(specFixtures.bundle);
    expect(text).not.toContain('"expr"');
    expect(text).not.toContain('aa_default');
  });

  it('WEB-10: every corporate % variable is points, g.target_pct is fraction, other units have no scale', () => {
    const vars = specFixtures.bundle.variables;
    const corporatePct = vars.filter((v) => v.layer === 'corporate' && v.unit.startsWith('%'));
    expect(corporatePct.length).toBeGreaterThan(30);
    for (const v of corporatePct) expect([v.id, v.percentScale]).toEqual([v.id, 'points']);
    const byId = (id: string) => vars.find((v) => v.id === id)?.percentScale;
    expect(byId('corp.gdp')).toBe('points');
    expect(byId('g.target_pct')).toBe('fraction');
    for (const v of vars.filter((x) => !x.unit.startsWith('%'))) {
      expect([v.id, v.percentScale]).toEqual([v.id, null]);
    }
    // nodes: the corporate P&L percentages and the two `* 100` ratios are points
    const nodes = specFixtures.bundle.nodes;
    const points = nodes.filter((n) => n.percentScale === 'points').map((n) => n.id);
    expect(points.sort()).toEqual(
      ['br.eps_pct27', 'pl.lf', 'pl.op_margin', 'pl.rate', 'val.px_vs'].sort(),
    );
    expect(nodes.find((n) => n.id === 'res.coverage')?.percentScale).toBe('fraction');
  });

  it('scenarios are the seeded presets, locked', () => {
    const seed = readSpec<{ scenarios: { id: string; label: string }[] }>(
      `seed/${specFixtures.tenant}/scenarios.json`,
    );
    expect(specFixtures.scenarios.scenarios.map((s) => [s.key, s.label])).toEqual(
      seed.scenarios.map((s) => [s.id, s.label]),
    );
    expect(specFixtures.scenarios.scenarios.every((s) => s.kind === 'preset' && s.locked)).toBe(
      true,
    );
  });

  it('snapshot for C is a valid WS snapshot holding every golden C value', () => {
    const c = presetSnapshot('C');
    expect(c).toBe(presetSnapshot());
    expect(parseServerMessage(c).ok).toBe(true);
    const scenarioC = specFixtures.scenarios.scenarios.find((s) => s.key === 'C');
    expect(c.scenarioId).toBe(scenarioC?.id);

    const expected: Record<string, number> = {};
    for (const [k, v] of Object.entries(golden.scenarios.C!)) {
      if (typeof v === 'number') expected[k.includes('[') ? k : `${k}[]`] = v;
      else {
        const prefix = k === 'levers' ? 'lev' : k;
        for (const [member, fields] of Object.entries(v)) {
          for (const [f, n] of Object.entries(fields)) expected[`${prefix}.${f}[${member}]`] = n;
        }
      }
    }
    expect(Object.keys(expected).length).toBeGreaterThan(0);
    for (const [cell, value] of Object.entries(expected)) {
      expect(c.cells[cell], cell).toBe(value);
    }
  });

  it('every preset in golden_results.json has a snapshot', () => {
    expect(Object.keys(specFixtures.snapshots).sort()).toEqual(
      Object.keys(golden.scenarios).sort(),
    );
  });

  it('values follow the spec files, not the code: a changed golden value changes the snapshot', () => {
    const dir = mkdtempSync(join(tmpdir(), 'con04-spec-'));
    tmpDirs.push(dir);
    cpSync(defaultSpecDir, dir, { recursive: true });
    const path = join(dir, 'reference', 'golden_results.json');
    const edited = JSON.parse(readFileSync(path, 'utf8')) as typeof golden;
    const net = edited.scenarios.C!['res.net'] as number;
    edited.scenarios.C!['res.net'] = net + 1;
    writeFileSync(path, JSON.stringify(edited));

    const regenerated = generateSpecFixtures(dir);
    const snapshots = JSON.parse(regenerated.get('snapshots.json')!) as Record<
      string,
      { cells: Record<string, number> }
    >;
    expect(snapshots.C!.cells['res.net[]']).toBe(net + 1);
    expect(regenerated.get('bundle.json')).toBe(generated.get('bundle.json'));
  });
});
