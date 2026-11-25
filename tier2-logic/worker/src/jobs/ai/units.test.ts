import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AiConfigError, loadAiConfig, MemoryAuditSink, ReconfigReview } from '@glidepath/ai';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BudgetExceededError, TokenBudget, budgetedClient } from './budget';
import { CACHE_FORMAT, CacheBundleError, readCacheBundle } from './cache';
import { estimateReconfigCost } from './cost';
import { redact, safeMessage, secretsOf } from './redact';
import { parseRehearseArgs, runRehearse } from './rehearse';
import { DEFAULT_MAX_TOKENS_PER_JOB, AiJobSettingsError, loadJobSettings } from './settings';
import { TEST_KEY, fakeModel, loadFixtures, testDeps, type Fixtures } from './testing/fake-model';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../../..');

let f: Fixtures;
let dir: string;
beforeAll(async () => {
  f = await loadFixtures();
  dir = mkdtempSync(join(tmpdir(), 'gp-ai06-'));
}, 120_000);
afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('AI-06 cost guard', () => {
  it('a cost estimate is computed before start from the prompt, the models and the budget (test)', () => {
    const config = loadAiConfig({ ANTHROPIC_API_KEY: TEST_KEY });
    const small = estimateReconfigCost({ prompt: 'Set up Example Air', seedSections: 6, config, maxTokens: 500_000 });
    const long = estimateReconfigCost({ prompt: 'x'.repeat(40_000), seedSections: 6, config, maxTokens: 500_000 });
    expect(small).toMatchObject({ model: config.models.primary, maxTokens: 500_000 });
    expect(small.inputTokens).toBeGreaterThan(0);
    expect(small.outputTokens).toBeGreaterThan(0);
    expect(small.usd).toBeGreaterThan(0);
    expect(long.inputTokens).toBeGreaterThan(small.inputTokens);
    // More seed sections, more calls; tuning only when produced.
    expect(estimateReconfigCost({ prompt: 'p', seedSections: 12, config, maxTokens: 1 }).outputTokens).toBeGreaterThan(
      estimateReconfigCost({ prompt: 'p', seedSections: 6, config, maxTokens: 1 }).outputTokens,
    );
    expect(estimateReconfigCost({ prompt: 'p', seedSections: 6, produce: ['seed'], config, maxTokens: 1 }).inputTokens).toBeLessThan(
      estimateReconfigCost({ prompt: 'p', seedSections: 6, config, maxTokens: 1 }).inputTokens,
    );
  });

  it('AI_MAX_TOKENS_PER_JOB comes from the environment with a default in the loader (ADR-022) (test)', () => {
    expect(loadJobSettings({}).maxTokensPerJob).toBe(DEFAULT_MAX_TOKENS_PER_JOB);
    expect(loadJobSettings({ AI_MAX_TOKENS_PER_JOB: ' ' }).maxTokensPerJob).toBe(DEFAULT_MAX_TOKENS_PER_JOB);
    expect(loadJobSettings({ AI_MAX_TOKENS_PER_JOB: '1234' }).maxTokensPerJob).toBe(1234);
    for (const bad of ['0', '-5', '1e6', 'many']) expect(() => loadJobSettings({ AI_MAX_TOKENS_PER_JOB: bad })).toThrow(AiJobSettingsError);
  });

  it('the budget stops the job: no call starts once it is spent, a call past it is counted and stops the job (test)', async () => {
    const budget = new TokenBudget(2_500);
    const calls: string[] = [];
    const client = budgetedClient(
      {
        run: async <O>(step: { id: string; output: { parse(v: unknown): O } }) => {
          calls.push(step.id);
          return {
            output: step.output.parse({}),
            sources: [],
            model: 'claude-opus-5-5',
            fallback: false,
            usage: { inputTokens: 1000, outputTokens: 100, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
            audit: [],
          };
        },
      } as never,
      budget,
    );
    const step = { id: 's', output: { parse: (v: unknown) => v } } as never;
    await client.run(step, {}); // 1100
    await client.run(step, {}); // 2200
    expect(budget.used).toBe(2200);
    await expect(client.run(step, {})).rejects.toBeInstanceOf(BudgetExceededError); // 3300 > 2500: counted, stops
    expect(budget.used).toBe(3300);
    expect(calls).toHaveLength(3);
    await expect(client.run(step, {})).rejects.toMatchObject({ code: 'budget_exceeded', used: 3300, max: 2500 });
    expect(calls).toHaveLength(3); // the fourth never started
    expect(budget.usage).toMatchObject({ calls: 3, inputTokens: 3000, outputTokens: 300 });
    expect(budget.usage.usd).toBeGreaterThan(0);
  });
});

describe('AI-06 API key', () => {
  it('ANTHROPIC_API_KEY is read from the environment; errors name the variable, never a value (test)', () => {
    expect(() => loadAiConfig({})).toThrow(AiConfigError);
    try {
      loadAiConfig({ ANTHROPIC_API_KEY: '', AI_MODEL: 'Not A Model' });
    } catch (e) {
      expect((e as Error).message).toContain('ANTHROPIC_API_KEY');
      expect((e as Error).message).not.toContain('Not A Model');
    }
    expect(loadAiConfig({ ANTHROPIC_API_KEY: TEST_KEY }).apiKey).toBe(TEST_KEY);
  });

  it('the key is scrubbed from anything stored or thrown (test)', () => {
    const secrets = secretsOf({ ANTHROPIC_API_KEY: ` ${TEST_KEY} `, OTHER: 'x' });
    expect(secrets).toEqual([TEST_KEY]);
    expect(redact(`401 for x-api-key: ${TEST_KEY} (again ${TEST_KEY})`, secrets)).toBe('401 for x-api-key: [redacted] (again [redacted])');
    expect(safeMessage(new Error(`bad key ${TEST_KEY}`), secrets)).toBe('Error: bad key [redacted]');
    expect(safeMessage('plain', secrets)).toBe('plain');
  });

  it('no source of the job reads or prints the key: it goes to the SDK through loadAiConfig only (test)', () => {
    const offenders: string[] = [];
    for (const name of readdirSync(here).filter((n) => n.endsWith('.ts') && !n.endsWith('.test.ts'))) {
      const src = readFileSync(join(here, name), 'utf8');
      if (/\.apiKey\b|process\.env\.ANTHROPIC/.test(src)) offenders.push(`${name}: reads the key`);
      if (name !== 'rehearse-cli.ts' && /console\.(log|info|warn|error|debug)/.test(src)) offenders.push(`${name}: prints`);
    }
    expect(offenders).toEqual([]);
  });

  it('worker egress is the egress network only, and only the worker holds the key (compose-config check) (test)', () => {
    const servicesOf = (file: string): Map<string, string[]> => {
      const services = new Map<string, string[]>();
      let inServices = false;
      let current: string[] | null = null;
      for (const line of readFileSync(join(repoRoot, file), 'utf8').split('\n')) {
        if (/^services:\s*$/.test(line)) inServices = true;
        else if (/^\S/.test(line)) inServices = false;
        const m = /^ {2}([a-z][a-z0-9_-]*):\s*$/.exec(line);
        if (inServices && m) services.set(m[1]!, (current = []));
        else if (inServices && current) current.push(line);
      }
      return services;
    };
    const networksOf = (svc: string[]): string[] => {
      const line = svc.find((l) => /^\s{4}networks:/.test(l));
      return line ? [...line.matchAll(/[a-z]+/g)].map((x) => x[0]).slice(1) : [];
    };
    const services = servicesOf('docker-compose.yml');
    const worker = services.get('worker');
    expect(worker, 'worker service').toBeDefined();
    expect(networksOf(worker!)).toEqual(['data', 'egress']);
    expect(worker!.join('\n')).toContain('ANTHROPIC_API_KEY');
    for (const [name, lines] of services) {
      if (name === 'worker') continue;
      expect(lines.join('\n'), `${name} must not hold the API key`).not.toContain('ANTHROPIC_API_KEY');
      // OPS-09 (owner-approved 2026-11-23): logic also reaches the internet, only for the Cloudflare Access signing
      // keys; it holds no API key (checked above). Every other service stays off egress.
      if (name === 'logic') expect(networksOf(lines)).toEqual(['edge', 'data', 'egress']);
      else expect(networksOf(lines), `${name} must not be on the egress network`).not.toContain('egress');
    }
    // The egress network is the only one with outbound internet; the data network is internal.
    const text = readFileSync(join(repoRoot, 'docker-compose.yml'), 'utf8');
    expect(text).toMatch(/^ {2}data:\n {4}internal: true/m);
    expect(text).toMatch(/^ {2}egress: \{\}/m);
    // The same holds in the other compose files: the key is the worker's alone, never another service's.
    for (const extra of ['docker-compose.dev.yml', 'docker-compose.neon.yml']) {
      for (const [name, lines] of servicesOf(extra)) {
        if (name !== 'worker') expect(lines.join('\n'), `${extra}: ${name} must not hold the API key`).not.toContain('ANTHROPIC_API_KEY');
      }
    }
  });
});

describe('AI-06 rehearse CLI', () => {
  it('parses --tenant, --prompt, --out and --home (test)', () => {
    expect(parseRehearseArgs(['--tenant', 'ua'])).toEqual({ tenant: 'ua' });
    expect(parseRehearseArgs(['--tenant=ua', '--out', '/tmp/x', '--home=aa', '--prompt', 'Hello'])).toEqual({ tenant: 'ua', out: '/tmp/x', home: 'aa', prompt: 'Hello' });
    expect(() => parseRehearseArgs([])).toThrow(/--tenant/);
    expect(() => parseRehearseArgs(['--tenant'])).toThrow(/needs a value/);
    expect(() => parseRehearseArgs(['--tenant', 'ua', '--wat'])).toThrow(/unknown argument/);
  });

  it('`pnpm ai:rehearse --tenant ua` writes a cache bundle folder (fake client) (test)', async () => {
    const out = join(dir, 'ua');
    const log: string[] = [];
    const models: ReturnType<typeof fakeModel>[] = [];
    const deps = testDeps(f, { models, onCall: () => void log.push('model call') });
    const report = await runRehearse({ tenant: 'ua', outDir: out }, deps, (m) => log.push(m));

    // The estimate is shown before the first model call.
    expect(log.findIndex((l) => l.startsWith('rehearse: ua: estimate'))).toBeLessThan(log.indexOf('model call'));
    expect(log.some((l) => /about \$\d/.test(l))).toBe(true);

    expect(readdirSync(out).sort()).toEqual(['audit', 'manifest.json', 'review.json']);
    const bundle = readCacheBundle(out);
    expect(bundle.manifest).toMatchObject({ format: CACHE_FORMAT, id: report.jobId, tenant: 'ua', homeTenant: 'aa', specVersion: f.spec.bundle.specVersion });
    expect(bundle.manifest.prompt).toContain('UA');
    expect(bundle.manifest.usage.calls).toBe(models[0]!.calls.length);
    expect(bundle.manifest.estimate.maxTokens).toBe(DEFAULT_MAX_TOKENS_PER_JOB);
    expect(ReconfigReview.parse(bundle.review)).toEqual(bundle.review);
    expect(bundle.review.drafts.seed).not.toBeNull();
    expect(bundle.review.drafts.lever_tuning).not.toBeNull();
    expect(bundle.audit).toHaveLength(models[0]!.calls.length);
    expect(bundle.audit[0]!.name).toBe('001-scope-response.json');
    // Nothing secret in the folder.
    for (const name of ['manifest.json', 'review.json', ...bundle.audit.map((a) => `audit/${a.name}`)])
      expect(readFileSync(join(out, name), 'utf8')).not.toContain(TEST_KEY);
  });

  it('stops at AI_MAX_TOKENS_PER_JOB and writes no bundle (test)', async () => {
    const out = join(dir, 'ua-budget');
    const deps = testDeps(f, { env: { AI_MAX_TOKENS_PER_JOB: '2500' }, tokensPerCall: 1000 });
    await expect(runRehearse({ tenant: 'ua', outDir: out }, deps)).rejects.toBeInstanceOf(BudgetExceededError);
    expect(() => readdirSync(out)).toThrow();
  });

  it('a bundle that does not validate is refused with the reason (test)', async () => {
    const bad = join(dir, 'bad');
    const good = join(dir, 'ua');
    const copy = (name: string, mutate: (v: Record<string, unknown>) => void): string => {
      const target = join(dir, `bad-${name}`);
      const m = JSON.parse(readFileSync(join(good, 'manifest.json'), 'utf8')) as Record<string, unknown>;
      mutate(m);
      mkdirSync(target, { recursive: true });
      writeFileSync(join(target, 'manifest.json'), JSON.stringify(m));
      writeFileSync(join(target, 'review.json'), readFileSync(join(good, 'review.json')));
      return target;
    };
    expect(() => readCacheBundle(copy('format', (m) => (m.format = 'other')))).toThrow(CacheBundleError);
    expect(() => readCacheBundle(copy('tenant', (m) => (m.homeTenant = 'Not A Slug')))).toThrow(/slugs/);
    mkdirSync(bad, { recursive: true });
    writeFileSync(join(bad, 'manifest.json'), readFileSync(join(good, 'manifest.json')));
    writeFileSync(join(bad, 'review.json'), '{"plan":{}}');
    expect(() => readCacheBundle(bad)).toThrow(/ReconfigReview/);
    expect(() => readCacheBundle(join(dir, 'missing'))).toThrow(/manifest.json is missing/);
  });
});

describe('AI-06 fake client', () => {
  it('writes audit records through the sink it is given', async () => {
    const audit = new MemoryAuditSink();
    const m = fakeModel(f, { jobId: 'job-1', audit });
    await m.run({ id: 'scope', output: { parse: (v: unknown) => v } } as never, {});
    expect(audit.paths()).toEqual(['ai/job-1/001-scope-response.json']);
  });
});
