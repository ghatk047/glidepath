#!/usr/bin/env node
// `pnpm e2e:visual -- --trace off` runs the QA-06 visual baselines (G11) against the compose stack:
// 8 modules x 2 themes x 2 widths compared with the approved baselines at the pixel threshold.
// `pnpm e2e:visual -- --update` approves: it (re)writes the baselines that are missing or differ.
// Either way the last test writes the reviewer's report, `visual-report/index.html`, with every
// baseline beside the UX pack's render of the same screen. pnpm forwards the literal `--`, which
// Playwright would read as "the rest are test filters"; drop it.
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
// a fresh run record per run (the report says "not captured" for screens a filtered run skipped)
rmSync(join(here, 'visual-report', 'run'), { recursive: true, force: true });

const raw = process.argv.slice(2).filter((a, i) => !(i === 0 && a === '--'));
const update = raw.includes('--update');
const args = raw.filter((a) => a !== '--update');
if (!args.includes('--trace')) args.push('--trace', 'off');
// compare only: a missing baseline is a failure to approve, never a silent write
args.push(`--update-snapshots=${update ? 'all' : 'none'}`);

const run = spawnSync('playwright', ['test', '-c', 'playwright.visual.config.ts', ...args], {
  stdio: 'inherit',
  shell: false,
});
process.exit(run.status ?? 1);
