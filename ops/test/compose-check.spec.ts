// OPS-05: ops/compose-check.sh (G13 network test, G14 clean start < 3 min).
// No Docker daemon needed: the script is run against a fake `docker` on PATH that plays
// the scenarios (healthy, stubbed migrate, unhealthy logic, web resolving db, ...), plus
// shellcheck (when installed) and the --dry-run plan. The real daemon run is manual / CI.
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseComposeYaml, REPO_ROOT, writeTestEnvFile } from '../src/index';

const SCRIPT = join(REPO_ROOT, 'ops/compose-check.sh');
const COMPOSE_TEXT = readFileSync(join(REPO_ROOT, 'docker-compose.yml'), 'utf8');
const COMPOSE = parseComposeYaml(COMPOSE_TEXT) as {
  services: Record<string, { build?: { dockerfile?: string }; image?: string; profiles?: string[] }>;
};
// The script runs with COMPOSE_PROFILES=dev (from .env.example), so every service is in play.
const SERVICES = Object.keys(COMPOSE.services);
// The tenant migrate seeds, from its command in docker-compose.yml (`--seed <id>`).
const SEED = /"--seed",\s*"([a-z0-9_-]+)"/.exec(COMPOSE_TEXT)![1]!;

// ---------------------------------------------------------------------- fake docker
// ops/test/fake-docker.sh plays the scenarios; FAKE_SCENARIO picks one.
const FAKE_DOCKER = join(import.meta.dirname, 'fake-docker.sh');
let BIN: string; // dir holding the fake docker
let ENV_FILE: string;

beforeAll(() => {
  BIN = mkdtempSync(join(tmpdir(), 'glidepath-fakebin-'));
  copyFileSync(FAKE_DOCKER, join(BIN, 'docker'));
  chmodSync(join(BIN, 'docker'), 0o755);
  ENV_FILE = writeTestEnvFile();
});

interface Run {
  code: number;
  out: string;
  err: string;
  calls: string;
  order: string;
}

function run(args: string[], opts: { scenario?: string; env?: Record<string, string>; path?: string } = {}): Run {
  const dir = mkdtempSync(join(tmpdir(), 'glidepath-fake-'));
  const r = spawnSync(SCRIPT, args, {
    encoding: 'utf8',
    cwd: REPO_ROOT,
    timeout: 60_000,
    env: {
      ...process.env,
      PATH: opts.path ?? `${BIN}:${process.env.PATH}`,
      FAKE_DIR: dir,
      FAKE_SCENARIO: opts.scenario ?? 'ok',
      FAKE_SERVICES: SERVICES.join(' '),
      ...opts.env,
    },
  });
  const read = (f: string) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8') : '');
  return { code: r.status ?? -1, out: r.stdout, err: r.stderr, calls: read('calls.log'), order: read('order.log') };
}

const check = (scenario: string, extra: string[] = []) =>
  run(['--no-build', '--settle', '0', '--env-file', ENV_FILE, '--project', 'ops-test', ...extra], { scenario });
/** The contract: the verdict is the last line, on stdout for PASS and stderr otherwise. */
const verdict = (r: Run) => (r.code === 0 ? r.out : r.err).trimEnd().split('\n').pop()!;

