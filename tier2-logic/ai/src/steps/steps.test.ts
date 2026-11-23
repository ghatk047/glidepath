/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ModelBundle } from '@glidepath/spec';
import { loadModelBundleFromDir } from '@glidepath/spec/node';
import { beforeAll, describe, expect, it } from 'vitest';
import { outputFormat } from '../client';
import { ModelOutputError } from '../errors';
import { checklistStep, ONBOARDING_CHECKLIST } from '../onboarding/checklist';
import type { ScopePromptInput } from '../prompts/render';
import { systemBlocks } from '../prompts/system';
import { FactBase } from '../schemas/facts';
import { ReconfigPlan } from '../schemas/plan';
import { SeedSectionDraft, TENANT_TARGET, TenantSeedDraft } from '../schemas/seed';
import type { Source } from '../sources';
import { loadExchanges } from '../testing/fake-transport';
import { forbidNetwork, harness } from '../testing/harness';
import { checkFactSources, research } from './research';
import { reviewPlan, scope } from './scope';
import { type DraftSeedPresets, draftSeed, PRESET_SOURCE, presetsFromSeed, seedSectionPlans } from './seed-draft';

forbidNetwork();

const here = dirname(fileURLToPath(import.meta.url));
const specDir = resolve(here, '../../../../docs/spec');

let bundle: ModelBundle;
beforeAll(async () => {
  bundle = await loadModelBundleFromDir(specDir);
});

const PROMPT_BAR = 'Set up Example Air (ZZ) and propose lever tuning.';
const AR = 'https://investors.example.com/annual-report-2025';
const NEWS = 'https://news.example.org/example-air-results';

const scopeInput: ScopePromptInput = {
  promptBar: PROMPT_BAR,
  today: '2026-11-23',
  defaults: { baseYear: 2026, targetYear: 2027 },
  existingTenants: [{ id: 'yy', name: 'Sample Airways', iataCode: 'YY' }],
};

const answerOf = (fixture: string, exchange = 0): any => {
  const events = (loadExchanges(fixture)[exchange] as { events: any[] }).events;
  const last = events.filter((e) => e.type === 'content_block_start' && e.content_block.type === 'text').at(-1).index;
  return JSON.parse(
    events
      .filter((e) => e.type === 'content_block_delta' && e.index === last && e.delta.type === 'text_delta')
      .map((e) => e.delta.text)
      .join(''),
  );
};

const plan = (): ReconfigPlan => ReconfigPlan.parse(answerOf('steps/scope-onboard'));
/** The checked fact base, as step 2 hands it on. */
const checkedFacts = async (): Promise<FactBase> => {
  const h = harness(loadExchanges('steps/research-sourced'));
  return (await research(h.client, { promptBar: PROMPT_BAR, plan: plan() })).output;
};

/** Neutral global presets: one lever, one scenario. */
const presets = (): DraftSeedPresets => ({
  scenarios: {
    tenant: 'ref',
    default_scenario: 'C',
    scenarios: [{ id: 'C', label: 'C. Balanced', values: { 'lev.L01.cut': 0.1 } }],
  },
  leverLibrary: { levers: [{ id: 'L01', label: 'Demand management' }] },
  sections: [
    {
      step: 'scenarios',
      tenant: null,
      dimensions: [{ dim: 'lever', members: [{ id: 'L01', attrs: [{ name: 'label', value: 'Demand management' }] }] }],
      values: [
        { variable: 'lev.L01.cut', scalar: 0.1, perMember: null, source: PRESET_SOURCE, confidence: 'M', factIds: [] },
      ],
    },
  ],
});

const WORKED_EXAMPLE = JSON.stringify([
  { step: 'workforce', tenant: null, dimensions: [], values: [{ variable: 'hc.ctr', scalar: 700, perMember: null, source: 'example', confidence: 'M', factIds: [] }] },
]);

const promptOf = (req: any): string => req.body.messages[0].content;
const systemOf = (req: any): string[] => req.body.system.map((b: any) => b.text);

