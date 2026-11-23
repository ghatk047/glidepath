// OPS-01: services and networks of docs/architecture/11_docker_deployment.md §1–§2.
// Runs against `docker compose config` when the Compose CLI is installed, and always
// against the parsed YAML, so a daemon-less builder checks the same contract.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  type ComposeModel,
  type ComposeSource,
  composeConfigFromDocker,
  composeConfigFromYaml,
  hasDockerCompose,
  parseComposeYaml,
  parseEnvFile,
  readEnvExample,
  REPO_ROOT,
  runComposeConfig,
  writeTestEnvFile,
} from '../src/index';

const DOCKER = hasDockerCompose();
const SOURCES: ComposeSource[] = DOCKER ? ['yaml', 'docker'] : ['yaml'];

const TIER2 = ['migrate', 'logic', 'worker'] as const;
const DB_URL_VARS = ['DATABASE_URL', 'DATABASE_URL_MIGRATE'];

/** Split connection settings that would stop a Neon URL from being a drop-in. */
const SPLIT_DB_VARS =
  /\b(PGHOST|PGHOSTADDR|PGPORT|PGUSER|PGPASSWORD|PGPASSFILE|PGDATABASE|PGSSLMODE|PGSERVICE|DB_HOST|DB_PORT|DB_USER|DB_USERNAME|DB_PASS|DB_PASSWORD|DB_NAME|DB_SSL|DATABASE_HOST|DATABASE_PORT|DATABASE_USER|DATABASE_PASSWORD|DATABASE_NAME|POSTGRES_HOST|POSTGRES_PORT)\b/;

function load(source: ComposeSource): ComposeModel {
  const envFile = writeTestEnvFile();
  return source === 'docker'
    ? composeConfigFromDocker({ envFile, profiles: ['dev'] })
    : composeConfigFromYaml({ envFile });
}

