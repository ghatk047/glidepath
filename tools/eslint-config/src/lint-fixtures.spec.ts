import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { createConfig, dependencyMatrix } from './index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

type Msg = { ruleId: string | null; message: string };

async function lint(
  relPath: string,
  code: string,
  options?: Parameters<typeof createConfig>[0],
): Promise<Msg[]> {
  const eslint = new ESLint({
    cwd: root,
    overrideConfigFile: true,
    overrideConfig: createConfig(options),
  });
  const [res] = await eslint.lintText(code, { filePath: path.join(root, relPath) });
  return res?.messages ?? [];
}
const ids = (m: Msg[]) => m.map((x) => x.ruleId);
const boundaryErrors = (m: Msg[]) => m.filter((x) => x.ruleId === 'boundaries/dependencies');

/** Virtual source file and a real module entry point of each element, for relative imports. */
const dirs: Record<string, string> = {
  'tier1-ui': 'tier1-presentation/ui',
  'tier1-web': 'tier1-presentation/web',
  contract: 'contract/api-contract',
  server: 'tier2-logic/server',
  worker: 'tier2-logic/worker',
  spec: 'tier2-logic/spec',
  engine: 'tier2-logic/engine',
  solvers: 'tier2-logic/solvers',
  domain: 'tier2-logic/domain',
  excel: 'tier2-logic/excel',
  ai: 'tier2-logic/ai',
  'data-access': 'tier2-logic/data-access',
};
const fileOf = (pkg: string) => `${dirs[pkg]}/src/x.ts`;

const importOf = (from: string, to: string) => {
  const rel = path
    .relative(
      path.dirname(path.join(root, fileOf(from))),
      path.join(root, `${dirs[to]}/src/index.ts`),
    )
    .replace(/\.ts$/, '.js');
  return `import { v } from '${rel.startsWith('.') ? rel : './' + rel}';\nexport const a = v;\n`;
};

describe('02 §1 dependency arrows', () => {
  for (const [from, allowed] of Object.entries(dependencyMatrix)) {
    for (const to of Object.keys(dependencyMatrix).filter((t) => t !== from)) {
      const ok = allowed.includes(to);
      it(`${from} ${ok ? 'may' : 'cannot'} import ${to}`, async () => {
        const msgs = await lint(fileOf(from), importOf(from, to));
        expect(boundaryErrors(msgs)).toHaveLength(ok ? 0 : 1);
      });
    }
  }

  it('tier1 cannot import tier2-logic/engine', async () => {
    const msgs = await lint(fileOf('tier1-web'), importOf('tier1-web', 'engine'));
    expect(boundaryErrors(msgs)).toHaveLength(1);
  });
  it('tier1 can import contract and ui', async () => {
    for (const to of ['contract', 'tier1-ui']) {
      expect(
        boundaryErrors(await lint(fileOf('tier1-web'), importOf('tier1-web', to))),
      ).toHaveLength(0);
    }
  });
  it('no tier 2 package may import tier 3 code', async () => {
    const msgs = await lint(
      fileOf('data-access'),
      "import { v } from '../../../tier3-data/migrations/0001_schema.sql';\nexport const a = v;\n",
    );
    expect(boundaryErrors(msgs)).toHaveLength(1);
  });
});

describe('database drivers', () => {
  it('data-access may import pg and drizzle', async () => {
    const msgs = await lint(
      fileOf('data-access'),
      "import pg from 'pg';\nimport { sql } from 'drizzle-orm';\nexport const a = [pg, sql];\n",
    );
    expect(ids(msgs)).not.toContain('no-restricted-imports');
  });
  it('a fixture importing pg from tier2-logic/domain fails', async () => {
    const msgs = await lint(fileOf('domain'), "import pg from 'pg';\nexport const a = pg;\n");
    expect(ids(msgs)).toContain('no-restricted-imports');
  });
  it('drizzle-orm from tier2-logic/server fails', async () => {
    const msgs = await lint(
      fileOf('server'),
      "import { sql } from 'drizzle-orm/pg-core';\nexport const a = sql;\n",
    );
    expect(ids(msgs)).toContain('no-restricted-imports');
  });
});