describe('AC1 step 1 → ReconfigPlan (medium), step 2 → FactBase with web search/fetch and citations (high), step 3 → TenantSeedDraft by seed section (high), recorded responses', () => {
  it('scope(): one structured call at effort medium, no tools, cached checklist prefix, prompt bar quoted last', async () => {
    const h = harness(loadExchanges('steps/scope-onboard'));
    const result = await scope(h.client, scopeInput);

    expect(result.output).toEqual(plan());
    expect(result.review).toEqual([]);
    expect(h.requests).toHaveLength(1);
    const body = h.requests[0]!.body;
    expect(body.output_config).toEqual({ effort: 'medium', format: outputFormat(ReconfigPlan) });
    expect(body.thinking).toEqual({ type: 'adaptive' });
    expect(body).not.toHaveProperty('tools');
    expect(systemOf(h.requests[0])).toEqual([...systemBlocks('scope')]);
    expect(body.system.at(-1).cache_control).toEqual({ type: 'ephemeral' });
    expect(promptOf(h.requests[0])).toContain('<prompt_bar>\nSet up Example Air (ZZ) and propose lever tuning.\n</prompt_bar>');
    expect(result.calls.map((c) => c.step)).toEqual(['scope']);
    expect(result.calls[0]!.audit).toEqual(['ai/job-0001/001-scope-response-1.json', 'ai/job-0001/001-scope-sources.json']);
  });

  it('reviewPlan() flags an onboarding plan that leaves out checklist steps', () => {
    const partial = { ...plan(), checklist: ['tenant_record', 'baseline_lines'] };
    expect(reviewPlan(partial).map((f) => `${f.kind}:${f.step}`)).toEqual(
      ONBOARDING_CHECKLIST.steps.slice(2).map((s) => `incomplete_checklist:${s.id}`),
    );
    expect(reviewPlan({ ...partial, intent: 'tune', produce: ['lever_tuning'], tenant: { ...partial.tenant, existingTenantId: 'zz' } })).toEqual([]);
  });

  it('research(): effort high, web_search_20260209 + web_fetch_20260209 (auto), pause_turn resumed, citations kept as sources', async () => {
    const h = harness(loadExchanges('steps/research-sourced'));
    const result = await research(h.client, { promptBar: PROMPT_BAR, plan: plan() }, { maxSearches: 8, maxFetches: 4 });

    expect(h.requests).toHaveLength(2); // pause_turn continued once
    for (const req of h.requests) {
      expect(req.body.output_config).toEqual({ effort: 'high', format: outputFormat(FactBase) });
      expect(req.body.tools).toEqual([
        { type: 'web_search_20260209', name: 'web_search', max_uses: 8 },
        { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 4 },
      ]);
      expect(req.body.tool_choice).toEqual({ type: 'auto' });
      expect(systemOf(req)).toEqual([...systemBlocks('research')]);
    }
    for (const id of plan().checklist) expect(promptOf(h.requests[0])).toContain(`- ${id}:`);

    const sources = result.calls[0]!.sources;
    expect(sources.map((s) => [s.url, s.via])).toEqual([
      [AR, ['search', 'fetch']],
      [NEWS, ['search', 'citation']],
    ]);
    expect(sources[1]!.citedText).toEqual(['The carrier ended the year with about 21,500 employees.']);
    expect(result.output.facts.map((f) => f.id)).toEqual(['f-revenue', 'f-employees', 'f-tech-headcount', 'f-vendor']);
    expect(result.output.facts[0]).toMatchObject({ value: 9104, unit: 'USD m', sourceUrl: AR, date: '2026-02-14', confidence: 'H' });
    // A sourced fact without a title gets it from the page the model opened.
    expect(result.output.facts[1]).toMatchObject({ sourceUrl: NEWS, sourceTitle: 'Example Air posts full-year results', confidence: 'M' });
    expect(result.output.gaps).toEqual([{ step: 'vendors', question: 'Book of business per vendor is not public.' }]);
    expect(result.calls[0]!.audit).toEqual([
      'ai/job-0001/001-research-response-1.json',
      'ai/job-0001/001-research-response-2.json',
      'ai/job-0001/001-research-sources.json',
    ]);
  });

  it('draftSeed(): one structured call per seed section at effort high, shared cached prefix, assembled into a TenantSeedDraft', async () => {
    const facts = await checkedFacts();
    const h = harness(loadExchanges('steps/seed-sections'), { jobId: 'job-0002' });
    const result = await draftSeed(h.client, {
      promptBar: PROMPT_BAR,
      plan: plan(),
      facts,
      bundle,
      presets: presets(),
      workedExample: WORKED_EXAMPLE,
    });

    // Chunked by seed section: every checklist step the model drafts, in checklist order; presets are not drafted.
    const drafted = ONBOARDING_CHECKLIST.steps.filter((s) => s.seed.from === 'facts' && s.seed.files.length > 0).map((s) => s.id);
    expect(seedSectionPlans(bundle).map((p) => p.step)).toEqual(drafted);
    expect(h.requests).toHaveLength(drafted.length);
    expect(result.calls.map((c) => c.step)).toEqual(drafted.map((s) => `seed-${s.replace(/_/g, '-')}`));

    const system = [...systemBlocks('seed_draft', { workedExample: WORKED_EXAMPLE })];
    h.requests.forEach((req, i) => {
      expect(req.body.output_config).toEqual({ effort: 'high', format: outputFormat(SeedSectionDraft) });
      expect(req.body).not.toHaveProperty('tools');
      expect(systemOf(req)).toEqual(system); // identical prefix: the cache written by the first section is read by the rest
      const prompt = promptOf(req);
      const section = JSON.parse(prompt.match(/<section>\n([\s\S]*?)\n<\/section>/)![1]!);
      expect(section.step).toBe(drafted[i]);
      const plan = seedSectionPlans(bundle).find((p) => p.step === drafted[i])!;
      expect(section.variables.map((v: any) => v.id)).toEqual(plan.variables.map((v) => v.id));
      expect(section.dimensions.map((d: any) => d.id)).toEqual(checklistStep(drafted[i]!).seed.dims);
      expect(prompt).toContain('<fact_base>');
    });
    expect(result.calls.slice(1).every((c) => c.usage.cacheReadInputTokens > 0)).toBe(true);

    const seed = result.output;
    expect(TenantSeedDraft.safeParse(seed).success).toBe(true); // a valid seed (SPEC-03 reader) with provenance
    expect(seed.tenant).toMatchObject({ id: 'zz', name: 'Example Air', currency: 'USD', base_year: 2026, target_year: 2027, ticker: 'EXA' });
    expect(seed.variableValues).toEqual({
      'line.amount': { ln_001: 42.5 },
      'portfolio.apps': 800,
      'org.ss_flag': { vp_operations: 1 },
      'hc.ctr': 600,
      'vendor.book': { vendor_a: 12 },
      'corp.cpi': { fy26: 2.5 },
      'g.target_mode': 2,
      'lev.L01.cut': 0.1,
    });
    expect(Object.keys(seed.dimensionMembers)).toEqual([
      'year', 'iyear', 'pool', 'line', 'domain', 'akey', 'addr_tag', 'vp', 'vendor', 'lgroup', 'lever',
    ]);
    expect(seed.dimensionMembers.line![0]).toMatchObject({ id: 'ln_001', pool: 'internal_labour', lever_ids: ['L01'] });
    // Presets copied for the new tenant.
    expect((seed.scenarios as any).tenant).toBe('zz');
    expect(seed.leverLibrary).toEqual(presets().leverLibrary);
    expect(seed.provenance.find((p) => p.target === TENANT_TARGET)).toEqual({ target: TENANT_TARGET, source: AR, confidence: 'H', factIds: ['f-revenue'] });
    expect(seed.provenance.find((p) => p.target === 'lev.L01.cut')).toMatchObject({ source: PRESET_SOURCE });
    expect(result.calls.at(-1)!.audit.at(-1)).toBe('ai/job-0002/007-seed-target-sources.json');

    // Variables a section left out are flagged, not invented.
    const missing = result.review.filter((f) => f.kind === 'missing_value').map((f) => f.target);
    expect(missing).toContain('g.target_net');
    expect(missing).not.toContain('hc.ctr');
  });

  it('draftSeed() rejects a section that drafts a variable it does not own', async () => {
    const facts = await checkedFacts();
    const h = harness(loadExchanges('steps/seed-foreign-variable'));
    const err = await draftSeed(h.client, { promptBar: PROMPT_BAR, plan: plan(), facts, bundle, presets: presets() }).catch((e) => e);
    expect(err).toBeInstanceOf(ModelOutputError);
    expect((err as ModelOutputError).issues).toEqual([
      { path: ['values', 0, 'variable'], message: "variable 'g.target_net' is not part of section tenant_record" },
    ]);
  });

  it('presetsFromSeed() copies the preset sections of a reference seed with the registry confidence', async () => {
    const seedDir = join(specDir, 'seed', 'aa');
    const read = (f: string) => JSON.parse(readFileSync(join(seedDir, f), 'utf8'));
    const ref = {
      tenant: read('tenant.json'),
      dimensionMembers: read('dimension_members.json'),
      variableValues: read('variable_values.json'),
      scenarios: read('scenarios.json'),
      leverLibrary: read('lever_library.json'),
    };
    const p = presetsFromSeed(ref, bundle.variables);
    expect(p.sections.map((s) => s.step)).toEqual(seedSectionPlans(bundle, 'presets').map((s) => s.step));
    const levers = bundle.variables.filter((v) => v.group === checklistStep('scenarios').seed.groups[0]);
    expect(p.sections[0]!.values.map((v) => v.variable).sort()).toEqual(levers.map((v) => v.id).sort());
    for (const v of p.sections[0]!.values) {
      expect(v.source).toBe(PRESET_SOURCE);
      expect(v.confidence).toBe(bundle.variables.find((r) => r.id === v.variable)!.confidence);
    }
    expect(p.scenarios).toBe(ref.scenarios);
  });
});

