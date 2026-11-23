import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import type { Denylist } from './denylist';

export type FindingKind = 'tier2-symbol' | 'tier2-package' | 'tier-path' | 'sql';

export interface Finding {
  kind: FindingKind;
  /** Path relative to the bundle directory. */
  file: string;
  line: number;
  /** The offending symbol, specifier, path or (truncated) SQL text. */
  match: string;
  /** Tier 2 packages exporting the symbol, when known. */
  owners?: string[];
}

export const SCANNED_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.html', '.htm', '.map']);

/**
 * Statement-shaped SQL. DML keywords are matched in upper case (how SQL is written
 * in code) or together with a `$n` parameter, so ordinary English prose in a UI
 * library does not trip them. DDL and RLS phrases are unambiguous in any case.
 */
export const SQL_PATTERNS: RegExp[] = [
  /\bSELECT\s+(?:DISTINCT\s+)?[\w*"`.,()\s]+?\s+FROM\s+["`]?[A-Za-z_]\w*/g,
  /\bINSERT\s+INTO\s+["`]?[A-Za-z_]\w*/g,
  /\bUPDATE\s+["`]?[A-Za-z_][\w.]*["`]?\s+SET\s+["`]?\w+/g,
  /\bDELETE\s+FROM\s+["`]?[A-Za-z_]\w*/g,
  /\b(?:select|insert|update|delete)\b[^;'"`]{1,200}?\$\d+/gi,
  /\b(?:create|alter|drop|truncate)\s+(?:or\s+replace\s+)?(?:temp(?:orary)?\s+)?(?:table|policy|index|schema|extension|function|trigger)\s+(?:if\s+(?:not\s+)?exists\s+)?["`]?[A-Za-z_]\w*/gi,
  /\b(?:enable|force)\s+row\s+level\s+security\b/gi,
  /\bset_config\s*\(/gi,
];

function* walk(dir: string): Generator<string> {
  for (const dirent of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, dirent.name);
    if (dirent.isDirectory()) yield* walk(path);
    else if (dirent.isFile()) yield path;
  }
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = text.indexOf('\n'); i !== -1 && i < index; i = text.indexOf('\n', i + 1)) line++;
  return line;
}

function snippet(s: string): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > 80 ? `${flat.slice(0, 77)}...` : flat;
}

/** Findings from the `sources` array of a source map (path-based only). */
function scanSourceMap(text: string, file: string, deny: Denylist): Finding[] {
  let sources: unknown;
  try {
    sources = (JSON.parse(text) as { sources?: unknown }).sources;
  } catch {
    return [];
  }
  if (!Array.isArray(sources)) return [];
  const out: Finding[] = [];
  for (const s of sources) {
    if (typeof s === 'string' && deny.pathMarkers.some((m) => s.includes(m))) {
      out.push({ kind: 'tier-path', file, line: 1, match: s });
    }
  }
  return out;
}

export function scanText(text: string, file: string, deny: Denylist): Finding[] {
  if (file.endsWith('.map')) return scanSourceMap(text, file, deny);
  const findings: Finding[] = [];

  // 1. Exported tier 2 names, matched as whole identifiers.
  const reported = new Set<string>();
  for (const m of text.matchAll(/[A-Za-z_$][\w$]*/g)) {
    const owners = deny.symbols.get(m[0]);
    if (!owners || reported.has(m[0])) continue;
    // Wire field names (object keys such as `membersHash:` in contract schemas) and
    // quoted strings are data shapes, not leaked tier 2 code.
    const end = m.index + m[0].length;
    const after = text.slice(end, end + 2);
    const before = m.index > 0 ? text[m.index - 1] : '';
    // Member access (`xs.reverse()`, `re.compile`) is a property of some other object, not a tier 2 export.
    if (
      (after[0] === ':' && after[1] !== ':') ||
      before === '"' ||
      before === "'" ||
      before === '.'
    )
      continue;
    // Class/object method definitions (`}compile(){` inside a library class) define a member, not a tier 2 export.
    if (
      before !== undefined &&
      before !== '' &&
      '{},;'.includes(before) &&
      /^\([^()]*\)\s*\{/.test(text.slice(end, end + 200))
    )
      continue;
    reported.add(m[0]);
    findings.push({ kind: 'tier2-symbol', file, line: lineOf(text, m.index), match: m[0], owners });
  }

  // 2. Tier 2 package specifiers and tier 2 / tier 3 source paths.
  for (const name of deny.packageNames) {
    const i = text.indexOf(name);
    if (i !== -1)
      findings.push({ kind: 'tier2-package', file, line: lineOf(text, i), match: name });
  }
  for (const marker of deny.pathMarkers) {
    const i = text.indexOf(marker);
    if (i !== -1) findings.push({ kind: 'tier-path', file, line: lineOf(text, i), match: marker });
  }

  // 3. SQL statements.
  for (const re of SQL_PATTERNS) {
    for (const m of text.matchAll(re)) {
      findings.push({ kind: 'sql', file, line: lineOf(text, m.index), match: snippet(m[0]) });
    }
  }
  return findings;
}

export interface ScanResult {
  filesScanned: number;
  findings: Finding[];
}

export function scanBundle(bundleDir: string, deny: Denylist): ScanResult {
  if (!existsSync(bundleDir) || !statSync(bundleDir).isDirectory()) {
    throw new Error(`bundle directory not found: ${bundleDir}`);
  }
  const findings: Finding[] = [];
  let filesScanned = 0;
  for (const path of walk(bundleDir)) {
    if (!SCANNED_EXTENSIONS.has(extname(path).toLowerCase())) continue;
    filesScanned++;
    findings.push(...scanText(readFileSync(path, 'utf8'), relative(bundleDir, path), deny));
  }
  return { filesScanned, findings };
}
