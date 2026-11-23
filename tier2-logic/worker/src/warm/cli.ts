// Entry of `pnpm warm --tenant aa`: pre-runs the demo's solver jobs (see warm.ts). Settings from the environment
// (DATABASE_URL, SPEC_DIR); a local .env is loaded when present, existing variables win. Exit 1 when a job failed.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createDb } from '@glidepath/data-access';
import { defaultSolverDeps } from '../jobs/solver/deps';
import { findTier3Data } from '../seed/files';
import { seedIds } from '../seed/ids';
import { parseWarmArgs } from './args';
import { warmTenant } from './warm';

async function main(): Promise<void> {
  const { tenant } = parseWarmArgs(process.argv.slice(2));
  const dotenv = join(dirname(findTier3Data()), '.env');
  if (existsSync(dotenv)) process.loadEnvFile(dotenv);
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error('warm: DATABASE_URL is required');
  const handle = createDb(url, { poolMax: 2 });
  try {
    const report = await warmTenant({
      db: handle.db,
      tenantId: seedIds.tenant(tenant),
      userId: seedIds.seedActor(),
      deps: defaultSolverDeps(),
      log: (m) => console.log(m),
    });
    console.log(`warm: ${report.ran} ran, ${report.hits} already cached, ${report.skipped} skipped, ${report.failed} failed`);
    if (report.failed > 0) process.exitCode = 1;
  } finally {
    await handle.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? `${err.name}: ${err.message}` : err);
  process.exit(1);
});
