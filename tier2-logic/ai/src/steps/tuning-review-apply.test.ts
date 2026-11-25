/* eslint-disable @typescript-eslint/no-explicit-any */
// AI-05: pipeline steps 6-8. The reference tenant seed (docs/spec/seed/aa) goes through the same path a step 3 draft
// takes (drafted sections + copied presets), is validated and calibrated (AI-04), tuned on a fake ModelClient, put in
// a review payload, and applied to an in-memory changeset store (the domain's test store) through a fake port.
// No network, no database.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ChangesetRejectedError } from '@glidepath/domain';
import { compile, type CompiledModel } from '@glidepath/engine';
import type { ModelBundle, TenantMembers } from '@glidepath/spec';
import { loadModelBundleFromDir } from '@glidepath/spec/node';
import { beforeAll, describe, expect, it } from 'vitest';
import { MemoryChangesetStore } from '../../../domain/src/test-support/memory-store';
import { checklistStep } from '../onboarding/checklist';
import { REVIEW_CONFIG } from '../pipeline/catalog';
import { LEVER_TUNING_INSTRUCTIONS } from '../prompts/system';
import type { LeverTuningPromptInput } from '../prompts/render';
import { CalibrationReport } from '../schemas/calibration';
import { FactBase } from '../schemas/facts';
import { LeverTuningDraft } from '../schemas/lever-tuning';
import { ReconfigPlan } from '../schemas/plan';
import { ReconfigReview } from '../schemas/review';
import { assembleSeedDraft, splitSeedDraft, TenantSeedDraft } from '../schemas/seed';
import type { ModelClient, Step, StepRun } from '../step';
import { forbidNetwork } from '../testing/harness';
import { applyDraft, type ApplyTarget, ReconfigApplyError, type ReconfigApplyPort, type ReconfigTenant } from './apply';
import { calibrate, targetsFromFacts } from './calibrate';
import { leverTuningStep, tuneLevers } from './lever-tuning';
import type { StepCall } from './result';
import { leverTuningChangeset, reviewPayload, seedChangeset } from './review';
import { presetsFromSeed, PRESET_SOURCE } from './seed-draft';
import { type SeedDraft, validateDraft } from './validate';

forbidNetwork();

const here = dirname(fileURLToPath(import.meta.url));
const specDir = resolve(here, '../../../../docs/spec');
const seedDir = join(specDir, 'seed', 'aa');
const read = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'));

const ACTOR = '00000000-0000-4000-8000-0000000000a1';
const MODEL_VERSION = '00000000-0000-4000-8000-0000000000f1';
const T0 = '2026-11-23T10:00:00.000Z';

let bundle: ModelBundle;
let model: CompiledModel;
let reference: SeedDraft;
let facts: FactBase;
let plan: ReconfigPlan;
let calibration: Awaited<ReturnType<typeof calibrate>>;
let globalMembers: TenantMembers;

const leverMax = (id: string): number => bundle.variables.find((v) => v.id === id)!.max!;

/** The tuning the fake model proposes: two sound changes, one past its bound, one on a non-lever, one on a missing scenario. */
const proposal = (): LeverTuningDraft => ({
  summary: 'No captive centre of scale: relocation levers start lower.',
  changes: [
    {
      variable: 'lev.L03.pct',
      memberKey: null,
      scenario: null,
      value: 0.2,
      reason: 'No large captive centre, so fewer onshore contractor roles can relocate in year one.',
      factIds: ['f-swb'],
      confidence: 'M',
    },
    {
      variable: 'lev.L03.pct',
      memberKey: null,
      scenario: 'C',
      value: 0.3,
      reason: 'The default scenario relocates less for the same reason.',
      factIds: ['f-swb', 'f-nope'],
      confidence: 'M',
    },
    { variable: 'lev.L04.pct', memberKey: null, scenario: null, value: 5, reason: 'Past the bound.', factIds: [], confidence: 'L' },
    { variable: 'corp.crack', memberKey: 'fy25', scenario: null, value: 1, reason: 'Not a lever.', factIds: [], confidence: 'L' },
    { variable: 'lev.L05.nb', memberKey: null, scenario: 'Z', value: 0.1, reason: 'No such scenario.', factIds: [], confidence: 'L' },
  ],
  openQuestions: ['Is the planned captive centre in scope for the target year?'],
});