// ---------------------------------------------------------------------- tests
describe('ops/compose-check.sh', () => {
  it('is executable and passes shellcheck (static check for a daemon-less builder)', () => {
    expect(existsSync(SCRIPT)).toBe(true);
    const sc = spawnSync('shellcheck', ['--version'], { encoding: 'utf8' });
    if (sc.status !== 0) {
      // No shellcheck here: still check that bash parses it. CI (ubuntu) has shellcheck.
      expect(spawnSync('bash', ['-n', SCRIPT]).status).toBe(0);
      return;
    }
    const r = spawnSync('shellcheck', ['-s', 'bash', SCRIPT], { encoding: 'utf8' });
    expect(r.stdout + r.stderr).toBe('');
    expect(r.status).toBe(0);
  });

  describe('dry-run mode', () => {
    it('prints the plan and the exact commands, exits 0, and never calls docker', () => {
      const r = run(['--dry-run'], { path: `${BIN}:${process.env.PATH}` });
      expect(r.code).toBe(0);
      expect(r.calls).toBe('');
      expect(r.out).toMatch(/down -v --remove-orphans/);
      expect(r.out).toMatch(/up -d/);
      expect(r.out).toMatch(/exec -T web getent hosts db .*must exit 2/);
      expect(r.out).toMatch(/exec -T web getent hosts objects .*must exit 2/);
      expect(r.out).toMatch(/budget 180s/);
      expect(r.out.trimEnd().split('\n').pop()).toMatch(/^compose-check: DRY-RUN: /);
    });

    it('works with no docker at all and with --extra-ca / --no-build / --keep', () => {
      const tools = mkdtempSync(join(tmpdir(), 'glidepath-tools-'));
      for (const t of ['bash', 'sed', 'head', 'grep', 'cut', 'dirname', 'cat', 'tail']) {
        const p = spawnSync('bash', ['-c', `command -v ${t}`], { encoding: 'utf8' }).stdout.trim();
        symlinkSync(p, join(tools, t));
      }
      const r = run(['--dry-run', '--extra-ca', '/x/ca.pem', '--keep', '--budget', '60'], { path: tools });
      expect(r.code).toBe(0);
      expect(r.out).toContain('--secret id=extra-ca,src=/x/ca.pem');
      expect(r.out).toContain('budget 60s');
      expect(r.out).toContain('teardown skipped (--keep)');
      const nb = run(['--dry-run', '--no-build'], { path: tools });
      expect(nb.out).toContain('build skipped');
      expect(nb.out).not.toMatch(/docker build/);
    });

    it('builds the images listed in docker-compose.yml from the Dockerfiles it names', () => {
      const r = run(['--dry-run']);
      const dockerfiles = Object.values(COMPOSE.services)
        .map((s) => s.build?.dockerfile)
        .filter((d): d is string => !!d);
      expect(new Set(dockerfiles).size).toBe(2);
      for (const df of dockerfiles) expect(r.out).toContain(`docker build -q -f ${df} -t glidepath/`);
    });
  });

  describe('usage errors exit 2 with a one-line reason, before anything is started', () => {
    it.each([
      [['--bogus'], /unknown option --bogus/],
      [['--budget', 'abc', '--dry-run'], /--budget must be/],
      [['--project', 'Bad Name'], /--project must be/],
      [['--budget'], /needs a value/],
    ])('%j', (args, re) => {
      const r = run(args);
      expect(r.code).toBe(2);
      expect(r.err.trim().split('\n')).toHaveLength(1);
      expect(r.err).toMatch(/^compose-check: USAGE: /);
      expect(r.err).toMatch(re);
      expect(r.calls).not.toMatch(/up|down/);
    });

    it('no docker CLI', () => {
      const tools = mkdtempSync(join(tmpdir(), 'glidepath-tools-'));
      for (const t of ['bash', 'sed', 'head', 'grep', 'cut', 'dirname', 'cat', 'tail', 'mktemp', 'rm', 'tr', 'wc']) {
        const p = spawnSync('bash', ['-c', `command -v ${t}`], { encoding: 'utf8' }).stdout.trim();
        symlinkSync(p, join(tools, t));
      }
      const r = run(['--no-build'], { path: tools });
      expect(r.code).toBe(2);
      expect(verdict(r)).toMatch(/^compose-check: USAGE: docker CLI not found/);
    });

    it('missing env file and empty secrets', () => {
      const missing = run(['--no-build', '--env-file', '/nonexistent/.env']);
      expect(missing.code).toBe(2);
      expect(verdict(missing)).toMatch(/env file .* not found/);
      const dir = mkdtempSync(join(tmpdir(), 'glidepath-env-'));
      const empty = join(dir, 'empty.env');
      writeFileSync(empty, readFileSync(ENV_FILE, 'utf8').replace(/^AUTH_SECRET=.*$/m, 'AUTH_SECRET='));
      const r = run(['--no-build', '--env-file', empty]);
      expect(r.code).toBe(2);
      expect(verdict(r)).toMatch(/AUTH_SECRET is empty/);
      expect(r.order).toBe('');
    });
  });

  describe('G14: clean start and per-service timings', () => {
    it('all healthy: exit 0, down -v before up -d, a timing line for every service, one-line PASS', () => {
      const r = check('ok');
      expect(r.code, r.err + r.out).toBe(0);
      const lines = r.order.split('\n').filter(Boolean);
      expect(lines.indexOf('down')).toBeGreaterThanOrEqual(0);
      expect(lines.indexOf('down')).toBeLessThan(lines.findIndex((l) => l.startsWith('up ')));
      for (const s of SERVICES) expect(r.out, s).toMatch(new RegExp(`^\\s+${s}\\s+\\S+\\s+(healthy|completed)\\s+\\d+$`, 'm'));
      expect(r.out).toMatch(/migrate\s+2\s+completed\s+\d+/);
      expect(r.out).toMatch(/stack start: \d+s \(budget 180s\)/);
      expect(verdict(r)).toMatch(new RegExp(`^compose-check: PASS: all ${SERVICES.length} services healthy or completed in \\d+s`));
      expect(r.err).toBe('');
    });

    it('tears the stack down (down -v) at the end unless --keep', () => {
      expect(check('ok').order.trimEnd().split('\n')).toContain('down');
      const downs = (r: Run) => r.order.split('\n').filter((l) => l === 'down').length;
      expect(downs(check('ok'))).toBe(2);
      expect(downs(check('ok', ['--keep']))).toBe(1);
    }, 30_000);

    it('a service that never becomes healthy within the budget: exit 3 BUDGET, one-line reason', () => {
      const r = check('slow', ['--budget', '2']);
      expect(r.code).toBe(3);
      expect(verdict(r)).toMatch(/^compose-check: BUDGET: not healthy within 2s: logic$/);
      expect(r.out).toMatch(/logic\s+2\s+NOT HEALTHY/);
    });

    it('an unhealthy service is a FAIL (exit 1) with its name in the reason', () => {
      const r = check('logic-unhealthy');
      expect(r.code).toBe(1);
      expect(verdict(r)).toMatch(/^compose-check: FAIL: logic failed or unhealthy/);
      expect(r.err).toContain('--- last log lines of logic');
    });

    it('a non-78 exit of migrate is a FAIL, not a stub', () => {
      const r = check('migrate-fail');
      expect(r.code).toBe(1);
      expect(verdict(r)).toMatch(/^compose-check: FAIL: migrate failed or unhealthy/);
    });

    it('a service without a healthcheck that keeps restarting is a FAIL', () => {
      const r = check('worker-crash');
      expect(r.code).toBe(1);
      expect(verdict(r)).toMatch(/^compose-check: FAIL: worker failed or unhealthy/);
    });
  });

  describe('stubbed services (OPS-02 entries not built) are reported, never green', () => {
    it('stubbed migrate: exit 4 PENDING, listed as STUB(78), dependents NOT STARTED, network test still ran', () => {
      const r = check('stub');
      expect(r.code).toBe(4);
      expect(r.out).toMatch(/migrate\s+2\s+STUB\(78\)/);
      expect(r.out).toMatch(/logic\s+2\s+NOT STARTED/);
      expect(r.out).toMatch(/worker\s+2\s+NOT STARTED/);
      expect(r.out).toMatch(/STUBBED services .*: migrate/);
      expect(r.order).toContain('exec getent hosts db');
      expect(verdict(r)).toMatch(/^compose-check: PENDING: stubbed \(exit 78, entry not built\): migrate; stack incomplete/);
      expect(r.out).not.toMatch(/PASS/);
    });

    it('a stubbed worker (running, restarting) is also PENDING', () => {
      const r = check('worker-stub');
      expect(r.code).toBe(4);
      expect(r.out).toMatch(/worker\s+2\s+STUB\(78\)/);
    });

    it('--strict (or COMPOSE_CHECK_STRICT=1) turns a stub into a FAIL', () => {
      const a = check('stub-strict', ['--strict']);
      expect(a.code).toBe(1);
      expect(verdict(a)).toMatch(/^compose-check: FAIL: stubbed services in strict mode .*: migrate/);
      const b = run(['--no-build', '--settle', '0', '--env-file', ENV_FILE, '--project', 'ops-test'], {
        scenario: 'stub',
        env: { COMPOSE_CHECK_STRICT: '1' },
      });
      expect(b.code).toBe(1);
    });
  });

  describe('G13: web cannot reach the data tier', () => {
    it('runs getent hosts db and objects inside web, requires "not found" and a working control lookup', () => {
      const r = check('ok');
      expect(r.order).toContain('exec getent hosts db');
      expect(r.order).toContain('exec getent hosts objects');
      expect(r.order).toContain('exec getent hosts logic');
      expect(r.out).toMatch(/getent hosts db: not found \(exit 2\)\s+ok/);
      expect(r.out).toMatch(/getent hosts objects: not found \(exit 2\)\s+ok/);
      expect(r.out).toMatch(/control: getent hosts logic resolves/);
      expect(r.out).toMatch(/web networks: p_edge\s*$/m);
    });

    it('web resolving db is a FAIL (exit 1) with a one-line reason', () => {
      const r = check('web-resolves-db');
      expect(r.code).toBe(1);
      expect(r.err.trimEnd().split('\n').pop()).toBe('compose-check: FAIL: web resolves db (tier separation broken)');
    });

    it('a getent that cannot run (exit 127) is inconclusive, not a pass', () => {
      const r = check('no-getent');
      expect(r.code).toBe(1);
      expect(verdict(r)).toMatch(/network test inconclusive: getent hosts db exited 127/);
    });

    it('web attached to the data network is a FAIL', () => {
      const r = check('data-net');
      expect(r.code).toBe(1);
      expect(verdict(r)).toMatch(/web is attached to the data network/);
    });
  });

  // INT-01 (M0 exit, 09 §1): what migrate applied and what web serves, checked in the running stack.
  describe('M0: schema + RLS + views applied by migrate, seed loaded, tokens served as CSS [INT-01]', () => {
    it('all present: the data-tier and token checks run and print ok, verdict stays PASS', () => {
      const r = check('ok');
      expect(r.code, r.err + r.out).toBe(0);
      expect(r.order).toContain('exec db psql');
      expect(r.order).toContain('exec web css');
      expect(r.out).toMatch(/migrations applied: \d+ of \d+\s+ok/);
      expect(r.out).toMatch(/RLS enabled and forced on all \d+ tenant tables\s+ok/);
      expect(r.out).toMatch(/views present: v_inputs_resolved, v_dimension_members\s+ok/);
      expect(r.out).toContain(`seed tenant "${SEED}" loaded`);
      expect(r.out).toMatch(/design tokens in the served CSS: \d+ of \d+\s+ok/);
    });

    it.each([
      ['migration-missing', /migrations not applied by migrate: manual\/\S+\.sql/],
      ['rls-missing', /RLS not enabled and forced on tenant tables: line_item/],
      ['view-missing', /views missing after migrate: v_dimension_members/],
      ['seed-missing', new RegExp(`seed tenant "${SEED}" not loaded by migrate`)],
      ['tokens-missing', /web serves no design token CSS: \d+ of \d+ custom properties missing/],
    ])('%s is a FAIL with a one-line reason', (sc, re) => {
      const r = check(sc);
      expect(r.code, r.out).toBe(1);
      expect(verdict(r)).toMatch(/^compose-check: FAIL: /);
      expect(verdict(r)).toMatch(re);
    });

    it('stubbed migrate: the data-tier check is reported as not run (PENDING), the token check still runs', () => {
      const r = check('stub');
      expect(r.code).toBe(4);
      expect(r.out).toMatch(/data tier: not checked, migrate did not complete \(stub\)/);
      expect(r.order).not.toContain('exec db psql');
      expect(r.out).toMatch(/design tokens in the served CSS: \d+ of \d+\s+ok/);
      expect(verdict(r)).toMatch(/data tier not verified/);
    });

    it('the dry-run plan names both checks', () => {
      const r = run(['--dry-run']);
      expect(r.out).toMatch(/schema_migration/);
      expect(r.out).toMatch(/relrowsecurity/);
      expect(r.out).toMatch(/tokens\.css/);
    });
  });

  describe('one-line failure reason, wired for CI (FND-04 job "compose")', () => {
    it('every non-zero exit ends stderr with a single "compose-check: STATUS: reason" line', () => {
      for (const sc of ['logic-unhealthy', 'migrate-fail', 'web-resolves-db', 'no-getent', 'stub', 'data-net']) {
        const r = check(sc);
        expect(r.code, sc).not.toBe(0);
        expect(verdict(r), sc).toMatch(/^compose-check: (FAIL|PENDING|BUDGET): \S.*$/);
        expect(verdict(r).includes('\n')).toBe(false);
      }
    }, 60_000);

    it('the compose job in ci.yml runs the script, with PENDING (exit 4) as a notice and everything else failing', () => {
      const ci = readFileSync(join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8');
      const job = ci.slice(ci.indexOf('\n  compose:'));
      expect(job).toContain('ops/compose-check.sh');
      expect(job).toMatch(/4\) echo "::notice title=G14 PENDING::\$reason"/);
      expect(job).toMatch(/\*\) echo "::error title=G14 Container::\$reason"; exit "\$rc"/);
      expect(job).not.toMatch(/docker compose up -d --build --wait/);
      expect(ci).toMatch(/schedule:/);
    });
  });

  it('keeps its image -> Dockerfile map and service names in step with docker-compose.yml', () => {
    const script = readFileSync(SCRIPT, 'utf8');
    const map = /^IMAGES="([^"]+)"/m.exec(script)![1]!.split(' ');
    for (const pair of map) {
      const [image, dockerfile] = pair.split(':') as [string, string];
      const svc = Object.values(COMPOSE.services).find((s) => s.image?.startsWith(`${image}:`));
      expect(svc, image).toBeDefined();
      expect(svc!.build?.dockerfile, image).toBe(dockerfile);
    }
    expect(SERVICES).toEqual(expect.arrayContaining(['db', 'migrate', 'logic', 'worker', 'web']));
  });
});