describe('AC2 facts without a source get confidence low and a review flag', () => {
  it('research(): an unsourced fact and a fact citing a page never opened become L and are flagged', async () => {
    const h = harness(loadExchanges('steps/research-sourced'));
    const result = await research(h.client, { promptBar: PROMPT_BAR, plan: plan() });
    const raw = answerOf('steps/research-sourced', 1);
    expect(raw.facts[2]).toMatchObject({ id: 'f-tech-headcount', sourceUrl: null, confidence: 'M' }); // as the model sent it
    expect(result.output.facts[2]).toMatchObject({ id: 'f-tech-headcount', sourceUrl: null, confidence: 'L' });
    expect(result.output.facts[3]).toMatchObject({ id: 'f-vendor', confidence: 'L' });
    expect(result.output.facts[0]!.confidence).toBe('H');
    expect(result.review).toEqual([
      { kind: 'unsourced', step: 'workforce', target: 'f-tech-headcount', message: 'Fact f-tech-headcount (Technology headcount) has no source; confidence set to L.' },
      {
        kind: 'source_not_seen',
        step: 'vendors',
        target: 'f-vendor',
        message: 'Fact f-vendor (Main infrastructure managed-service vendor) cites https://blog.example.net/vendor-roundup, which the research never opened; confidence set to L.',
      },
    ]);
  });

  it('checkFactSources(): every unsourced fact is flagged, whatever confidence the model gave; matching ignores fragment and trailing slash', () => {
    const fact = (id: string, sourceUrl: string | null, confidence: 'H' | 'M' | 'L') => ({
      id, step: 'workforce' as const, label: id, value: 1, unit: 'FTE', period: null, sourceUrl, sourceTitle: null, date: '2026-01-01', confidence, note: null,
    });
    const seen: Source[] = [{ url: `${AR}/`, title: 'Annual report', via: ['fetch'], pageAge: null, retrievedAt: null, citedText: [] }];
    const { facts, review } = checkFactSources(
      { facts: [fact('a', null, 'H'), fact('b', null, 'L'), fact('c', `${AR}#p12`, 'H')], gaps: [] },
      seen,
    );
    expect(facts.facts.map((f) => [f.id, f.confidence, f.sourceTitle])).toEqual([['a', 'L', null], ['b', 'L', null], ['c', 'H', 'Annual report']]);
    expect(review.map((f) => `${f.kind}:${f.target}`)).toEqual(['unsourced:a', 'unsourced:b']);
  });

  it('draftSeed(): seeded values without a source get confidence L and a review flag; unknown fact ids are dropped and flagged', async () => {
    const facts = await checkedFacts();
    const h = harness(loadExchanges('steps/seed-sections'));
    const result = await draftSeed(h.client, { promptBar: PROMPT_BAR, plan: plan(), facts, bundle, presets: presets() });
    const prov = new Map(result.output.provenance.map((p) => [p.target, p]));
    expect(prov.get('portfolio.apps')).toEqual({ target: 'portfolio.apps', source: null, confidence: 'L', factIds: [] }); // model said M
    expect(prov.get('vendor.book')).toEqual({ target: 'vendor.book', source: null, confidence: 'L', factIds: ['f-vendor'] });
    expect(prov.get('org.ss_flag')!.factIds).toEqual([]);
    const flags = result.review.filter((f) => f.kind !== 'missing_value');
    expect(flags).toEqual([
      { kind: 'unsourced', step: 'baseline_lines', target: 'portfolio.apps', message: 'portfolio.apps has no source; confidence set to L.' },
      { kind: 'unknown_fact', step: 'org', target: 'org.ss_flag', message: 'org.ss_flag names unknown fact(s) f-org-chart; reference dropped.' },
      { kind: 'unsourced', step: 'vendors', target: 'vendor.book', message: 'vendor.book has no source; confidence set to L.' },
    ]);
    // Every seeded value carries a source and a confidence (checklist step 9).
    for (const v of Object.keys(result.output.variableValues)) expect(prov.has(v), v).toBe(true);
  });
});
