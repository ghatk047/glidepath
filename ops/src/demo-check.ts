// OPS-06: the checks of ops/demo-check.sh. Everything here talks to the stack through its two published ports
// (web on https://localhost, the mail sink on http://127.0.0.1:8025), by IP literal or `localhost` mapped to
// 127.0.0.1 in the connection, so no DNS name is ever resolved and the check runs with networking off (G14:
// in a container on `--network none` the two ports arrive as unix sockets, see `socketPath`).
// No business number lives here: expected values are read from docs/spec/reference (golden_results.json,
// solver_demo_results.json) and the tolerances come from @glidepath/parity.
import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { SOLVER_TOLERANCES, goldenClose, pyRound } from '@glidepath/parity';

export const UA_DRAFT_REASON = 'UA reconfig draft not cached (run pnpm ai:rehearse --tenant ua)';
/** The four headline cells of Cockpit C that docs/spec/reference/golden_results.json pins (spec ids verbatim). */
export const GOLDEN_HEADLINES = ['res.net', 'res.gap', 'res.risk', 'br.eps27'] as const;
export const TENANT = 'aa';

export interface Endpoint {
  /** `https://localhost`, `http://127.0.0.1:8025`. Only loopback hosts are accepted. */
  readonly url: string;
  /** Reach the endpoint through this unix socket instead of TCP (a checker container without a network). */
  readonly socketPath?: string;
}

export interface CheckConfig {
  readonly web: Endpoint;
  readonly mail: Endpoint;
  readonly email: string;
  readonly goldenFile: string;
  readonly solverFile: string;
  /** How long to wait for the sign-in mail, ms. */
  readonly mailTimeoutMs?: number;
}

export interface CheckResult {
  readonly name: string;
  readonly ok: boolean;
  /** One line: what held, or why it did not. */
  readonly detail: string;
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export class CheckError extends Error {}

export function assertLoopback(url: string): URL {
  const u = new URL(url);
  if (!LOOPBACK.has(u.hostname)) throw new CheckError(`refusing ${u.hostname}: demo-check only talks to localhost`);
  return u;
}

interface Reply {
  readonly status: number;
  readonly headers: http.IncomingHttpHeaders;
  readonly text: string;
}

interface Call {
  readonly method?: string;
  readonly path: string;
  readonly headers?: Record<string, string>;
  readonly body?: string;
}

/** A tiny cookie-keeping client for one endpoint. */
class Client {
  readonly jar = new Map<string, string>();
  constructor(readonly ep: Endpoint) {
    assertLoopback(ep.url);
  }

  request(call: Call): Promise<Reply> {
    const u = new URL(call.path, this.ep.url);
    const tls = u.protocol === 'https:';
    const headers: Record<string, string> = { accept: 'application/json', ...call.headers };
    if (this.jar.size > 0) headers.cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    if (call.body !== undefined) headers['content-length'] = String(Buffer.byteLength(call.body));
    // `localhost` is connected as 127.0.0.1 (no lookup); the Host header and TLS name stay `localhost`.
    const host = u.hostname === 'localhost' ? '127.0.0.1' : u.hostname.replace(/^\[|\]$/g, '');
    const options: https.RequestOptions = {
      method: call.method ?? 'GET',
      path: u.pathname + u.search,
      headers: { host: u.host, ...headers },
      timeout: 20_000,
      ...(this.ep.socketPath
        ? { socketPath: this.ep.socketPath }
        : { host, port: u.port || (tls ? 443 : 80) }),
      // Caddy's local CA is not in the system store; the peer is this machine's own loopback.
      ...(tls ? { rejectUnauthorized: false, servername: u.hostname === '127.0.0.1' ? undefined : u.hostname } : {}),
    };
    return new Promise((resolve, reject) => {
      const req = (tls ? https : http).request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          for (const raw of res.headers['set-cookie'] ?? []) {
            const [pair = ''] = raw.split(';');
            const eq = pair.indexOf('=');
            if (eq > 0) {
              const value = pair.slice(eq + 1);
              if (value === '' || /;\s*max-age=0/i.test(raw)) this.jar.delete(pair.slice(0, eq));
              else this.jar.set(pair.slice(0, eq), value);
            }
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') });
        });
      });
      req.on('timeout', () => req.destroy(new Error('timed out')));
      req.on('error', (e) => reject(new CheckError(`${u.origin}${u.pathname}: ${e.message}`)));
      req.end(call.body);
    });
  }

  async json<T>(path: string, init: Omit<Call, 'path'> = {}): Promise<T> {
    const r = await this.request({ path, ...init });
    if (r.status < 200 || r.status >= 300) throw new CheckError(`${init.method ?? 'GET'} ${path} answered ${r.status}`);
    try {
      return JSON.parse(r.text) as T;
    } catch {
      throw new CheckError(`${path} did not answer JSON`);
    }
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const readJson = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'));

interface MailList {
  messages?: { ID: string; To?: { Address: string }[]; Subject?: string }[];
}

/** Signs in through the mail sink: ask for a link, read it from the sink, open it. Leaves the session in `web`'s jar. */
export async function signIn(web: Client, mail: Client, email: string, timeoutMs = 15_000): Promise<void> {
  const before = new Set(((await mail.json<MailList>('/api/v1/messages')).messages ?? []).map((m) => m.ID));
  const origin = new URL(web.ep.url).origin;
  const asked = await web.request({
    method: 'POST',
    path: '/api/auth/magic-link',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ email }),
  });
  if (asked.status !== 202) throw new CheckError(`sign-in: magic-link request answered ${asked.status}`);
  const until = Date.now() + timeoutMs;
  for (;;) {
    const fresh = ((await mail.json<MailList>('/api/v1/messages')).messages ?? []).find(
      (m) => !before.has(m.ID) && (m.To ?? []).some((t) => t.Address.toLowerCase() === email.toLowerCase()),
    );
    if (fresh) {
      const msg = await mail.json<{ Text?: string }>(`/api/v1/message/${fresh.ID}`);
      const link = /https?:\/\/[^\s"<>]+\/api\/auth\/callback\?token=[^\s"<>]+/.exec(msg.Text ?? '')?.[0];
      if (!link) throw new CheckError('sign-in: the mail has no sign-in link');
      const u = new URL(link);
      const r = await web.request({ path: u.pathname + u.search });
      if (r.status !== 303 || String(r.headers.location ?? '').includes('invalid-link'))
        throw new CheckError(`sign-in: the link was not accepted (${r.status} ${String(r.headers.location ?? '')})`);
      return;
    }
    if (Date.now() > until) throw new CheckError(`sign-in: no mail for ${email} reached the mail sink in ${timeoutMs / 1000}s`);
    await sleep(250);
  }
}

