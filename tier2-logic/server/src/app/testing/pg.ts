import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { start, stop } from '@glidepath/pg-local';
import type { PgLocalInstance } from '@glidepath/pg-local';

/** A throwaway Postgres 16 cluster (pg-local, ADR-016) for one test file. */
export interface TestCluster {
  url: string;
  stop(): void;
}

export async function startCluster(tag: string): Promise<TestCluster> {
  const stateFile = join(tmpdir(), `gp-server-${tag}-${process.pid}.json`);
  const instance: PgLocalInstance = await start({ stateFile });
  return { url: instance.url, stop: () => void stop({ instance, stateFile }) };
}
