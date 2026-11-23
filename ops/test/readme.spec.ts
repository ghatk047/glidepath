// OPS-01: README "Running locally" section.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../src/index';

function section(md: string, heading: string): string | undefined {
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (start < 0) return undefined;
  const end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n');
}

describe('README "Running locally"', () => {
  const body = section(readFileSync(join(REPO_ROOT, 'README.md'), 'utf8'), 'Running locally');

  it('exists', () => {
    expect(body).toBeDefined();
  });

  it('gives the three steps in order: cp .env.example .env, docker compose up -d, open https://localhost', () => {
    const steps = ['cp .env.example .env', 'docker compose up -d', 'https://localhost'];
    const at = steps.map((s) => body!.indexOf(s));
    for (const [i, s] of steps.entries()) expect(at[i], s).toBeGreaterThanOrEqual(0);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('no longer mentions MinIO, the objects service or the objdata volume', () => {
    expect(body).not.toMatch(/minio|objdata|\bobjects\b/i);
    expect(body).not.toContain('MINIO_ROOT_PASSWORD');
  });

  it('explains how to point at Neon instead of the local db', () => {
    expect(body).toContain('docker-compose.neon.yml');
    expect(body).toContain('sslmode=require');
  });
});

describe('ops/README "Public demo (Cloudflare)" (OPS-09)', () => {
  const body = section(readFileSync(join(REPO_ROOT, 'ops/README.md'), 'utf8'), 'Public demo (Cloudflare)');

  it('exists', () => {
    expect(body).toBeDefined();
  });

  it('gives the dashboard steps: origin https://web:443, origin server name = the public host, no TLS verify, Access', () => {
    expect(body).toContain('`https://web:443`');
    expect(body).toMatch(/Origin Server Name = the `PUBLIC_BASE_URL` host/);
    expect(body).toMatch(/No TLS Verify = on/);
    expect(body).toMatch(/AUD tag/);
    expect(body).toContain('icy-recipe-ffdf.cloudflareaccess.com');
  });

  it('lists the .env keys', () => {
    for (const k of ['PUBLIC_BASE_URL', 'CF_ACCESS_TEAM_DOMAIN', 'CF_ACCESS_AUD', 'TUNNEL_TOKEN', 'ACCESS_AUTO_TENANTS', 'ACCESS_AUTO_ROLE', 'ACCESS_ALLOWED_DOMAINS', 'AI_ENABLED'])
      expect(body, k).toContain(`\`${k}\``);
  });

  it('gives the start and stop commands for the compose profile and the locally managed tunnel', () => {
    expect(body).toContain('docker compose --profile demo --profile tunnel up -d');
    expect(body).toMatch(/docker compose --profile demo --profile tunnel down/);
    expect(body).toContain('glidepath-tunnel');
    expect(body).toContain('docker stop glidepath-tunnel');
  });

  it('names no AUD tag or token value', () => {
    expect(body).not.toMatch(/[A-Za-z0-9+/=_-]{40,}/);
  });
});
