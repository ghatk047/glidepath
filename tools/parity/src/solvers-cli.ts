import { EXIT_ERROR } from './gate';
import { runSolverGate, type SolverGateOptions } from './solvers-gate';

const USAGE = 'usage: pnpm test:solvers [--reference <file>] [--out <dir>]';
const FLAGS: Readonly<Record<string, keyof SolverGateOptions>> = {
  '--reference': 'reference',
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
    console.error(`parity:solvers: bad argument ${a}\n${USAGE}`);
    process.exit(EXIT_ERROR);
  }
  options[key] = value;
}

try {
  process.exit((await runSolverGate(options)).exitCode);
} catch (err) {
  console.error(`parity:solvers: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  process.exit(EXIT_ERROR);
}
