import { start, stop } from './index';

const [cmd, ...rest] = process.argv.slice(2);

function flag(name: string): string | undefined {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
}

if (cmd === 'start') {
  const inst = await start({ ssl: rest.includes('--ssl'), init: flag('--init'), database: flag('--db') });
  console.log(`DATABASE_URL=${inst.url}`);
} else if (cmd === 'stop') {
  console.log(stop() ? 'pg-local: stopped' : 'pg-local: not running');
} else {
  console.error('usage: pg:local start [--ssl] [--init <dir>] [--db <name>] | stop');
  process.exit(2);
}
