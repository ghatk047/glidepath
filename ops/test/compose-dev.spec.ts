// OPS-04: docker-compose.dev.yml hot-reload override and mailpit, checked on the MERGED config
// (docker-compose.yml + docker-compose.dev.yml). Uses `docker compose config` when the Compose
// CLI is installed, and always the YAML merge, so a daemon-less builder checks the same contract.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  type ComposeModel,
  type ComposeSource,
  composeConfigFromDocker,
  composeConfigFromYamlFiles,
  hasDockerCompose,
  REPO_ROOT,
  writeTestEnvFile,
} from '../src/index';

const FILES = ['docker-compose.yml', 'docker-compose.dev.yml'];
const SOURCES: ComposeSource[] = hasDockerCompose() ? ['yaml', 'docker'] : ['yaml'];

function load(source: ComposeSource): ComposeModel {
  const envFile = writeTestEnvFile();
  return source === 'docker'
    ? composeConfigFromDocker({ envFile, files: FILES })
    : composeConfigFromYamlFiles({ envFile, files: FILES });
}

describe.each(SOURCES)('docker-compose.yml + docker-compose.dev.yml (%s)', (source) => {
  let c: ComposeModel;
  beforeAll(() => {
    c = load(source);
  });
  const svc = (name: string) => {
    const s = c.services[name];
    if (!s) throw new Error(`service ${name} missing`);
    return s;
  };
  const cmd = (name: string) => (svc(name).command ?? []).join(' ');

  // acceptance 1
  it('web runs the Vite dev server and logic/worker run tsx watch from bind mounts', () => {
    expect(cmd('web')).toMatch(/\bvite\b/);
    expect(cmd('logic')).toMatch(/tsx watch/);
    expect(cmd('worker')).toMatch(/tsx watch/);
    for (const s of ['web', 'logic', 'worker']) {
      expect(svc(s).bindMounts, `${s} bind-mounts the repo`).toContain('/repo');
    }
    // Caddy is gone from web; nothing serves production certificates in dev.
    expect(svc('web').image).toMatch(/^node:22/);
    expect(svc('web').ports.join(' ')).not.toMatch(/:(80|443)$/);
  });

  // acceptance 2
  it('binds db 5432 and mailpit 8025 to 127.0.0.1 only (no MinIO exists, ADR-025)', () => {
    expect(svc('db').ports).toContain('127.0.0.1:5432:5432');
    expect(svc('mail').ports).toContain('127.0.0.1:8025:8025');
    expect(svc('mail').profiles, 'mailpit starts without COMPOSE_PROFILES').toEqual([]);
    expect(Object.keys(c.services)).not.toContain('objects');
    for (const [name, s] of Object.entries(c.services)) {
      for (const p of s.ports) {
        expect(p.split(':')[0], `${name} port ${p}`).toBe('127.0.0.1');
      }
    }
  });

  it('keeps tier separation: web is not on the data network, only db gets the host network', () => {
    expect(svc('web').networks).toEqual(['edge']);
    expect(c.networks.data?.internal).toBe(true);
    expect(c.networks.devhost?.internal).toBe(false);
    expect([...svc('db').networks].sort()).toEqual(['data', 'devhost']);
    for (const s of ['logic', 'worker', 'migrate'])
      expect(svc(s).networks).not.toContain('devhost');
  });

  it('keeps migrate on the logic image and the start order behind migrate', () => {
    expect(svc('migrate').image).toMatch(/^glidepath\/logic:/);
    for (const s of ['logic', 'worker'])
      expect(svc(s).depends_on.migrate?.condition, s).toBe('service_completed_successfully');
  });
});

// acceptance 3
describe('README documents the dev command', () => {
  const md = readFileSync(join(REPO_ROOT, 'README.md'), 'utf8');
  it('gives the dev compose command, the Vite port and mailpit', () => {
    expect(md).toContain('docker compose -f docker-compose.yml -f docker-compose.dev.yml up');
    expect(md).toContain('http://localhost:5173');
    expect(md).toContain('http://localhost:8025');
  });
});
