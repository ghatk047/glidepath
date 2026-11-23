import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';

/** Directory whose exports must never reach the web bundle. */
export const TIER2_DIR = 'tier2-logic';
/** Directories whose exports the web bundle may legitimately contain. */
export const SHARED_DIRS = ['contract', 'tier1-presentation'] as const;

/** Names shorter than this are too likely to collide with unrelated identifiers. */
export const MIN_SYMBOL_LENGTH = 5;
/** Exported by every package as a skeleton marker; carries no tier 2 meaning. */
const IGNORED_NAMES = new Set(['packageName', 'default']);

export interface PackageInfo {
  /** Directory name under its tier directory, e.g. `engine`. */
  dir: string;
  /** npm name, e.g. `@glidepath/engine`. */
  name: string;
  /** Absolute entry files (`main` plus every `exports` target that is TypeScript). */
  entries: string[];
}

export interface Denylist {
  /** Value export name -> tier 2 packages that export it. */
  symbols: Map<string, string[]>;
  /** Import specifiers of tier 2 packages, e.g. `@glidepath/engine`. */
  packageNames: string[];
  /** Path fragments that identify tier 2 / tier 3 sources, e.g. `tier2-logic/`. */
  pathMarkers: string[];
}

function readJson(path: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function collectTargets(value: unknown, out: string[]): void {
  if (typeof value === 'string') out.push(value);
  else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) collectTargets(v, out);
  }
}

/** Workspace packages directly under `<root>/<tierDir>/*`. */
export function listPackages(root: string, tierDir: string): PackageInfo[] {
  const base = join(root, tierDir);
  if (!existsSync(base)) return [];
  const result: PackageInfo[] = [];
  for (const dirent of readdirSync(base, { withFileTypes: true })) {
    if (!dirent.isDirectory() || dirent.name === 'node_modules') continue;
    const pkgDir = join(base, dirent.name);
    const pkg = readJson(join(pkgDir, 'package.json'));
    if (!pkg || typeof pkg.name !== 'string') continue;
    const targets: string[] = [];
    if (typeof pkg.main === 'string') targets.push(pkg.main);
    collectTargets(pkg.exports, targets);
    const entries = [...new Set(targets)]
      .filter((t) => /\.[cm]?tsx?$/.test(t) && !t.endsWith('.d.ts'))
      .map((t) => resolve(pkgDir, t))
      .filter((p) => existsSync(p));
    result.push({ dir: dirent.name, name: pkg.name, entries });
  }
  return result.sort((a, b) => a.dir.localeCompare(b.dir));
}

/**
 * Value (runtime) export names of the given entry files. Type-only exports are
 * erased by the compiler and cannot appear in a bundle, so they are skipped.
 * Re-exports (`export * from`, `export { x } from`) are followed by the checker.
 */
export function exportedValueNames(entries: string[]): Map<string, string[]> {
  const byEntry = new Map<string, string[]>();
  if (entries.length === 0) return byEntry;
  const program = ts.createProgram(entries, {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowImportingTsExtensions: true,
    resolveJsonModule: true,
    skipLibCheck: true,
    noEmit: true,
    types: [],
  });
  const checker = program.getTypeChecker();
  for (const entry of entries) {
    const source = program.getSourceFile(entry);
    const moduleSymbol = source && checker.getSymbolAtLocation(source);
    const names: string[] = [];
    if (moduleSymbol) {
      for (const exp of checker.getExportsOfModule(moduleSymbol)) {
        const target = exp.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exp) : exp;
        // An unresolvable alias has no flags; keep it (fail closed).
        const isValue = target.flags === 0 || (target.flags & ts.SymbolFlags.Value) !== 0;
        if (isValue) names.push(exp.getName());
      }
    }
    byEntry.set(entry, names);
  }
  return byEntry;
}

function namesOf(packages: PackageInfo[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const byEntry = exportedValueNames(packages.flatMap((p) => p.entries));
  for (const pkg of packages) {
    for (const entry of pkg.entries) {
      for (const name of byEntry.get(entry) ?? []) {
        const owners = out.get(name) ?? [];
        if (!owners.includes(pkg.name)) owners.push(pkg.name);
        out.set(name, owners);
      }
    }
  }
  return out;
}

/**
 * Builds the denylist from the package sources at run time: every value export
 * of every `tier2-logic/*` package, minus names that the web bundle may contain
 * legitimately (exports of `contract/*` and `tier1-presentation/*`).
 */
export function deriveDenylist(root: string): Denylist {
  const tier2 = listPackages(root, TIER2_DIR);
  const allowed = new Set<string>(IGNORED_NAMES);
  for (const dir of SHARED_DIRS) {
    for (const name of namesOf(listPackages(root, dir)).keys()) allowed.add(name);
  }
  const symbols = new Map<string, string[]>();
  for (const [name, owners] of namesOf(tier2)) {
    if (name.length < MIN_SYMBOL_LENGTH || allowed.has(name)) continue;
    symbols.set(name, owners);
  }
  return {
    symbols,
    packageNames: tier2.map((p) => p.name),
    pathMarkers: [`${TIER2_DIR}/`, 'tier3-data/'],
  };
}
