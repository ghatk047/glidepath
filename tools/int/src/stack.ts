import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient, WS_SESSION_PATH } from '@glidepath/api-contract';
import type { ApiClient, FetchLike, RequestInitLike } from '@glidepath/api-contract';
import { openSession } from './socket';
import type { SessionSocket } from './socket';

/**
 * The running compose stack, reached the way a browser reaches it: through `web` (Caddy) at
 * PUBLIC_BASE_URL, signed in with a magic link caught by mailpit (dev profile). Settings are
 * environment only; the defaults match `.env.example`.
 *
 *   INT_BASE_URL         origin of the stack (default PUBLIC_BASE_URL, else https://localhost)
 *   INT_MAIL_URL         mailpit API (default http://localhost:8025)
 *   INT_EMAIL            user to sign in as (default DEMO_USER_EMAIL, else demo@example.com)
 *   INT_TENANT           tenant slug (default aa, the seeded tenant)
 *   INT_CA_FILE          PEM of the CA that signed the site certificate; when unset and the base is
 *                        https, it is read from the web container's Caddy data
 *   INT_COMPOSE_PROJECT  compose project to read that CA from (default glidepath)
 */

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export const config = {
  baseUrl: (process.env.INT_BASE_URL || process.env.PUBLIC_BASE_URL || 'https://localhost').replace(/\/+$/, ''),
  mailUrl: (process.env.INT_MAIL_URL || 'http://localhost:8025').replace(/\/+$/, ''),
  email: process.env.INT_EMAIL || process.env.DEMO_USER_EMAIL || 'demo@example.com',
  tenant: process.env.INT_TENANT || 'aa',
  caFile: process.env.INT_CA_FILE || '',
  composeProject: process.env.INT_COMPOSE_PROJECT || 'glidepath',
} as const;

/** Caddy's internal root CA inside the web container (`tls internal`, caddydata volume). */
const CADDY_ROOT_CA = '/data/caddy/pki/authorities/local/root.crt';

/** The PEM that signed the site certificate, or null for a plain-http base. */
export function siteCa(): string | null {
  if (!config.baseUrl.startsWith('https:')) return null;
  if (config.caFile) return readFileSync(config.caFile, 'utf8');
  return execFileSync(
    'docker',
    ['compose', '-p', config.composeProject, 'exec', '-T', 'web', 'cat', CADDY_ROOT_CA],
    { encoding: 'utf8', cwd: repoRoot },
  );
}

export const readRepoJson = <T>(...parts: string[]): T =>
  JSON.parse(readFileSync(join(repoRoot, ...parts), 'utf8')) as T;

const LINK = /https?:\/\/\S+\/api\/auth\/callback\?token=[A-Za-z0-9_-]+/;
const MAIL_POLL_MS = 250;
const MAIL_WAIT_MS = 20_000;

interface MailList {
  messages: { ID: string; To: { Address: string }[] }[];
}

async function mailIds(): Promise<Set<string>> {
  const res = await fetch(`${config.mailUrl}/api/v1/messages?limit=200`);
  if (!res.ok) throw new Error(`mailpit ${res.status}: is the dev profile (mail) up?`);
  const list = (await res.json()) as MailList;
  return new Set(list.messages.map((m) => m.ID));
}

async function newLinkFor(email: string, seen: Set<string>): Promise<string> {
  const deadline = Date.now() + MAIL_WAIT_MS;
  while (Date.now() < deadline) {
    const res = await fetch(`${config.mailUrl}/api/v1/messages?limit=200`);
    const list = (await res.json()) as MailList;
    const mail = list.messages.find(
      (m) => !seen.has(m.ID) && m.To.some((t) => t.Address.toLowerCase() === email.toLowerCase()),
    );
    if (mail) {
      const body = (await (await fetch(`${config.mailUrl}/api/v1/message/${mail.ID}`)).json()) as { Text: string };
      const link = LINK.exec(body.Text)?.[0];
      if (!link) throw new Error('sign-in mail carries no callback link');
      return link;
    }
    await new Promise((r) => setTimeout(r, MAIL_POLL_MS));
  }
  throw new Error(`no sign-in mail for ${email} within ${MAIL_WAIT_MS} ms`);
}

/** A signed-in browser: the Cookie header it sends and the CSRF token it echoes. */
export interface Browser {
  readonly cookie: string;
  readonly csrf: string;
}

const CSRF_COOKIE = 'gp_csrf';
const CSRF_HEADER = 'x-csrf-token';

/** Magic-link sign-in (ADR-014) through the public routes, the link read from mailpit. */
export async function signIn(email = config.email): Promise<Browser> {
  const seen = await mailIds();
  const asked = await fetch(`${config.baseUrl}/api/auth/magic-link`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: config.baseUrl },
    body: JSON.stringify({ email }),
  });
  if (asked.status !== 202) throw new Error(`magic-link answered ${asked.status}: ${await asked.text()}`);
  const link = await newLinkFor(email, seen);
  const cb = await fetch(link, { redirect: 'manual' });
  const pairs = cb.headers.getSetCookie().map((c) => c.split(';')[0]!.trim()).filter((p) => !p.endsWith('='));
  const csrfPair = pairs.find((p) => p.startsWith(`${CSRF_COOKIE}=`));
  if (!csrfPair || pairs.length < 2) throw new Error(`callback answered ${cb.status} without a session`);
  return { cookie: pairs.join('; '), csrf: decodeURIComponent(csrfPair.slice(CSRF_COOKIE.length + 1)) };
}

/** Same-origin request headers of `browser`. */
export const browserHeaders = (b: Browser): Record<string, string> => ({
  cookie: b.cookie,
  origin: config.baseUrl,
  [CSRF_HEADER]: b.csrf,
});

/** The contract's typed client, sending `browser`'s cookie, Origin and CSRF header. */
export function apiAs(b: Browser): ApiClient {
  const f: FetchLike = (url: string, init?: RequestInitLike) =>
    fetch(url, { ...init, headers: { ...init?.headers, ...browserHeaders(b) } } as RequestInit);
  return createClient(config.baseUrl, f);
}

/** `WS /ws/session?tenant&scenario` as `browser`. */
export function sessionAs(b: Browser, scenarioId: string): Promise<SessionSocket> {
  const q = new URLSearchParams({ tenant: config.tenant, scenario: scenarioId });
  const url = `${config.baseUrl.replace(/^http/, 'ws')}${WS_SESSION_PATH}?${q.toString()}`;
  return openSession(url, { cookie: b.cookie, origin: config.baseUrl });
}
