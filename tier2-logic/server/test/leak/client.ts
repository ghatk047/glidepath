/**
 * A browser for the leak test: signs a user in through the magic link (the server's real cookie auth) and sends
 * requests as the SPA does (same origin, CSRF header on state-changing methods). Every answer is captured whole
 * (status, headers, body text and bytes) so the oracle can look through all of it.
 */
import { WS_SESSION_PATH } from '@glidepath/api-contract';
import { CSRF_COOKIE, CSRF_HEADER } from '../../src/auth/cookies';
import { openSocket } from '../../src/session/testing/ws-client';
import type { Opened, Refused } from '../../src/session/testing/ws-client';
import { ORIGIN } from './stack';
import type { LeakStack, LeakUser } from './stack';

/** The cookies a browser holds (name -> value). */
export class Browser {
  readonly jar = new Map<string, string>();
  constructor(readonly user: LeakUser | null) {}

  get cookie(): string {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  get csrf(): string {
    return decodeURIComponent(this.jar.get(CSRF_COOKIE) ?? '');
  }

  /** Takes the Set-Cookie headers of an answer (an expired or empty cookie is dropped). */
  take(res: Response): void {
    for (const sc of res.headers.getSetCookie()) {
      const pair = sc.split(';')[0] ?? '';
      const i = pair.indexOf('=');
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      if (value === '' || /max-age=0/i.test(sc)) this.jar.delete(name);
      else this.jar.set(name, value);
    }
  }
}

/** One answer, whole. */
export interface Captured {
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly text: string;
  readonly bytes: Uint8Array;
  /** The body as JSON, when it is JSON. */
  readonly json: unknown;
}

export type Body = { json: unknown } | { bytes: Uint8Array; contentType: string } | undefined;

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

export async function capture(method: string, path: string, res: Response): Promise<Captured> {
  const bytes = new Uint8Array(await res.arrayBuffer());
  const text = Buffer.from(bytes).toString('utf8');
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    headers[k] = v;
  });
  let json: unknown;
  if (/json/.test(headers['content-type'] ?? '')) {
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
  }
  return { method, path, status: res.status, headers, text, bytes, json };
}

export class LeakClient {
  constructor(private readonly stack: LeakStack) {}

  /** Signs `user` in through the magic link; the browser then holds the session and CSRF cookies. */
  async signIn(user: LeakUser): Promise<Browser> {
    const browser = new Browser(user);
    const before = this.stack.links.length;
    const res = await fetch(`${this.stack.base}/api/auth/magic-link`, {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ email: user.email }),
    });
    if (res.status !== 202) throw new Error(`magic-link for ${user.email} answered ${res.status}`);
    for (let i = 0; this.stack.links.length === before && i < 200; i++) await new Promise((r) => setTimeout(r, 10));
    const link = this.stack.links[before];
    if (!link) throw new Error(`no sign-in link for ${user.email}`);
    await this.callback(browser, link);
    if (!browser.jar.has(CSRF_COOKIE)) throw new Error(`sign-in of ${user.email} set no session`);
    return browser;
  }

  /** Opens a sign-in link in `browser` (the callback consumes the token and sets the cookies). */
  async callback(browser: Browser, link: string): Promise<Captured> {
    const u = new URL(link);
    const path = `${u.pathname}${u.search}`;
    const res = await fetch(`${this.stack.base}${path}`, { redirect: 'manual', headers: { cookie: browser.cookie } });
    browser.take(res);
    return capture('GET', path, res);
  }

  /** A request as the signed-in SPA sends it (or anonymous with a cookie-less browser). */
  async request(browser: Browser, method: string, path: string, body?: Body): Promise<Captured> {
    const headers: Record<string, string> = { origin: ORIGIN };
    if (browser.jar.size > 0) headers.cookie = browser.cookie;
    if (!SAFE.has(method) && browser.csrf) headers[CSRF_HEADER] = browser.csrf;
    let payload: string | Uint8Array | undefined;
    if (body && 'json' in body) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body.json);
    } else if (body) {
      headers['content-type'] = body.contentType;
      payload = body.bytes;
    }
    const res = await fetch(`${this.stack.base}${path}`, { method, headers, body: payload, redirect: 'manual' });
    browser.take(res);
    return capture(method, path, res);
  }

  /** `WS /ws/session?tenant&scenario` as `browser` (same origin, its cookies). */
  socket(browser: Browser, tenant: string, scenario: string): Promise<Opened | Refused> {
    const query = new URLSearchParams({ tenant, scenario }).toString();
    const headers: Record<string, string> = { origin: ORIGIN };
    if (browser.jar.size > 0) headers.cookie = browser.cookie;
    return openSocket(`ws://127.0.0.1:${this.stack.server.port}${WS_SESSION_PATH}?${query}`, headers);
  }
}
