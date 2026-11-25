import { WS_PROTOCOL_VERSION } from '@glidepath/api-contract';
import type { CellKey as WireCell } from '@glidepath/api-contract';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer } from '../app/start';
import type { RunningServer } from '../app/start';
import { AUTH_SECRET } from '../app/testing/fixtures';
import type { Mailer } from '../auth/mailer';
import { presetId, startAaDatabase } from '../routes/read/testing/aa-db';
import type { AaDatabase } from '../routes/read/testing/aa-db';
import { ORIGIN, PUBLIC_BASE_URL } from './testing/harness';
import { goldenCells, matchesGolden } from './testing/seed';
import { openSocket } from './testing/ws-client';

/**
 * `startServer` wires `WS /ws/session`: the `logic` process as `node dist/server.js` runs it (env config,
 * cookie auth, the DB loader, upgrades on the listening port), and `close()` ends open sessions (1001).
 */

let aa: AaDatabase;
let server: RunningServer;
const links: string[] = [];

beforeAll(async () => {
  aa = await startAaDatabase();
  const u = new URL(aa.database.adminUrl);
  u.pathname = `/${aa.database.database}`;
  u.searchParams.set('options', '-c role=glidepath_app');
  const mailer: Mailer = { sendMagicLink: async (m) => void links.push(m.link), close: () => undefined };
  server = await startServer(
    { DATABASE_URL: u.toString(), AUTH_SECRET, PUBLIC_BASE_URL, PORT: '0', LOG_LEVEL: 'silent' },
    { mailer },
  );
}, 180_000);

afterAll(async () => {
  await aa?.close();
});

async function signIn(email: string, base: string): Promise<string> {
  const res = await fetch(`${base}/api/auth/magic-link`, {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  expect(res.status).toBe(202);
  for (let i = 0; links.length === 0 && i < 100; i++) await new Promise((r) => setTimeout(r, 20));
  const link = new URL(links[0]!);
  const cb = await fetch(`${base}${link.pathname}${link.search}`, { redirect: 'manual' });
  expect(cb.status).toBe(303);
  return cb.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
}

describe('startServer serves WS /ws/session', () => {
  it('opens a session with the cookie of a magic-link sign-in, answers a golden snapshot, and closes it on shutdown', async () => {
    const base = `http://127.0.0.1:${server.port}`;
    const cookie = await signIn('ana@example.test', base);
    const r = await openSocket(`ws://127.0.0.1:${server.port}/ws/session?tenant=aa&scenario=${presetId('C')}`, { cookie, origin: ORIGIN });
    if (!r.ok) throw new Error(`refused: ${r.status} ${r.body}`);
    expect(server.sessions.sessions.size).toBe(1);

    r.socket.send({ v: WS_PROTOCOL_VERSION, type: 'subscribe', cells: ['res.net[]'] });
    const snap = await r.socket.expect('snapshot');
    const golden = goldenCells('C').get('res.net[]' as WireCell)!;
    expect(matchesGolden(snap.cells['res.net[]' as WireCell]!, golden)).toBe(true);

    await server.close();
    await expect(r.socket.next(2_000)).rejects.toThrow(/closed \(1001\)/);
    expect(server.sessions.sessions.size).toBe(0);
  });
});
