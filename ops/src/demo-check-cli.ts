// Entry of the HTTP half of ops/demo-check.sh, bundled with esbuild into one file the script runs with node
// (on the host, or in a container on `--network none` with the stack's ports arriving as unix sockets).
//
//   node demo-check.mjs [--web URL] [--mail URL] [--web-socket PATH] [--mail-socket PATH]
//                       [--email ADDR] [--ref-dir DIR] [--golden FILE] [--solver FILE] [--mail-timeout SECONDS]
//                       [--ai-enabled 0|1]
//
// Prints `PASS <check>: <detail>` / `FAIL <check>: <reason>` / `SKIP <check>: <why>` per check, then a last line
// `demo-check: PASS ...` or `demo-check: FAIL: <first reason>`. Exit 0 all passed, 1 a check failed, 2 usage.
import { resolve } from 'node:path';
import { runChecks } from './demo-check';

const args = process.argv.slice(2);
const opt = new Map<string, string>();
for (let i = 0; i < args.length; i += 2) {
  const k = args[i]!;
  const v = args[i + 1];
  if (!k.startsWith('--') || v === undefined) {
    console.error(`demo-check: bad argument ${k}`);
    process.exit(2);
  }
  opt.set(k.slice(2), v);
}
const get = (k: string, d: string): string => opt.get(k) ?? d;
const refDir = get('ref-dir', resolve('docs/spec/reference'));
const webSocket = opt.get('web-socket');
const mailSocket = opt.get('mail-socket');

try {
  const results = await runChecks({
    web: { url: get('web', 'https://localhost'), ...(webSocket ? { socketPath: webSocket } : {}) },
    mail: { url: get('mail', 'http://127.0.0.1:8025'), ...(mailSocket ? { socketPath: mailSocket } : {}) },
    email: get('email', 'demo@example.com'),
    goldenFile: get('golden', `${refDir}/golden_results.json`),
    solverFile: get('solver', `${refDir}/solver_demo_results.json`),
    mailTimeoutMs: Number(get('mail-timeout', '15')) * 1000,
    aiEnabled: get('ai-enabled', '1') !== '0',
  });
  for (const r of results)
    (r.ok ? console.log : console.error)(`${r.skipped ? 'SKIP' : r.ok ? 'PASS' : 'FAIL'} ${r.name}: ${r.detail}`);
  const first = results.find((r) => !r.ok);
  if (first) {
    console.error(`demo-check: FAIL: ${first.detail}`);
    process.exit(1);
  }
  console.log(`demo-check: PASS: ${results.length} checks`);
} catch (e) {
  console.error(`demo-check: FAIL: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