describe.each(SOURCES)('docker-compose.yml (%s)', (source) => {
  let c: ComposeModel;
  beforeAll(() => {
    c = load(source);
  });
  const svc = (name: string) => {
    const s = c.services[name];
    if (!s) throw new Error(`service ${name} missing`);
    return s;
  };

  it('is the glidepath project with the services of 11 §1', () => {
    expect(c.name).toBe('glidepath');
    expect(Object.keys(c.services).sort()).toEqual(
      ['db', 'logic', 'mail', 'migrate', 'web', 'worker'].sort(),
    );
  });

  it('pins db to a postgres:16 minor', () => {
    expect(svc('db').image).toMatch(/^postgres:16\.\d+(-[a-z0-9.]+)?$/);
  });

  it('has no objects service; tier 2 stores objects in Postgres (ADR-025)', () => {
    expect(Object.keys(c.services)).not.toContain('objects');
    for (const s of TIER2) expect(svc(s).environment.OBJECT_STORE, s).toBe('postgres');
  });

  it('pins mailpit and tags the glidepath images with TAG', () => {
    expect(svc('mail').image).toMatch(/^axllent\/mailpit:v\d+\.\d+\.\d+$/);
    for (const s of TIER2) expect(svc(s).image).toBe('glidepath/logic:dev');
    expect(svc('web').image).toBe('glidepath/web:dev');
  });

  it('runs the three tier-2 commands from one image', () => {
    // The shell only adds --parity / --ai-cache when the image carries them (OPS-06, tested below).
    expect(svc('migrate').command!.slice(0, 2)).toEqual(['sh', '-c']);
    expect(svc('migrate').command!.slice(3)).toEqual(['migrate', '--seed', 'aa']);
    // `docker compose config` prints a literal $ as $$ (re-parseable output); the container sees one.
    expect(svc('migrate').command![2]!.replaceAll('$$', '$')).toContain('exec node dist/migrate.js "$@"');
    expect(svc('logic').command).toEqual(['node', 'dist/server.js']);
    expect(svc('worker').command).toEqual(['node', 'dist/worker.js']);
  });

  it('puts mail in the dev and demo profiles only and every other service in no profile', () => {
    expect(svc('mail').profiles).toEqual(['dev', 'demo']);
    for (const [name, s] of Object.entries(c.services))
      if (name !== 'mail') expect(s.profiles, name).toEqual([]);
  });

  it('defines networks edge, data (internal: true) and egress', () => {
    expect(Object.keys(c.networks).sort()).toEqual(['data', 'edge', 'egress']);
    expect(c.networks.data!.internal).toBe(true);
    expect(c.networks.edge!.internal).toBe(false);
    expect(c.networks.egress!.internal).toBe(false);
  });

  it('web on edge only; db on data only; worker on data + egress; logic on edge + data', () => {
    const nets = (name: string) => [...svc(name).networks].sort();
    expect(nets('web')).toEqual(['edge']);
    expect(nets('db')).toEqual(['data']);
    expect(nets('worker')).toEqual(['data', 'egress']);
    expect(nets('logic')).toEqual(['data', 'edge']);
    expect(nets('migrate')).toEqual(['data']);
    expect(nets('mail')).toEqual(['edge']);
  });

  it('publishes only web 80/443 and mailpit 8025, both on 127.0.0.1 by default', () => {
    expect(svc('web').ports.sort()).toEqual(['127.0.0.1:443:443', '127.0.0.1:80:80']);
    expect(svc('mail').ports).toEqual(['127.0.0.1:8025:8025']);
    for (const s of ['db', ...TIER2]) expect(svc(s).ports, s).toEqual([]);
  });

  it('starts in order: db healthy -> migrate done -> logic/worker -> web', () => {
    expect(svc('migrate').depends_on).toEqual({ db: { condition: 'service_healthy' } });
    for (const s of ['logic', 'worker'])
      expect(svc(s).depends_on, s).toEqual({
        migrate: { condition: 'service_completed_successfully' },
      });
    expect(svc('web').depends_on).toEqual({ logic: { condition: 'service_healthy' } });
  });

  it('keeps the volumes pgdata and caddydata, and has no objdata', () => {
    expect(c.volumes).toEqual(expect.arrayContaining(['pgdata', 'caddydata']));
    expect(c.volumes).not.toContain('objdata');
  });

  it('has no OBJECTS_IMAGE, MINIO_* or S3_* settings', () => {
    for (const [name, s] of Object.entries(c.services))
      for (const k of Object.keys(s.environment))
        expect(k, `${name}: ${k}`).not.toMatch(/^(OBJECTS_IMAGE|MINIO_|S3_)/);
  });

  it('tier-2 services read the DB only from DATABASE_URL / DATABASE_URL_MIGRATE', () => {
    for (const s of TIER2) {
      const dbKeys = Object.keys(svc(s).environment).filter((k) =>
        /^(PG|POSTGRES|DB_|DATABASE)/.test(k),
      );
      expect(
        dbKeys.every((k) => DB_URL_VARS.includes(k)),
        `${s}: ${dbKeys.join(',')}`,
      ).toBe(true);
    }
    expect(Object.keys(svc('migrate').environment)).toEqual(expect.arrayContaining(DB_URL_VARS));
    // Runtime services get the app role only; the owner URL is for migrate.
    for (const s of ['logic', 'worker']) {
      expect(svc(s).environment).toHaveProperty('DATABASE_URL');
      expect(svc(s).environment).not.toHaveProperty('DATABASE_URL_MIGRATE');
    }
  });

  it('hands each service only its own settings (no env_file, secrets where needed)', () => {
    for (const [name, s] of Object.entries(c.services)) expect(s.hasEnvFile, name).toBe(false);
    const holders = (key: string) =>
      Object.entries(c.services)
        .filter(([, s]) => key in s.environment)
        .map(([n]) => n)
        .sort();
    expect(holders('POSTGRES_PASSWORD')).toEqual(['db']);
    expect(holders('APP_DB_PASSWORD')).toEqual(['db']);
    expect(holders('ANTHROPIC_API_KEY')).toEqual(['worker']);
    expect(holders('AUTH_SECRET')).toEqual(['logic']);
    expect(Object.keys(svc('web').environment)).toEqual(['PUBLIC_BASE_URL']);
  });

  it('resolves the DB URLs from the role passwords in .env', () => {
    expect(svc('logic').environment.DATABASE_URL).toBe(
      'postgresql://glidepath_app:test-app_db_password@db:5432/glidepath?sslmode=disable',
    );
    expect(svc('migrate').environment.DATABASE_URL_MIGRATE).toBe(
      'postgresql://glidepath_owner:test-owner_db_password@db:5432/glidepath?sslmode=disable',
    );
  });
});

