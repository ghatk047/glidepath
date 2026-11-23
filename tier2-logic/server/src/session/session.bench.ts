/**
 * Session perf budget (G8, 08 §1; 07 §3): `pnpm --filter @glidepath/server bench`.
 *
 * `ws.preview`: one preview frame over a loopback WebSocket until its `delta` arrives, on preset C of the
 * seed tenant (pg-local, cookie auth, the DB loader) with every golden cell subscribed, a lever and the target
 * moved one registry step per preview, each preview answered before the next is sent, at the contract's rate
 * (`PREVIEW_MIN_INTERVAL_MS` between sends, as tier 1 paces them; the server caps reruns at that rate, API-07).
 *
 * Budget: p95 < 25 ms. Vitest's own timings include the pacing pause; the round trips (send to delta) are
 * timed here and their p95 printed against the budget (`ws.preview p95 … ms`): that line is the G8 reading.
 */
import { PREVIEW_MIN_INTERVAL_MS, WS_PROTOCOL_VERSION } from '@glidepath/api-contract';
import type { ServerMessage } from '@glidepath/api-contract';
import { specBundle } from '@glidepath/testkit';
import { bench, describe } from 'vitest';
import { presetId } from '../routes/read/testing/aa-db';
import { startSessionHarness } from './testing/harness';
import { goldenCells } from './testing/seed';

/** 07 §3: deltas within 25 ms at p95 on local Docker read as instant. */
export const WS_PREVIEW_P95_BUDGET_MS = 25;
const P95 = 0.95;

const v = WS_PROTOCOL_VERSION;
const h = await startSessionHarness();
const cookie = await h.login('ana@example.test');
const socket = await h.open({ cookie, scenario: presetId('C') });
socket.send({ v, type: 'subscribe', cells: [...goldenCells('C').keys()] });
await socket.expect('snapshot');

const bundle = await specBundle();
const stepped = (id: string) => {
  const d = bundle.variables.find((x) => x.id === id);
  if (!d || d.min === null || d.step === null) throw new Error(`no stepped variable ${id}`);
  return (k: number) => d.min! + k * d.step!;
};
const target = stepped('g.target_net');
const conf = stepped('lev.conf');
const lever = [...h.hub.sessions][0]?.scenario.model.members.lever?.[0]?.id;
if (!lever) throw new Error('no lever member');

let seq = 0;
let sentAt = Number.NEGATIVE_INFINITY;
const times: number[] = [];

describe('session', () => {
  bench('ws.preview', async () => {
    seq += 1;
    const changes =
      seq % 2 === 0
        ? [{ var: 'lev.conf', member: lever, value: conf(seq % 4) }]
        : [{ var: 'g.target_net', member: '', value: target(seq % 4) }];
    const pause = sentAt + PREVIEW_MIN_INTERVAL_MS - performance.now();
    if (pause > 0) await new Promise((r) => setTimeout(r, pause));
    const t0 = (sentAt = performance.now());
    socket.send({ v, type: 'preview', seq, changes });
    // The delta; the scratch's warnings (API-07) follow it and are skipped.
    const d = (await socket.until((m) => m.type === 'delta')).at(-1) as Extract<ServerMessage, { type: 'delta' }>;
    times.push(performance.now() - t0);
    if (d.seq !== seq) throw new Error(`delta answered seq ${d.seq}, not ${seq}`);
  }, {
    // Paced at the contract rate: run long enough for a p95 over ~100 round trips.
    time: 3_000,
    setup: (_task, mode) => {
      if (mode === 'run') times.length = 0;
    },
    // After the measured cycle: print its p95 against the budget (the G8 reading), then shut down (bench
    // mode runs no afterAll hooks; pg-local's exit hook stops a throwaway cluster in any case).
    teardown: (_task, mode) => {
      if (mode !== 'run') return;
      void socket.close().then(() => h.close());
      const sorted = [...times].sort((a, b) => a - b);
      const p95 = sorted[Math.ceil(P95 * sorted.length) - 1] ?? Infinity;
      const verdict = p95 < WS_PREVIEW_P95_BUDGET_MS ? 'within' : 'OVER';
      process.stdout.write(
        `ws.preview p95 ${p95.toFixed(3)} ms over ${sorted.length} round trips: ${verdict} the ${WS_PREVIEW_P95_BUDGET_MS} ms budget\n`,
      );
    },
  });
});
