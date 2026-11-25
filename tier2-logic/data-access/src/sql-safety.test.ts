import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

/** DATA-05 "all queries parameterised; no string-built SQL": the lint half (eslint.config.js of this package). */

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const eslint = new ESLint({ cwd: pkgDir });

async function lintAs(file: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: join(pkgDir, file) });
  return (result?.messages ?? []).filter((m) => m.severity === 2).map((m) => m.ruleId ?? m.message);
}

const head = "import { sql } from 'drizzle-orm';\nimport type { TenantTx } from './tenant';\n";

// ESLint with the TypeScript parser takes seconds per run under a parallel turbo build.
describe('all queries parameterised; no string-built SQL (lint)', { timeout: 60_000 }, () => {
  it('rejects string-built SQL in runtime code', async () => {
    const bad = [
      // a template literal or concatenation handed to execute
      "export const f = (tx: TenantTx, id: string) => tx.execute(`select * from scenario where id = '${id}'`);\n",
      "export const f = (tx: TenantTx, id: string) => tx.execute('select * from scenario where id = ' + id);\n",
      'export const f = (tx: TenantTx, q: string) => tx.execute(q);\n',
      // sql.raw with anything but a literal, also inside a sql`` template
      'export const f = (tx: TenantTx, id: string) => tx.execute(sql`select * from scenario where id = ${sql.raw(id)}`);\n',
      'export const f = (col: string) => sql.raw(`order by ${col}`);\n',
      "export const f = (col: string) => sql.raw('order by ' + col);\n",
      // node-postgres directly: drizzle only
      "export const f = (c: { query(t: string): unknown }) => c.query('select 1');\n",
      'export const f = (c: { query(t: string): unknown }, id: string) => c.query(`select ${id}`);\n',
    ];
    for (const code of bad) {
      expect(await lintAs('src/repos/probe.ts', head + code), code).toContain('no-restricted-syntax');
    }
  });

  it('accepts bound values (sql tag, query builder, literal sql.raw); tests and testing/ helpers are exempt', async () => {
    const good = [
      'export const f = (tx: TenantTx, id: string) => tx.execute(sql`select * from scenario where id = ${id}::uuid`);\n',
      "export const f = (tx: TenantTx) => tx.execute(sql`select ${sql.raw('id, key')} from scenario`);\n",
      'export const f = (q: { execute(): unknown }) => q.execute();\n',
    ];
    for (const code of good) expect(await lintAs('src/repos/probe.ts', head + code), code).not.toContain('no-restricted-syntax');
    const helper = "export const f = (c: { query(t: string): unknown }, r: string) => c.query(`CREATE ROLE ${r}`);\n";
    expect(await lintAs('src/testing/probe.ts', helper)).toEqual([]);
    expect(await lintAs('src/repos/probe.test.ts', helper)).toEqual([]);
  });

  it('keeps the root rules (airline names) alongside', async () => {
    const airline = ['Amer', 'ican'].join(''); // assembled so this file does not trip the rule itself
    expect(await lintAs('src/repos/probe.ts', `export const carrier = '${airline}';\n`)).toContain('no-restricted-syntax');
  });

  it('src lints clean under the rule', async () => {
    const results = await eslint.lintFiles(['src']);
    const errors = results.flatMap((r) =>
      r.messages.filter((m) => m.severity === 2).map((m) => `${r.filePath}:${m.line} ${m.ruleId}`),
    );
    expect(errors).toEqual([]);
    // the repositories are among the linted files
    expect(results.map((r) => r.filePath)).toEqual(expect.arrayContaining([join(pkgDir, 'src/repos/inputs.ts')]));
  });
});
