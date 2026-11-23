// OPS-01: .env.example lists every setting (11 §4, 02 §4, ADR-015, ADR-022), none filled.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  envFileKeys,
  interpolatedVariables,
  parseEnvFile,
  readEnvExample,
  REPO_ROOT,
} from '../src/index';

const text = readEnvExample();
const env = parseEnvFile(text);

/** The settings OPS-01 acceptance names, in that order. */
const REQUIRED = [
  'DATABASE_URL',
  'DATABASE_URL_MIGRATE',
  'POSTGRES_PASSWORD',
  'APP_DB_PASSWORD',
  'OBJECT_STORE',
  'AUTH_SECRET',
  'PUBLIC_BASE_URL',
  'SMTP_URL',
  'ANTHROPIC_API_KEY',
  'LOG_LEVEL',
  'SESSION_IDLE_MIN',
  'JOB_CONCURRENCY',
  'AI_MAX_TOKENS_PER_JOB',
  'AUTH_LINK_TTL_MIN',
  'DEMO_USER_EMAIL',
];

/** Secrets: must be empty, or a ${REF} to another (empty) secret. */
const isSecretKey = (k: string) => /PASSWORD|SECRET|API_KEY|ACCESS_KEY/.test(k);
const REF = /^\$\{[A-Z0-9_]+\}$/;
/** postgresql://<role>:${REF}@<host>/<db>?sslmode=<mode> */
const DB_URL =
  /^postgresql:\/\/([a-z_]+):(\$\{[A-Z0-9_]+\})@([a-z0-9.-]+(?::\d+)?)\/([a-z_]+)\?sslmode=([a-z-]+)$/;

describe('.env.example', () => {
  it.each(REQUIRED)('lists %s', (key) => {
    expect(env.has(key)).toBe(true);
  });

  it('sets OBJECT_STORE=postgres and has no OBJECTS_IMAGE, MINIO_* or S3_* settings', () => {
    expect(env.get('OBJECT_STORE')).toBe('postgres');
    for (const k of env.keys()) expect(k).not.toMatch(/^(OBJECTS_IMAGE|MINIO_|S3_)/);
    expect(text).not.toMatch(/minio|objdata/i);
  });

  it('lists each key once', () => {
    const keys = envFileKeys(text);
    expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([]);
  });

  it('leaves every secret empty (or a reference to another empty secret)', () => {
    for (const [k, v] of env) {
      if (!isSecretKey(k)) continue;
      expect(v === '' || REF.test(v), `${k}=${v}`).toBe(true);
      if (REF.test(v)) expect(env.get(v.slice(2, -1)), `${k} -> ${v}`).toBeDefined();
    }
    for (const k of [
      'POSTGRES_PASSWORD',
      'OWNER_DB_PASSWORD',
      'APP_DB_PASSWORD',
      'AUTH_SECRET',
      'ANTHROPIC_API_KEY',
    ])
      expect(env.get(k), k).toBe('');
  });

  it('has no value that looks like a real key or token', () => {
    for (const [k, v] of env) {
      expect(v, k).not.toMatch(/sk-ant-|-----BEGIN|AKIA[0-9A-Z]{16}/);
      // long opaque strings are secrets, not placeholders
      expect(v.replace(/\$\{[A-Z0-9_]+\}/g, ''), k).not.toMatch(/[A-Za-z0-9+/=_-]{32,}/);
    }
  });

  it('DATABASE_URL uses the app role glidepath_app, password by reference, sslmode in the URL', () => {
    const m = DB_URL.exec(env.get('DATABASE_URL')!);
    expect(m, env.get('DATABASE_URL')).not.toBeNull();
    expect(m![1]).toBe('glidepath_app');
    expect(m![2]).toBe('${APP_DB_PASSWORD}');
    expect(m![5]).toBeTruthy();
  });

  it('DATABASE_URL_MIGRATE uses the owner role glidepath_owner, password by reference', () => {
    const m = DB_URL.exec(env.get('DATABASE_URL_MIGRATE')!);
    expect(m, env.get('DATABASE_URL_MIGRATE')).not.toBeNull();
    expect(m![1]).toBe('glidepath_owner');
    expect(m![2]).toBe('${OWNER_DB_PASSWORD}');
  });

  it('has no split DB settings (PGHOST, DB_HOST...) next to the URLs', () => {
    for (const k of env.keys())
      expect(k).not.toMatch(/^(PG[A-Z]+|DB_[A-Z]+|DATABASE_(HOST|PORT|USER|PASSWORD|NAME))$/);
  });

  it('documents a Neon-style sslmode=require URL', () => {
    expect(text).toMatch(/sslmode=require/);
    expect(text).toContain('docker-compose.neon.yml');
  });

  it('lists every variable the compose files interpolate', () => {
    for (const file of ['docker-compose.yml', 'docker-compose.neon.yml']) {
      const vars = interpolatedVariables(readFileSync(join(REPO_ROOT, file), 'utf8'));
      for (const v of vars) expect(env.has(v), `${file}: ${v}`).toBe(true);
    }
  });

  it('is committed while .env is git-ignored', () => {
    const ignore = readFileSync(join(REPO_ROOT, '.gitignore'), 'utf8').split(/\r?\n/);
    expect(ignore).toContain('.env');
  });
});