describe('no split DB connection vars in compose (Neon drop-in)', () => {
  const composeFiles = readdirSync(REPO_ROOT).filter((f) => /^docker-compose.*\.ya?ml$/.test(f));

  it('the grep catches split vars when present', () => {
    expect(SPLIT_DB_VARS.test('      PGHOST: db')).toBe(true);
    expect(SPLIT_DB_VARS.test('      DB_PASSWORD: x')).toBe(true);
    expect(SPLIT_DB_VARS.test('      DATABASE_URL: x')).toBe(false);
  });

  it.each(composeFiles)('%s has no PGHOST/PGUSER/DB_HOST-style vars', (file) => {
    const text = readFileSync(join(REPO_ROOT, file), 'utf8');
    const hits = text.split('\n').filter((l) => SPLIT_DB_VARS.test(l));
    expect(hits).toEqual([]);
  });
});

describe('docker-compose.neon.yml drops the local db (YAML)', () => {
  const neon = parseComposeYaml(
    readFileSync(join(REPO_ROOT, 'docker-compose.neon.yml'), 'utf8'),
  ) as {
    services: Record<string, { profiles?: string[]; networks?: string[]; depends_on?: object }>;
  };

  it('moves db out of the default profile and lets migrate reach the internet', () => {
    expect(neon.services.db!.profiles).toEqual(['local-db']);
    expect([...neon.services.migrate!.networks!].sort()).toEqual(['data', 'egress']);
    expect(neon.services.migrate!.depends_on).toEqual({});
  });
});

describe.skipIf(!DOCKER)('docker compose config (Compose CLI)', () => {
  it('fails fast, naming the variable, when .env.example is used with empty secrets', () => {
    const r = runComposeConfig({ envFile: join(REPO_ROOT, '.env.example') });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/required variable [A-Z0-9_]+ is missing a value/);
  });

  it('starts mail only with the dev profile, which .env.example turns on', () => {
    const off = composeConfigFromDocker({
      envFile: writeTestEnvFile(REPO_ROOT, { COMPOSE_PROFILES: '' }),
    });
    expect(Object.keys(off.services)).not.toContain('mail');
    // COMPOSE_PROFILES=dev in .env.example: a plain `docker compose up -d` includes mailpit.
    const byDefault = composeConfigFromDocker({ envFile: writeTestEnvFile() });
    expect(Object.keys(byDefault.services)).toContain('mail');
  });

  it('with docker-compose.neon.yml: no db, nothing depends on db, migrate on data + egress', () => {
    const envFile = writeTestEnvFile(REPO_ROOT, {
      DATABASE_URL:
        'postgresql://glidepath_app:x@ep-pooler.example.neon.tech/glidepath?sslmode=require',
      DATABASE_URL_MIGRATE:
        'postgresql://glidepath_owner:x@ep.example.neon.tech/glidepath?sslmode=require',
    });
    const files = ['docker-compose.yml', 'docker-compose.neon.yml'];
    const c = composeConfigFromDocker({ envFile, files, profiles: ['dev'] });
    expect(Object.keys(c.services)).not.toContain('db');
    for (const [name, s] of Object.entries(c.services))
      expect(Object.keys(s.depends_on), name).not.toContain('db');
    expect(c.services.migrate!.networks.sort()).toEqual(['data', 'egress']);
    expect(c.services.logic!.environment.DATABASE_URL).toContain('sslmode=require');
    expect(c.services.migrate!.environment.DATABASE_URL_MIGRATE).toContain('sslmode=require');
    // Neon mode needs none of the local Postgres secrets.
    const noPg = writeTestEnvFile(REPO_ROOT, {
      POSTGRES_PASSWORD: '',
      APP_DB_PASSWORD: '',
      OWNER_DB_PASSWORD: '',
    });
    expect(runComposeConfig({ envFile: noPg, files }).status).toBe(0);
    // The db service is still there for whoever asks for it explicitly.
    const withDb = composeConfigFromDocker({ envFile, files, profiles: ['local-db'] });
    expect(Object.keys(withDb.services)).toContain('db');
  });
});

// ------------------------------------------------------------------ OPS-06: demo profile
const SHA = (c: string) => `@sha256:${c.repeat(64)}`;
const DEMO_TAG = 'demo-2026-12-04';
const PINS = {
  LOGIC_IMAGE_PIN: SHA('a'),
  WEB_IMAGE_PIN: SHA('b'),
  DB_IMAGE_PIN: SHA('c'),
  MAIL_IMAGE_PIN: SHA('d'),
};
const demoEnv = (extra: Record<string, string> = {}) =>
  writeTestEnvFile(REPO_ROOT, { COMPOSE_PROFILES: 'demo', TAG: DEMO_TAG, ...PINS, ...extra });