interface Scenario {
  id: string;
  key: string;
}
interface Run {
  status: string;
  result: { status: string; metrics: Record<string, number> } | null;
}
interface Lookup {
  run: Run | null;
  current: boolean;
}
interface ReconfigJob {
  status: string;
  tenant: string | null;
  plan: { tenant?: { slug?: string } } | null;
  drafts: unknown[];
}

/** Metric of the cached min-risk run -> reference field and the G5 tolerance (tools/parity solvers-gate, SOL-04). */
export function minRiskRules(): { metric: string; field: string; tol: number }[] {
  const T = SOLVER_TOLERANCES;
  return [
    { metric: 'risk_exposure', field: 'risk_exposure', tol: T.money },
    { metric: 'res.tot_ot_it[]', field: 'one_time_it', tol: T.money },
    { metric: 'res.fte_us[]', field: 'fte_us', tol: T.fte },
    { metric: 'res.fte_gcc[]', field: 'fte_gcc', tol: T.fte },
    { metric: 'res.net[]', field: 'net', tol: T.cents },
  ];
}

/** Compares the cached min-risk metrics with `min_risk_total_bar` of solver_demo_results.json; returns the misses. */
export function minRiskMisses(metrics: Record<string, number>, ref: Record<string, number>): string[] {
  const misses: string[] = [];
  for (const { metric, field, tol } of minRiskRules()) {
    const got = metrics[metric];
    const want = ref[field];
    if (typeof want !== 'number') throw new CheckError(`solver_demo_results.json min_risk_total_bar has no ${field}`);
    if (typeof got !== 'number') misses.push(`${metric} missing`);
    else if (!(Math.abs(got - want) <= tol)) misses.push(`${metric} ${round(got)} vs ${want} (tolerance ${tol})`);
  }
  return misses;
}

const round = (n: number): number => Math.round(n * 1e6) / 1e6;

type Check = [name: string, run: () => Promise<string>];

