/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModelBundleFromDir, readTenantSeed } from '@glidepath/spec/node';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { outputFormat } from './client';
import { ONBOARDING_CHECKLIST } from './onboarding/checklist';
import { renderScopePrompt } from './prompts/render';
import { systemBlocks } from './prompts/system';
import { FactBase } from './schemas/facts';
import { LeverTuningDraft } from './schemas/lever-tuning';
import { ReconfigPlan } from './schemas/plan';
import { assembleSeedDraft, SeedAssemblyError, SeedSectionDraft, splitSeedDraft, TenantSeedDraft } from './schemas/seed';
import { defineStep } from './step';
import type { Exchange } from './testing/fake-transport';
import { forbidNetwork, harness } from './testing/harness';

forbidNetwork();

const here = dirname(fileURLToPath(import.meta.url));
const specDir = resolve(here, '../../../docs/spec');
const seedDir = join(specDir, 'seed', 'aa');
const readSeed = (f: string): any => JSON.parse(readFileSync(join(seedDir, f), 'utf8'));
const referenceSeedJson = () => ({
  tenant: readSeed('tenant.json'),
  dimensionMembers: readSeed('dimension_members.json'),
  variableValues: readSeed('variable_values.json'),
  scenarios: readSeed('scenarios.json'),
  leverLibrary: readSeed('lever_library.json'),
});

const examplePlan = (): ReconfigPlan => ({
  intent: 'onboard',
  tenant: { name: 'Example Air', iataCode: 'ZZ', ticker: 'EXA', currency: 'USD', existingTenantId: null },
  baseYear: 2026,
  targetYear: 2027,
  lastReportedYear: 2025,
  produce: ['seed', 'lever_tuning'],
  checklist: ONBOARDING_CHECKLIST.steps.map((s) => s.id),
  openQuestions: [],
});

const exampleFacts = (): FactBase => ({
  facts: [
    {
      id: 'f1',
      step: 'corporate_drivers',
      label: 'Total operating revenue',
      value: 1234.5,
      unit: 'USD m',
      period: 'FY2025',
      sourceUrl: 'https://example.com/annual-report-2025.pdf',
      sourceTitle: 'Example Air annual report 2025',
      date: '2026-02-20',
      confidence: 'H',
      note: null,
    },
    {
      id: 'f2',
      step: 'workforce',
      label: 'Technology headcount',
      value: 900,
      unit: 'FTE',
      period: null,
      sourceUrl: null,
      sourceTitle: null,
      date: '2026-11-01',
      confidence: 'L',
      note: 'Benchmark estimate, no public source.',
    },
  ],
  gaps: [{ step: 'vendors', question: 'Book of business per vendor is not public.' }],
});

const exampleTuning = (): LeverTuningDraft => ({
  summary: 'No captive centre of scale, so offshore levers start low.',
  changes: [
    {
      variable: 'lev.L03.cut',
      memberKey: null,
      scenario: null,
      value: 0.05,
      reason: 'The airline has no global capability centre to move work to.',
      factIds: ['f2'],
      confidence: 'M',
    },
  ],
  openQuestions: [],
});

const messages = (s: z.ZodError | undefined) => (s ? s.issues.map((i) => `${i.path.join('.')}: ${i.message}`) : []);

