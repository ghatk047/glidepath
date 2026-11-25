// INT-01: the M0 status note and the generated artefacts the M0 exit criteria name (09 §1).
// The in-stack checks (schema + RLS + views applied by migrate, tokens served) are in
// compose-check.spec.ts; this file covers what is checked from the repo alone.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../src/index';

describe('M0 integration [INT-01]', () => {
  it('docs/status/2026-11-24.md is written with the M0 status, every M0 gate and the DATA-08 seed timing', () => {
    const path = join(REPO_ROOT, 'docs/status/2026-11-24.md');
    expect(existsSync(path)).toBe(true);
    const note = readFileSync(path, 'utf8');
    expect(note).toMatch(/^# Status 2026-11-24 · M0/m);
    for (const gate of ['G1', 'G2', 'G13', 'G14']) expect(note, gate).toContain(`| ${gate} `);
    expect(note).toMatch(/## DATA-08 seed timing/);
    expect(note).toMatch(/CI run links/);
  });

  it('spec types are generated (tier2-logic/spec/src/generated) and tokens CSS exists (ui/src/tokens)', () => {
    const generated = join(REPO_ROOT, 'tier2-logic/spec/src/generated');
    expect(readdirSync(generated)).toEqual(expect.arrayContaining(['index.ts', 'ids.ts', 'variables.ts']));
    const css = readFileSync(join(REPO_ROOT, 'tier1-presentation/ui/src/tokens/tokens.css'), 'utf8');
    expect(css).toMatch(/^\/\* GENERATED from docs\/ux\/tokens\.json/);
    expect(css).toMatch(/--[a-z0-9-]+:/);
  });
});
