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
