import { runFuzz, type FuzzOptions } from './fuzz';
import { EXIT_ERROR } from './gate';

const USAGE =
  'usage: pnpm parity:fuzz [--tenant <aa|zz>]... [--seed <n>] [--vectors <n>] [--edge <n>] ' +
  '[--out <dir>] [--python <exe>] [--oracle <script>]';

type Flag = 'tenant' | 'seed' | 'vectors' | 'edge' | 'out' | 'python' | 'oracle';
const FLAGS: ReadonlySet<string> = new Set<Flag>([
  'tenant',
  'seed',
  'vectors',
  'edge',
  'out',
  'python',
  'oracle',
]);
const NUMERIC: ReadonlySet<string> = new Set<Flag>(['seed', 'vectors', 'edge']);

function fail(message: string): never {
  console.error(`parity:fuzz: ${message}\n${USAGE}`);
  process.exit(EXIT_ERROR);
}

const args = process.argv.slice(2);
const tenants: string[] = [];
const options: Record<string, string | number> = {};
for (let i = 0; i < args.length; i++) {
  const a = args[i]!;
  if (a === '--') continue;
  const [flag, inline] = a.split('=', 2) as [string, string | undefined];
  const name = flag.replace(/^--/, '');
  const value = inline ?? args[++i];
  if (!flag.startsWith('--') || !FLAGS.has(name) || value === undefined) fail(`bad argument ${a}`);
  if (name === 'tenant') {
    tenants.push(...value.split(','));
  } else if (NUMERIC.has(name)) {
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < 0) fail(`--${name} needs a whole number, got ${value}`);
    options[name] = n;
  } else {
    options[name] = value;
  }
}

try {
  const opts: FuzzOptions = { ...options, ...(tenants.length > 0 && { tenants }) };
  process.exit((await runFuzz(opts)).exitCode);
} catch (err) {
  console.error(`parity:fuzz: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  process.exit(EXIT_ERROR);
}
