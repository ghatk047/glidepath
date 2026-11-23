#!/usr/bin/env node
// `pnpm e2e:perf -- --trace off` runs the QA-08 performance monitors against the compose stack.
// `pnpm e2e:perf -- --device` is the owner's run on the demo Mac: the same specs and the same
// metric table, in a headed browser (real compositor and GPU path). pnpm forwards the literal `--`,
// which Playwright would read as "the rest are test filters"; drop it.
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// a fresh metrics file per run
rmSync(join(fileURLToPath(new URL('.', import.meta.url)), 'perf-report.json'), { force: true });

const raw = process.argv.slice(2).filter((a, i) => !(i === 0 && a === '--'));
const device = raw.includes('--device');
const args = raw.filter((a) => a !== '--device');
if (!args.includes('--trace')) args.push('--trace', 'off');

const run = spawnSync('playwright', ['test', '-c', 'playwright.perf.config.ts', ...args], {
  stdio: 'inherit',
  shell: false,
  env: { ...process.env, GP_PERF_DEVICE: device ? '1' : '' },
});
process.exit(run.status ?? 1);
