import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// `yaml` is a devDependency of @glidepath/ops; resolve it from there (this folder is not a workspace package).
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const { parse } = createRequire(join(root, 'ops', 'package.json'))('yaml') as {
  parse: (s: string) => any;
};

const raw = readFileSync(join(here, 'ci.yml'), 'utf8');
const wf = parse(raw);
const jobs: Record<string, any> = wf.jobs;
const stepsOf = (id: string): any[] => jobs[id].steps ?? [];

describe('ci.yml [FND-04]', () => {
  it('triggers on PRs, pushes to develop/main and nightly', () => {
    const on = wf.on;
    expect(on).toHaveProperty('pull_request');
    expect(on.push.branches).toEqual(['develop', 'main']);
    expect(on.schedule).toBeTruthy();
  });

  it('G1, G2 (turbo affected filter) and G13 run on every PR', () => {
    for (const id of ['G1', 'G2', 'G13']) {
      expect(jobs[id], id).toBeDefined();
      expect(jobs[id].if, `${id} must be unconditional`).toBeUndefined();
      expect(jobs[id].needs).toBeUndefined();
    }
    expect(jobs.G1.name).toMatch(/^G1 /);
    expect(jobs.G2.name).toMatch(/^G2 /);
    expect(jobs.G13.name).toMatch(/^G13 /);
    expect(raw).toContain('--filter="...[$TURBO_BASE]"');
    expect(wf.env.TURBO_BASE).toContain('origin/main');
    const g1 = JSON.stringify(stepsOf('G1'));
    expect(g1).toContain('actionlint');
    expect(g1).toContain('typecheck lint');
    expect(JSON.stringify(stepsOf('G2'))).toContain('turbo run test');
  });

  it('Postgres 16 service exposes DATABASE_URL and DATABASE_URL_MIGRATE; no object store', () => {
    expect(wf.env.DATABASE_URL).toMatch(/^postgresql:\/\//);
    expect(wf.env.DATABASE_URL_MIGRATE).toMatch(/^postgresql:\/\//);
    for (const id of ['G2', 'leak', 'perf']) {
      expect(jobs[id].services.postgres.image, id).toBe('postgres:16');
      const runs = stepsOf(id)
        .map((s) => s.run ?? '')
        .join('\n');
      expect(runs, id).toContain('SELECT 1');
      expect(runs, id).toContain('$DATABASE_URL_MIGRATE');
    }
    expect(raw).not.toMatch(/minio|s3|objects/i);
    for (const j of Object.values(jobs)) {
      for (const svc of Object.keys(j.services ?? {})) expect(svc).toBe('postgres');
    }
  });

  it('gate jobs exist with contract names and skip while their script is a placeholder', () => {
    const expected: Record<string, string> = {
      'parity-golden': 'G3',
      'parity-fuzz': 'G4',
      solvers: 'G5',
      excel: 'G6',
      leak: 'G7',
      perf: 'G8',
      e2e: 'G9',
      storyline: 'G10',
      compose: 'G14',
    };
    for (const [id, gate] of Object.entries(expected)) {
      const job = jobs[id];
      expect(job, id).toBeDefined();
      expect(job.name.startsWith(`${gate} `), id).toBe(true);
      const steps = stepsOf(id);
      const probe = steps.find((s) => s.id === 'probe');
      expect(probe, `${id} has a script-presence step`).toBeDefined();
      expect(probe.run).toContain('::notice');
      expect(probe.run).toMatch(/placeholder/);
      const gated = steps.filter((s) => /^Run |Compose up|Multi-arch/.test(s.name ?? ''));
      expect(gated.length, id).toBeGreaterThan(0);
      for (const s of gated) {
        expect(s.if, `${id}: ${s.name}`).toBe("steps.probe.outputs.ready == 'true'");
      }
    }
    expect(jobs['parity-fuzz'].if).toContain("'schedule'");
  });

  it('G13 builds the web bundle and tier-check requires it [INT-01]', () => {
    const steps = stepsOf('G13');
    const build = steps.findIndex((s) => /@glidepath\/web\.\.\..*run build/.test(s.run ?? ''));
    const check = steps.findIndex((s) => /^pnpm tier-check/.test(s.run ?? ''));
    expect(build, 'web build step').toBeGreaterThanOrEqual(0);
    expect(check, 'tier-check step').toBeGreaterThan(build);
    expect(steps[check].run).toContain('--require-bundle');
  });

  it('G3 path filter covers the parity tool and the root package.json [INT-01]', () => {
    const run: string = stepsOf('changes').find((s) => s.id === 'paths').run;
    const line = run.split('\n').find((l) => l.trim().startsWith('out spec '))!;
    const re = new RegExp(line.match(/'([^']+)'/)![1]!);
    for (const f of ['tools/parity/src/cli.ts', 'package.json', 'docs/spec/schema.json', 'tier3-data/x.sql']) {
      expect(re.test(f), f).toBe(true);
    }
    expect(re.test('ops/package.json')).toBe(false);
  });

  it('root bench script is wired to the package benches, not a placeholder [INT-01]', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    expect(pkg.scripts.bench).not.toMatch(/not implemented/);
    expect(pkg.scripts.bench).toMatch(/turbo run bench/);
    const turbo = JSON.parse(readFileSync(join(root, 'turbo.json'), 'utf8'));
    expect(turbo.tasks.bench).toBeDefined();
  });

  it('G14 runs the M1 integration spec on the stack compose-check kept up, and tools/int/ triggers it [INT-02]', () => {
    const steps = stepsOf('compose');
    const up = steps.findIndex((s) => /ops\/compose-check\.sh --keep/.test(s.run ?? ''));
    const m1 = steps.findIndex((s) => /pnpm int:m1/.test(s.run ?? ''));
    expect(up, 'compose-check step').toBeGreaterThanOrEqual(0);
    expect(m1, 'int:m1 step').toBeGreaterThan(up);
    expect(steps[m1].run).toContain('INT_COMPOSE_PROJECT=glidepath-check');
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    expect(pkg.scripts['int:m1']).toMatch(/@glidepath\/int/);
    const run: string = stepsOf('changes').find((s) => s.id === 'paths').run;
    const line = run.split('\n').find((l) => l.trim().startsWith('out infra '))!;
    expect(new RegExp(line.match(/'([^']+)'/)![1]!).test('tools/int/m1.spec.ts')).toBe(true);
  });

  it('the G9 job also runs the M2 integration spec on the stack it brought up [INT-03]', () => {
    const steps = stepsOf('e2e');
    const smoke = steps.findIndex((s) => /pnpm e2e -- --trace off/.test(s.run ?? ''));
    const m2 = steps.findIndex((s) => /pnpm int:m2 -- --trace off/.test(s.run ?? ''));
    expect(smoke, 'G9 smoke step').toBeGreaterThanOrEqual(0);
    expect(m2, 'int:m2 step').toBeGreaterThan(smoke);
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    expect(pkg.scripts['int:m2']).toMatch(/@glidepath\/e2e/);
  });

  it('G10 runs the demo storyline nightly and on demand, not on every PR [QA-05]', () => {
    const job = jobs.storyline;
    expect(job.name).toMatch(/^G10 /);
    expect(job.if).toContain("'schedule'");
    expect(job.if).toContain("'workflow_dispatch'");
    expect(job.if).not.toContain('pull_request');
    expect(wf.on).toHaveProperty('workflow_dispatch');
    const steps = stepsOf('storyline');
    const up = steps.findIndex((s) => /docker compose up/.test(s.run ?? ''));
    const run = steps.findIndex((s) => /pnpm e2e:storyline -- --trace off/.test(s.run ?? ''));
    expect(up, 'compose up step').toBeGreaterThanOrEqual(0);
    expect(run, 'storyline step').toBeGreaterThan(up);
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    expect(pkg.scripts['e2e:storyline']).toMatch(/@glidepath\/e2e/);
    expect(pkg.scripts['e2e:storyline']).not.toMatch(/not implemented/);
    // the G9 smoke leaves the storyline spec to its own run
    const g9 = readFileSync(join(root, 'e2e', 'playwright.config.ts'), 'utf8');
    expect(g9).toContain("'storyline.spec.ts'");
  });

  it('references secrets only via ${{ secrets.* }} and carries no inline credentials', () => {
    const bare = raw.replace(/\$\{\{\s*secrets\.[A-Za-z0-9_]+\s*\}\}/g, '');
    expect(bare).not.toMatch(/secrets/i);
    expect(bare).not.toMatch(/(PASSWORD|TOKEN|API_KEY|AUTH_SECRET)\s*[:=]\s*['"]?[A-Za-z0-9+/]{8,}/);
  });
});
