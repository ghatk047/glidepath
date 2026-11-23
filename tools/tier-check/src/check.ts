import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { deriveDenylist } from './denylist';
import { scanBundle, type Finding } from './scan';

/** Where `pnpm --filter @glidepath/web build` writes the production bundle (Vite default). */
export const DEFAULT_BUNDLE_DIR = 'tier1-presentation/web/dist';

export const EXIT_CLEAN = 0;
export const EXIT_LEAK = 1;
/** Not part of the clean/leak contract: tier-check itself could not run. */
export const EXIT_ERROR = 2;

export interface CheckOptions {
  root: string;
  /** Bundle directory; relative paths resolve against `root`. */
  bundle?: string;
  /** Fail (exit 2) instead of skipping when the bundle is absent. */
  requireBundle?: boolean;
  log?: (line: string) => void;
}

export interface CheckResult {
  exitCode: number;
  status: 'clean' | 'leak' | 'skipped' | 'error';
  findings: Finding[];
  filesScanned: number;
}

function hasBundle(dir: string): boolean {
  return existsSync(dir) && readdirSync(dir).length > 0;
}

export function runTierCheck(opts: CheckOptions): CheckResult {
  const log = opts.log ?? ((l: string) => console.log(l));
  const bundleDir = resolve(opts.root, opts.bundle ?? DEFAULT_BUNDLE_DIR);

  if (!hasBundle(bundleDir)) {
    const msg = `tier-check: no web bundle at ${bundleDir}`;
    if (opts.requireBundle) {
      log(`${msg} (--require-bundle set). Run \`pnpm --filter @glidepath/web build\` first.`);
      return { exitCode: EXIT_ERROR, status: 'error', findings: [], filesScanned: 0 };
    }
    log(`${msg}; skipping (the web build, WEB-01, has not produced one yet). Exiting 0.`);
    return { exitCode: EXIT_CLEAN, status: 'skipped', findings: [], filesScanned: 0 };
  }

  const deny = deriveDenylist(opts.root);
  const { findings, filesScanned } = scanBundle(bundleDir, deny);
  log(
    `tier-check: scanned ${filesScanned} files in ${bundleDir} against ` +
      `${deny.symbols.size} tier 2 symbols, ${deny.packageNames.length} packages, SQL patterns`,
  );
  if (findings.length === 0) {
    log('tier-check: clean');
    return { exitCode: EXIT_CLEAN, status: 'clean', findings, filesScanned };
  }
  log(`tier-check: LEAK, ${findings.length} finding(s)`);
  for (const f of findings) {
    const owners = f.owners ? ` (exported by ${f.owners.join(', ')})` : '';
    log(`  ${f.kind}  ${f.file}:${f.line}  ${f.match}${owners}`);
  }
  return { exitCode: EXIT_LEAK, status: 'leak', findings, filesScanned };
}
