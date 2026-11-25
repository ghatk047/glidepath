import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const pkgDir = fileURLToPath(new URL('../..', import.meta.url));

describe('contract: dist/server.js on :8080', () => {
  it('builds dist/server.js, which exits 1 naming the missing variables', () => {
    const build = spawnSync('pnpm', ['run', 'build'], { cwd: pkgDir, encoding: 'utf8' });
    expect(build.status, build.stderr).toBe(0);
    expect(existsSync(`${pkgDir}/dist/server.js`)).toBe(true);

    const run = spawnSync('node', ['dist/server.js'], { cwd: pkgDir, encoding: 'utf8', env: { PATH: process.env.PATH ?? '' } });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('missing environment variables: DATABASE_URL, AUTH_SECRET');
  }, 60_000);
});
