/**
 * How each call of the leak test is judged (QA-03, G7). Every call, whatever its purpose:
 *
 * 1. answers the status the case expects;
 * 2. carries no marker of tenant B or C (a value of their rows that tenant A does not have) in its status line,
 *    headers or body, apart from the caller's own arguments echoed back;
 * 3. leaves every row of tenants B and C exactly as it was (count and md5 per tenant table, read by a superuser).
 *
 * Calls aimed at another tenant (its row ids under tenant A's path, or its path by a non-member) must be refused
 * with a 404 that is indistinguishable from the 404 of an id or tenant that does not exist (same status, same body
 * once the ids are masked): a refusal must not tell that the row exists.
 */
import { randomUUID } from 'node:crypto';
import type { Browser, Body, Captured, LeakClient } from './client';
import { Markers, UUID_G, changedTables, digest, leaves, rowsOfTenant } from './oracle';
import type { Leaf, TenantTable } from './oracle';
import { SLUG, TENANT_ID } from './stack';
import type { LeakStack, UserName } from './stack';

export type Other = 'B' | 'C';
export const OTHERS: readonly Other[] = ['B', 'C'];

export interface World {
  readonly stack: LeakStack;
  readonly client: LeakClient;
  readonly browsers: Record<UserName, Browser>;
  readonly tables: readonly TenantTable[];
  markers: Markers;
  /** The digests of B and C as of the last check. */
  readonly last: Record<Other, Map<string, string>>;
}

const NOT_FOUND = 404;

/** Strings (and the uuids inside them) of a request: what an answer may echo back without leaking. */
export function requestTokens(path: string, body: Body): Set<string> {
  const out = new Set<string>();
  const add = (s: string): void => {
    out.add(s);
    out.add(s.toLowerCase());
    for (const u of s.match(UUID_G) ?? []) out.add(u.toLowerCase());
  };
  const u = new URL(path, 'http://x');
  add(u.pathname);
  for (const seg of u.pathname.split('/')) if (seg) add(decodeURIComponent(seg));
  for (const [, v] of u.searchParams) add(v);
  if (body && 'json' in body) for (const v of leaves([body.json])) if (typeof v === 'string') add(v);
  return out;
}

/** The answer with the given ids and slugs masked, `instance` and the request id dropped: for twin comparison. */
function masked(c: Captured, ids: readonly string[]): string {
  let body: string;
  if (c.json !== undefined && c.json !== null && typeof c.json === 'object' && !Array.isArray(c.json)) {
    const { instance: _instance, ...rest } = c.json as Record<string, unknown>;
    void _instance;
    body = JSON.stringify(rest);
  } else {
    body = c.text;
  }
  for (const id of ids) body = body.split(id).join('<id>');
  return `${c.status} ${c.headers['content-type'] ?? ''} ${body}`;
}

const replaceAll = (s: string, pairs: readonly (readonly [string, string])[]): string =>
  pairs.reduce((acc, [from, to]) => acc.split(from).join(to), s);

function swapBody(body: Body, pairs: readonly (readonly [string, string])[]): Body {
  if (!body || !('json' in body)) return body;
  return { json: JSON.parse(replaceAll(JSON.stringify(body.json), pairs)) };
}

export interface CallOptions {
  /** Statuses that count as the expected answer. */
  readonly expect: readonly number[];
  /** Values the answer may contain because the caller sent them. */
  readonly echoes?: ReadonlySet<string>;
  /** More values to look through (e.g. the cells of a downloaded workbook). */
  readonly values?: (c: Captured) => Promise<unknown[]>;
}

/** One route's checks; problems are collected and asserted at the end of the route's test. */
export class Probe {
  readonly problems: string[] = [];
  calls = 0;

  constructor(private readonly w: World) {}

  /** Sends one request as `user` and judges it (status, markers, other tenants' rows). */
  async call(label: string, user: UserName | Browser, method: string, path: string, body: Body, o: CallOptions): Promise<Captured> {
    const browser = typeof user === 'string' ? this.w.browsers[user] : user;
    const res = await this.w.client.request(browser, method, path, body);
    this.calls += 1;
    const who = typeof user === 'string' ? user : (user.user?.name ?? 'anonymous');
    const what = `${label} [${who}: ${method} ${path}]`;
    if (!o.expect.includes(res.status)) this.problems.push(`${what}: answered ${res.status}, expected ${o.expect.join(' or ')}: ${res.text.slice(0, 400)}`);
    const values: unknown[] = [res.json ?? res.text, res.headers];
    if (o.values && o.expect.includes(res.status)) values.push(...(await o.values(res)));
    await this.scan(what, `${res.status}\n${JSON.stringify(res.headers)}\n${res.text}`, values, o.echoes ?? new Set());
    await this.unchanged(what);
    return res;
  }

