import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { pythonDefs, section, tableRows, unquote } from './porting-doc';

const here = dirname(fileURLToPath(import.meta.url));
const enginePy = readFileSync(resolve(here, '../../../docs/spec/reference/engine.py'), 'utf8');
const porting = readFileSync(resolve(here, '../PORTING.md'), 'utf8');

/** The defs the ENG-01 acceptance line names explicitly. */
const ACCEPTANCE_DEFS = [
  'tokenize',
  'Parser.__init__',
  'Parser.peek',
  'Parser.nxt',
  'Parser.expect',
  'Parser.parse',
  'Parser.expr',
  'Parser.nud',
  'parse',
  'Model.key',
  'Model.combos',
  'Model.pick_expr',
  'Model._idx',
  'Model.resolve',
  'Model.where_ok',
  'Model.deps',
  'Model.ev',
  'Model._expand',
  'Model.input_cells',
  'Model.run',
  'Model.rerun',
];

interface MapRow {
  py: string;
  line: number;
  module: string;
  fn: string;
  item: string;
}

function mapRows(): MapRow[] {
  const body = section(porting, /^## \d+\. Port map/);
  return tableRows(body).map((c) => ({
    py: unquote(c[0] ?? ''),
    line: Number(c[1]),
    module: unquote(c[2] ?? ''),
    fn: c[3] ?? '',
    item: c[4] ?? '',
  }));
}

describe('PORTING.md port map (porting-map.spec.ts)', () => {
  const defs = pythonDefs(enginePy);
  const rows = mapRows();

  it('lists engine.py defs, including every def the acceptance names', () => {
    const names = defs.map((d) => d.name);
    for (const d of ACCEPTANCE_DEFS) expect(names, d).toContain(d);
    expect(names).toContain('Parser');
    expect(names).toContain('Model');
    expect(names).toContain('Model.input_cells.put');
    expect(names).toContain('Parser.BP');
    expect(defs.length).toBeGreaterThanOrEqual(29);
  });

  it('maps every def/class in engine.py to a TS module + function, at the right line', () => {
    expect(rows.length).toBeGreaterThan(0);
    for (const d of defs) {
      const hits = rows.filter((r) => r.py === d.name);
      expect(hits, `${d.name} must appear exactly once in the port map`).toHaveLength(1);
      const r = hits[0]!;
      expect(r.line, `${d.name} line (engine.py changed? re-review the port)`).toBe(d.line);
      expect(r.module, `${d.name} TS module`).toMatch(/^src\/[\w/.-]+\.ts$/);
      expect(r.fn, `${d.name} TS function`).toMatch(/^`[^`]+`/);
      expect(r.item, `${d.name} item`).toMatch(/^ENG-\d\d$/);
    }
  });

  it('names nothing that is not in engine.py', () => {
    const names = new Set(defs.map((d) => d.name));
    for (const r of rows) expect(names.has(r.py), `stale row ${r.py}`).toBe(true);
  });
});
