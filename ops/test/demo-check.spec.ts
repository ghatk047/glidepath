// OPS-06: ops/demo-check.sh against a fixture stack (an HTTP server playing the web API and the mail sink).
// The fixture's numbers are read from docs/spec/reference, as the checker's are; nothing here is a business number.
// The real-stack run (every container healthy, the actual numbers) is the manual gate in ops/README.md.
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { GOLDEN_HEADLINES, UA_DRAFT_REASON, assertLoopback, minRiskMisses, runChecks } from '../src/demo-check';
import { REPO_ROOT } from '../src/index';

vi.setConfig({ testTimeout: 120_000 });

const REF = join(REPO_ROOT, 'docs/spec/reference');
const golden = JSON.parse(readFileSync(join(REF, 'golden_results.json'), 'utf8')) as { scenarios: Record<string, Record<string, number>> };
const solver = JSON.parse(readFileSync(join(REF, 'solver_demo_results.json'), 'utf8')) as { min_risk_total_bar: Record<string, number> };
const SCRIPT = join(REPO_ROOT, 'ops/demo-check.sh');
const EMAIL = 'demo@example.com';

interface Fixture {
  ua: boolean;
  /** Added to the cached min-risk risk exposure: 0 = as the reference, 0.5 = a cache warmed before SOL-12. */
  riskSkew: number;
  calcSkew: number;
  mc: boolean;
  parity: boolean;
  mailWorks: boolean;
}
const complete = (): Fixture => ({ ua: true, riskSkew: 0, calcSkew: 0, mc: true, parity: true, mailWorks: true });

/** One server plays both ports: /api/v1/* is the mail sink, the rest is the web API. */
function startFixture(state: Fixture): Promise<{ url: string; close: () => Promise<void>; calls: string[] }> {
  const sent: { ID: string; To: { Address: string }[]; Text: string }[] = [];
  const calls: string[] = [];
  let url = '';
  const json = (res: http.ServerResponse, body: unknown, status = 200) => {
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  };
  const C = { id: 'sc-c', key: 'C' };
  const D = { id: 'sc-d', key: 'D' };
  const mr = solver.min_risk_total_bar;
  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    calls.push(`${req.method} ${u.pathname}`);
    const authed = (req.headers.cookie ?? '').includes('session=ok');
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (u.pathname === '/api/v1/messages') return json(res, { messages: sent.map(({ ID, To }) => ({ ID, To })) });
      if (u.pathname.startsWith('/api/v1/message/')) return json(res, sent.find((m) => `/api/v1/message/${m.ID}` === u.pathname) ?? {}, 200);
      if (u.pathname === '/api/auth/magic-link' && req.method === 'POST') {
        if (req.headers.origin !== url) return json(res, { title: 'cross-site' }, 403);
        if (state.mailWorks) sent.push({ ID: `m${sent.length + 1}`, To: [{ Address: (JSON.parse(body) as { email: string }).email }], Text: `Open:\n\n${url}/api/auth/callback?token=t${sent.length + 1}\n` });
        return json(res, { status: 'accepted' }, 202);
      }
      if (u.pathname === '/api/auth/callback') {
        res.writeHead(303, { location: '/', 'set-cookie': 'session=ok; Path=/; HttpOnly' }).end();
        return;
      }
      if (!authed) return json(res, { title: 'unauthenticated' }, 401);
      if (u.pathname === '/api/me') return json(res, { email: EMAIL });
      if (u.pathname === '/api/tenants') return json(res, { tenants: [{ slug: 'aa' }] });
      if (u.pathname === '/api/t/aa/scenarios') return json(res, { scenarios: [C, D] });
      if (u.pathname === `/api/t/aa/scenarios/${C.id}/calc`) {
        const outputs: Record<string, number> = {};
        for (const id of GOLDEN_HEADLINES) outputs[`${id}[]`] = golden.scenarios.C![id]! + state.calcSkew;
        return json(res, { outputs, stale: false });
      }
      if (u.pathname === '/api/t/aa/solver-runs/lookup') {
        const problem = u.searchParams.get('problem');
        const scenarioId = u.searchParams.get('scenarioId');
        if (u.searchParams.get('params') !== '{}') return json(res, { run: null, current: false, trials: null });
        if (problem === 'monte_carlo' && state.mc) return json(res, { run: { status: 'done', result: { status: 'optimal', metrics: {} } }, current: true, trials: 2000 });
        if (problem === 'min_risk_mix' && scenarioId === C.id) {
          const metrics = { risk_exposure: mr.risk_exposure! + state.riskSkew, 'res.tot_ot_it[]': mr.one_time_it!, 'res.fte_us[]': mr.fte_us!, 'res.fte_gcc[]': mr.fte_gcc!, 'res.net[]': mr.net! };
          return json(res, { run: { status: 'done', result: { status: 'feasible', metrics } }, current: true, trials: null });
        }
        return json(res, { run: null, current: false, trials: null });
      }
      if (u.pathname === '/api/ai/reconfig') {
        const jobs = state.ua ? [{ status: 'review', tenant: null, plan: { tenant: { slug: 'ua' } }, drafts: [{ kind: 'seed' }, { kind: 'lever_tuning' }] }] : [];
        return json(res, { jobs, parity: state.parity ? [{ tenant: 'aa', passed: 245, total: 245 }] : [] });
      }
      return json(res, { title: 'not found' }, 404);
    });
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve({ url, calls, close: () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); }) });
    }),
  );
}

