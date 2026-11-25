/* eslint-disable @typescript-eslint/no-explicit-any */
// AI-04: pipeline steps 4-5. The reference tenant seed (docs/spec/seed/aa) is put through the same path a step 3
// draft takes (drafted sections + copied presets, assembled and parsed), then validated and calibrated against its
// own last-reported-year figures (fixtures/calibration/reference-fy25-facts.json, each fact quoting the registry note
// it comes from). No network: the repair round runs on a fake ModelClient.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile, type CompiledModel } from '@glidepath/engine';
import type { ModelBundle } from '@glidepath/spec';
import { loadModelBundleFromDir } from '@glidepath/spec/node';
import { beforeAll, describe, expect, it } from 'vitest';
import { CALIBRATION } from '../calibration/catalog';
import { checklistStep } from '../onboarding/checklist';
import { CALIBRATION_REPAIR_INSTRUCTIONS } from '../prompts/system';
import type { CalibrationRepairPromptInput } from '../prompts/render';
import { CalibrationReport, ValidationReport, type CalibrationRepair, type CalibrationTarget } from '../schemas/calibration';
import { FactBase } from '../schemas/facts';
import { assembleSeedDraft, splitSeedDraft, TenantSeedDraft } from '../schemas/seed';
import type { ModelClient, Step, StepRun } from '../step';
import { forbidNetwork } from '../testing/harness';
import { calibrate, calibrationRepairStep, CalibrationSetupError, checkInvariants, lastReportedYear, targetsFromFacts } from './calibrate';
import { presetsFromSeed, PRESET_SOURCE } from './seed-draft';
import { type SeedDraft, validateDraft } from './validate';

forbidNetwork();

const here = dirname(fileURLToPath(import.meta.url));
const specDir = resolve(here, '../../../../docs/spec');
const seedDir = join(specDir, 'seed', 'aa');
const read = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'));

let bundle: ModelBundle;
let reference: SeedDraft;
let facts: FactBase;
let targets: CalibrationTarget[];

beforeAll(async () => {
  bundle = await loadModelBundleFromDir(specDir);
  const raw = {
    tenant: read(join(seedDir, 'tenant.json')),
    dimensionMembers: read(join(seedDir, 'dimension_members.json')),
    variableValues: read(join(seedDir, 'variable_values.json')),
    scenarios: read(join(seedDir, 'scenarios.json')),
    leverLibrary: read(join(seedDir, 'lever_library.json')),
  };
  // As step 3 builds a draft: the fact sections (here: the reference seed's own) and the presets copied.
  const presets = presetsFromSeed(raw, bundle.variables);
  const drafted = splitSeedDraft(TenantSeedDraft.parse(raw), bundle.variables).filter((s) => checklistStep(s.step).seed.from === 'facts');
  reference = TenantSeedDraft.parse(assembleSeedDraft([...drafted, ...presets.sections], presets));
  facts = FactBase.parse(read(resolve(here, '../../fixtures/calibration/reference-fy25-facts.json')));
  targets = targetsFromFacts(facts, 2025);
});

/** A deep copy of the reference draft, changed by `edit`. */
function mutated(edit: (d: { -readonly [K in keyof SeedDraft]: any }) => void): SeedDraft {
  const d = structuredClone(reference) as any;
  edit(d);
  return d as SeedDraft;
}

const errorsOf = (r: ValidationReport) => r.entries.filter((e) => e.severity === 'error');

