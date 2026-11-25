#!/usr/bin/env node
// `pnpm e2e -- --trace off`: runs the Playwright smoke (G9). pnpm forwards the literal `--`, which
// Playwright would read as "the rest are test filters"; drop it so `--trace off` is an option.
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2).filter((a, i) => !(i === 0 && a === '--'));
const run = spawnSync('playwright', ['test', ...args], { stdio: 'inherit', shell: false });
process.exit(run.status ?? 1);
