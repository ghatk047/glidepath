/**
 * Helpers for the ops tests: read the repo-root Compose files and .env.example.
 *
 * The Compose model comes from `docker compose config --format json` when the Compose CLI
 * is installed (no daemon needed), and otherwise from parsing the YAML directly with a
 * small interpolator, so the same assertions run in a daemon-less builder.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

export const packageName = '@glidepath/ops';

/** Repository root (this package lives in `<root>/ops`). */
export const REPO_ROOT = resolve(import.meta.dirname, '../..');

export type ComposeSource = 'docker' | 'yaml';

export interface ComposeService {
  image?: string;
  command?: string[];
  profiles: string[];
  networks: string[];
  environment: Record<string, string>;
  depends_on: Record<string, { condition?: string }>;
  /** Published ports as "host_ip:published:target" (host_ip may be empty). */
  ports: string[];
  hasEnvFile: boolean;
}

export interface ComposeModel {
  source: ComposeSource;
  name?: string;
  services: Record<string, ComposeService>;
  networks: Record<string, { internal: boolean }>;
  volumes: string[];
}

// ------------------------------------------------------------------------- .env files

/** Parses KEY=VALUE lines (comments and blank lines ignored). Values are kept verbatim. */
export function parseEnvFile(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    out.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
  }
  return out;
}

/** Keys of KEY=VALUE lines in order, including duplicates (for "listed once" checks). */
export function envFileKeys(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && l.indexOf('=') > 0)
    .map((l) => l.slice(0, l.indexOf('=')).trim());
}

export function readEnvExample(root = REPO_ROOT): string {
  return readFileSync(join(root, '.env.example'), 'utf8');
}

/** Names of variables a Compose file interpolates (`${VAR}`, `${VAR:-x}`, `${VAR:?x}`...). */
export function interpolatedVariables(composeText: string): string[] {
  const names = new Set<string>();
  for (const m of composeText.matchAll(/(?<!\$)\$\{([A-Za-z_][A-Za-z0-9_]*)/g)) names.add(m[1]!);
  return [...names].sort();
}

/**
 * Minimal Compose-style interpolation: `$$`, `${VAR}`, `${VAR:-def}`, `${VAR-def}`,
 * `${VAR:?msg}`, `${VAR?msg}`, `${VAR:+alt}`. Throws on a missing required variable.
 */
export function interpolate(value: string, env: ReadonlyMap<string, string>): string {
  return value.replace(
    /\$\$|\$\{([A-Za-z_][A-Za-z0-9_]*)(?:(:?[-?+])((?:[^{}]|\{[^{}]*\})*))?\}/g,
    (whole, name: string | undefined, op: string | undefined, arg: string | undefined) => {
      if (whole === '$$') return '$';
      const v = env.get(name!);
      const unsetOrEmpty = v === undefined || v === '';
      switch (op) {
        case undefined:
          return v ?? '';
        case ':-':
          return unsetOrEmpty ? interpolate(arg ?? '', env) : v;
        case '-':
          return v === undefined ? interpolate(arg ?? '', env) : v;
        case ':?':
        case '?':
          if (op === ':?' ? unsetOrEmpty : v === undefined)
            throw new Error(`required variable ${name} is missing a value: ${arg ?? ''}`);
          return v!;
        case ':+':
          return unsetOrEmpty ? '' : interpolate(arg ?? '', env);
        case '+':
          return v === undefined ? '' : interpolate(arg ?? '', env);
        default:
          return whole;
      }
    },
  );
}

/** Expands an env file the way Compose does (later lines may reference earlier ones). */
export function expandEnv(entries: ReadonlyMap<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of entries) out.set(k, interpolate(v, out));
  return out;
}

/**
 * Writes a throwaway env file: .env.example with every empty secret filled by a dummy
 * value, so `docker compose config` can resolve the required variables.
 */
export function writeTestEnvFile(root = REPO_ROOT, extra: Record<string, string> = {}): string {
  const lines = readEnvExample(root)
    .split(/\r?\n/)
    .map((line) => {
      const m = /^([A-Z0-9_]+)=$/.exec(line.trim());
      if (m && /PASSWORD|SECRET/.test(m[1]!)) return `${m[1]}=test-${m[1]!.toLowerCase()}`;
      return line;
    });
  for (const [k, v] of Object.entries(extra)) lines.push(`${k}=${v}`);
  const dir = mkdtempSync(join(tmpdir(), 'glidepath-ops-'));
  const file = join(dir, 'test.env');
  writeFileSync(file, lines.join('\n'));
  return file;
}

// ---------------------------------------------------------------------- Compose model

export function hasDockerCompose(): boolean {
  if (process.env.OPS_COMPOSE_SOURCE === 'yaml') return false;
  const r = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' });
  return r.status === 0;
}

/** process.env without the settings .env.example defines, so the shell cannot leak in. */
function cleanEnv(root: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const k of parseEnvFile(readEnvExample(root)).keys()) delete env[k];
  for (const k of Object.keys(env)) if (k.startsWith('COMPOSE_')) delete env[k];
  return env;
}

