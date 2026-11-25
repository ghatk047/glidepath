import { EXIT_ERROR, runGate, type GateOptions } from './gate';

const USAGE = 'usage: pnpm parity:golden [--golden <file>] [--parity-report <file>] [--out <dir>]';
const FLAGS: Readonly<Record<string, keyof GateOptions>> = {
  '--golden': 'golden',
  '--parity-report': 'parityReport',
  '--out': 'out',
};

const args = process.argv.slice(2);
const options: Record<string, string> = {};
for (let i = 0; i < args.length; i++) {
  const a = args[i]!;
  if (a === '--') continue;
  const [flag, inline] = a.split('=', 2) as [string, string | undefined];
  const key = FLAGS[flag];
  const value = inline ?? args[++i];
  if (key === undefined || value === undefined) {
    console.error(`parity: bad argument ${a}\n${USAGE}`);
    process.exit(EXIT_ERROR);
  }
  options[key] = value;
}

try {
  process.exit((await runGate(options)).exitCode);
} catch (err) {
  console.error(`parity: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  process.exit(EXIT_ERROR);
}
