import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_BUNDLE_DIR, EXIT_CLEAN, EXIT_ERROR, EXIT_LEAK } from './check';
import { deriveDenylist, runTierCheck } from './index';

const REPO_ROOT = resolve(import.meta.dirname, '../../..');

let root: string;
const lines: string[] = [];
const log = (l: string) => lines.push(l);

function write(rel: string, content: string): void {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function pkg(dir: string, name: string, indexSource: string): void {
  write(`${dir}/package.json`, JSON.stringify({ name, version: '0.0.0', main: 'src/index.ts' }));
  write(`${dir}/src/index.ts`, indexSource);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'tier-check-'));
  lines.length = 0;
  pkg(
    'tier2-logic/engine',
    '@glidepath/engine',
    [
      `export const packageName = '@glidepath/engine';`,
      `export function computeNetSavings(): number { return 0; }`,
      `export type EngineConfig = { a: number };`,
      `export interface EngineState { b: number }`,
    ].join('\n'),
  );
  pkg(
    'tier2-logic/domain',
    '@glidepath/domain',
    `export { applyChangeset } from './changeset';\nexport * from './rules';\n`,
  );
  write('tier2-logic/domain/src/changeset.ts', `export function applyChangeset() {}\n`);
  write('tier2-logic/domain/src/rules.ts', `export const validateRuleSet = () => true;\n`);
  pkg(
    'contract/api-contract',
    '@glidepath/api-contract',
    `export const sessionMessageSchema = {};\nexport const computeNetSavings = 1;\n`,
  );
  write('tier1-presentation/web/dist/index.html', '<!doctype html><script src="/a.js"></script>');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function bundle(file: string, js: string): void {
  write(`tier1-presentation/web/dist/${file}`, js);
}

describe('tier-check', () => {
  // acceptance 1
  it('exits 1 on a fixture bundle containing an exported tier-2 symbol', () => {
    bundle('assets/app.js', 'const net = validateRuleSet(state); render(net);');
    const r = runTierCheck({ root, log });
    expect(r.exitCode).toBe(EXIT_LEAK);
    expect(r.status).toBe('leak');
    expect(r.findings).toContainEqual(
      expect.objectContaining({
        kind: 'tier2-symbol',
        match: 'validateRuleSet',
        file: join('assets', 'app.js'),
        line: 1,
        owners: ['@glidepath/domain'],
      }),
    );
    expect(lines.join('\n')).toContain('LEAK');
  });

  it('exits 1 on a fixture bundle that imports a tier 2 package or source path', () => {
    bundle('assets/a.js', `import "@glidepath/engine";`);
    bundle('assets/b.js', `//# sourceURL=tier2-logic/solvers/src/x.ts`);
    const kinds = runTierCheck({ root, log }).findings.map((f) => f.kind);
    expect(kinds).toContain('tier2-package');
    expect(kinds).toContain('tier-path');
  });

  it.each([
    ['select', `db.query("SELECT id, name FROM workbooks WHERE id = 1")`],
    ['insert', 'sql`INSERT INTO audit_log (a) VALUES (1)`'],
    ['update', `run("UPDATE scenarios SET name = 'x'")`],
    ['delete', `run("DELETE FROM scenarios")`],
    ['param', `q("select * from t where id = $1")`],
    ['ddl', `run("create table if not exists foo (id int)")`],
    ['rls', `run("ALTER TABLE t ENABLE ROW LEVEL SECURITY")`],
    ['set_config', `run("select set_config('app.tenant', $1, true)")`],
  ])('exits 1 on a fixture bundle containing an SQL statement pattern (%s)', (_n, snippet) => {
    bundle('assets/app.js', snippet);
    const r = runTierCheck({ root, log });
    expect(r.exitCode).toBe(EXIT_LEAK);
    expect(r.findings.some((f) => f.kind === 'sql')).toBe(true);
  });

  it('flags tier 2 / tier 3 paths in source maps', () => {
    bundle('assets/app.js.map', JSON.stringify({ sources: ['../../tier2-logic/engine/src/a.ts'] }));
    const r = runTierCheck({ root, log });
    expect(r.exitCode).toBe(EXIT_LEAK);
    expect(r.findings[0]?.kind).toBe('tier-path');
  });

  it('exits 0 on a clean fixture bundle', () => {
    bundle(
      'assets/app.js',
      [
        'const e = React.createElement("p", null, "Select an option from the list");',
        'const x = sessionMessageSchema; // allowed: exported by the contract',
        'const computeNetSavings = 1; // allowed: name is also exported by the contract',
        'update the packageName and select items',
      ].join('\n'),
    );
    const r = runTierCheck({ root, log });
    expect(r.findings).toEqual([]);
    expect(r.exitCode).toBe(EXIT_CLEAN);
    expect(r.status).toBe('clean');
  });

  it('does not match a tier 2 name that is only a substring of another identifier', () => {
    bundle('assets/app.js', 'const myValidateRuleSetLabel = 1; validateRuleSets();');
    expect(runTierCheck({ root, log }).exitCode).toBe(EXIT_CLEAN);
  });

  it('exits 0 with a clear message when no bundle exists yet', () => {
    rmSync(join(root, 'tier1-presentation/web/dist'), { recursive: true });
    const r = runTierCheck({ root, log });
    expect(r.exitCode).toBe(EXIT_CLEAN);
    expect(r.status).toBe('skipped');
    expect(lines.join('\n')).toMatch(/no web bundle at .*skipping/);
  });

  it('exits 2 when the bundle is absent and --require-bundle is set', () => {
    rmSync(join(root, 'tier1-presentation/web/dist'), { recursive: true });
    const r = runTierCheck({ root, log, requireBundle: true });
    expect(r.exitCode).toBe(EXIT_ERROR);
  });

  it('honours a custom bundle directory', () => {
    write('out/x.js', 'validateRuleSet();');
    expect(runTierCheck({ root, log, bundle: 'out' }).exitCode).toBe(EXIT_LEAK);
  });
});

