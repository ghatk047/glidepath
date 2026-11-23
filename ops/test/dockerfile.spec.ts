// OPS-02: the glidepath/logic image (ops/docker/logic).
// Static checks on the Dockerfile, hadolint when available, the bake targets, the
// Dockerfile-specific .dockerignore and the entrypoint files the image runs.
// None of these tests need a running Docker daemon (bake --print and hadolint are used
// when the CLI / image is present, and the same facts are checked from the files otherwise).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../src/index';

const DIR = join(REPO_ROOT, 'ops/docker/logic');
const read = (f: string) => readFileSync(join(DIR, f), 'utf8');
const dockerfile = read('Dockerfile');

/** Instructions with `\` continuations joined and comments dropped. */
function instructions(text: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!cur && (line === '' || line.startsWith('#'))) continue;
    if (cur && line.startsWith('#')) continue;
    cur += (cur ? ' ' : '') + line.replace(/\\$/, '').trim();
    if (!line.endsWith('\\')) {
      out.push(cur);
      cur = '';
    }
  }
  return out;
}
const ins = instructions(dockerfile);
const argDefault = (name: string) =>
  ins.map((i) => new RegExp(`^ARG ${name}=(\\S+)$`).exec(i)?.[1]).find((v) => v !== undefined);

function run(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', cwd: opts.cwd ?? REPO_ROOT, env: opts.env ?? process.env });
}
const have = (cmd: string, args: string[]) => run(cmd, args).status === 0;

