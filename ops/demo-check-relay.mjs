// Forwards unix sockets to the stack's loopback ports so a checker container on `--network none` can reach the
// stack without a network of its own (ops/demo-check.sh --isolated). Usage:
//   node ops/demo-check-relay.mjs <dir> <name>=<port> ...      e.g.  /tmp/s web=443 mail=8025
// Listens on <dir>/<name>.sock and pipes each connection to 127.0.0.1:<port>. Runs until killed.
import { rmSync } from 'node:fs';
import { createConnection, createServer } from 'node:net';
import { join } from 'node:path';

const [dir, ...pairs] = process.argv.slice(2);
if (!dir || pairs.length === 0) {
  console.error('usage: demo-check-relay.mjs <dir> <name>=<port> ...');
  process.exit(2);
}
for (const pair of pairs) {
  const [name, port] = pair.split('=');
  const path = join(dir, `${name}.sock`);
  rmSync(path, { force: true });
  createServer((c) => {
    const up = createConnection({ host: '127.0.0.1', port: Number(port) });
    c.pipe(up).pipe(c);
    c.on('error', () => up.destroy());
    up.on('error', () => c.destroy());
  }).listen(path, () => process.stdout.write(`relay: ${path} -> 127.0.0.1:${port}\n`));
}