describe.each(SOURCES)('demo profile (%s)', (source) => {
  const load = (envFile: string, profiles = ['demo']): ComposeModel =>
    source === 'docker'
      ? composeConfigFromDocker({ envFile, profiles })
      : composeConfigFromYaml({ envFile });

  it('runs the images tagged demo-2026-12-04, each pinned by digest', () => {
    const c = load(demoEnv());
    expect(c.services.migrate!.image).toBe(`glidepath/logic:${DEMO_TAG}${PINS.LOGIC_IMAGE_PIN}`);
    expect(c.services.logic!.image).toBe(c.services.migrate!.image);
    expect(c.services.worker!.image).toBe(c.services.migrate!.image);
    expect(c.services.web!.image).toBe(`glidepath/web:${DEMO_TAG}${PINS.WEB_IMAGE_PIN}`);
    expect(c.services.db!.image).toMatch(new RegExp(`^postgres:16\\.\\d+-bookworm${PINS.DB_IMAGE_PIN}$`));
    expect(c.services.mail!.image).toMatch(new RegExp(`^axllent/mailpit:v[\\d.]+${PINS.MAIL_IMAGE_PIN}$`));
    for (const [name, s] of Object.entries(c.services))
      expect(s.image, name).toMatch(/^[^@]+:[^@]+@sha256:[0-9a-f]{64}$/);
  });

  it('includes the local mail sink so magic links work offline (GAP-09)', () => {
    const c = load(demoEnv());
    expect(Object.keys(c.services)).toContain('mail');
    expect(c.services.mail!.ports).toEqual(['127.0.0.1:8025:8025']);
    expect(c.services.logic!.environment.SMTP_URL).toBe('smtp://mail:1025');
  });

  it('leaves the images unpinned (tag only) when no pin is set, as in dev', () => {
    const c = load(writeTestEnvFile(), ['dev']);
    for (const [name, s] of Object.entries(c.services)) expect(s.image, name).not.toContain('@');
  });
});

describe('demo pins in the repo', () => {
  const record = join(REPO_ROOT, 'ops/demo-pins.env');
  it.skipIf(!existsSync(record))('ops/demo-pins.env (the committed freeze record) pins all four images', () => {
    const env = parseEnvFile(readFileSync(record, 'utf8'));
    expect(env.get('TAG')).toBe(DEMO_TAG);
    for (const k of Object.keys(PINS)) expect(env.get(k), k).toMatch(/^@sha256:[0-9a-f]{64}$/);
  });

  it('.env.example lists the four pins, empty', () => {
    const env = parseEnvFile(readEnvExample());
    for (const k of Object.keys(PINS)) expect(env.get(k), k).toBe('');
  });
});

describe('migrate command in the compose file (OPS-06 --parity / --ai-cache)', () => {
  const script = (() => {
    const c = composeConfigFromYaml({ envFile: writeTestEnvFile() });
    return c.services.migrate!.command![2]!;
  })();
  const seedDir = (files: string[]) => {
    const dir = mkdtempSync(join(tmpdir(), 'glidepath-seed-'));
    for (const f of files) {
      mkdirSync(join(dir, f, '..'), { recursive: true });
      writeFileSync(join(dir, f), '{}');
    }
    return dir;
  };
  /** Runs the script with node replaced by echo and the seed dir by a temp dir; returns the migrate arguments. */
  const argsFor = (files: string[]): string => {
    const dir = seedDir(files);
    const body = script.replace('d=/app/tier3-data/seed', `d=${dir}`).replace('exec node dist/migrate.js', 'echo');
    const r = spawnSync('sh', ['-c', body, 'migrate', '--seed', 'aa'], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    return r.stdout.trim().replaceAll(dir, '<seed>');
  };

  it('seeds only when the image has neither parity reports nor a UA cache (tolerates a missing directory)', () => {
    expect(argsFor([])).toBe('--seed aa');
  });
  it('adds --parity when both reports are there', () => {
    expect(argsFor(['parity/golden-report.json', 'parity/replay-report.json'])).toBe('--seed aa --parity <seed>/parity');
    expect(argsFor(['parity/golden-report.json'])).toBe('--seed aa');
  });
  it('adds --ai-cache when the UA bundle is there', () => {
    expect(argsFor(['ai-cache/ua/manifest.json'])).toBe('--seed aa --ai-cache <seed>/ai-cache/ua');
  });
  it('adds both, parity first', () => {
    expect(argsFor(['parity/golden-report.json', 'parity/replay-report.json', 'ai-cache/ua/manifest.json'])).toBe(
      '--seed aa --parity <seed>/parity --ai-cache <seed>/ai-cache/ua',
    );
  });
});
