/**
 * Readers for PORTING.md and engine.py used by the porting tests. Pure string functions (no IO), so the
 * package stays free of node builtins outside test files.
 */

/** A def, class or constant of engine.py: `tokenize`, `Parser`, `Parser.nud`, `Model.input_cells.put`, `TOK`, `Parser.BP`. */
export interface PyDef {
  readonly name: string;
  /** 1-based line of the `def`/`class`/assignment. */
  readonly line: number;
}

/** Every class, def (top level, method, nested) and upper-case constant of a Python module, in file order. */
export function pythonDefs(source: string): PyDef[] {
  const out: PyDef[] = [];
  let cls: string | null = null;
  let method: string | null = null;
  source.split('\n').forEach((text, i) => {
    const line = i + 1;
    let m: RegExpExecArray | null;
    if ((m = /^class (\w+)/.exec(text))) {
      cls = m[1]!;
      method = null;
      out.push({ name: cls, line });
    } else if ((m = /^def (\w+)/.exec(text))) {
      cls = null;
      method = null;
      out.push({ name: m[1]!, line });
    } else if ((m = /^([A-Z_][A-Z0-9_]*)\s*=/.exec(text))) {
      cls = null;
      method = null;
      out.push({ name: m[1]!, line });
    } else if (cls && (m = /^ {4}def (\w+)/.exec(text))) {
      method = `${cls}.${m[1]!}`;
      out.push({ name: method, line });
    } else if (cls && (m = /^ {4}([A-Z_][A-Z0-9_]*)\s*=/.exec(text))) {
      out.push({ name: `${cls}.${m[1]!}`, line });
    } else if (method && (m = /^ {8}def (\w+)/.exec(text))) {
      out.push({ name: `${method}.${m[1]!}`, line });
    }
  });
  return out;
}

/**
 * The text of the first section whose heading line matches `heading`, up to the next heading of the
 * same or a higher level. Empty string when there is none.
 */
export function section(markdown: string, heading: RegExp): string {
  const lines = markdown.split('\n');
  const start = lines.findIndex((l) => /^#{1,6} /.test(l) && heading.test(l));
  if (start < 0) return '';
  const level = /^(#+)/.exec(lines[start]!)![1]!.length;
  const end = lines.findIndex(
    (l, i) => i > start && /^(#+) /.test(l) && /^(#+)/.exec(l)![1]!.length <= level,
  );
  return lines.slice(start, end < 0 ? undefined : end).join('\n');
}

/**
 * Body rows of every pipe table in `markdown`, as trimmed cells. Header rows (followed by a `---` row)
 * and separator rows are dropped. An escaped `\|` stays inside its cell (unescaped).
 */
export function tableRows(markdown: string): string[][] {
  const lines = markdown.split('\n');
  const rows: string[][] = [];
  lines.forEach((l, i) => {
    if (!l.startsWith('|')) return;
    if (/^\|[\s|:-]+\|\s*$/.test(l)) return; // separator
    const next = lines[i + 1] ?? '';
    if (/^\|[\s|:-]+\|\s*$/.test(next)) return; // header
    const cells = l
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split(/(?<!\\)\|/)
      .map((c) => c.trim().replace(/\\\|/g, '|'));
    rows.push(cells);
  });
  return rows;
}

/** `` `x` `` → `x`; other text unchanged. */
export function unquote(cell: string): string {
  const m = /^`([^`]*)`$/.exec(cell.trim());
  return m ? m[1]! : cell.trim();
}
