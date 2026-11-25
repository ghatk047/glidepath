/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  loadModelBundle,
  membersHash,
  sha256Hex,
  SpecValidationError,
  type ModelBundleJson,
  type TenantMembers,
} from './index';
import { loadModelBundleFromDir } from './node';

const here = dirname(fileURLToPath(import.meta.url));
const specDir = resolve(here, '../../../docs/spec');
const readJson = (f: string): unknown => JSON.parse(readFileSync(join(specDir, f), 'utf8'));
const freshJson = (): { variables: any; formulaGraph: any } => ({
  variables: readJson('variables.json') as any,
  formulaGraph: readJson('formula_graph.json') as any,
});

function issuesOf(json: ModelBundleJson) {
  try {
    loadModelBundle(json);
  } catch (e) {
    expect(e).toBeInstanceOf(SpecValidationError);
    return (e as SpecValidationError).issues;
  }
  throw new Error('expected loadModelBundle to throw');
}

describe('loadModelBundle', () => {
  it('loads docs/spec with 194 variables, 307 nodes', async () => {
    const bundle = await loadModelBundleFromDir(specDir);
    expect(bundle.variables).toHaveLength(194);
    expect(bundle.nodes).toHaveLength(307);
    expect(bundle.dimensions.map((d) => d.id)).toContain('lever');
    expect(bundle.modelId).toBe('it_savings_unified');
    expect(bundle.nodes.filter((n) => n.cases)).toHaveLength(28);
    expect(bundle.nodes.filter((n) => n.members)).toHaveLength(7);
    // Same result through the pure core.
    expect(loadModelBundle(freshJson())).toEqual(bundle);
  });

  it('rejects an unknown dimension with a JSON-path error', () => {
    const j = freshJson();
    j.formulaGraph.nodes[3].dims = ['nope'];
    const issues = issuesOf(j);
    expect(issues[0]).toEqual({ path: '$.formulaGraph.nodes[3].dims[0]', message: "unknown dimension 'nope'" });

    const k = freshJson();
    k.variables.variables[5].dims = ['pool', 'ghost'];
    expect(issuesOf(k)[0]!.path).toBe('$.variables.variables[5].dims[1]');
  });

  it('rejects a duplicate id with a JSON-path error', () => {
    const j = freshJson();
    j.formulaGraph.nodes[10].id = j.formulaGraph.nodes[2].id;
    expect(issuesOf(j)[0]!.path).toBe('$.formulaGraph.nodes[10].id');

    const k = freshJson();
    k.variables.variables[7].id = k.variables.variables[1].id;
    const issue = issuesOf(k).find((i) => i.message.startsWith('duplicate variable id'));
    expect(issue!.path).toBe('$.variables.variables[7].id');
  });

  it('rejects a node with neither expr nor cases with a JSON-path error', () => {
    const j = freshJson();
    delete j.formulaGraph.nodes[4].expr;
    const issues = issuesOf(j);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.path).toBe('$.formulaGraph.nodes[4]');
    expect(issues[0]!.message).toContain('neither expr nor cases');
  });

  it('rejects structurally invalid input with a JSON-path error', () => {
    const j = freshJson();
    j.formulaGraph.nodes[1].dims = 'line';
    expect(issuesOf(j)[0]!.path).toBe('$.formulaGraph.nodes[1].dims');
  });

  it('rejects a case or members subset on a dim the node lacks', () => {
    const j = freshJson();
    const idx = j.formulaGraph.nodes.findIndex((n: any) => n.members);
    j.formulaGraph.nodes[idx].members = { lever: ['L01'] };
    expect(issuesOf(j)[0]!.path).toBe(`$.formulaGraph.nodes[${idx}].members.lever`);
  });
});

const sample = (): TenantMembers => ({
  vp: [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B' },
  ],
  line: [{ id: 'l1', pool: 'p', qty: 3, lever_ids: ['L01', 'L02'], notes: null }],
});

describe('membersHash', () => {
  it('is SHA-256 hex, order-independent, and changes with any attr change', () => {
    const base = membersHash(sample());
    expect(base).toMatch(/^[0-9a-f]{64}$/);

    // Order of dims, members and attributes does not matter.
    const shuffled: TenantMembers = {
      line: [{ notes: null, lever_ids: ['L01', 'L02'], qty: 3, pool: 'p', id: 'l1' }],
      vp: [
        { label: 'B', id: 'b' },
        { label: 'A', id: 'a' },
      ],
    };
    expect(membersHash(shuffled)).toBe(base);
    expect(membersHash(sample())).toBe(base);

    // Any change differs.
    const changed = (f: (m: any) => void): string => {
      const m = JSON.parse(JSON.stringify(sample()));
      f(m);
      return membersHash(m);
    };
    const variants = [
      changed((m) => (m.vp[0].label = 'A2')),
      changed((m) => (m.line[0].qty = 4)),
      changed((m) => (m.line[0].pool = 'q')),
      changed((m) => (m.line[0].lever_ids = ['L02', 'L01'])),
      changed((m) => (m.line[0].notes = 'x')),
      changed((m) => (m.line[0].extra = 1)),
      changed((m) => delete m.line[0].notes),
      changed((m) => (m.vp[1].id = 'c')),
      changed((m) => m.vp.push({ id: 'z' })),
      changed((m) => (m.lgroup = [])),
    ];
    for (const v of variants) expect(v).not.toBe(base);
    expect(new Set(variants).size).toBe(variants.length);
  });

  it('hashes the AA seed members deterministically', () => {
    const seed = readJson('seed/aa/dimension_members.json') as TenantMembers;
    const reversed = Object.fromEntries(
      Object.entries(seed)
        .reverse()
        .map(([k, v]) => [k, [...v].reverse()]),
    );
    expect(membersHash(reversed)).toBe(membersHash(seed));
  });

  it('rejects duplicate member ids', () => {
    expect(() => membersHash({ vp: [{ id: 'a' }, { id: 'a' }] })).toThrow(/duplicate member/);
  });

  it('sha256Hex matches node:crypto', () => {
    for (const s of ['', 'abc', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'héllo ✓'.repeat(50)]) {
      expect(sha256Hex(s)).toBe(createHash('sha256').update(s).digest('hex'));
    }
  });
});

describe('purity', () => {
  it('core imports no fs (or any node: builtin)', () => {
    const coreDir = join(here, 'core');
    const files = [...readdirSync(coreDir).map((f) => join(coreDir, f)), join(here, 'index.ts')];
    expect(files.length).toBeGreaterThan(3);
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      const specifiers = [...src.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]!);
      for (const s of specifiers) {
        expect(s, `${f} imports ${s}`).not.toMatch(/^(node:|fs$|fs\/|path$|crypto$|child_process$|os$)/);
        expect(s, `${f} imports ${s}`).not.toMatch(/(^|\/)node(\/|$)/);
      }
    }
  });
});