/** A ModelClient that answers the repair step from a script and records its inputs; any other step fails the test. */
function fakeClient(answers: CalibrationRepair[]) {
  const inputs: CalibrationRepairPromptInput[] = [];
  const client: ModelClient = {
    async run<I, O>(step: Step<I, O>, input: I): Promise<StepRun<O>> {
      expect(step).toBe(calibrationRepairStep);
      inputs.push(input as CalibrationRepairPromptInput);
      const output = answers.shift();
      if (!output) throw new Error('fake client: no scripted answer left');
      return {
        output: step.output.parse(output),
        sources: [],
        model: 'fake-model',
        fallback: false,
        usage: { inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
        audit: [`ai/job-test/${inputs.length}-${step.id}.json`],
      };
    },
  };
  return { client, inputs };
}

const noCalls: ModelClient = {
  run: () => {
    throw new Error('the model must not be called when the draft ties');
  },
};

// Each validation compiles the draft and evaluates six states; slow under a parallel turbo run.
describe('AC1 validate runs VR01-VR10, registry bounds and member integrity on the draft', { timeout: 60_000 }, () => {
  it('validate runs VR01–VR10, registry bounds and member integrity on the draft (test: aa seed clean; mutated seed reports each error)', () => {
    // Clean: no error on the tenant defaults or any preset; only preset values past a registry max warn (VR04, as the seed writes them).
    const clean = validateDraft(reference, bundle);
    expect(ValidationReport.parse(clean)).toEqual(clean);
    expect(clean.ok).toBe(true);
    expect(errorsOf(clean)).toEqual([]);
    expect(new Set(clean.entries.map((e) => e.check))).toEqual(new Set(['VR04']));
    for (const e of clean.entries) {
      const varId = e.cells[0]!.slice(0, e.cells[0]!.indexOf('['));
      expect(reference.provenance?.find((p) => p.target === varId)?.source).toBe(PRESET_SOURCE);
    }

    const share = (d: any, key: string) => d.variableValues['org.dom_share'][key] as number;
    const cases: { check: string; edit: (d: any) => void; cell?: string }[] = [
      { check: 'VR01', cell: 'org.dom_share[commercial_applications,vp_operations]', edit: (d) => (d.variableValues['org.dom_share']['commercial_applications,vp_operations'] = share(d, 'commercial_applications,vp_operations') + 0.2) },
      { check: 'VR02', edit: (d) => (d.variableValues['org.ss_flag'] = Object.fromEntries(Object.keys(d.variableValues['org.ss_flag']).map((k) => [k, 0]))) },
      {
        check: 'VR03',
        edit: (d) => {
          d.variableValues['org.usage_override_on'] = 1;
          d.variableValues['org.usage_override'] = Object.fromEntries(Object.keys(d.variableValues['org.usage_override']).map((k) => [k, 0.5]));
        },
      },
      // A drafted value past its registry bound is an error (BOUNDS_POLICY.ai_reconfig rejects it).
      { check: 'VR04', cell: 'corp.crack[fy25]', edit: (d) => (d.variableValues['corp.crack'].fy25 = 2 * bundle.variables.find((v) => v.id === 'corp.crack')!.max!) },
      { check: 'VR05', cell: 'lv.ms0[]', edit: (d) => (d.variableValues['hc.ctr'] = 2 * bundle.variables.find((v) => v.id === 'hc.ctr')!.max!) },
      {
        check: 'VR06',
        edit: (d) => {
          d.variableValues['lev.L09.split_sw'] = 0.7;
          d.variableValues['lev.L09.split_cloud'] = 0.6;
        },
      },
      { check: 'VR07', edit: (d) => (d.variableValues['portfolio.apps'] = d.variableValues['lev.L09.n'] - 1) },
      { check: 'VR08', cell: 'vp.check[]', edit: (d) => (d.variableValues['org.dom_share']['commercial_applications,vp_operations'] = 0.2) },
      { check: 'VR09', cell: 'line[it_001]', edit: (d) => (d.dimensionMembers.line[0].domain = 'no_such_domain') },
      { check: 'VR10', cell: 'corp.asm_g[fy27]', edit: (d) => delete d.variableValues['corp.asm_g'].fy27 },
      // Member integrity: unknown dimension, unknown variable, bad member key, broken member reference.
      { check: 'members', cell: 'zz_extra', edit: (d) => (d.dimensionMembers.zz_extra = [{ id: 'x' }]) },
      { check: 'members', cell: 'no.such_var[]', edit: (d) => (d.variableValues['no.such_var'] = 1) },
      { check: 'members', cell: 'corp.lf[fy99]', edit: (d) => (d.variableValues['corp.lf'].fy99 = 80) },
      { check: 'members', cell: 'year/fy26', edit: (d) => (d.dimensionMembers.year[1].prev = 'fy00') },
      { check: 'members', cell: 'lgroup', edit: (d) => (d.dimensionMembers.lgroup = []) },
    ];
    for (const c of cases) {
      const report = validateDraft(mutated(c.edit), bundle);
      expect(report.ok, c.check).toBe(false);
      const hits = errorsOf(report).filter((e) => e.check === c.check);
      expect(hits.length, `${c.check} reported`).toBeGreaterThan(0);
      if (c.cell) expect(hits.flatMap((e) => e.cells), c.check).toContain(c.cell);
      for (const e of hits) expect(e.message.length, c.check).toBeGreaterThan(0);
    }
  });

  it('an entry identical in several states is listed once with its scopes; a scenario value past a bound only warns', () => {
    const report = validateDraft(
      mutated((d) => {
        d.variableValues['corp.crack'].fy25 = 1000;
        d.scenarios.scenarios[0].values['hc.ctr'] = 5000;
      }),
      bundle,
    );
    const crack = report.entries.find((e) => e.cells.includes('corp.crack[fy25]'))!;
    expect(crack.severity).toBe('error');
    expect(crack.scopes).toEqual([null, ...reference.scenarios.scenarios.map((s) => s.id)]);
    const ctr = report.entries.find((e) => e.check === 'VR04' && e.cells.includes('hc.ctr[]'))!;
    expect(ctr.severity).toBe('warning');
    expect(ctr.scopes).toEqual([reference.scenarios.scenarios[0]!.id]);
  });

  it('a draft the engine cannot compile is an engine error, not a throw', () => {
    const report = validateDraft(reference, bundle, {
      compile: () => {
        throw new Error('boom');
      },
    });
    expect(errorsOf(report).map((e) => [e.check, e.message])).toEqual([['engine', 'The draft does not compile: boom']]);
  });
});

describe('AC2 calibrate ties the last reported year within 1%, with one repair round on a miss', { timeout: 60_000 }, () => {
  it('targetsFromFacts takes one figure per metric of the reported year, by alias, converted to $M', () => {
    expect(targets.map((t) => t.metric)).toEqual(CALIBRATION.metrics.map((m) => m.id));
    const byMetric = Object.fromEntries(targets.map((t) => [t.metric, t]));
    expect(byMetric.revenue!.factIds).toEqual(['f-rev']); // not passenger revenue, not the prior year
    expect(byMetric.cash!.value).toBeCloseTo(5836, 9); // USD bn → $M
    expect(targetsFromFacts(facts, 2024).map((t) => t.metric)).toEqual(['revenue']);
    expect(lastReportedYear(reference.dimensionMembers).id).toBe('fy25');
    expect(() => lastReportedYear({ year: [] })).toThrow(CalibrationSetupError);
  });

  it('calibrate rebuilds the last reported fiscal year with the engine and ties revenue, fuel, SWB, opex, EBIT, interest, net income, OCF, FCF, cash, net debt within 1%; on a miss one repair round with residuals (test: aa seed ties against its own FY25 corp inputs; perturbed seed triggers repair via fake client)', async () => {
    // The reference seed ties against its own FY2025 figures; the model is never called.
    const tied = await calibrate(noCalls, { draft: reference, bundle, targets });
    const report = CalibrationReport.parse(tied.output.report);
    expect(report.year).toBe('fy25');
    expect(report.tolerance).toBe(CALIBRATION.tolerance);
    expect(report.rounds).toHaveLength(1);
    expect(report.rounds[0]!.metrics.map((m) => [m.metric, m.cell, m.status])).toEqual(
      CALIBRATION.metrics.map((m) => [m.id, `${m.node}[fy25]`, 'tied']),
    );
    for (const m of report.rounds[0]!.metrics) expect(Math.abs(m.relative!)).toBeLessThanOrEqual(0.01);
    expect(report.tied).toBe(true);
    expect(tied.calls).toEqual([]);
    expect(tied.review).toEqual([]);
    expect(tied.output.draft).toBe(reference);
    expect(tied.output.validation).toBeNull();

    // Perturbed: passenger yield 5% high, so revenue (and what follows from it) misses. One repair round on a fake
    // client restores it; a change to a non-corporate variable is dropped and flagged.
    const yield25 = reference.variableValues['corp.yield25'] as number;
    const perturbed = mutated((d) => (d.variableValues['corp.yield25'] = yield25 * 1.05));
    const fake = fakeClient([
      {
        changes: [
          { variable: 'corp.yield25', scalar: yield25, perMember: null, reason: 'Revenue is 4.5% high; yield back to the reported 19.83 cents.', source: 'f-rev', confidence: 'H', factIds: ['f-rev'] },
          { variable: 'hc.us', scalar: 1, perMember: null, reason: 'not allowed', source: null, confidence: 'L', factIds: [] },
        ],
        openQuestions: ['Is cargo revenue reported net of mail?'],
      },
    ]);
    const repaired = await calibrate(fake.client, { draft: perturbed, bundle, targets, facts, promptBar: 'Set up Example Air' });
    expect(fake.inputs).toHaveLength(1);
    const sent = fake.inputs[0]!;
    expect(sent.calibration).toEqual({ year: 'fy25', label: 'FY2025A', tolerance: CALIBRATION.tolerance });
    const revenue = (sent.residuals as { metric: string; status: string; residual: number }[]).find((r) => r.metric === 'revenue')!;
    expect(revenue.status).toBe('miss');
    expect(revenue.residual).toBeGreaterThan(0);
    expect(sent.variables.every((v) => v.id.startsWith('corp.'))).toBe(true);
    expect(sent.variables.find((v) => v.id === 'corp.yield25')!.value).toBe(yield25 * 1.05);
    expect(sent.facts).toBe(facts);

    const r = repaired.output.report;
    expect(r.rounds.map((x) => x.tied)).toEqual([false, true]);
    expect(r.rounds[0]!.metrics.find((m) => m.metric === 'revenue')!.status).toBe('miss');
    expect(r.tied).toBe(true);
    expect(r.repair).toEqual([{ variable: 'corp.yield25', memberKey: '', from: yield25 * 1.05, to: yield25, reason: expect.any(String) }]);
    expect(repaired.output.draft.variableValues['corp.yield25']).toBe(yield25);
    expect(repaired.output.draft.provenance?.find((p) => p.target === 'corp.yield25')).toEqual({ target: 'corp.yield25', source: 'f-rev', confidence: 'H', factIds: ['f-rev'] });
    expect(perturbed.variableValues['corp.yield25']).toBe(yield25 * 1.05); // input draft untouched
    expect(repaired.output.validation!.ok).toBe(true);
    expect(repaired.output.openQuestions).toEqual(['Is cargo revenue reported net of mail?']);
    expect(repaired.review.map((f) => [f.kind, f.target])).toEqual([['repair_dropped', 'hc.us']]);
    expect(repaired.calls.map((c) => [c.step, c.model])).toEqual([['calibration-repair', 'fake-model']]);

    // A repair that does not close the gap: still exactly one round, and every miss is flagged for review.
    const stuck = fakeClient([{ changes: [], openQuestions: [] }, { changes: [], openQuestions: [] }]);
    const missed = await calibrate(stuck.client, { draft: perturbed, bundle, targets });
    expect(stuck.inputs).toHaveLength(1);
    expect(missed.output.report.rounds).toHaveLength(2);
    expect(missed.output.report.tied).toBe(false);
    const flagged = missed.review.filter((f) => f.kind === 'calibration_miss').map((f) => f.target);
    expect(flagged).toContain('pl.rev[fy25]');
    expect(flagged).toEqual(missed.output.report.rounds[1]!.metrics.filter((m) => m.status === 'miss').map((m) => m.cell));
  });

  it('a metric with no reported figure is missing, flagged and not repaired', async () => {
    const res = await calibrate(noCalls, { draft: reference, bundle, targets: targets.filter((t) => t.metric !== 'fcf') });
    const fcf = res.output.report.rounds[0]!.metrics.find((m) => m.metric === 'fcf')!;
    expect([fcf.status, fcf.reported, fcf.residual]).toEqual(['missing', null, null]);
    expect(res.output.report.tied).toBe(false);
    expect(res.review.map((f) => [f.kind, f.target])).toEqual([['calibration_miss', 'pl.fcf[fy25]']]);
  });

  it('the repair step is a structured-output call with effort high and its own instructions', () => {
    expect(calibrationRepairStep.effort).toBe('high');
    expect(calibrationRepairStep.system).toContain(CALIBRATION_REPAIR_INSTRUCTIONS);
    expect(calibrationRepairStep.tools).toBeUndefined();
  });
});

describe('AC3 invariants of 06 §4', { timeout: 60_000 }, () => {
  it('invariants: pool effects sum to run-rate, VP nets sum to total, FY27 base vs FY27+IT revenue identical (test)', () => {
    // Hold on the tenant defaults and on every preset of the reference seed.
    const ok = checkInvariants(reference, bundle);
    const scopes = [null, ...reference.scenarios.scenarios.map((s) => s.id)];
    expect(ok.map((i) => [i.id, i.scope])).toEqual(scopes.flatMap((s) => CALIBRATION.invariants.map((inv) => [inv.id, s])));
    expect(ok.every((i) => i.holds)).toBe(true);

    // Each one breaks on a draft built to break it.
    const failing = (draft: SeedDraft, opts = {}) =>
      checkInvariants(draft, bundle, opts).filter((i) => !i.holds && i.scope === null).map((i) => i.id);

    // Pool effects: an engine whose lev.rr_check[L01] is off (the formula ties it, so the check is on the engine).
    const leaky = (b: ModelBundle, m: SeedDraft['dimensionMembers']): CompiledModel => {
      const model = compile(b, m);
      return {
        evaluate: (values: ReadonlyMap<string, number>, overrides?: ReadonlyMap<string, number>) => {
          const ev = model.evaluate(values, overrides);
          return { ...ev, get: (c: string) => (c === 'lev.rr_check[L01]' ? 1 : ev.get(c)), has: (c: string) => ev.has(c) };
        },
      } as unknown as CompiledModel;
    };
    expect(failing(reference, { compile: leaky })).toEqual(['pool_effects']);

    // VP nets: a domain owned 120%, so lever shares leak across VPs.
    const vpLeak = mutated((d) => (d.variableValues['org.dom_share']['commercial_applications,vp_operations'] = 0.2));
    expect(failing(vpLeak)).toContain('vp_nets');

    // Base vs IT revenue: the IT column rolls forward from the reported year instead of the year before it, so the
    // two columns of the same input year no longer carry the same revenue.
    const rolled = mutated((d) => {
      const it = d.dimensionMembers.year.find((y: any) => y.it === 1);
      it.prev = lastReportedYear(d.dimensionMembers).id;
    });
    const broken = checkInvariants(rolled, bundle).filter((i) => !i.holds && i.scope === null);
    expect(broken.map((i) => [i.id, i.failing.map((f) => f.cell)])).toEqual([['base_vs_it_revenue', ['pl.rev[fy27b]', 'pl.rev[fy27it]']]]);
  });

  it('a broken invariant fails the calibration and is flagged for review', async () => {
    const vpLeak = mutated((d) => (d.variableValues['org.dom_share']['commercial_applications,vp_operations'] = 0.2));
    const res = await calibrate(noCalls, { draft: vpLeak, bundle, targets });
    expect(res.output.report.rounds[0]!.tied).toBe(true);
    expect(res.output.report.tied).toBe(false);
    expect(res.review.some((f) => f.kind === 'invariant_broken' && f.target === 'vp_nets')).toBe(true);
  });
});
