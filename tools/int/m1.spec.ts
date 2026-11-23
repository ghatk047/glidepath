import { randomUUID } from 'node:crypto';
import { CellKey, MemberKey, VarKey, WS_PROTOCOL_VERSION as v, toCellKey } from '@glidepath/api-contract';
import type { ApiClient, CalcResponse, CellValues, ChangesetResult, Scenario } from '@glidepath/api-contract';
import { goldenClose, goldenTargets, pyRound } from '@glidepath/parity';
import type { GoldenFile, GoldenTarget } from '@glidepath/parity';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiAs, config, readRepoJson, sessionAs, signIn } from './src/stack';
import type { Browser } from './src/stack';
import type { SessionSocket } from './src/socket';

/**
 * INT-02, M1 exit (09 §1) on the seeded compose stack: what-if sessions over WS, the
 * `applyChangeset` write path behind `POST /changesets`, and the stored calculation of preset C
 * against `docs/spec/reference/golden_results.json` (scenarios.C).
 *
 * Run against a stack that is up and seeded (`docker compose up -d`, or `ops/compose-check.sh --keep`
 * with INT_COMPOSE_PROJECT=glidepath-check): `pnpm int:m1`. Settings: `src/stack.ts`.
 */

const PRESET = 'C';
/** The slider the Cockpit hero moves (spec id, verbatim). */
const TARGET = 'g.target_net';
/** Cockpit headline cells for C (20_orchestrator Loop step 6): net, gap, risk-adjusted, EPS. */
const HEADLINE = ['res.net', 'res.gap', 'res.risk', 'br.eps27'] as const;
/** golden_results.json holds Python round(v, 6) (tier2-logic/engine/PORTING.md §6). */
const GOLDEN_DECIMALS = 6;
/** Preview and commit run the same engine on the same inputs: they agree to float noise. */
const SAME_ENGINE_REL = 1e-12;

interface RegistryVariable {
  id: string;
  min: number | null;
  max: number | null;
  step: number | null;
}

const golden = readRepoJson<GoldenFile>('docs', 'spec', 'reference', 'golden_results.json');
/** Golden cells of C by their wire key (`res.net` → `res.net[]`; `lev.rr[L01]` as is). */
const goldenC: GoldenTarget[] = goldenTargets(golden)
  .filter((t) => t.scenario === PRESET)
  .map((t) => ({ ...t, cell: t.cell.includes('[') ? t.cell : toCellKey(t.cell) }));
const registry = readRepoJson<{ variables: RegistryVariable[] }>('docs', 'spec', 'variables.json');
const targetDef = registry.variables.find((v) => v.id === TARGET);

const cell = (id: string) => toCellKey(id);
const sameEngine = (a: number, b: number) => Math.abs(a - b) <= SAME_ENGINE_REL * Math.max(1, Math.abs(b));

/** Golden cells of C whose value in `values` misses the golden one (absent cells are misses). */
function goldenMisses(values: Readonly<Record<string, number | null>>, targets: readonly GoldenTarget[]) {
  return targets
    .map((t) => ({ cell: t.cell, golden: t.golden, value: values[t.cell] ?? null }))
    .filter((r) => r.value === null || !goldenClose(pyRound(r.value, GOLDEN_DECIMALS), r.golden));
}

const headlineTargets = HEADLINE.map((id) => {
  const t = goldenC.find((g) => g.cell === toCellKey(id));
  if (!t) throw new Error(`golden C has no ${id}`);
  return t;
});

let browser: Browser;
let api: ApiClient;
let presetC: Scenario;
let socket: SessionSocket | undefined;
let committedValue: number;
let previewDelta: CellValues;
let commit: ChangesetResult;
/** Printed for the status note: timings (ms), golden cell counts and the headline values read. */
const timings: Record<string, number> = {};
const counts: Record<string, number> = {};
const headline: Record<string, Record<string, number | undefined>> = {};

const tenantParams = () => ({ tenant: config.tenant });
const calcOf = (id: string): Promise<CalcResponse> =>
  api.scenarioCalc({ params: { tenant: config.tenant, id } });

beforeAll(async () => {
  browser = await signIn();
  api = apiAs(browser);
  const { scenarios } = await api.scenarios({ params: tenantParams() });
  const c = scenarios.find((s) => s.key === PRESET && s.kind === 'preset');
  if (!c) throw new Error(`tenant ${config.tenant} has no preset ${PRESET}`);
  presetC = c;
});