export interface ComposeOptions {
  files?: string[];
  envFile: string;
  profiles?: string[];
  root?: string;
}

export interface ComposeRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Runs `docker compose ... config --format json` and returns the raw process result. */
export function runComposeConfig(opts: ComposeOptions): ComposeRun {
  const root = opts.root ?? REPO_ROOT;
  const args = ['compose', '--project-directory', root, '--env-file', opts.envFile];
  for (const f of opts.files ?? ['docker-compose.yml']) args.push('-f', join(root, f));
  for (const p of opts.profiles ?? []) args.push('--profile', p);
  args.push('config', '--format', 'json');
  const r = spawnSync('docker', args, { encoding: 'utf8', env: cleanEnv(root) });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

export function composeConfigFromDocker(opts: ComposeOptions): ComposeModel {
  const r = runComposeConfig(opts);
  if (r.status !== 0) throw new Error(`docker compose config failed: ${r.stderr}`);
  return normalize(JSON.parse(r.stdout), 'docker');
}

/**
 * Parses one Compose file without Docker: YAML merge keys resolved, `${...}` interpolated
 * from the env file. Services of every profile are kept (the caller filters).
 */
export function composeConfigFromYaml(opts: ComposeOptions & { file?: string }): ComposeModel {
  const root = opts.root ?? REPO_ROOT;
  const text = readFileSync(join(root, opts.file ?? 'docker-compose.yml'), 'utf8');
  const env = expandEnv(parseEnvFile(readFileSync(opts.envFile, 'utf8')));
  const raw = interpolateDeep(parseComposeYaml(text), env);
  return normalize(raw, 'yaml');
}

/** YAML parse with merge keys and Compose's `!reset` / `!override` tags kept as plain values. */
export function parseComposeYaml(text: string): unknown {
  return parseYaml(text, {
    merge: true,
    customTags: [
      { tag: '!reset', resolve: () => null },
      { tag: '!override', collection: 'seq', resolve: (v) => v },
      { tag: '!override', collection: 'map', resolve: (v) => v },
    ],
  });
}

function interpolateDeep(v: unknown, env: ReadonlyMap<string, string>): unknown {
  if (typeof v === 'string') return interpolate(v, env);
  if (Array.isArray(v)) return v.map((x) => interpolateDeep(x, env));
  if (v && typeof v === 'object') {
    // yaml returns Map/plain objects depending on options; normalise to plain objects.
    const entries = v instanceof Map ? [...v.entries()] : Object.entries(v);
    return Object.fromEntries(entries.map(([k, x]) => [String(k), interpolateDeep(x, env)]));
  }
  return v;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

function listOrKeys(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (isObj(v)) return Object.keys(v);
  return [];
}

function envMap(v: unknown): Record<string, string> {
  if (Array.isArray(v)) {
    return Object.fromEntries(
      v.map(String).map((s) => {
        const i = s.indexOf('=');
        return i < 0 ? [s, ''] : [s.slice(0, i), s.slice(i + 1)];
      }),
    );
  }
  if (isObj(v))
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x == null ? '' : String(x)]));
  return {};
}

function portStrings(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((p) => {
    if (isObj(p))
      return `${String(p.host_ip ?? '')}:${String(p.published ?? '')}:${String(p.target ?? '')}`;
    const parts = String(p).split(':');
    return parts.length === 3 ? parts.join(':') : `:${parts.join(':')}`;
  });
}

function normalize(raw: unknown, source: ComposeSource): ComposeModel {
  const doc = isObj(raw) ? raw : {};
  const services: Record<string, ComposeService> = {};
  for (const [name, s] of Object.entries(isObj(doc.services) ? doc.services : {})) {
    const svc = isObj(s) ? s : {};
    const deps: Record<string, { condition?: string }> = {};
    if (Array.isArray(svc.depends_on)) for (const d of svc.depends_on) deps[String(d)] = {};
    else if (isObj(svc.depends_on))
      for (const [d, c] of Object.entries(svc.depends_on))
        deps[d] = isObj(c) && typeof c.condition === 'string' ? { condition: c.condition } : {};
    services[name] = {
      image: typeof svc.image === 'string' ? svc.image : undefined,
      command: Array.isArray(svc.command) ? svc.command.map(String) : undefined,
      profiles: listOrKeys(svc.profiles),
      networks: listOrKeys(svc.networks),
      environment: envMap(svc.environment),
      depends_on: deps,
      ports: portStrings(svc.ports),
      hasEnvFile: svc.env_file !== undefined,
    };
  }
  const networks: Record<string, { internal: boolean }> = {};
  for (const [name, n] of Object.entries(isObj(doc.networks) ? doc.networks : {}))
    networks[name] = { internal: isObj(n) && n.internal === true };
  return {
    source,
    name: typeof doc.name === 'string' ? doc.name : undefined,
    services,
    networks,
    volumes: listOrKeys(doc.volumes),
  };
}