/** Walk a JSON schema (following `$ref`s) and collect what structured outputs reject. */
function wireProblems(root: any): string[] {
  const out: string[] = [];
  const resolveRef = (ref: string): any =>
    ref.replace(/^#\/?/, '').split('/').filter(Boolean).reduce((node: any, key) => node?.[key], root);
  const walk = (schema: any, path: string, stack: string[]): void => {
    if (schema === null || typeof schema !== 'object') return;
    if (typeof schema.$ref === 'string') {
      if (stack.includes(schema.$ref)) out.push(`${path}: recursive schema via ${schema.$ref}`);
      else walk(resolveRef(schema.$ref), `${path}->${schema.$ref}`, [...stack, schema.$ref]);
    }
    if ((schema.type === 'object' || schema.properties) && schema.additionalProperties !== false)
      out.push(`${path}: object without additionalProperties: false`);
    // The SDK turns a zod record into a closed object with no properties: the model could only answer {}.
    if (schema.type === 'object' && Object.keys(schema.properties ?? {}).length === 0)
      out.push(`${path}: map/record (sent as an empty object)`);
    for (const [k, v] of Object.entries(schema)) {
      if (k === '$defs' || k === 'definitions') continue;
      if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}.${k}[${i}]`, stack));
      else if (v && typeof v === 'object') walk(v, `${path}.${k}`, stack);
    }
  };
  walk(root, '$', []);
  return out;
}

/** A recorded-shape stream whose answer is `answer` as JSON text (no network; the fake transport replays it). */
function jsonAnswer(answer: unknown): Exchange[] {
  const text = JSON.stringify(answer);
  const usage = { input_tokens: 10, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  return [
    {
      status: 200,
      headers: { 'request-id': 'req_ai02' },
      events: [
        { type: 'message_start', message: { id: 'msg_ai02', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, stop_details: null, usage } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null, stop_details: null }, usage: { output_tokens: 20 } },
        { type: 'message_stop' },
      ],
    },
  ];
}

describe('AC1 zod schemas ReconfigPlan, FactBase, TenantSeedDraft, LeverTuningDraft', () => {
  it('the reference tenant seed (docs/spec/seed/aa) passes TenantSeedDraft (validated with the SPEC-03 seed reader)', async () => {
    const parsed = TenantSeedDraft.safeParse(referenceSeedJson());
    expect(messages(parsed.error)).toEqual([]);
    const { provenance, ...seed } = parsed.data!;
    expect(provenance).toEqual([]);
    expect(seed).toEqual(await readTenantSeed(seedDir));
  });

  it('TenantSeedDraft reports SPEC-03 seed errors with their JSON paths, and provenance for unknown values', () => {
    const bad = referenceSeedJson();
    delete bad.tenant.currency;
    const r = TenantSeedDraft.safeParse({ ...bad, provenance: [] });
    expect(r.success).toBe(false);
    expect(messages(r.error).join('\n')).toContain('$.tenant.currency');

    const dup = referenceSeedJson();
    dup.dimensionMembers.vp.push({ ...dup.dimensionMembers.vp[0] });
    dup.scenarios.default_scenario = 'nope';
    const r2 = TenantSeedDraft.safeParse(dup);
    expect(messages(r2.error).join('\n')).toMatch(/\$\.dimensionMembers\.vp\[\d+\]\.id: duplicate member id/);
    expect(messages(r2.error).join('\n')).toContain("$.scenarios.default_scenario: default_scenario 'nope'");

    const r3 = TenantSeedDraft.safeParse({
      ...referenceSeedJson(),
      provenance: [{ target: 'no.such_variable', source: null, confidence: 'L', factIds: [] }],
    });
    expect(messages(r3.error)).toEqual(["provenance.0.target: no seeded value 'no.such_variable'"]);
  });

  it('step 3 sections cover the whole seed: split into checklist sections, each valid on the wire, and reassembled unchanged', async () => {
    const bundle = await loadModelBundleFromDir(specDir);
    const seed = TenantSeedDraft.parse(referenceSeedJson());
    const sections = splitSeedDraft(seed, bundle.variables);
    for (const s of sections) expect(messages(SeedSectionDraft.safeParse(s).error)).toEqual([]);
    expect(sections.map((s) => s.step)).toEqual([
      'tenant_record',
      'baseline_lines',
      'org',
      'workforce',
      'vendors',
      'corporate_drivers',
      'target',
      'scenarios',
    ]);

    const raw = referenceSeedJson();
    const assembled = assembleSeedDraft(sections, { scenarios: raw.scenarios, leverLibrary: raw.leverLibrary });
    const { provenance, ...files } = assembled;
    expect(files).toEqual(raw);
    // No provenance in the reference seed's values: every value comes back as unsourced, confidence L.
    expect(provenance).toHaveLength(Object.keys(raw.variableValues).length + 1);
    expect(new Set(provenance!.map((p) => `${p.source}/${p.confidence}`))).toEqual(new Set(['null/L']));
    expect(TenantSeedDraft.safeParse(assembled).success).toBe(true);
  });

  it('assembleSeedDraft refuses sections that draft a dimension or variable twice or lack the tenant record', async () => {
    const bundle = await loadModelBundleFromDir(specDir);
    const raw = referenceSeedJson();
    const sections = splitSeedDraft(TenantSeedDraft.parse(raw), bundle.variables);
    const presets = { scenarios: raw.scenarios, leverLibrary: raw.leverLibrary };
    const org = sections.find((s) => s.step === 'org')!;
    const err = (() => {
      try {
        assembleSeedDraft([...sections.filter((s) => s.step !== 'tenant_record'), org], presets);
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(SeedAssemblyError);
    expect((err as SeedAssemblyError).problems).toEqual(
      expect.arrayContaining(['expected one tenant record, got 0', "dimension 'vp' drafted twice"]),
    );
  });

  it('ReconfigPlan accepts a plan and rejects a bad IATA code, inverted years and an inconsistent intent', () => {
    expect(ReconfigPlan.parse(examplePlan())).toEqual(examplePlan());
    const p = examplePlan();
    const bad = {
      ...p,
      intent: 'tune',
      tenant: { ...p.tenant, iataCode: 'zzz' },
      targetYear: p.baseYear - 1,
      checklist: ['not_a_step'],
    };
    expect(messages(ReconfigPlan.safeParse(bad).error).map((m) => m.split(':')[0])).toEqual(
      expect.arrayContaining(['tenant.iataCode', 'checklist.0']),
    );
    const refined = { ...p, intent: 'tune' as const, targetYear: p.baseYear - 1 };
    expect(messages(ReconfigPlan.safeParse(refined).error).map((m) => m.split(':')[0])).toEqual([
      'targetYear',
      'tenant.existingTenantId',
      'produce',
    ]);
  });

  it('FactBase holds value, unit, source URL, date and confidence; rejects bad URLs, dates and duplicate ids', () => {
    expect(FactBase.parse(exampleFacts())).toEqual(exampleFacts());
    const fb = exampleFacts();
    fb.facts[0] = { ...fb.facts[0]!, sourceUrl: 'not a url', date: '20 Feb 2026' };
    fb.facts[1] = { ...fb.facts[1]!, id: 'f1' };
    expect(messages(FactBase.safeParse(fb).error).map((m) => m.split(':')[0])).toEqual(
      expect.arrayContaining(['facts.0.sourceUrl', 'facts.0.date']),
    );
    const dup = exampleFacts();
    dup.facts[1] = { ...dup.facts[1]!, id: 'f1' };
    expect(messages(FactBase.safeParse(dup).error)).toEqual(['facts.1.id: duplicate fact id f1']);
  });

  it('LeverTuningDraft holds changes with reasons; rejects an empty reason and a cell proposed twice', () => {
    expect(LeverTuningDraft.parse(exampleTuning())).toEqual(exampleTuning());
    const t = exampleTuning();
    t.changes.push({ ...t.changes[0]!, reason: '' });
    expect(messages(LeverTuningDraft.safeParse(t).error).map((m) => m.split(':')[0])).toEqual(
      expect.arrayContaining(['changes.1.reason', 'changes.1']),
    );
  });

  it('every model-facing schema is valid for structured outputs: closed objects, no maps, no recursion', () => {
    const wire = { ReconfigPlan, FactBase, SeedSectionDraft, LeverTuningDraft };
    for (const [name, schema] of Object.entries(wire)) {
      const format = outputFormat(schema);
      expect(format.type, name).toBe('json_schema');
      expect(wireProblems(format.schema), name).toEqual([]);
    }
    // The check itself catches what the SDK would send silently broken.
    const Tree: z.ZodType = z.lazy(() => z.object({ children: z.array(Tree) }));
    expect(wireProblems(outputFormat(z.object({ m: z.record(z.string(), z.number()) })).schema)).toEqual([
      '$.properties.m: map/record (sent as an empty object)',
    ]);
    expect(wireProblems(outputFormat(z.object({ t: Tree })).schema)).toEqual([
      expect.stringContaining('recursive schema'),
    ]);
  });

  it('runs through the ModelClient as a step output (recorded-shape reply, no network)', async () => {
    const h = harness(jsonAnswer(examplePlan()));
    const scope = defineStep({
      id: 'scope',
      effort: 'medium',
      output: ReconfigPlan,
      system: systemBlocks('scope'),
      prompt: (input: { promptBar: string }) =>
        renderScopePrompt({
          promptBar: input.promptBar,
          today: '2026-11-23',
          defaults: { baseYear: 2026, targetYear: 2027 },
          existingTenants: [],
        }),
    });
    const run = await h.client.run(scope, { promptBar: 'set up Example Air' });
    expect(run.output).toEqual(examplePlan());
    expect(h.requests[0]!.body.output_config.format).toEqual(outputFormat(ReconfigPlan));
  });
});
