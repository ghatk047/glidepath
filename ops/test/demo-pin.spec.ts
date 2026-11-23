// OPS-06: ops/demo-pin.sh writes the digest pins that `docker compose --profile demo up -d` reads.
// A fake `docker` plays the daemon: images have manifest digests, nothing is built.
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { composeConfigFromYaml, parseEnvFile, readEnvExample, REPO_ROOT, writeTestEnvFile } from '../src/index';

const SCRIPT = join(REPO_ROOT, 'ops/demo-pin.sh');
const hex = (c: string) => c.repeat(64);

const FAKE = `#!/usr/bin/env bash
echo "docker $*" >> "$FAKE_DIR/calls.log"
case "$1" in
  info) exit 0 ;;
  build) exit "\${FAKE_BUILD_EXIT:-0}" ;;
  tag) exit 0 ;;
  pull) exit 0 ;;
  image)
    # image inspect [--format F] REF
    shift 2
    fmt=""; [ "$1" = "--format" ] && { fmt="$2"; shift 2; }
    ref="$1"
    case "$ref" in
      *@sha256:*) [ -n "\${FAKE_NO_RESOLVE:-}" ] && exit 1; exit 0 ;;
    esac
    case "$ref" in *missing*) exit 1 ;; esac
    [ -z "$fmt" ] && exit 0
    case "$fmt" in
      *Descriptor*) [ -n "\${FAKE_NO_DESCRIPTOR:-}" ] && { echo "<no value>"; exit 0; }
        case "$ref" in
          glidepath/logic:*) echo "sha256:${hex('a')}" ;;
          glidepath/web:*) echo "sha256:${hex('b')}" ;;
          postgres:*) echo "sha256:${hex('c')}" ;;
          axllent/mailpit:*) echo "sha256:${hex('d')}" ;;
        esac ;;
      *RepoDigests*) echo "\${ref%%:*}@sha256:${hex('e')}" ;;
    esac
    exit 0 ;;
esac
exit 0
`;

let BIN: string;
beforeAll(() => {
  BIN = mkdtempSync(join(tmpdir(), 'glidepath-pinbin-'));
  writeFileSync(join(BIN, 'docker'), FAKE);
  chmodSync(join(BIN, 'docker'), 0o755);
});

function run(args: string[], env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'glidepath-pin-'));
  const envFile = join(dir, '.env');
  copyFileSync(writeTestEnvFile(), envFile);
  const record = join(dir, 'demo-pins.env');
  const r = spawnSync(SCRIPT, ['--env-file', envFile, '--record', record, ...args], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
    env: { ...process.env, PATH: `${BIN}:${process.env.PATH}`, FAKE_DIR: dir, ...env },
  });
  const read = (f: string) => {
    try {
      return readFileSync(f, 'utf8');
    } catch {
      return '';
    }
  };
  return { code: r.status ?? -1, out: r.stdout, err: r.stderr, envFile, record, env: parseEnvFile(read(envFile)), rec: parseEnvFile(read(record)), calls: read(join(dir, 'calls.log')) };
}

