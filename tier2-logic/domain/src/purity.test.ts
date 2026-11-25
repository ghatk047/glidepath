import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const eslint = new ESLint({ cwd: pkgDir });

async function lintAs(file: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: join(pkgDir, file) });
  return (result?.messages ?? []).filter((m) => m.severity === 2).map((m) => m.ruleId ?? m.message);
}

// ESLint with the TypeScript parser takes seconds per run under a parallel turbo build.
describe('package imports no IO modules (lint)', { timeout: 60_000 }, () => {
  it('the lint config rejects IO imports and IO globals in src', async () => {
    const io = [
      "import { readFileSync } from 'node:fs';\nexport const f = readFileSync;\n",
      "import fs from 'fs';\nexport const f = fs;\n",
      "import { readFile } from 'fs/promises';\nexport const f = readFile;\n",
      "import { createServer } from 'node:http';\nexport const f = createServer;\n",
      "import { Pool } from 'pg';\nexport const f = Pool;\n",
      "import { drizzle } from 'drizzle-orm/node-postgres';\nexport const f = drizzle;\n",
      "import { loadModelBundleFromDir } from '@glidepath/spec/node';\nexport const f = loadModelBundleFromDir;\n",
      "import type { Db } from '@glidepath/data-access';\nexport type F = Db;\n",
      "export const f = () => fetch('https://example.invalid');\n",
      'export const f = () => process.env.DATABASE_URL;\n',
      "export const f = () => import('node:fs');\n",
    ];
    for (const code of io) {
      const errors = await lintAs('src/probe.ts', code);
      expect(errors, code).toEqual(
        expect.arrayContaining([expect.stringMatching(/^no-restricted-(imports|globals|syntax)$/)]),
      );
    }
  });

  it('pure imports pass, and tests may read spec files', async () => {
    expect(
      await lintAs(
        'src/probe.ts',
        "import { membersHash } from '@glidepath/spec';\nexport const f = membersHash;\n",
      ),
    ).toEqual([]);
    expect(
      await lintAs(
        'src/probe.test.ts',
        "import { readFileSync } from 'node:fs';\nexport const f = readFileSync;\n",
      ),
    ).toEqual([]);
  });

  it('src lints clean, and ports.ts holds the ChangesetStore and ModelCache ports', async () => {
    const results = await eslint.lintFiles(['src']);
    const errors = results.flatMap((r) =>
      r.messages.filter((m) => m.severity === 2).map((m) => `${r.filePath}:${m.line} ${m.ruleId}`),
    );
    expect(errors).toEqual([]);
    const linted = results.map((r) => r.filePath);
    const sources = readdirSync(join(pkgDir, 'src')).filter(
      (f) => f.endsWith('.ts') && !f.endsWith('.test.ts'),
    );
    for (const f of sources) expect(linted).toContain(join(pkgDir, 'src', f));
    const ports = readFileSync(join(pkgDir, 'src/ports.ts'), 'utf8');
    expect(ports).toMatch(/export interface ChangesetStore\b/);
    expect(ports).toMatch(/export interface ModelCache</);
  });
});
