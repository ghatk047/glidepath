/**
 * QA-03 acceptance 3: the `leak` CI job (G7 Tenancy) is enabled and runs for every pull request that touches
 * data-access or the server, and what it runs reaches this package's leak tests.
 *
 * The job is checked as CI really decides it: the `tenancy` path filter of the `changes` job is taken from
 * ci.yml and run, as a regular expression, over sample changed paths; and the job's own probe condition is
 * applied to the root `test:leak` script. (`.github/workflows/ci.test.ts` covers ci.yml's shape in general;
 * this spec is about the one gate QA-03 hangs on, and it fails if that gate stops covering this package.)
 *
 * `yaml` is a devDependency of @glidepath/ops, resolved from there as `.github/workflows/ci.test.ts` does:
 * the server package does not depend on it.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = new URL('../../../../', import.meta.url).pathname;
const read = (p: string): string => readFileSync(join(root, p), 'utf8');
const { parse } = createRequire(join(root, 'ops', 'package.json'))('yaml') as { parse: (s: string) => unknown };

interface Step {
  readonly name?: string;
  readonly run?: string;
  readonly if?: string;
}
interface Job {
  readonly name?: string;
  readonly needs?: string | string[];
  readonly if?: string;
  readonly steps?: Step[];
  readonly outputs?: Record<string, string>;
  readonly services?: Record<string, { image?: string }>;
}

const raw = read('.github/workflows/ci.yml');
const workflow = parse(raw) as { on: Record<string, unknown>; jobs: Record<string, Job> };
const jobs = workflow.jobs;
const script = (pkg: string, name: string): string | undefined =>
  (JSON.parse(read(join(pkg, 'package.json'))) as { scripts?: Record<string, string> }).scripts?.[name];

/** The regular expression `out tenancy '<re>'` passes to `grep -Eq` over the changed paths. */
function tenancyFilter(): RegExp {
  const run = (jobs.changes?.steps ?? []).map((s) => s.run ?? '').join('\n');
  const m = /out\s+tenancy\s+'([^']+)'/.exec(run);
  expect(m, 'the changes job must select the tenancy gate by changed paths').not.toBeNull();
  return new RegExp(m![1]!);
}

describe('CI job leak required for data-access and server PRs (test: job enabled)', () => {
  it('the leak job is the G7 gate, gated on the tenancy paths, and runs `pnpm test:leak`', () => {
    const leak = jobs.leak;
    expect(leak, 'ci.yml has no `leak` job').toBeDefined();
    expect(leak!.name).toMatch(/^G7\b/);
    // on every pull request, through the changed-path selection
    expect(workflow.on).toHaveProperty('pull_request');
    expect([jobs.changes?.outputs ?? {}].map((o) => 'tenancy' in o)).toEqual([true]);
    expect([leak!.needs].flat()).toContain('changes');
    expect(leak!.if).toBe("needs.changes.outputs.tenancy == 'true'");
    // it needs a database, and it runs the gate's script
    expect(leak!.services?.postgres?.image).toBe('postgres:16');
    const steps = leak!.steps ?? [];
    const runs = steps.map((s) => s.run ?? '').join('\n');
    expect(runs).toContain('pnpm test:leak');
    const gate = steps.find((s) => (s.run ?? '').includes('pnpm test:leak') && (s.name ?? '').startsWith('Run'));
    expect(gate, 'the gate step must run pnpm test:leak').toBeDefined();
  });

  it('a pull request touching the server or data-access selects the tenancy gate; an unrelated one does not', () => {
    const re = tenancyFilter();
    for (const path of [
      'tier2-logic/server/src/routes/read/routes.ts',
      'tier2-logic/server/test/leak/leak.routes.spec.ts',
      'tier2-logic/server/package.json',
      'tier2-logic/data-access/src/repos/inputs.ts',
      'tier3-data/migrations/0002_rls.sql',
    ]) {
      expect(re.test(path), `a change to ${path} must run the G7 job`).toBe(true);
    }
    for (const path of ['docs/backlog/qa.md', 'tier1-presentation/web/src/app.tsx', 'tier2-logic/engine/src/eval.ts']) {
      expect(re.test(path), `${path} does not belong to the tenancy gate`).toBe(false);
    }
  });

  it('the job is enabled, not skipped: its probe accepts the root `test:leak`, which recurses into this package', () => {
    const probe = (jobs.leak?.steps ?? []).find((s) => (s.name ?? '').startsWith('Probe'));
    expect(probe, 'the leak job must probe the script before skipping').toBeDefined();
    // the probe's own condition, as ci.yml spells it: a script that exists and is no placeholder
    expect(probe!.run).toContain("scripts['test:leak']");
    const rootScript = script('.', 'test:leak');
    expect(rootScript, 'the root test:leak script is missing: the G7 job would skip itself').toBeDefined();
    expect(/not implemented yet/.test(rootScript!), 'the root test:leak script is still a placeholder').toBe(false);
    // `pnpm -r run test:leak` reaches every package that has the script, this one included
    expect(rootScript).toContain('-r');
    expect(rootScript).toContain('run test:leak');
    expect(script('tier2-logic/server', 'test:leak'), 'the server package needs a test:leak script').toContain('test/leak');
    expect(script('tier2-logic/data-access', 'test:leak'), 'data-access must keep its leak script').toContain('test/leak');
    // the gate's own step must stay guarded by the probe, so a green run is never an empty one
    for (const s of (jobs.leak?.steps ?? []).filter((x) => (x.run ?? '').trim() === 'pnpm test:leak')) {
      expect(s.if).toBe("steps.probe.outputs.ready == 'true'");
    }
  });
});