afterAll(async () => {
  await socket?.close();
  console.info(`[m1] timings (ms): ${JSON.stringify(timings)}`);
  console.info(`[m1] golden C cells matched: ${JSON.stringify(counts)}`);
  console.info(`[m1] headline: ${JSON.stringify(headline)}`);
});

describe(`M1 on the seeded stack: preset ${PRESET} (INT-02)`, () => {
  it('the seed holds the five locked presets and preset C is unedited', async () => {
    const { scenarios } = await api.scenarios({ params: tenantParams() });
    const presets = scenarios.filter((s) => s.kind === 'preset').map((s) => s.key);
    expect(presets).toEqual(expect.arrayContaining(Object.keys(golden.scenarios)));
    expect(presetC).toMatchObject({ locked: true, archived: false, editsCount: 0 });
    expect(goldenC.length).toBeGreaterThan(HEADLINE.length);
  });

  it('GET calc of C equals the golden C headline values (net, gap, risk-adjusted, EPS) and every golden C cell it carries', async () => {
    const t0 = performance.now();
    const calc = await calcOf(presetC.id);
    timings.calcGet = Math.round(performance.now() - t0);
    expect(calc).toMatchObject({ scenarioId: presetC.id, scenarioVersion: presetC.version, stale: false });
    expect(goldenMisses(calc.outputs, headlineTargets)).toEqual([]);
    const carried = goldenC.filter((t) => t.cell in calc.outputs);
    expect(goldenMisses(calc.outputs, carried)).toEqual([]);
    counts.calc = carried.length;
    headline.goldenC = Object.fromEntries(headlineTargets.map((t) => [t.cell, t.golden]));
    const calcOut: Readonly<Record<string, number>> = calc.outputs;
    headline.calcC = Object.fromEntries(headlineTargets.map((t) => [t.cell, calcOut[t.cell]]));
  });

  it(`WS session on C: snapshot equals all golden C cells; a preview of ${TARGET} answers a delta`, async () => {
    if (!targetDef || targetDef.min === null || targetDef.max === null || targetDef.step === null) {
      throw new Error(`registry has no bounded ${TARGET}`);
    }
    const inputs = await api.scenarioInputs({ params: { tenant: config.tenant, id: presetC.id } });
    const current = inputs.inputs.find((i) => i.var === TARGET && i.member === '')?.value;
    if (current === undefined || current === null) throw new Error(`C has no value for ${TARGET}`);
    // One registry step along the slider grid, inside [min, max].
    committedValue = current + targetDef.step <= targetDef.max ? current + targetDef.step : current - targetDef.step;
    expect(committedValue).toBeGreaterThanOrEqual(targetDef.min);

    socket = await sessionAs(browser, presetC.id);
    socket.send({ v, type: 'subscribe', cells: [cell(TARGET), ...goldenC.map((t) => CellKey.parse(t.cell))] });
    const snap = await socket.waitFor('snapshot');
    expect(snap).toMatchObject({ scenarioId: presetC.id, version: presetC.version });
    expect(snap.cells[cell(TARGET)]).toBe(current);
    expect(goldenMisses(snap.cells, goldenC)).toEqual([]);
    counts.snapshot = goldenC.length;

    const t0 = performance.now();
    socket.send({
      v,
      type: 'preview',
      seq: 1,
      changes: [{ var: VarKey.parse(TARGET), member: MemberKey.parse(''), value: committedValue }],
    });
    const delta = await socket.waitFor('delta', (d) => d.seq === 1);
    timings.previewRoundTrip = Math.round(performance.now() - t0);
    previewDelta = delta.cells;
    expect(delta.cells[cell(TARGET)]).toBe(committedValue);
    const gap = delta.cells[cell('res.gap')];
    expect(typeof gap).toBe('number');
    expect(gap).not.toBe(snap.cells[cell('res.gap')]);

    // The drag ends: the scratch is dropped and the cells go back to the committed values.
    socket.send({ v, type: 'cancelPreview', seq: 2 });
    const back = await socket.waitFor('delta', (d) => d.seq === 2);
    expect(back.cells[cell(TARGET)]).toBe(current);
    expect(back.cells[cell('res.gap')]).toBe(snap.cells[cell('res.gap')]);
  });

  it('POST /changesets on C persists, forks Custom (from C), recomputes; the session hears the commit', async () => {
    if (!socket) throw new Error('needs the session of the previous step');
    const t0 = performance.now();
    commit = await api.changesetApply({
      params: tenantParams(),
      body: {
        scenarioId: presetC.id,
        baseVersion: presetC.version,
        changes: [{ target: 'variable', key: TARGET, member: '', value: committedValue }],
        clientRequestId: randomUUID(),
      },
    });
    timings.commit = Math.round(performance.now() - t0);

    // Fork: a locked preset is never written; the edit lands on Custom (from C).
    expect(commit.forkedFrom).toBe(presetC.id);
    expect(commit.scenarioId).not.toBe(presetC.id);
    expect(commit.editsCount).toBeGreaterThanOrEqual(1);

    // Recompute: the stored outputs are what the preview showed for the same value.
    const outputs: Readonly<Record<string, number>> = commit.outputs;
    const previewed = Object.entries(previewDelta).filter(([c, v]) => c in outputs && v !== null);
    expect(previewed.length).toBeGreaterThan(0);
    for (const [c, v] of previewed) expect(sameEngine(outputs[c]!, v!), c).toBe(true);
    // Headline cells the preview did not move keep their golden C value.
    const unmoved = headlineTargets.filter((t) => !(t.cell in previewDelta));
    expect(goldenMisses(commit.outputs, unmoved)).toEqual([]);
    headline.fork = {
      [cell(TARGET)]: committedValue,
      ...Object.fromEntries(headlineTargets.map((t) => [t.cell, outputs[t.cell]])),
    };

    // The author's session on C follows the fork and gets the committed cells.
    const notice = await socket.waitFor('changeset');
    expect(notice).toMatchObject({
      scenarioId: commit.scenarioId,
      forkedFrom: presetC.id,
      changesetId: commit.changesetId,
      version: commit.version,
    });
    const pushed = await socket.waitFor('delta', (d) => d.seq === null);
    expect(pushed.cells[cell(TARGET)]).toBe(committedValue);
    expect(sameEngine(pushed.cells[cell('res.gap')]!, commit.outputs[cell('res.gap')]!)).toBe(true);

    // Persisted: the fork, its input, its history and its calc_run are in tier 3.
    const { scenarios } = await api.scenarios({ params: tenantParams() });
    const fork = scenarios.find((s) => s.id === commit.scenarioId);
    expect(fork).toMatchObject({
      kind: 'user',
      parentId: presetC.id,
      locked: false,
      version: commit.version,
      editsCount: commit.editsCount,
    });
    expect(fork?.label).toMatch(new RegExp(`^Custom \\(from ${PRESET}\\)( \\d+)?$`));

    const inputs = await api.scenarioInputs({ params: { tenant: config.tenant, id: commit.scenarioId } });
    expect(inputs.inputs.find((i) => i.var === TARGET && i.member === '')).toMatchObject({
      value: committedValue,
      from: 'scenario',
      fromScenarioId: commit.scenarioId,
    });

    const history = await api.changesetHistory({ params: { tenant: config.tenant, id: commit.scenarioId } });
    const entry = history.changesets.find((c) => c.id === commit.changesetId);
    expect(entry).toMatchObject({ status: 'applied', origin: 'ui' });
    expect(entry?.changes).toEqual([
      expect.objectContaining({ target: 'variable', key: TARGET, member: '', newValue: committedValue }),
    ]);

    const calc = await calcOf(commit.scenarioId);
    expect(calc).toMatchObject({
      scenarioId: commit.scenarioId,
      scenarioVersion: commit.version,
      inputHash: commit.inputHash,
      stale: false,
    });
    expect(calc.outputs).toEqual(commit.outputs);
  });

  it('preset C is untouched by the commit: same version, GET calc still equals golden C', async () => {
    const { scenarios } = await api.scenarios({ params: tenantParams() });
    expect(scenarios.find((s) => s.id === presetC.id)).toMatchObject({
      version: presetC.version,
      editsCount: 0,
      locked: true,
    });
    const calc = await calcOf(presetC.id);
    expect(calc.stale).toBe(false);
    expect(goldenMisses(calc.outputs, headlineTargets)).toEqual([]);
  });
});