  /** Markers of B or C in an answer (or a WS frame), after dropping values tenant A now has itself. */
  async scan(what: string, text: string, values: unknown[], echoes: ReadonlySet<string>): Promise<void> {
    const hits = this.w.markers.find(text, values, echoes);
    if (hits.length === 0) return;
    // A value tenant A has written meanwhile (its own edit, its own new row) is no longer another tenant's alone.
    const own = leaves([...(await rowsOfTenant(this.w.stack.admin, this.w.tables, 'A')).values()].flat());
    const real = hits.filter((h) => !own.has(h.value) && !(typeof h.value === 'string' && own.has(h.value.toLowerCase())));
    if (real.length > 0) {
      this.problems.push(
        `${what}: returned other tenants' data: ${real
          .slice(0, 8)
          .map((h) => `${JSON.stringify(h.value)} (tenant ${h.source.tenant}, ${h.source.table})`)
          .join(', ')}${real.length > 8 ? ` and ${real.length - 8} more` : ''}`,
      );
    }
  }

  /** B's and C's rows are as they were at the last check. */
  async unchanged(what: string): Promise<void> {
    for (const t of OTHERS) {
      const now = await digest(this.w.stack.admin, this.w.tables, TENANT_ID[t]);
      const changed = changedTables(this.w.last[t], now);
      this.w.last[t] = now;
      if (changed.length > 0) this.problems.push(`${what}: changed rows of tenant ${t} (${SLUG[t]}) in ${changed.join(', ')}`);
    }
  }

  /** A call tenant A makes on its own data: it must work. */
  own(label: string, user: UserName, method: string, path: string, body?: Body, expect: readonly number[] = [200], values?: CallOptions['values']): Promise<Captured> {
    return this.call(`${label} (own)`, user, method, path, body, { expect, ...(values ? { values } : {}) });
  }

  /**
   * The same request and its twin with every id in `ids` replaced by a fresh uuid (`swapSlug` the tenant it was
   * sent to, replaced in the path): same status and same masked body, so a refusal tells nothing about what
   * exists. `aimed` and `foreign` use it for the tenant routes; a route that names the tenant in its body
   * instead of its path (`POST /api/ai/reconfig`) calls it directly, with the slug among the `ids`.
   */
  async refused(label: string, user: UserName, method: string, path: string, body: Body, ids: readonly string[], swapSlug?: string): Promise<void> {
    const echoes = requestTokens(path, body);
    const real = await this.call(label, user, method, path, body, { expect: [NOT_FOUND], echoes });
    const pairs: [string, string][] = ids.map((id) => [id, randomUUID()]);
    if (swapSlug) pairs.push([`/api/t/${swapSlug}/`, `/api/t/no-such-${randomUUID().slice(0, 8)}/`]);
    const twinPath = replaceAll(path, pairs);
    const twinBody = swapBody(body, pairs);
    const twin = await this.call(`${label}, twin with unknown ids`, user, method, twinPath, twinBody, { expect: [NOT_FOUND], echoes: requestTokens(twinPath, twinBody) });
    const masks = [...ids, ...pairs.map(([, to]) => to)];
    if (masked(real, masks) !== masked(twin, masks)) {
      this.problems.push(`${label} [${user}: ${method} ${path}]: the refusal differs from the one for an unknown id: ${masked(real, masks)} <> ${masked(twin, masks)}`);
    }
  }

  /**
   * Tenant A's route aimed at another tenant's rows: `pathOf(slug)` with the other tenant's `ids` in it (or in the
   * body). As tenant A's owner and as a member of both A and the copy, under tenant A's path: 404 like an unknown
   * id. Under the other tenant's own path, by a non-member: 404 like an unknown tenant.
   */
  async aimed(label: string, method: string, pathOf: (slug: string) => string, body: Body, at: Other, ids: readonly string[]): Promise<void> {
    for (const user of ['ana', 'max'] as const) {
      await this.refused(`${label} aimed at tenant ${at}`, user, method, pathOf(SLUG.A), body, ids);
    }
    await this.refused(`${label} on tenant ${at}'s own path by a non-member`, 'ana', method, pathOf(SLUG[at]), body, [], SLUG[at]);
    if (at === 'B') await this.refused(`${label} on tenant B's own path by a non-member`, 'max', method, pathOf(SLUG.B), body, [], SLUG.B);
  }

  /** A route without ids, on the other tenants' paths by a non-member: 404 like an unknown tenant. */
  async foreign(label: string, method: string, pathOf: (slug: string) => string, body?: Body): Promise<void> {
    for (const at of OTHERS) await this.refused(`${label} on tenant ${at}'s path by a non-member`, 'ana', method, pathOf(SLUG[at]), body, [], SLUG[at]);
    await this.refused(`${label} on tenant B's path by a non-member`, 'max', method, pathOf(SLUG.B), body, [], SLUG.B);
  }
}

export type { Leaf };
