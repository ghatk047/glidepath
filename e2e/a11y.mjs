#!/usr/bin/env node
// `pnpm e2e:a11y -- --trace off` runs the QA-07 accessibility checks (G12) against the compose stack.
// pnpm forwards the literal `--`, which Playwright would read as "the rest are test filters"; drop it.
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2).filter((a, i) => !(i === 0 && a === '--'));
if (!args.includes('--trace')) args.push('--trace', 'off');
const run = spawnSync('playwright', ['test', '-c', 'playwright.a11y.config.ts', ...args], {
  stdio: 'inherit',
  shell: false,
});
process.exit(run.status ?? 1);