describe('ops/demo-pin.sh', () => {
  it('--build builds both images with the demo tag and pins all four by digest in .env and the record', () => {
    const r = run(['--build']);
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    expect(r.calls).toMatch(/docker build -q -f ops\/docker\/logic\/Dockerfile -t glidepath\/logic:demo-2026-12-04 \./);
    expect(r.calls).toMatch(/docker build -q -f ops\/docker\/web\/Dockerfile -t glidepath\/web:demo-2026-12-04 \./);
    for (const e of [r.env, r.rec]) {
      expect(e.get('TAG')).toBe('demo-2026-12-04');
      expect(e.get('LOGIC_IMAGE_PIN')).toBe(`@sha256:${hex('a')}`);
      expect(e.get('WEB_IMAGE_PIN')).toBe(`@sha256:${hex('b')}`);
      expect(e.get('DB_IMAGE_PIN')).toBe(`@sha256:${hex('c')}`);
      expect(e.get('MAIL_IMAGE_PIN')).toBe(`@sha256:${hex('d')}`);
    }
    expect(r.env.get('COMPOSE_PROFILES')).toBe('demo');
    // The rest of .env is untouched (secrets stay).
    expect(r.env.get('AUTH_SECRET')).toBe('test-auth_secret');
  });

  it('the pinned .env gives docker-compose.yml digest-pinned images of the demo tag', () => {
    const r = run(['--build']);
    const c = composeConfigFromYaml({ envFile: r.envFile });
    expect(c.services.logic!.image).toBe(`glidepath/logic:demo-2026-12-04@sha256:${hex('a')}`);
    expect(c.services.web!.image).toBe(`glidepath/web:demo-2026-12-04@sha256:${hex('b')}`);
    for (const [name, s] of Object.entries(c.services)) expect(s.image, name).toMatch(/@sha256:[0-9a-f]{64}$/);
  });

  it('--from-tag retags existing images instead of building', () => {
    const r = run(['--from-tag', 'dev']);
    expect(r.code).toBe(0);
    expect(r.calls).toContain('docker tag glidepath/logic:dev glidepath/logic:demo-2026-12-04');
    expect(r.calls).toContain('docker tag glidepath/web:dev glidepath/web:demo-2026-12-04');
    expect(r.calls).not.toContain('docker build');
  });

  it('falls back to RepoDigests when the image store has no descriptor', () => {
    const r = run(['--build'], { FAKE_NO_DESCRIPTOR: '1' });
    expect(r.code).toBe(0);
    expect(r.env.get('LOGIC_IMAGE_PIN')).toBe(`@sha256:${hex('e')}`);
  });

  it('is rerunnable: a second run replaces the pins, never appends duplicates', () => {
    const r = run(['--build']);
    const again = spawnSync(SCRIPT, ['--env-file', r.envFile, '--record', r.record, '--build'], {
      encoding: 'utf8',
      cwd: REPO_ROOT,
      env: { ...process.env, PATH: `${BIN}:${process.env.PATH}`, FAKE_DIR: join(r.envFile, '..') },
    });
    expect(again.status).toBe(0);
    const text = readFileSync(r.envFile, 'utf8');
    for (const k of ['TAG', 'COMPOSE_PROFILES', 'LOGIC_IMAGE_PIN', 'WEB_IMAGE_PIN', 'DB_IMAGE_PIN', 'MAIL_IMAGE_PIN'])
      expect(text.match(new RegExp(`^${k}=`, 'gm')), k).toHaveLength(1);
  });

  it('--digest takes a registry digest (multi-arch index) over the local one', () => {
    const r = run(['--build', '--digest', `logic=sha256:${hex('9')}`]);
    expect(r.code).toBe(0);
    expect(r.env.get('LOGIC_IMAGE_PIN')).toBe(`@sha256:${hex('9')}`);
    expect(r.env.get('WEB_IMAGE_PIN')).toBe(`@sha256:${hex('b')}`);
  });

  it('refuses a digest that does not resolve locally, and writes nothing', () => {
    const r = run(['--build'], { FAKE_NO_RESOLVE: '1' });
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/does not resolve locally/);
    expect(r.env.get('LOGIC_IMAGE_PIN')).toBe('');
    expect(r.rec.size).toBe(0);
  });

  it('fails when the build fails', () => {
    const r = run(['--build'], { FAKE_BUILD_EXIT: '1' });
    expect(r.code).toBe(1);
    expect(r.err).toContain('build failed: glidepath/logic');
  });

  it('--apply copies a committed record into .env without docker', () => {
    const built = run(['--build']);
    const dir = mkdtempSync(join(tmpdir(), 'glidepath-apply-'));
    const envFile = join(dir, '.env');
    copyFileSync(writeTestEnvFile(), envFile);
    const r = spawnSync(SCRIPT, ['--apply', '--env-file', envFile, '--record', built.record], {
      encoding: 'utf8',
      cwd: REPO_ROOT,
      env: { ...process.env, PATH: '/usr/bin:/bin' },
    });
    expect(r.status).toBe(0);
    const env = parseEnvFile(readFileSync(envFile, 'utf8'));
    expect(env.get('WEB_IMAGE_PIN')).toBe(`@sha256:${hex('b')}`);
    expect(env.get('COMPOSE_PROFILES')).toBe('demo');
  });

  it('rejects usage errors with exit 2', () => {
    expect(run([]).code).toBe(2);
    expect(run(['--build', '--digest', 'logic=sha256:abc']).code).toBe(2);
    expect(run(['--build', '--tag', 'bad tag']).code).toBe(2);
    expect(run(['--bogus']).code).toBe(2);
  });

  it('--dry-run changes nothing', () => {
    const r = run(['--build', '--dry-run']);
    expect(r.code).toBe(0);
    expect(r.calls).toBe('');
    expect(r.env.get('LOGIC_IMAGE_PIN')).toBe('');
  });

  it('reads the postgres and mailpit references from docker-compose.yml', () => {
    const r = run(['--build']);
    const text = readFileSync(join(REPO_ROOT, 'docker-compose.yml'), 'utf8');
    const pg = /image: (postgres:[^$\s]+)\$\{DB_IMAGE_PIN/.exec(text)![1]!;
    const mp = /image: (axllent\/mailpit:[^$\s]+)\$\{MAIL_IMAGE_PIN/.exec(text)![1]!;
    expect(r.calls).toContain(`docker image inspect ${pg}`);
    expect(r.calls).toContain(`docker image inspect ${mp}`);
    expect(parseEnvFile(readEnvExample()).get('TAG')).toBe('dev');
  });
});