/** Async: the fixture server lives in this process, so a blocking spawn would starve it. */
function runScript(url: string, extra: string[] = [], env: Record<string, string> = {}) {
  return new Promise<{ code: number; out: string; err: string }>((resolve) => {
    const args = ['--skip-containers', '--web', url, '--mail', url, '--email', EMAIL, '--mail-timeout', '3', ...extra];
    const child = spawn(SCRIPT, args, { cwd: REPO_ROOT, env: { ...process.env, ...env } });
    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (err += d.toString()));
    const timer = setTimeout(() => child.kill('SIGKILL'), 110_000);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, out, err });
    });
  });
}

describe('ops/demo-check.sh against a fixture stack', () => {
  let fx: Awaited<ReturnType<typeof startFixture>>;
  let state: Fixture;
  beforeAll(async () => {
    state = complete();
    fx = await startFixture(state);
  });
  afterAll(() => fx.close());
  const reset = (over: Partial<Fixture> = {}) => Object.assign(state, complete(), over);

  it('passes on a complete stack: sign-in through the mail sink, golden C, cached results, UA draft', async () => {
    reset();
    const r = await runScript(fx.url);
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    expect(r.out).toContain('PASS sign-in through the mail sink');
    expect(r.out).toContain('PASS calc C matches golden_results.json: res.net, res.gap, res.risk, br.eps27');
    expect(r.out).toMatch(/PASS cached Monte Carlo C/);
    expect(r.out).toMatch(/PASS cached min-risk C matches solver_demo_results.json/);
    expect(r.out).toMatch(/demo-check: PASS/);
    // The sign-in went through the sink: one magic-link request, one mail read, one callback.
    expect(fx.calls).toContain('POST /api/auth/magic-link');
    expect(fx.calls).toContain('GET /api/auth/callback');
  });

  it('exits non-zero with the one-line reason when the UA draft is not cached (the live stack until AI-07)', async () => {
    reset({ ua: false });
    const r = await runScript(fx.url);
    expect(r.code).toBe(1);
    expect(r.err.trim().split('\n')).toEqual([`FAIL cached UA reconfig draft: ${UA_DRAFT_REASON}`, `demo-check: FAIL: ${UA_DRAFT_REASON}`]);
  });

  it('fails when calc C is off the golden values by more than 1e-6 relative', async () => {
    reset({ calcSkew: 0.001 });
    const r = await runScript(fx.url);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/demo-check: FAIL: calc C differs from golden: res\.net /);
  });

  it('fails when Monte Carlo is not cached', async () => {
    reset({ mc: false });
    const r = await runScript(fx.url);
    expect(r.code).toBe(1);
    expect(r.err).toContain('no cached monte_carlo result for C');
  });

  it('fails on a cache warmed before SOL-12 (min-risk risk exposure off the reference)', async () => {
    reset({ riskSkew: 0.51 });
    const r = await runScript(fx.url);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/FAIL: cached min-risk C is off the reference .*risk_exposure/);
  });

  it('fails when parity is not recorded', async () => {
    reset({ parity: false });
    expect((await runScript(fx.url)).err).toMatch(/demo-check: FAIL: parity not recorded/);
  });

  it('fails when the sign-in mail never arrives', async () => {
    reset({ mailWorks: false });
    const r = await runScript(fx.url);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/sign-in: no mail for demo@example.com reached the mail sink/);
  });

  it('refuses any host but localhost (no DNS name is ever resolved)', async () => {
    expect(() => assertLoopback('https://example.com')).toThrow(/only talks to localhost/);
    expect(() => assertLoopback('https://localhost')).not.toThrow();
    expect(() => assertLoopback('http://127.0.0.1:8025')).not.toThrow();
    const r = await runScript('https://example.com');
    expect(r.code).toBe(1);
    expect(r.err).toContain('only talks to localhost');
  });

  it('min-risk comparison uses the G5 tolerances: the reference passes, 0.51 off fails', () => {
    const mr = solver.min_risk_total_bar;
    const metrics = { risk_exposure: mr.risk_exposure!, 'res.tot_ot_it[]': mr.one_time_it!, 'res.fte_us[]': mr.fte_us!, 'res.fte_gcc[]': mr.fte_gcc!, 'res.net[]': mr.net! };
    expect(minRiskMisses(metrics, mr)).toEqual([]);
    expect(minRiskMisses({ ...metrics, risk_exposure: mr.risk_exposure! + 0.51 }, mr)).toHaveLength(1);
  });

  it('runs in-process too (runChecks): every check passing', async () => {
    reset();
    const results = await runChecks({
      web: { url: fx.url },
      mail: { url: fx.url },
      email: EMAIL,
      goldenFile: join(REF, 'golden_results.json'),
      solverFile: join(REF, 'solver_demo_results.json'),
      mailTimeoutMs: 3000,
    });
    expect(results.filter((r) => !r.ok)).toEqual([]);
    expect(results).toHaveLength(8);
  });
});

