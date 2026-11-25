import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { aaSeedDir, fictitiousUsers, FICTITIOUS_EMAIL_DOMAIN } from './index';

/**
 * Lint: no real personal data in testkit. Every e-mail address in testkit sources,
 * fixtures and the AA seed must be on the reserved `.test` TLD (RFC 2606), and the
 * exported users must be the fictitious ones.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEXT = /\.(ts|json|md|csv|py|sql|txt)$/;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (TEXT.test(name)) out.push(p);
  }
  return out;
}

function emailsIn(files: string[]): { file: string; email: string }[] {
  const found: { file: string; email: string }[] = [];
  for (const file of files) {
    for (const m of readFileSync(file, 'utf8').matchAll(EMAIL)) found.push({ file, email: m[0] });
  }
  return found;
}

describe('lint: no real personal data; fictitious users only', () => {
  it('every e-mail address in testkit and the AA seed is on the reserved .test TLD', () => {
    const found = emailsIn([...walk(root), ...walk(aaSeedDir)]).filter(
      // this test file names the pattern; its own regex is not an address
      (f) => !f.file.endsWith('no-personal-data.test.ts'),
    );
    const bad = found.filter((f) => !f.email.toLowerCase().endsWith('.test'));
    expect(bad).toEqual([]);
  });

  it('the exported users are fictitious: example.test addresses, test-labelled names, unique ids and emails', () => {
    expect(fictitiousUsers.length).toBeGreaterThan(0);
    for (const u of fictitiousUsers) {
      expect(u.email.endsWith(`@${FICTITIOUS_EMAIL_DOMAIN}`)).toBe(true);
      expect(u.name).toMatch(/^Test /);
      expect(u.id).toMatch(/^00000000-0000-4000-8000-[0-9a-f]{12}$/);
    }
    expect(new Set(fictitiousUsers.map((u) => u.email)).size).toBe(fictitiousUsers.length);
    expect(new Set(fictitiousUsers.map((u) => u.id)).size).toBe(fictitiousUsers.length);
  });
});