describe('Dockerfile', () => {
  const froms = ins.filter((i) => i.startsWith('FROM '));

  it('is a multi-stage build with a build and a runtime stage', () => {
    expect(froms.length).toBeGreaterThanOrEqual(2);
    expect(froms.at(-1)).toMatch(/ AS runtime$/);
    expect(froms.some((f) => / AS build$/.test(f))).toBe(true);
  });

  it('pins a node:22 slim image by digest', () => {
    const image = argDefault('NODE_IMAGE');
    expect(image).toMatch(/^node:22(\.\d+)*-[a-z]+-slim@sha256:[0-9a-f]{64}$/);
    for (const f of froms) expect(f).toMatch(/^FROM \$\{NODE_IMAGE\} AS /);
  });

  it('installs the pnpm version of the root package.json', () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as { packageManager: string };
    expect(`pnpm@${argDefault('PNPM_VERSION')}`).toBe(pkg.packageManager);
  });

  it('installs from the lockfile and pnpm-deploys server and worker (production deps only)', () => {
    const all = ins.join('\n');
    expect(all).toContain('pnpm install --frozen-lockfile');
    expect(all).toMatch(/pnpm --filter "@glidepath\/server" --prod [^&]*deploy \/deploy\/server/);
    expect(all).toMatch(/pnpm --filter "@glidepath\/worker" --prod [^&]*deploy \/deploy\/worker/);
    // The deploy must read the lockfile (no --legacy, which resolves from the registry again).
    expect(all).not.toContain('--legacy');
  });

  it('runs as a non-root user in the final stage', () => {
    const lastFrom = ins.lastIndexOf(froms.at(-1)!);
    const users = ins.slice(lastFrom).filter((i) => i.startsWith('USER '));
    expect(users.length).toBeGreaterThan(0);
    const user = users.at(-1)!.slice('USER '.length).trim();
    expect(user).not.toMatch(/^(root|0)(:|$)/);
    expect(ins.at(-1)).toMatch(/^CMD \["node", "dist\/server\.js"\]$/);
  });

  it('takes no secret build args and bakes in no environment setting', () => {
    const sensitive = /SECRET|PASSWORD|PASSWD|TOKEN|API_?KEY|ACCESS_?KEY|CREDENTIAL|DATABASE_URL|AUTH_/i;
    for (const i of ins.filter((x) => /^(ARG|ENV) /.test(x))) expect(i, i).not.toMatch(sensitive);
    expect(ins.filter((i) => i.startsWith('ENV ')).join(' ')).not.toMatch(/URL|SMTP|S3_/);
    expect(dockerfile).not.toMatch(/COPY[^\n]*\.env/);
  });

  // FIX-04: the read routes load the spec bundle from SPEC_DIR; the image has no docs/ tree.
  describe('spec bundle for the read routes (SPEC_DIR)', () => {
    // The files loadModelBundleFromDir reads, taken from its source so the two cannot drift.
    const loaderSource = readFileSync(join(REPO_ROOT, 'tier2-logic/spec/src/node/index.ts'), 'utf8');
    const loaderFiles = [...loaderSource.matchAll(/read\('([\w.]+\.json)'\)/g)].map((m) => m[1]!);
    // XL-08: the worker's Excel jobs also read the template from SPEC_DIR.
    const excelDeps = readFileSync(join(REPO_ROOT, 'tier2-logic/worker/src/jobs/excel/deps.ts'), 'utf8');
    const excelFiles = [...excelDeps.matchAll(/join\(specDir\(\), '([\w.]+\.json)'\)/g)].map((m) => m[1]!);
    const specFiles = [...new Set([...loaderFiles, ...excelFiles])];
    const runtimeInstructions = ins.slice(ins.lastIndexOf(ins.filter((i) => i.startsWith('FROM ')).at(-1)!));

    it('the loader reads exactly variables.json and formula_graph.json; the Excel jobs add excel_template.json', () => {
      expect(loaderFiles.sort()).toEqual(['formula_graph.json', 'variables.json']);
      expect(excelFiles).toEqual(['excel_template.json']);
      for (const f of specFiles) expect(existsSync(join(REPO_ROOT, 'docs/spec', f)), f).toBe(true);
    });

    it('the build stage copies those files, and only those, from docs/spec to /out/spec, read-only', () => {
      const build = ins.slice(0, ins.lastIndexOf(ins.filter((i) => i.startsWith('FROM ')).at(-1)!)).join('\n');
      const cp = /cp (docs\/spec\/\S+(?: docs\/spec\/\S+)*) \/out\/spec\//.exec(build);
      expect(cp, 'cp docs/spec/... /out/spec/').not.toBeNull();
      expect(cp![1]!.split(' ').sort()).toEqual(specFiles.map((f) => `docs/spec/${f}`).sort());
      expect(build).toMatch(/chmod 0?444 \/out\/spec\//);
      expect(build).not.toMatch(/cp -R docs|COPY[^\n]*docs/);
    });

    it('the runtime stage holds them at /app/spec and sets SPEC_DIR to that fixed path', () => {
      expect(runtimeInstructions).toContain('COPY --from=build /out/spec /app/spec');
      expect(runtimeInstructions).toContain('ENV SPEC_DIR=/app/spec');
      const user = runtimeInstructions.findIndex((i) => i.startsWith('USER '));
      expect(runtimeInstructions.indexOf('ENV SPEC_DIR=/app/spec')).toBeLessThan(user); // set before the CMD, as an image default
    });

    it('the Dockerfile ignore file lets exactly those files of docs/ into the build context', () => {
      const lines = read('Dockerfile.dockerignore')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'));
      const at = lines.indexOf('docs');
      expect(at).toBeGreaterThanOrEqual(0);
      // exceptions come after the exclusion they punch through (last match wins in a .dockerignore)
      const exceptions = lines.slice(at + 1).filter((l) => l.startsWith('!'));
      expect(exceptions.sort()).toEqual(specFiles.map((f) => `!docs/spec/${f}`).sort());
    });
  });

  it('is what docker-compose.yml builds', () => {
    const compose = readFileSync(join(REPO_ROOT, 'docker-compose.yml'), 'utf8');
    expect(compose).toMatch(/context: \.\n\s+dockerfile: ops\/docker\/logic\/Dockerfile/);
  });

  const hadolint = have('hadolint', ['--version'])
    ? (['hadolint'] as const)
    : have('docker', ['image', 'inspect', 'hadolint/hadolint:v2.12.0'])
      ? (['docker', 'run', '--rm', '-v', `${DIR}:/w`, '-w', '/w', 'hadolint/hadolint:v2.12.0', 'hadolint'] as const)
      : undefined;
  it.skipIf(!hadolint)('passes hadolint', () => {
    const [cmd, ...pre] = hadolint!;
    const args = hadolint![0] === 'hadolint' ? ['--config', join(DIR, '.hadolint.yaml'), join(DIR, 'Dockerfile')] : ['--config', '.hadolint.yaml', 'Dockerfile'];
    const r = run(cmd, [...pre, ...args]);
    expect(r.stdout + r.stderr).toBe('');
    expect(r.status).toBe(0);
  });
});

