import { resolve } from 'node:path';
import { EXIT_ERROR, runTierCheck } from './check';

const root = resolve(import.meta.dirname, '../../..');
const args = process.argv.slice(2);
let bundle: string | undefined;
let requireBundle = false;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--bundle') bundle = args[++i];
  else if (a?.startsWith('--bundle=')) bundle = a.slice('--bundle='.length);
  else if (a === '--require-bundle') requireBundle = true;
  else if (a === '--') continue;
  else {
    console.error(
      `tier-check: unknown argument ${a}\nusage: pnpm tier-check [--bundle <dir>] [--require-bundle]`,
    );
    process.exit(EXIT_ERROR);
  }
}

try {
  process.exit(runTierCheck({ root, bundle, requireBundle }).exitCode);
} catch (err) {
  console.error(`tier-check: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(EXIT_ERROR);
}
