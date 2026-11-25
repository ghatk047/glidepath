/* eslint-disable @typescript-eslint/no-explicit-any -- parsed Caddy/bake JSON is untyped */
/**
 * Helpers for the web image tests (OPS-03): the Caddyfile, the Dockerfile and the bake file
 * of `ops/docker/web`, and a way to run `caddy` against them.
 *
 * `caddy` runs from the PATH when installed, otherwise from the exact image the Dockerfile
 * serves from (`docker run caddy:<pinned>`), so the test validates with the same version
 * that ships. Neither available is a hard error, not a skip.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../src/index';

export const WEB_DIR = join(REPO_ROOT, 'ops/docker/web');
export const CADDYFILE = join(WEB_DIR, 'Caddyfile');
export const DOCKERFILE = join(WEB_DIR, 'Dockerfile');
export const BAKE_FILE = join(WEB_DIR, 'docker-bake.hcl');

export const read = (path: string): string => readFileSync(path, 'utf8');

/** The `FROM caddy:<tag>` image of the runtime stage. */
export function caddyImage(): string {
  const m = /^FROM\s+(caddy:\S+)/m.exec(read(DOCKERFILE));
  if (!m) throw new Error('Dockerfile has no "FROM caddy:<tag>" runtime stage');
  return m[1]!;
}

export interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

const run = (cmd: string, args: string[], env: Record<string, string> = {}): Run => {
  const r = spawnSync(cmd, args, {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    maxBuffer: 16 * 1024 * 1024,
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? r.error?.message ?? '' };
};

/** Runs `caddy <subcommand> --config <Caddyfile> --adapter caddyfile` with the given env. */
export function caddy(subcommand: 'validate' | 'adapt', env: Record<string, string> = {}): Run {
  const local = run('caddy', ['version']);
  if (local.status === 0) {
    return run('caddy', [subcommand, '--config', CADDYFILE, '--adapter', 'caddyfile'], env);
  }
  const docker = ['run', '--rm', '-v', `${CADDYFILE}:/etc/caddy/Caddyfile:ro`];
  for (const [k, v] of Object.entries(env)) docker.push('-e', `${k}=${v}`);
  docker.push(
    caddyImage(),
    'caddy',
    subcommand,
    '--config',
    '/etc/caddy/Caddyfile',
    '--adapter',
    'caddyfile',
  );
  const r = run('docker', docker);
  if (r.status !== 0 && /not found|No such file|ENOENT|Cannot connect/i.test(r.stderr))
    throw new Error(`need caddy on PATH or a Docker daemon with ${caddyImage()}: ${r.stderr}`);
  return r;
}

/** `caddy adapt` as parsed JSON. */
export function adapt(env: Record<string, string> = {}): unknown {
  const r = caddy('adapt', env);
  if (r.status !== 0) throw new Error(`caddy adapt failed: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

/** `docker buildx bake -f docker-bake.hcl <target> --print` as parsed JSON. */
export function bakePrint(target: string, env: Record<string, string> = {}): any {
  const r = run('docker', ['buildx', 'bake', '-f', BAKE_FILE, target, '--print'], env);
  if (r.status !== 0) throw new Error(`docker buildx bake --print failed: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

/** Every object anywhere in `v` for which `pred` holds (depth first). */
export function findAll(
  v: unknown,
  pred: (o: Record<string, any>) => boolean,
): Record<string, any>[] {
  const out: Record<string, any>[] = [];
  const walk = (x: unknown): void => {
    if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === 'object') {
      if (pred(x as Record<string, any>)) out.push(x as Record<string, any>);
      Object.values(x).forEach(walk);
    }
  };
  walk(v);
  return out;
}

/** The Content-Security-Policy value set by the adapted config (single, shared policy). */
export function adaptedCsp(config: unknown): string[] {
  return findAll(
    config,
    (o) => o.handler === 'headers' && !!o.response?.set?.['Content-Security-Policy'],
  ).flatMap((o) => o.response.set['Content-Security-Policy'] as string[]);
}

/** Parses a CSP into directive -> source list. */
export function parseCsp(csp: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const part of csp.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) out.set(name, sources);
  }
  return out;
}