describe('docker-bake.hcl', () => {
  const bakeFile = 'ops/docker/logic/docker-bake.hcl';
  const buildx = have('docker', ['buildx', 'version']);

  it.skipIf(!buildx)('`docker buildx bake --print logic` lists linux/arm64 and linux/amd64', () => {
    const r = run('docker', ['buildx', 'bake', '-f', bakeFile, '--print', 'logic']);
    expect(r.status, r.stderr).toBe(0);
    const plan = JSON.parse(r.stdout) as {
      target: { logic: { platforms: string[]; dockerfile: string; context: string; tags: string[] } };
    };
    expect(plan.target.logic.platforms).toEqual(['linux/arm64', 'linux/amd64']);
    expect(plan.target.logic.dockerfile).toBe('ops/docker/logic/Dockerfile');
    expect(plan.target.logic.context).toBe('.');
    expect(plan.target.logic.tags).toEqual(['glidepath/logic:dev']);
  });

  it('declares the same platforms and entry defaults as the file says (no daemon)', () => {
    const hcl = read('docker-bake.hcl');
    expect(hcl).toMatch(/platforms\s*=\s*\["linux\/arm64", "linux\/amd64"\]/);
    for (const name of ['SERVER_ENTRY', 'WORKER_ENTRY', 'MIGRATE_ENTRY', 'STRICT_ENTRYPOINTS']) {
      const m = new RegExp(`variable "${name}" \\{\\s*default = "([^"]*)"`).exec(hcl);
      expect(m?.[1], name).toBe(argDefault(name));
    }
  });
});

describe('Dockerfile.dockerignore', () => {
  const lines = read('Dockerfile.dockerignore')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));

  it('excludes .env files, docs and tests', () => {
    for (const p of ['.env', '.env.*', 'docs', 'e2e', '**/*.test.ts', '**/*.spec.ts', '**/node_modules', '.git'])
      expect(lines, p).toContain(p);
  });

  it('does not exclude what the build copies or runs', () => {
    const needed = [
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'tier2-logic',
      'tier3-data',
      'tier3-data/migrations',
      'contract',
      'tools',
      'ops',
      'ops/docker/logic/collect-dist.sh',
      'ops/docker/logic/merge-node-modules.sh',
    ];
    const hits = (pattern: string, path: string) =>
      !/[*?[]/.test(pattern) && (path === pattern || path.startsWith(`${pattern}/`));
    for (const path of needed) for (const l of lines) expect(hits(l, path), `${l} hides ${path}`).toBe(false);
  });

  it('is the file the Dockerfile builds with (BuildKit picks <Dockerfile>.dockerignore first)', () => {
    expect(existsSync(join(DIR, 'Dockerfile.dockerignore'))).toBe(true);
  });
});

describe('entrypoints: dist/server.js, dist/worker.js, dist/migrate.js', () => {
  const entries = {
    server: argDefault('SERVER_ENTRY')!,
    worker: argDefault('WORKER_ENTRY')!,
    migrate: argDefault('MIGRATE_ENTRY')!,
  };

  it('are packages build outputs named dist/<name>.js in an existing tier-2 package', () => {
    for (const [name, rel] of Object.entries(entries)) {
      expect(rel, name).toMatch(new RegExp(`^tier2-logic/[a-z-]+/dist/${name}\\.js$`));
      expect(existsSync(join(REPO_ROOT, dirname(dirname(rel)), 'package.json')), rel).toBe(true);
    }
  });

  it('are the commands docker-compose.yml runs', () => {
    const compose = readFileSync(join(REPO_ROOT, 'docker-compose.yml'), 'utf8');
    // migrate runs through a shell that adds --parity / --ai-cache when the image has them (OPS-06).
    expect(compose).toContain('exec node dist/migrate.js "$$@"');
    expect(compose).toMatch(/- --seed\s*\n\s*- aa\b/);
    expect(compose).toContain('command: ["node", "dist/server.js"]');
    expect(compose).toContain('command: ["node", "dist/worker.js"]');
  });

  /** An entry is "built" once its package's build script writes dist/<name>.js. */
  const built = (name: string, rel: string): boolean => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, dirname(dirname(rel)), 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    return (pkg.scripts?.build ?? '').includes(`dist/${name}.js`);
  };

  it.each(Object.entries(entries))(
    'dist/%s.js is produced by its package build or stubbed by collect-dist.sh (until API-01/JOB-01/DATA-08)',
    (name, rel) => {
      if (built(name, rel)) return; // real build output; nothing stubbed
      const dir = mkdtempSync(join(tmpdir(), 'glidepath-collect-'));
      const out = join(dir, 'dist');
      const env = { ...process.env, SERVER_ENTRY: entries.server, WORKER_ENTRY: entries.worker, MIGRATE_ENTRY: entries.migrate };
      const sh = join(DIR, 'collect-dist.sh');
      const strict = run('sh', [sh, dir, out], { env: { ...env, STRICT_ENTRYPOINTS: '1' } });
      expect(strict.status, 'strict mode fails the build').not.toBe(0);
      expect(strict.stderr).toContain('STRICT_ENTRYPOINTS=1');
      const lax = run('sh', [sh, dir, out], { env: { ...env, STRICT_ENTRYPOINTS: '0' } });
      expect(lax.status, lax.stderr).toBe(0);
      const stub = run('node', [join(out, `${name}.js`)]);
      expect(stub.status).toBe(78);
      expect(stub.stderr).toContain('stub');
    },
  );
});

