import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const packageName = '@glidepath/scaffold-check';

/** Package directories required by 02 section 1. */
export const PACKAGE_DIRS = [
  'tier1-presentation/web',
  'tier1-presentation/ui',
  'tier2-logic/server',
  'tier2-logic/worker',
  'tier2-logic/spec',
  'tier2-logic/engine',
  'tier2-logic/solvers',
  'tier2-logic/domain',
  'tier2-logic/excel',
  'tier2-logic/ai',
  'tier2-logic/data-access',
  'contract/api-contract',
  'tools/gen-schema',
  'tools/gen-types',
  'tools/parity',
  'tools/tier-check',
  'tools/scaffold-check',
  'e2e'
] as const;

/** Root scripts that CLAUDE.md#Commands names (pnpm ones). */
export const ROOT_SCRIPTS = [
  'parity:golden',
  'parity:fuzz',
  'test:excel',
  'test:leak',
  'tier-check',
  'e2e',
  'e2e:storyline',
  'bench',
] as const;

const REQUIRED_FILES = ['package.json', 'README.md', 'src/index.ts', 'src/index.test.ts'];

export interface CheckResult {
  missing: string[];
  problems: string[];
}

export function checkScaffold(root: string): CheckResult {
  const missing: string[] = [];
  const problems: string[] = [];
  for (const dir of PACKAGE_DIRS) {
    for (const f of REQUIRED_FILES) {
      if (!existsSync(join(root, dir, f))) missing.push(`${dir}/${f}`);
    }
    const pj = join(root, dir, 'package.json');
    if (existsSync(pj)) {
      const name = (JSON.parse(readFileSync(pj, 'utf8')) as { name?: string }).name;
      const expected = `@glidepath/${dir.split('/').pop()}`;
      if (name !== expected) problems.push(`${dir}: name ${String(name)} != ${expected}`);
    }
  }
  const rootPj = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    packageManager?: string;
    engines?: Record<string, string>;
    scripts?: Record<string, string>;
  };
  if (!rootPj.packageManager?.startsWith('pnpm@10.')) problems.push('packageManager must pin pnpm 10');
  if (!rootPj.engines?.node?.includes('22')) problems.push('engines.node must pin Node 22');
  if (!rootPj.engines?.pnpm?.includes('10')) problems.push('engines.pnpm must pin pnpm 10');
  if (!existsSync(join(root, '.nvmrc'))) missing.push('.nvmrc');
  else if (!readFileSync(join(root, '.nvmrc'), 'utf8').trim().startsWith('22'))
    problems.push('.nvmrc must be 22');
  for (const s of ROOT_SCRIPTS) {
    if (!rootPj.scripts?.[s]) missing.push(`root script ${s}`);
  }
  const base = join(root, 'tsconfig.base.json');
  if (!existsSync(base)) missing.push('tsconfig.base.json');
  else if (!/"strict"\s*:\s*true/.test(readFileSync(base, 'utf8')))
    problems.push('tsconfig.base.json must set strict: true');
  return { missing, problems };
}