const usage = { inputTokens: 100, outputTokens: 20, cacheCreationInputTokens: 0, cacheReadInputTokens: 50 };

/** A ModelClient that answers the lever-tuning step only, and records its inputs. */
function tuningClient(answer: LeverTuningDraft) {
  const inputs: LeverTuningPromptInput[] = [];
  const client: ModelClient = {
    async run<I, O>(step: Step<I, O>, input: I): Promise<StepRun<O>> {
      expect(step).toBe(leverTuningStep);
      inputs.push(input as LeverTuningPromptInput);
      return {
        output: step.output.parse(answer),
        sources: [{ url: 'https://example.com/annual-report', title: 'Annual report', via: ['search'], pageAge: null, retrievedAt: null, citedText: [] }],
        model: 'fake-model',
        fallback: false,
        usage,
        audit: [`ai/job-test/${inputs.length}-${step.id}.json`],
      };
    },
  };
  return { client, inputs };
}

/** An in-memory port: one store, the tenant's transaction restores the tables when `fn` throws. */
class FakePort implements ReconfigApplyPort {
  readonly store = new MemoryChangesetStore({ globalMembers });
  readonly opened: ApplyTarget[] = [];
  leverRows: { line_key: string; lever_code: string }[] = [];

  async inTenant<T>(target: ApplyTarget, fn: (tenant: ReconfigTenant) => Promise<T>): Promise<T> {
    this.opened.push(target);
    const tables = structuredClone(this.store.tables);
    const leverRows = [...this.leverRows];
    try {
      return await fn({
        tenantId: target.kind === 'existing' ? target.tenantId : 'tenant-new',
        modelVersionId: MODEL_VERSION,
        store: this.store,
        writeLeverMappings: async (rows) => {
          this.leverRows.push(...rows);
        },
      });
    } catch (e) {
      this.store.tables = tables;
      this.leverRows = leverRows;
      throw e;
    }
  }

  /** Every write method the store saw. */
  writes(): string[] {
    const reads = new Set(['loadScenarioForUpdate', 'loadScenarios', 'loadInputs', 'loadMembers', 'loadMemberRows', 'loadChangeset', 'findChangesetByClientRequest', 'changesSince', 'lockTenantDefaults', 'findCalcRun']);
    return this.store.methods().filter((m) => !reads.has(m));
  }
}

const ids = (prefix: string) => {
  let n = 0;
  return () => `${prefix}-${++n}`;
};

beforeAll(async () => {
  bundle = await loadModelBundleFromDir(specDir);
  const raw = {
    tenant: read(join(seedDir, 'tenant.json')),
    dimensionMembers: read(join(seedDir, 'dimension_members.json')),
    variableValues: read(join(seedDir, 'variable_values.json')),
    scenarios: read(join(seedDir, 'scenarios.json')),
    leverLibrary: read(join(seedDir, 'lever_library.json')),
  };
  const presets = presetsFromSeed(raw, bundle.variables);
  const drafted = splitSeedDraft(TenantSeedDraft.parse(raw), bundle.variables).filter((s) => checklistStep(s.step).seed.from === 'facts');
  reference = TenantSeedDraft.parse(assembleSeedDraft([...drafted, ...presets.sections], presets));
  model = compile(bundle, reference.dimensionMembers);
  facts = FactBase.parse(read(resolve(here, '../../fixtures/calibration/reference-fy25-facts.json')));
  plan = ReconfigPlan.parse({
    intent: 'onboard',
    tenant: { name: 'Example Air', iataCode: 'ZZ', ticker: null, currency: 'USD', existingTenantId: null },
    baseYear: 2026,
    targetYear: 2027,
    lastReportedYear: 2025,
    produce: ['seed', 'lever_tuning'],
    checklist: ['tenant_record', 'baseline_lines'],
    openQuestions: ['Which fiscal calendar does the request mean?'],
  });
  const noCalls: ModelClient = {
    run: () => {
      throw new Error('the reference draft ties: no repair call');
    },
  };
  calibration = await calibrate(noCalls, { draft: reference, bundle, targets: targetsFromFacts(facts, 2025), facts }, { compile: () => model });
  const dims = new Set(bundle.dimensions.filter((d) => !d.scope.split('+').includes('tenant')).map((d) => d.id));
  globalMembers = Object.fromEntries(Object.entries(reference.dimensionMembers).filter(([dim]) => dims.has(dim)));
}, 120_000);

