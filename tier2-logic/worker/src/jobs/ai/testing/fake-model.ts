import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checklistStep,
  FactBase,
  type AiConfig,
  type AuditSink,
  LeverTuningDraft,
  loadAiConfig,
  type ModelClient,
  ONBOARDING_CHECKLIST,
  ReconfigPlan,
  type SeedSectionDraft,
  splitSeedDraft,
  type Step,
  type StepRun,
  TenantSeedDraft,
} from '@glidepath/ai';
import type { ModelBundle, TenantSeed } from '@glidepath/spec';
import { findTier3Data, readSeedInputs } from '../../../seed/files';
import type { AiJobDeps, AiSpec } from '../deps';

/**
 * Test support: a ModelClient that answers every pipeline step from the reference tenant's seed (AA) renamed to a
 * neutral airline ("Example Air", `zz`), the way AI-05's tests drive steps 6-8. No network, no key: the audit
 * records it writes stand in for the Claude client's.
 */

export const TEST_KEY = 'sk-ant-test-0000-never-sent-anywhere';
export const NEW_TENANT = 'zz';

const here = dirname(fileURLToPath(import.meta.url));
const aiFixtures = resolve(here, '../../../../../ai/fixtures');

export interface Fixtures {
  readonly spec: AiSpec;
  readonly plan: ReconfigPlan;
  readonly facts: FactBase;
  readonly sections: readonly SeedSectionDraft[];
  readonly tuning: LeverTuningDraft;
}

let cached: Promise<Fixtures> | undefined;

/** Loads the spec bundle and builds the scripted answers once per test file. */
export function loadFixtures(): Promise<Fixtures> {
  cached ??= (async () => {
    const tier3Data = findTier3Data();
    const inputs = await readSeedInputs(tier3Data, 'aa');
    const bundle: ModelBundle = inputs.global.bundle;
    const reference: TenantSeed = inputs.tenant;
    const raw = {
      ...(reference as unknown as Record<string, unknown>),
      tenant: { ...reference.tenant, id: NEW_TENANT, name: 'Example Air', ticker: 'EXA' },
    };
    const drafted = splitSeedDraft(TenantSeedDraft.parse(raw), bundle.variables).filter((s) => checklistStep(s.step).seed.from === 'facts');
    const facts = FactBase.parse(JSON.parse(readFileSync(join(aiFixtures, 'calibration', 'reference-fy25-facts.json'), 'utf8')));
    const plan = ReconfigPlan.parse({
      intent: 'onboard',
      tenant: { name: 'Example Air', iataCode: 'ZZ', ticker: 'EXA', currency: 'USD', existingTenantId: null },
      baseYear: 2026,
      targetYear: 2027,
      lastReportedYear: 2025,
      produce: ['seed', 'lever_tuning'],
      checklist: ONBOARDING_CHECKLIST.steps.map((s) => s.id),
      openQuestions: [],
    });
    const tuning = LeverTuningDraft.parse({
      summary: 'No captive centre of scale: relocation levers start lower.',
      changes: [
        { variable: 'lev.L03.pct', memberKey: null, scenario: null, value: 0.2, reason: 'No large captive centre, so fewer roles can relocate in year one.', factIds: ['f-swb'], confidence: 'M' },
        { variable: 'lev.L03.pct', memberKey: null, scenario: 'C', value: 0.3, reason: 'The default scenario relocates less for the same reason.', factIds: ['f-swb'], confidence: 'M' },
      ],
      openQuestions: [],
    });
    return { spec: { bundle, reference }, plan, facts, sections: drafted, tuning };
  })();
  return cached;
}

export interface FakeModelOptions {
  readonly jobId: string;
  readonly audit: AuditSink;
  /** Tokens each call reports as input (output is a tenth). */
  readonly tokensPerCall?: number;
  /** Called before each call answers; may throw. */
  readonly onCall?: (stepId: string, callNumber: number) => Promise<void> | void;
}

export interface FakeModel extends ModelClient {
  readonly calls: string[];
}

const encoder = new TextEncoder();

export function fakeModel(f: Fixtures, o: FakeModelOptions): FakeModel {
  const calls: string[] = [];
  const answer = (step: Step<never, unknown>, input: unknown): unknown => {
    if (step.id === 'scope') return f.plan;
    if (step.id === 'research') return f.facts;
    if (step.id === 'lever-tuning') return f.tuning;
    if (step.id.startsWith('seed-')) {
      const want = (input as { step: string }).step;
      const section = f.sections.find((s) => s.step === want);
      if (section === undefined) throw new Error(`fake model: no section ${want}`);
      return section;
    }
    throw new Error(`fake model: no answer for step ${step.id}`);
  };
  return {
    calls,
    async run<I, O>(step: Step<I, O>, input: I): Promise<StepRun<O>> {
      calls.push(step.id);
      await o.onCall?.(step.id, calls.length);
      const key = `${o.jobId}/${String(calls.length).padStart(3, '0')}-${step.id}-response.json`;
      await o.audit.put('ai', key, encoder.encode(JSON.stringify({ step: step.id })), { contentType: 'application/json' });
      const tokens = o.tokensPerCall ?? 1000;
      return {
        output: step.output.parse(answer(step as never, input)),
        sources: [{ url: 'https://example.com/annual-report', title: 'Annual report', via: ['search'], pageAge: null, retrievedAt: null, citedText: [] }],
        model: 'claude-opus-5-5',
        fallback: false,
        usage: { inputTokens: tokens, outputTokens: Math.ceil(tokens / 10), cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
        audit: [`ai/${key}`],
      };
    },
  };
}

export const testConfig = (env: Record<string, string> = {}): AiConfig => loadAiConfig({ ANTHROPIC_API_KEY: TEST_KEY, ...env });

export interface TestDepsOptions {
  readonly env?: Record<string, string>;
  readonly tokensPerCall?: number;
  readonly onCall?: FakeModelOptions['onCall'];
  /** Where the fake model of the latest job is kept, for assertions. */
  readonly models?: FakeModel[];
  readonly overrides?: Partial<AiJobDeps>;
  readonly clock?: () => Date;
}

let idCounter = 0;

/** `AiJobDeps` with the fake model; `objects` and `db` come from the test (they need a database). */
export function testDeps(f: Fixtures, o: TestDepsOptions = {}): AiJobDeps {
  const env = { ANTHROPIC_API_KEY: TEST_KEY, ...(o.env ?? {}) };
  return {
    env,
    spec: async () => f.spec,
    config: () => loadAiConfig(env),
    client: ({ jobId, audit }) => {
      const m = fakeModel(f, { jobId, audit, ...(o.tokensPerCall === undefined ? {} : { tokensPerCall: o.tokensPerCall }), ...(o.onCall === undefined ? {} : { onCall: o.onCall }) });
      o.models?.push(m);
      return m;
    },
    objects: () => {
      throw new Error('testDeps: objects() is provided by the test');
    },
    db: () => {
      throw new Error('testDeps: db() is provided by the test');
    },
    now: o.clock ?? (() => new Date('2026-11-23T10:00:00.000Z')),
    newId: () => `00000000-0000-4000-8000-${(0xc0000 + ++idCounter).toString(16).padStart(12, '0')}`,
    ...(o.overrides ?? {}),
  };
}
