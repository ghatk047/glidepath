import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkScaffold, packageName, ROOT_SCRIPTS } from './index';

const root = resolve(import.meta.dirname, '../../..');

describe('scaffold-check', () => {
  it('exports its package name', () => {
    expect(packageName).toBe('@glidepath/scaffold-check');
  });

  it('reports 0 missing packages/files and no problems', () => {
    const r = checkScaffold(root);
    expect(r.missing).toEqual([]);
    expect(r.problems).toEqual([]);
  });

  it('pins Node 22 and pnpm 10 with .nvmrc', () => {
    const pj = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
    expect(pj.packageManager).toMatch(/^pnpm@10\./);
    expect(pj.engines.node).toContain('22');
    expect(pj.engines.pnpm).toContain('10');
    expect(readFileSync(resolve(root, '.nvmrc'), 'utf8').trim()).toBe('22');
  });

  it('has a root script for every CLAUDE.md command (placeholder until its item lands)', () => {
    const pj = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
    for (const s of ROOT_SCRIPTS) {
      expect(typeof pj.scripts[s], s).toBe('string');
      expect(pj.scripts[s].trim().length, s).toBeGreaterThan(0);
    }
  });

  it('typecheck-fixture: implicit any fails tsc under tsconfig.base strict', () => {
    const tsc = resolve(root, 'node_modules/typescript/bin/tsc');
    const r = spawnSync(
      process.execPath,
      [tsc, '--noEmit', '-p', resolve(root, 'tools/scaffold-check/fixtures/tsconfig.json')],
      { encoding: 'utf8' },
    );
    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain('TS7006');
  });
});