describe('collect-dist.sh and merge-node-modules.sh', () => {
  const sh = (name: string) => join(DIR, name);
  const write = (path: string, text: string) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  };

  it('collects built entries (and their sibling chunks) under the fixed names', () => {
    const root = mkdtempSync(join(tmpdir(), 'glidepath-collect-'));
    write(join(root, 'a/dist/main.js'), "console.log('server')");
    write(join(root, 'a/dist/chunk-1.js'), '// chunk');
    write(join(root, 'b/dist/worker.js'), "console.log('worker')");
    write(join(root, 'b/dist/migrate.js'), "console.log('migrate')");
    const out = join(root, 'out');
    const r = run('sh', [sh('collect-dist.sh'), root, out], {
      env: { ...process.env, SERVER_ENTRY: 'a/dist/main.js', WORKER_ENTRY: 'b/dist/worker.js', MIGRATE_ENTRY: 'b/dist/migrate.js', STRICT_ENTRYPOINTS: '1' },
    });
    expect(r.status, r.stderr).toBe(0);
    expect(run('node', [join(out, 'server.js')]).stdout.trim()).toBe('server');
    expect(run('node', [join(out, 'worker.js')]).stdout.trim()).toBe('worker');
    expect(run('node', [join(out, 'migrate.js')]).stdout.trim()).toBe('migrate');
    expect(existsSync(join(out, 'chunk-1.js'))).toBe(true);
  });

  it('merges deploy trees and fails on a version conflict', () => {
    const root = mkdtempSync(join(tmpdir(), 'glidepath-merge-'));
    const pkg = (nm: string, name: string, version: string) =>
      write(join(nm, name, 'package.json'), `{\n  "name": "${name}",\n  "version": "${version}"\n}\n`);
    pkg(join(root, 'one'), 'hono', '4.1.0');
    pkg(join(root, 'one'), '@scope/a', '1.0.0');
    pkg(join(root, 'two'), 'hono', '4.1.0');
    pkg(join(root, 'two'), 'pg-boss', '10.0.0');
    pkg(join(root, 'two'), '@scope/b', '2.0.0');
    const ok = run('sh', [sh('merge-node-modules.sh'), join(root, 'out'), join(root, 'one'), join(root, 'two')]);
    expect(ok.status, ok.stderr).toBe(0);
    for (const p of ['hono', 'pg-boss', '@scope/a', '@scope/b']) expect(existsSync(join(root, 'out', p, 'package.json')), p).toBe(true);
    pkg(join(root, 'three'), 'hono', '5.0.0');
    const bad = run('sh', [sh('merge-node-modules.sh'), join(root, 'out2'), join(root, 'one'), join(root, 'three')]);
    expect(bad.status).not.toBe(0);
    expect(bad.stderr).toContain('hono');
  });

  it('leaves @types out of the runtime tree, even when two deploys pin different versions', () => {
    const root = mkdtempSync(join(tmpdir(), 'glidepath-merge-types-'));
    const pkg = (nm: string, name: string, version: string) =>
      write(join(nm, name, 'package.json'), `{\n  "name": "${name}",\n  "version": "${version}"\n}\n`);
    pkg(join(root, 'one'), '@types/node', '22.20.5');
    pkg(join(root, 'one'), 'hono', '4.1.0');
    pkg(join(root, 'two'), '@types/node', '14.18.63');
    pkg(join(root, 'two'), 'exceljs', '4.4.0');
    const r = run('sh', [sh('merge-node-modules.sh'), join(root, 'out'), join(root, 'one'), join(root, 'two')]);
    expect(r.status, r.stderr).toBe(0);
    expect(existsSync(join(root, 'out', '@types'))).toBe(false);
    for (const p of ['hono', 'exceljs']) expect(existsSync(join(root, 'out', p, 'package.json')), p).toBe(true);
  });
});

describe('ops/docker/logic/README.md', () => {
  const readme = read('README.md');
  it('documents the runtime approach, the single-arch build and the multi-arch command', () => {
    expect(readme).toContain('docker build -f ops/docker/logic/Dockerfile -t glidepath/logic:dev .');
    expect(readme).toContain('docker buildx bake -f ops/docker/logic/docker-bake.hcl');
    expect(readme).toContain('linux/arm64');
    expect(readme).toContain('STRICT_ENTRYPOINTS');
    expect(readme).toMatch(/esbuild/);
  });
});
