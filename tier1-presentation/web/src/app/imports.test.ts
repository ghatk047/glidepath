import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const webSrc = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function* sourceFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === 'node_modules') continue;
    if (statSync(p).isDirectory()) yield* sourceFiles(p);
    else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) yield p;
  }
}

const specifiers = (text: string) =>
  [...text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]!);

// Runtime libraries the SPA may use (ADR-009).
const libraries = [
  'react',
  'react-dom',
  '@tanstack/react-router',
  'zustand',
  '@vitejs/plugin-react',
];

describe('tier boundary (G13) on web sources', () => {
  it('imports only contract and ui from the workspace, nothing from tier 2 or 3', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(webSrc)) {
      for (const spec of specifiers(readFileSync(file, 'utf8'))) {
        const allowed =
          (spec.startsWith('.') && !/(tier2-logic|tier3-data|contract\/)/.test(spec)) ||
          spec.startsWith('node:') ||
          spec === '@glidepath/api-contract' ||
          spec === '@glidepath/ui' ||
          spec.startsWith('@glidepath/ui/') ||
          libraries.some((l) => spec === l || spec.startsWith(`${l}/`));
        if (!allowed) offenders.push(`${file}: ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
