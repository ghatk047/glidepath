// Entry of `pnpm ai:rehearse --tenant ua [--prompt <text>] [--out <dir>] [--home <slug>]`.
// The Claude API key comes from the environment (a local .env is loaded when present, existing variables win);
// it is handed to the SDK only and never printed.
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { defaultAiDeps } from './deps';
import { redact, secretsOf } from './redact';
import { parseRehearseArgs, runRehearse } from './rehearse';
import { findTier3Data } from '../../seed/files';

async function main(): Promise<void> {
  const args = parseRehearseArgs(process.argv.slice(2));
  const tier3Data = findTier3Data();
  const dotenv = join(dirname(tier3Data), '.env');
  if (existsSync(dotenv)) process.loadEnvFile(dotenv);
  const deps = defaultAiDeps({ tier3Data });
  const outDir = resolve(args.out ?? join(tier3Data, 'seed', 'ai-cache', args.tenant));
  await runRehearse({ tenant: args.tenant, outDir, ...(args.prompt === undefined ? {} : { prompt: args.prompt }), ...(args.home === undefined ? {} : { home: args.home }) }, deps, (m) => console.log(m));
}

main().catch((err: unknown) => {
  const secrets = secretsOf(process.env);
  console.error(redact(err instanceof Error ? `${err.name}: ${err.message}` : String(err), secrets));
  process.exit(1);
});
