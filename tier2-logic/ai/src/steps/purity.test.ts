import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const pkgDir = resolve(here, '../..');
const eslint = new ESLint({ cwd: pkgDir });

async function lintAs(file: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: join(pkgDir, file) });
  return (result?.messages ?? []).filter((m) => m.severity === 2).map((m) => m.ruleId ?? m.message);
}

const restricted = expect.arrayContaining([
  expect.stringMatching(/^(@typescript-eslint\/)?no-restricted-(imports|globals|syntax)$/),
]);

// ESLint with the TypeScript parser takes seconds per run under a parallel turbo build.
describe('AC3 steps take the ModelClient as a port; no other IO (lint)', { timeout: 60_000 }, () => {
  it('the lint config rejects IO imports, IO globals and the concrete client in src/steps', async () => {
    const io = [
      "import { readFileSync } from 'node:fs';\nexport const f = readFileSync;\n",
      "import fs from 'fs';\nexport const f = fs;\n",
      "import { request } from 'node:https';\nexport const f = request;\n",
      "import { Pool } from 'pg';\nexport const f = Pool;\n",
      "import { loadModelBundleFromDir } from '@glidepath/spec/node';\nexport const f = loadModelBundleFromDir;\n",
      "import Anthropic from '@anthropic-ai/sdk';\nexport const f = new Anthropic();\n",
      "import { createClaudeModelClient } from '../client';\nexport const f = createClaudeModelClient;\n",
      "import { MemoryAuditSink } from '../audit';\nexport const f = MemoryAuditSink;\n",
      "import { loadAiConfig } from '../config';\nexport const f = loadAiConfig;\n",
      "import { harness } from '../testing/harness';\nexport const f = harness;\n",
      "export const f = () => fetch('https://example.invalid');\n",
      'export const f = () => process.env.ANTHROPIC_API_KEY;\n',
      "export const f = () => import('node:fs');\n",
    ];
    for (const code of io) expect(await lintAs('src/steps/probe.ts', code), code).toEqual(restricted);
  });

  it('the port, schemas, prompts and SDK types pass; tests may do IO', async () => {
    const ok = [
      "import type { ModelClient } from '../step';\nexport type F = ModelClient;\n",
      "import type { BetaWebSearchTool20260209 } from '@anthropic-ai/sdk/resources/beta/messages/messages';\nexport type F = BetaWebSearchTool20260209;\n",
      "import { FactBase } from '../schemas/facts';\nexport const f = FactBase;\n",
      "import { parseTenantSeed } from '@glidepath/spec';\nexport const f = parseTenantSeed;\n",
    ];
    for (const code of ok) expect(await lintAs('src/steps/probe.ts', code), code).toEqual([]);
    expect(
      await lintAs('src/steps/probe.test.ts', "import { readFileSync } from 'node:fs';\nexport const f = readFileSync;\n"),
    ).toEqual([]);
  });

  it('src/steps lints clean, and every step module is linted', async () => {
    const results = await eslint.lintFiles(['src/steps']);
    const errors = results.flatMap((r) =>
      r.messages.filter((m) => m.severity === 2).map((m) => `${r.filePath}:${m.line} ${m.ruleId}`),
    );
    expect(errors).toEqual([]);
    const linted = results.map((r) => r.filePath);
    const sources = readdirSync(here).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    expect(sources).toEqual(expect.arrayContaining(['scope.ts', 'research.ts', 'seed-draft.ts']));
    for (const f of sources) expect(linted).toContain(join(here, f));
  });
});