describe('denylist derivation', () => {
  // acceptance 3
  it('is derived from tier 2 exports at run time: adding an export to a fixture package updates it', () => {
    const before = deriveDenylist(root);
    expect(before.symbols.has('computeNetSavings')).toBe(false); // contract also exports it
    expect(before.symbols.get('validateRuleSet')).toEqual(['@glidepath/domain']);
    expect(before.symbols.has('applyChangeset')).toBe(true); // via named re-export
    expect(before.symbols.has('EngineConfig')).toBe(false); // type-only
    expect(before.symbols.has('EngineState')).toBe(false); // type-only
    expect(before.symbols.has('packageName')).toBe(false);
    expect(before.symbols.has('brandNewSolverExport')).toBe(false);
    expect(before.packageNames).toEqual(['@glidepath/domain', '@glidepath/engine']);

    write(
      'tier2-logic/engine/src/index.ts',
      `export const packageName = '@glidepath/engine';\nexport const brandNewSolverExport = 1;\n`,
    );
    const after = deriveDenylist(root);
    expect(after.symbols.get('brandNewSolverExport')).toEqual(['@glidepath/engine']);

    bundle('assets/app.js', 'brandNewSolverExport');
    expect(runTierCheck({ root, log }).exitCode).toBe(EXIT_LEAK);
  });

  it('picks up a new tier 2 package and its `exports` subpaths', () => {
    pkg('tier2-logic/newpkg', '@glidepath/newpkg', `export const newPkgThing = 1;\n`);
    write(
      'tier2-logic/newpkg/package.json',
      JSON.stringify({
        name: '@glidepath/newpkg',
        main: 'src/index.ts',
        exports: { '.': './src/index.ts', './node': './src/node.ts' },
      }),
    );
    write('tier2-logic/newpkg/src/node.ts', `export function readFromDisk() {}\n`);
    const deny = deriveDenylist(root);
    expect(deny.symbols.get('newPkgThing')).toEqual(['@glidepath/newpkg']);
    expect(deny.symbols.get('readFromDisk')).toEqual(['@glidepath/newpkg']);
  });

  it('derives a non-trivial denylist from the real repo', () => {
    const deny = deriveDenylist(REPO_ROOT);
    expect(deny.packageNames).toContain('@glidepath/engine');
    expect(deny.packageNames).toContain('@glidepath/data-access');
    expect(deny.symbols.has('createDb')).toBe(true);
    expect(deny.symbols.has('loadModelBundle')).toBe(true);
  });
});

describe('cli', () => {
  const cli = join(REPO_ROOT, 'tools/tier-check/src/cli.ts');
  const run = (args: string[]) =>
    spawnSync(process.execPath, ['--import', 'tsx', cli, ...args], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });

  it('exits 0 with a message when the bundle is absent, 1 on a leak, 2 on bad args', () => {
    const absent = run(['--bundle', join(root, 'nope')]);
    expect(absent.status).toBe(0);
    expect(absent.stdout).toContain('no web bundle');

    bundle('assets/app.js', 'x = "DELETE FROM users"');
    const leak = run(['--bundle', join(root, 'tier1-presentation/web/dist')]);
    expect(leak.status).toBe(1);
    expect(leak.stdout).toContain('sql');

    expect(run(['--bogus']).status).toBe(2);
  }, 60_000);
});

describe('web production bundle', () => {
  const dist = join(REPO_ROOT, DEFAULT_BUNDLE_DIR);
  const built = existsSync(dist) && readdirSync(dist).length > 0;
  if (!built) {
    console.info(
      `tier-check: skipping web bundle test, no build at ${dist}. ` +
        'Run `pnpm --filter @glidepath/web build` (needs WEB-01).',
    );
  }

  // acceptance 2
  it.skipIf(!built)('exits 0 on the clean production build of tier1-presentation/web', () => {
    const r = runTierCheck({ root: REPO_ROOT, log });
    expect(r.findings).toEqual([]);
    expect(r.exitCode).toBe(EXIT_CLEAN);
  });
});