/** Steps 6-7 for the reference draft: the checked tuning and the review payload. */
async function pipeline(answer = proposal()) {
  const { client, inputs } = tuningClient(answer);
  const tuned = await tuneLevers(client, { promptBar: 'Set up Example Air', plan, facts, seed: calibration.output.draft, bundle });
  const calls: StepCall[] = [...calibration.calls, ...tuned.calls];
  const review = reviewPayload(
    {
      plan,
      facts,
      calls,
      flags: [...calibration.review, ...tuned.review],
      bundle,
      seed: calibration.output.draft,
      validation: validateDraft(calibration.output.draft, bundle, { compile: () => model }),
      calibration: { report: calibration.output.report, openQuestions: ['Is FY2025 opex reported net of special items?'] },
      tuning: tuned.output,
    },
    { compile: () => model },
  );
  return { tuned, review, inputs };
}

describe('AI-05 steps 6-8', { timeout: 120_000 }, () => {
  it('LeverTuningDraft is a separate changeset with reasons (test)', async () => {
    const { tuned, review, inputs } = await pipeline();

    // Step 6 calls the model once with the lever inputs (registry layer `levers`) and their seeded defaults.
    expect(leverTuningStep).toMatchObject({ id: 'lever-tuning', effort: 'high', output: LeverTuningDraft });
    expect(leverTuningStep.system).toContain(LEVER_TUNING_INSTRUCTIONS);
    expect(inputs).toHaveLength(1);
    const levers = inputs[0]!.levers;
    expect(levers.length).toBeGreaterThan(0);
    for (const l of levers) expect(bundle.variables.find((v) => v.id === l.id)!.layer).toBe(REVIEW_CONFIG.tuning.layers[0]);
    expect(levers.find((l) => l.id === 'lev.L03.pct')!.libraryDefault).toBe(reference.variableValues['lev.L03.pct']);
    expect(inputs[0]!.scenarios.map((s) => s.id)).toEqual(reference.scenarios.scenarios.map((s) => s.id));

    // Checked: the sound changes stay with their reasons; the others are dropped and flagged.
    expect(LeverTuningDraft.parse(tuned.output)).toEqual(tuned.output);
    expect(tuned.output.changes.map((c) => [c.variable, c.scenario, c.value])).toEqual([
      ['lev.L03.pct', null, 0.2],
      ['lev.L03.pct', 'C', 0.3],
    ]);
    expect(tuned.output.changes[1]!.factIds).toEqual(['f-swb']);
    const flags = tuned.review.map((f) => [f.kind, f.target]);
    expect(flags).toEqual(
      expect.arrayContaining([
        ['tuning_dropped', 'lev.L04.pct'],
        ['tuning_dropped', 'corp.crack'],
        ['tuning_dropped', 'lev.L05.nb'],
        ['unknown_fact', 'lev.L03.pct'],
      ]),
    );
    expect(tuned.review.every((f) => f.step === REVIEW_CONFIG.tuning.step)).toBe(true);
    expect(tuned.calls.map((c) => c.step)).toEqual(['lever-tuning']);

    // A separate changeset: kind lever_tuning, origin ai_reconfig, one part per scope, each change noted with its reason.
    const cs = leverTuningChangeset(tuned.output);
    expect(cs).toEqual({
      kind: 'lever_tuning',
      parts: [
        { scope: null, origin: 'ai_reconfig', changes: [{ target: 'variable', key: 'lev.L03.pct', member_key: '', op: 'set', new_value: 0.2, note: tuned.output.changes[0]!.reason }] },
        { scope: 'C', origin: 'ai_reconfig', changes: [{ target: 'variable', key: 'lev.L03.pct', member_key: '', op: 'set', new_value: 0.3, note: tuned.output.changes[1]!.reason }] },
      ],
    });
    // ...not part of the seed changeset, which keeps the seeded lever values.
    const seedCs = seedChangeset(calibration.output.draft, bundle);
    expect(review.drafts.lever_tuning!.changeset).toEqual(cs);
    expect(review.drafts.seed!.changeset).toEqual(seedCs);
    for (const part of seedCs.parts) {
      const values = part.scope === null ? reference.variableValues : reference.scenarios.scenarios.find((x) => x.id === part.scope)!.values;
      for (const c of part.changes.filter((x) => x.key === 'lev.L03.pct')) expect(c.new_value).toBe(values['lev.L03.pct']);
    }
    expect(review.drafts.lever_tuning!.tuning!.changes.map((c) => c.reason)).toEqual(tuned.output.changes.map((c) => c.reason));
  });

  it('review payload: plan, sources, open questions, calibration report, both changesets with impact preview (test)', async () => {
    const { review } = await pipeline();
    expect(ReconfigReview.parse(JSON.parse(JSON.stringify(review)))).toEqual(review);

    expect(review.plan).toEqual(plan);
    expect(review.sources.map((s) => s.url)).toContain('https://example.com/annual-report');
    expect(review.sources.find((s) => s.url === 'https://example.com/annual-report')!.seenBy).toEqual(['lever-tuning']);
    expect(review.facts).toEqual(facts.facts);
    expect(review.openQuestions.map((q) => [q.origin, q.question, q.blocking])).toEqual([
      ['plan', 'Which fiscal calendar does the request mean?', false],
      ['calibration', 'Is FY2025 opex reported net of special items?', false],
      ['lever_tuning', 'Is the planned captive centre in scope for the target year?', false],
    ]);
    expect(review.calibration).toEqual(CalibrationReport.parse(calibration.output.report));
    expect(review.calibration!.tied).toBe(true);
    expect(review.validation!.ok).toBe(true);
    expect(review.flags.some((f) => f.kind === 'tuning_dropped')).toBe(true);
    expect(review.usage).toMatchObject({ calls: 1, inputTokens: 100, outputTokens: 20, cacheReadInputTokens: 50 });

    // The tenant the seed creates.
    expect(review.tenant!.record).toEqual(reference.tenant);
    expect(review.tenant!.presets.map((p) => p.key)).toEqual(reference.scenarios.scenarios.map((s) => s.id));
    expect(review.tenant!.leverMappings.length).toBeGreaterThan(0);

    // Seed draft: every member and value, drafted parts with origin ai_reconfig, copied presets with origin seed.
    const seed = review.drafts.seed!;
    expect(seed.kind).toBe('seed');
    const parts = seed.changeset.parts;
    expect(parts.map((p) => [p.scope, p.origin])).toEqual([
      [null, 'ai_reconfig'],
      [null, 'seed'],
      ...reference.scenarios.scenarios.map((s) => [s.id, 'seed']),
    ]);
    const lines = parts[0]!.changes.filter((c) => c.target === 'structural' && c.key === 'line');
    expect(lines).toHaveLength(reference.dimensionMembers.line!.length);
    expect(parts[1]!.changes.filter((c) => c.target === 'variable').every((c) => c.note === PRESET_SOURCE)).toBe(true);
    expect(seed.changes).toBe(parts.reduce((n, p) => n + p.changes.length, 0));
    expect(seed.sections.reduce((n, s) => n + s.changes, 0)).toBe(seed.changes);
    expect(seed.sections.map((s) => s.section)).toEqual(expect.arrayContaining(['baseline_lines', 'org', 'scenarios']));

    // Impact preview: every state, the impact cells; the seed against nothing, the tuning against the seed.
    const scopes = [null, ...reference.scenarios.scenarios.map((s) => s.id)];
    expect(seed.impact.map((i) => i.scope)).toEqual(scopes);
    for (const i of seed.impact) {
      expect(i.error).toBeNull();
      expect(i.rows.map((r) => r.cell)).toEqual(REVIEW_CONFIG.impact.nodes);
      expect(i.rows.every((r) => r.before === null && typeof r.after === 'number')).toBe(true);
    }
    const tuning = review.drafts.lever_tuning!;
    expect(tuning.changes).toBe(2);
    expect(tuning.summary).toBe(proposal().summary);
    expect(tuning.impact.map((i) => i.scope)).toEqual(scopes);
    const net = (scope: string | null) => tuning.impact.find((i) => i.scope === scope)!.rows.find((r) => r.cell === 'res.net')!;
    // C is tuned (lever 3 at 0.3 instead of 0.5): its net moves; A sets its own lever 3 value, so the default's change does not reach it.
    expect(net('C').before).toBe(seed.impact.find((i) => i.scope === 'C')!.rows.find((r) => r.cell === 'res.net')!.after);
    expect(net('C').after).not.toBe(net('C').before);
    expect(net('A').after).toBe(net('A').before);
  });

  it('apply goes through applyChangeset origin=ai_reconfig; tuning only if accepted; nothing written before accept (test)', async () => {
    const { review } = await pipeline();

    // Steps 6-7 wrote nothing: they take no store; the payload is data.
    const untouched = new FakePort();
    expect(untouched.store.calls).toEqual([]);

    // Nothing is written for an accept that cannot apply: no port call at all.
    for (const accept of [[], ['lever_tuning'], ['seed', 'seed']] as const) {
      await expect(applyDraft(untouched, review, { accept, actor: ACTOR, bundle })).rejects.toBeInstanceOf(ReconfigApplyError);
    }
    const failing = structuredClone(review);
    failing.validation = { ok: false, entries: [] };
    await expect(applyDraft(untouched, failing, { accept: ['seed'], actor: ACTOR, bundle })).rejects.toBeInstanceOf(ReconfigApplyError);
    expect(untouched.opened).toEqual([]);
    expect(untouched.store.calls).toEqual([]);

    // Seed only: the tenant is created, every changeset through applyChangeset, no tuning written.
    const seedOnly = new FakePort();
    const r1 = await applyDraft(seedOnly, review, { accept: ['seed'], actor: ACTOR, bundle, newId: ids('s'), now: () => T0 });
    expect(seedOnly.opened).toEqual([{ kind: 'create', record: reference.tenant }]);
    expect(r1.applied.map((a) => [a.kind, a.scope, a.origin])).toEqual(review.drafts.seed!.changeset.parts.map((p) => ['seed', p.scope, p.origin]));
    const stored1 = [...seedOnly.store.tables.changesets.values()];
    expect(stored1.map((c) => c.origin)).toEqual(review.drafts.seed!.changeset.parts.map((p) => p.origin));
    expect(stored1.every((c) => c.created_by === ACTOR)).toBe(true);
    expect(seedOnly.store.tables.audit.filter((a) => a.action === 'changeset.apply')).toHaveLength(stored1.length);
    // Drafted values and the tuned lever as seeded; the presets exist, filled and locked.
    expect(seedOnly.store.inputs(null).defaults.find((r) => r.var_key === 'lev.L03.pct')!.value).toBe(reference.variableValues['lev.L03.pct']);
    expect(seedOnly.store.tables.lineItems.size).toBe(reference.dimensionMembers.line!.length);
    const presets = [...seedOnly.store.tables.scenarios.values()];
    expect(presets.map((s) => [s.key, s.kind, s.locked])).toEqual(reference.scenarios.scenarios.map((s) => [s.id, 'preset', true]));
    expect(seedOnly.store.tables.scenarioValues.get(r1.presets.C!)!.get('lev.L03.pct[]')!.value).toBe(0.5);
    expect(seedOnly.leverRows).toEqual(review.tenant!.leverMappings);

    // Seed and tuning: the tuning is its own changesets, origin ai_reconfig, notes keep the reasons; C tuned in place.
    const both = new FakePort();
    const r2 = await applyDraft(both, review, { accept: ['seed', 'lever_tuning'], actor: ACTOR, bundle, newId: ids('b'), now: () => T0 });
    const tuningApplied = r2.applied.filter((a) => a.kind === 'lever_tuning');
    expect(tuningApplied.map((a) => [a.scope, a.origin, a.result.forkedFrom])).toEqual([
      [null, 'ai_reconfig', undefined],
      ['C', 'ai_reconfig', undefined],
    ]);
    expect(r2.applied.filter((a) => a.origin === 'ai_reconfig').map((a) => a.result.changeset.origin)).toEqual(['ai_reconfig', 'ai_reconfig', 'ai_reconfig']);
    expect(both.store.tables.variableValues.get('lev.L03.pct[]')).toMatchObject({ value: 0.2, note: review.drafts.lever_tuning!.tuning!.changes[0]!.reason });
    expect(both.store.tables.scenarioValues.get(r2.presets.C!)!.get('lev.L03.pct[]')!.value).toBe(0.3);
    const tuningRows = [...both.store.tables.changesets.values()].slice(-2);
    expect(tuningRows.map((c) => [c.origin, c.changes.map((x) => [x.key, x.new_value])])).toEqual([
      ['ai_reconfig', [['lev.L03.pct', 0.2]]],
      ['ai_reconfig', [['lev.L03.pct', 0.3]]],
    ]);
    expect([...both.store.tables.scenarios.values()].every((s) => s.locked)).toBe(true);
    expect(both.store.tables.changesets.size).toBe(seedOnly.store.tables.changesets.size + 2);
  });

  it('a rejected changeset rolls back the whole apply (out-of-bounds value in a tampered payload)', async () => {
    const { review } = await pipeline();
    const tampered = structuredClone(review);
    (tampered.drafts.lever_tuning!.changeset.parts[0]!.changes[0] as any).new_value = 2 * leverMax('lev.L03.pct');
    const port = new FakePort();
    await expect(
      applyDraft(port, tampered, { accept: ['seed', 'lever_tuning'], actor: ACTOR, bundle, newId: ids('t'), now: () => T0 }),
    ).rejects.toBeInstanceOf(ChangesetRejectedError);
    expect(port.store.tables.changesets.size).toBe(0);
    expect(port.store.tables.scenarios.size).toBe(0);
    expect(port.store.tables.variableValues.size).toBe(0);
    expect(port.leverRows).toEqual([]);
  });

  it('tuning an existing tenant: only the tuning is written; a locked preset forks', async () => {
    const { review } = await pipeline();
    const port = new FakePort();
    const created = await applyDraft(port, review, { accept: ['seed'], actor: ACTOR, bundle, newId: ids('e'), now: () => T0 });
    const before = port.store.tables.changesets.size;
    const seen = port.writes().length;

    const tune = structuredClone(review);
    tune.plan = ReconfigPlan.parse({ ...plan, intent: 'tune', produce: ['lever_tuning'], tenant: { ...plan.tenant, existingTenantId: created.tenantId } });
    tune.drafts.seed = null;
    tune.tenant = null;
    await expect(applyDraft(port, tune, { accept: ['seed'], actor: ACTOR, bundle })).rejects.toBeInstanceOf(ReconfigApplyError);
    const r = await applyDraft(port, tune, { accept: ['lever_tuning'], actor: ACTOR, bundle, newId: ids('u'), now: () => T0 });
    expect(port.opened.at(-1)).toEqual({ kind: 'existing', tenantId: created.tenantId });
    expect(r.applied.map((a) => [a.scope, a.origin])).toEqual([
      [null, 'ai_reconfig'],
      ['C', 'ai_reconfig'],
    ]);
    expect(r.applied[1]!.result.forkedFrom).toBe(created.presets.C);
    expect(port.store.tables.changesets.size).toBe(before + 2);
    expect(port.writes().slice(seen)).not.toContain('writeMember');
    expect(port.writes().slice(seen).filter((m) => m === 'createScenario')).toHaveLength(1); // the fork of C
    expect(port.writes().slice(seen).filter((m) => m === 'insertChangeset')).toHaveLength(2);
  });
});