// Networking off: the checker container on `--network none`, the stack's two ports reaching it as unix sockets
// from ops/demo-check-relay.mjs. Needs a Docker daemon and an image with node 22 (any glidepath/logic image).
function nodeImage(): string | null {
  if (spawnSync('docker', ['info'], { encoding: 'utf8' }).status !== 0) return null;
  const r = spawnSync('docker', ['image', 'ls', '--format', '{{.Repository}}:{{.Tag}}', 'glidepath/logic'], { encoding: 'utf8' });
  return r.stdout.split('\n').find((l) => l && !l.endsWith(':<none>')) ?? null;
}
const IMAGE = process.env.DEMO_CHECK_IMAGE ?? nodeImage();

describe.skipIf(!IMAGE)('demo-check with the checker container on --network none', () => {
  it('signs in and passes through the socket relay; the container has no network to resolve anything', async () => {
    const state = complete();
    const fx = await startFixture(state);
    try {
      const r = await runScript(fx.url, ['--isolated', '--image', IMAGE!]);
      expect(r.err).toBe('');
      expect(r.code).toBe(0);
      expect(r.out).toContain('isolated: checker container on --network none');
      expect(r.out).toMatch(/demo-check: PASS/);
      // Sanity: the same image on --network none cannot resolve a name (so a pass above resolved none).
      const probe = spawnSync('docker', ['run', '--rm', '--network', 'none', '--entrypoint', 'node', IMAGE!, '-e', "require('dns').lookup('example.com',e=>process.exit(e?0:1))"], { encoding: 'utf8' });
      expect(probe.status).toBe(0);
    } finally {
      await fx.close();
    }
  }, 120_000);

  it('still fails with the one-line reason inside the container when the UA draft is missing', async () => {
    const fx = await startFixture({ ...complete(), ua: false });
    try {
      const r = await runScript(fx.url, ['--isolated', '--image', IMAGE!]);
      expect(r.code).toBe(1);
      expect(r.err.trim().split('\n').pop()).toBe(`demo-check: FAIL: ${UA_DRAFT_REASON}`);
    } finally {
      await fx.close();
    }
  }, 120_000);
});