/** Runs every check and returns one result each; a check that throws is a failure with the message as reason. */
export async function runChecks(cfg: CheckConfig): Promise<CheckResult[]> {
  const web = new Client(cfg.web);
  const mail = new Client(cfg.mail);
  const results: CheckResult[] = [];
  const ctx: { scenarios?: Scenario[]; signedIn?: boolean } = {};

  const golden = readJson(cfg.goldenFile) as { scenarios: Record<string, Record<string, number>> };
  const solverRef = readJson(cfg.solverFile) as { min_risk_total_bar: Record<string, number> };

  const scenario = (key: string): Scenario => {
    const s = ctx.scenarios?.find((x) => x.key === key);
    if (!s) throw new CheckError(`scenario ${key} is not in the ${TENANT} tenant`);
    return s;
  };
  const lookup = async (key: string, problem: string): Promise<Run> => {
    const s = scenario(key);
    const q = new URLSearchParams({ scenarioId: s.id, problem, params: '{}' });
    const l = await web.json<Lookup>(`/api/t/${TENANT}/solver-runs/lookup?${q.toString()}`);
    if (!l.run || l.run.status !== 'done' || !l.run.result) throw new CheckError(`no cached ${problem} result for ${key}`);
    if (!l.current) throw new CheckError(`cached ${problem} result for ${key} is from older inputs`);
    return l.run;
  };

  const checks: Check[] = [
    [
      'sign-in through the mail sink',
      async () => {
        await signIn(web, mail, cfg.email, cfg.mailTimeoutMs);
        ctx.signedIn = true;
        const me = await web.json<{ email?: string }>('/api/me');
        return `signed in as ${me.email ?? cfg.email}`;
      },
    ],
    [
      'seed loaded',
      async () => {
        if (!ctx.signedIn) throw new CheckError('not signed in');
        const t = await web.json<{ tenants: { slug: string }[] }>('/api/tenants');
        if (!t.tenants.some((x) => x.slug === TENANT)) throw new CheckError(`tenant ${TENANT} is not seeded`);
        ctx.scenarios = (await web.json<{ scenarios: Scenario[] }>(`/api/t/${TENANT}/scenarios`)).scenarios;
        for (const k of ['C', 'D']) scenario(k);
        return `${TENANT} with ${ctx.scenarios.length} scenarios`;
      },
    ],
    [
      'calc C matches golden_results.json',
      async () => {
        const want = golden.scenarios.C;
        if (!want) throw new CheckError('golden_results.json has no scenario C');
        const calc = await web.json<{ outputs: Record<string, number>; stale: boolean }>(
          `/api/t/${TENANT}/scenarios/${scenario('C').id}/calc`,
        );
        if (calc.stale) throw new CheckError('calc for C is stale');
        const bad: string[] = [];
        for (const id of GOLDEN_HEADLINES) {
          const g = want[id];
          const got = calc.outputs[`${id}[]`];
          if (typeof g !== 'number') throw new CheckError(`golden_results.json C has no ${id}`);
          if (typeof got !== 'number') bad.push(`${id} missing`);
          else if (!goldenClose(pyRound(got, 6), g)) bad.push(`${id} ${got} vs ${g}`);
        }
        if (bad.length) throw new CheckError(`calc C differs from golden: ${bad.join('; ')}`);
        return GOLDEN_HEADLINES.map((id) => id).join(', ');
      },
    ],
    ['cached Monte Carlo C', async () => (await lookup('C', 'monte_carlo'), 'present')],
    ['cached Monte Carlo D', async () => (await lookup('D', 'monte_carlo'), 'present')],
    [
      'cached min-risk C matches solver_demo_results.json',
      async () => {
        const run = await lookup('C', 'min_risk_mix');
        const misses = minRiskMisses(run.result!.metrics, solverRef.min_risk_total_bar);
        if (misses.length)
          throw new CheckError(`cached min-risk C is off the reference (stale cache? rebuild with docker compose down -v): ${misses.join('; ')}`);
        return `risk exposure ${round(run.result!.metrics.risk_exposure ?? Number.NaN)}`;
      },
    ],
    [
      'parity recorded',
      async () => {
        const l = await web.json<{ parity: { tenant: string; passed: number; total: number }[] }>('/api/ai/reconfig');
        const p = l.parity.find((x) => x.tenant === TENANT);
        if (!p) throw new CheckError('parity not recorded (run pnpm parity:golden --out tier3-data/seed/parity, rebuild, down -v, up)');
        if (p.total === 0 || p.passed !== p.total) throw new CheckError(`parity ${p.passed}/${p.total}`);
        return `parity ${p.passed}/${p.total}`;
      },
    ],
    [
      'cached UA reconfig draft',
      async () => {
        const l = await web.json<{ jobs: ReconfigJob[] }>('/api/ai/reconfig');
        const job = l.jobs.find((j) => j.status === 'review' && j.drafts.length > 0 && (j.tenant === 'ua' || j.plan?.tenant?.slug === 'ua'));
        if (!job) throw new CheckError(UA_DRAFT_REASON);
        return `${job.drafts.length} draft(s) in review`;
      },
    ],
  ];

  for (const [name, run] of checks) {
    try {
      results.push({ name, ok: true, detail: await run() });
    } catch (e) {
      results.push({ name, ok: false, detail: (e instanceof Error ? e.message : String(e)).split('\n')[0]! });
    }
  }
  return results;
}
