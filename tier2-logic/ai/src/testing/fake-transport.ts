import { readFileSync } from 'node:fs';
import type { Transport } from '../client';

/**
 * Test support: a `fetch` replacement that replays recorded API exchanges and records every request.
 * Nothing here opens a socket; a request beyond the scripted exchanges fails the test.
 */

export type Exchange =
  | { status: number; headers?: Record<string, string>; events: unknown[] }
  | { status: number; headers?: Record<string, string>; body: unknown }
  | { networkError: true };

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  // Recorded JSON request body; tests index into it freely.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
}

const FIXTURES = new URL('../../fixtures/', import.meta.url);

export function loadExchanges(name: string): Exchange[] {
  const f = JSON.parse(readFileSync(new URL(`${name}.json`, FIXTURES), 'utf8')) as {
    exchanges: Exchange[];
  };
  return f.exchanges;
}

export function loadError(name: string): Exchange {
  const f = JSON.parse(readFileSync(new URL('errors.json', FIXTURES), 'utf8')) as {
    exchanges: Record<string, Exchange>;
  };
  const e = f.exchanges[name];
  if (!e) throw new Error(`no recorded error ${name}`);
  return e;
}

const sse = (events: unknown[]): string =>
  events
    .map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`)
    .join('');

export function fakeTransport(script: Exchange[]): {
  fetch: Transport;
  requests: RecordedRequest[];
} {
  const queue = [...script];
  const requests: RecordedRequest[] = [];
  const fetch: Transport = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const raw = typeof init?.body === 'string' ? init.body : '';
    requests.push({
      url,
      method: init?.method ?? 'GET',
      headers,
      body: raw ? JSON.parse(raw) : null,
    });
    const next = queue.shift();
    if (!next) throw new Error(`fake transport: unscripted request #${requests.length} to ${url}`);
    if ('networkError' in next) throw new TypeError('fetch failed: recorded connection reset');
    if ('events' in next) {
      return new Response(sse(next.events), {
        status: next.status,
        headers: { 'content-type': 'text/event-stream', ...next.headers },
      });
    }
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { 'content-type': 'application/json', ...next.headers },
    });
  };
  return { fetch, requests };
}