describe('database drivers: exact package names only (G13)', () => {
  const restricted = (m: Msg[]) => m.filter((x) => x.ruleId === 'no-restricted-imports');
  const from = (pkg: string, spec: string, file = fileOf(pkg)) =>
    lint(file, `import * as v from '${spec}';\nexport const a = v;\n`);

  it('rejects the npm packages from server and domain', async () => {
    for (const spec of [
      'pg',
      'pg/lib/client',
      'pg-pool',
      'pg-types',
      'drizzle-orm',
      'drizzle-orm/pg-core',
      'drizzle-kit',
    ]) {
      expect(restricted(await from('server', spec)), spec).toHaveLength(1);
      expect(restricted(await from('domain', spec)), spec).toHaveLength(1);
    }
  });
  it('allows relative paths that merely end in pg', async () => {
    for (const spec of ['./testing/pg', '../testing/pg', './pg', './pg-helpers']) {
      expect(restricted(await from('server', spec)), spec).toHaveLength(0);
    }
  });
  it('allows other workspace packages with pg in the name (not pg-local outside tests)', async () => {
    expect(restricted(await from('server', '@glidepath/pg-tools'))).toHaveLength(0);
    expect(restricted(await from('server', 'pgp'))).toHaveLength(0);
  });
  it('@glidepath/pg-local is allowed in tier-2 tests and testing/ helpers', async () => {
    for (const file of [
      'tier2-logic/server/src/app/x.test.ts',
      'tier2-logic/server/src/app/x.pg.test.ts',
      'tier2-logic/server/src/x.spec.ts',
      'tier2-logic/server/src/app/testing/pg.ts',
      'tier2-logic/engine/src/testing/pg.ts',
    ]) {
      expect(restricted(await from('server', '@glidepath/pg-local', file)), file).toHaveLength(0);
    }
  });
  it('@glidepath/pg-local is rejected in production source', async () => {
    expect(restricted(await from('server', '@glidepath/pg-local'))).toHaveLength(1);
  });
  it('pg and drizzle are still rejected in tier-2 tests and testing/ helpers', async () => {
    for (const file of [
      'tier2-logic/server/src/app/x.test.ts',
      'tier2-logic/server/src/app/testing/pg.ts',
    ]) {
      expect(restricted(await from('server', 'pg', file)), file).toHaveLength(1);
      expect(restricted(await from('server', 'drizzle-orm', file)), file).toHaveLength(1);
    }
  });
  it('data-access may import pg-local and every driver', async () => {
    for (const spec of ['pg', 'pg-pool', '@glidepath/pg-local', 'drizzle-orm/pg-core']) {
      expect(restricted(await from('data-access', spec)), spec).toHaveLength(0);
    }
  });
});

describe('magic numbers', () => {
  const code = 'export const a = (x: number) => x * 42;\nexport const b = [0, 1, -1];\n';
  for (const pkg of ['engine', 'solvers', 'domain', 'excel']) {
    it(`on for tier2-logic/${pkg} source`, async () => {
      const msgs = await lint(fileOf(pkg), code);
      expect(msgs.filter((m) => m.ruleId === 'no-magic-numbers')).toHaveLength(1);
    });
  }
  it('off for tests', async () => {
    const msgs = await lint('tier2-logic/engine/src/x.test.ts', code);
    expect(ids(msgs)).not.toContain('no-magic-numbers');
  });
  it('off outside the pure core', async () => {
    expect(ids(await lint(fileOf('server'), code))).not.toContain('no-magic-numbers');
  });
  it('allow-list is configurable', async () => {
    const msgs = await lint(fileOf('engine'), code, { magicNumberAllow: [0, 1, -1, 42] });
    expect(ids(msgs)).not.toContain('no-magic-numbers');
  });
});

describe('airline strings', () => {
  for (const word of ['AA', 'American', 'Sabre', 'DXC', 'Hyderabad']) {
    it(`'${word}' fails in source`, async () => {
      const msgs = await lint(fileOf('server'), `export const a = '${word}';\n`);
      expect(ids(msgs)).toContain('no-restricted-syntax');
    });
  }
  it('passes in seed folders, fixtures and docs', async () => {
    for (const f of ['tier3-data/seed/x.ts', 'tier2-logic/spec/src/fixtures/x.ts', 'docs/x.ts']) {
      expect(ids(await lint(f, "export const a = 'Sabre';\n"))).not.toContain(
        'no-restricted-syntax',
      );
    }
  });
  it('passes in tools/testkit (test infrastructure naming the AA seed)', async () => {
    const msgs = await lint(
      'tools/testkit/src/x.ts',
      "export const a = 'AA';\nexport const b = 'Sabre';\n",
    );
    expect(ids(msgs)).not.toContain('no-restricted-syntax');
  });
  it('does not flag words that merely contain the letters', async () => {
    const msgs = await lint(fileOf('server'), "export const a = 'AAA';\n");
    expect(ids(msgs)).not.toContain('no-restricted-syntax');
  });
});

describe('tier-1 tokens only', () => {
  it('hex colours fail outside ui/src/tokens', async () => {
    const msgs = await lint(fileOf('tier1-web'), "export const a = '#ff00aa';\n");
    expect(ids(msgs)).toContain('no-restricted-syntax');
  });
  it('raw px literals fail outside ui/src/tokens', async () => {
    const msgs = await lint(fileOf('tier1-ui'), "export const a = '12px';\n");
    expect(ids(msgs)).toContain('no-restricted-syntax');
  });
  it('hex and px pass inside ui/src/tokens', async () => {
    const msgs = await lint(
      'tier1-presentation/ui/src/tokens/x.ts',
      "export const a = ['#ff00aa', '12px'];\n",
    );
    expect(ids(msgs)).not.toContain('no-restricted-syntax');
  });
  it('toFixed and Intl fail outside the format module, pass inside it', async () => {
    const code = 'export const a = (1.5).toFixed(2);\nexport const b = Intl;\n';
    expect(ids(await lint(fileOf('tier1-web'), code))).toContain('no-restricted-syntax');
    expect(ids(await lint('tier1-presentation/ui/src/format/x.ts', code))).not.toContain(
      'no-restricted-syntax',
    );
  });
});
