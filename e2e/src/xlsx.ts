import ExcelJS from 'exceljs';

/**
 * Edits one cell of an exported workbook the way a person does in Excel (QA-05, Excel beat): find
 * the row by its hidden `key` column and the column by its header text, type a number, save. Rows
 * are identified by key, never by position, exactly like the importer reads them.
 */

/** The header row is the first of the top rows that holds both `key` and `Input`. */
const HEADER_SCAN_ROWS = 10;

const text = (v: ExcelJS.CellValue): string =>
  typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';

export interface CellRef {
  readonly sheet: string;
  /** Registry id in the hidden `key` column (`g.target_net`). */
  readonly key: string;
  /** Header of the column: text, or a pattern (a scenario's value column is headed by its label, e.g. "C. Balanced"). */
  readonly column: string | RegExp;
  /** Dimension member for a dimensioned row; `''` (default) for a scalar one. */
  readonly member?: string;
}

interface Located {
  readonly sheet: ExcelJS.Worksheet;
  readonly cell: ExcelJS.Cell;
}

function locate(wb: ExcelJS.Workbook, ref: CellRef): Located {
  const sheet = wb.getWorksheet(ref.sheet);
  if (!sheet) throw new Error(`workbook has no sheet ${ref.sheet}`);
  let headerRow = 0;
  const columns = new Map<string, number[]>();
  for (let r = 1; r <= HEADER_SCAN_ROWS && headerRow === 0; r++) {
    const heads = new Map<string, number[]>();
    sheet.getRow(r).eachCell({ includeEmpty: false }, (c, col) => {
      const t = text(c.value).toLowerCase();
      if (t) heads.set(t, [...(heads.get(t) ?? []), col]);
    });
    if (heads.has('key') && heads.has('input')) {
      headerRow = r;
      for (const [k, v] of heads) columns.set(k, v);
    }
  }
  if (headerRow === 0) throw new Error(`${ref.sheet}: no header row with key and Input`);
  const keyCol = columns.get('key')?.[0];
  const memberCol = columns.get('member')?.[0];
  const wanted = ref.column;
  const valueCol = [...columns.entries()].find(([head]) =>
    typeof wanted === 'string' ? head === wanted.toLowerCase() : wanted.test(head),
  )?.[1][0];
  if (keyCol === undefined) throw new Error(`${ref.sheet}: no key column`);
  if (valueCol === undefined) throw new Error(`${ref.sheet}: no column headed ${String(ref.column)}`);
  const want = ref.member ?? '';
  for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    if (text(row.getCell(keyCol).value) !== ref.key) continue;
    if (memberCol !== undefined && text(row.getCell(memberCol).value) !== want) continue;
    return { sheet, cell: row.getCell(valueCol) };
  }
  throw new Error(`${ref.sheet}: no row for ${ref.key}${want ? `[${want}]` : ''}`);
}

async function load(bytes: Uint8Array): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  // ExcelJS takes a Node Buffer; a Uint8Array view of the same bytes is the same data.
  await wb.xlsx.load(Buffer.from(bytes) as unknown as ExcelJS.Buffer);
  return wb;
}

/** The number a cell holds (formulas and text read as `null`). */
export async function readCell(bytes: Uint8Array, ref: CellRef): Promise<number | null> {
  const v = locate(await load(bytes), ref).cell.value;
  return typeof v === 'number' ? v : null;
}

/** Writes `value` into the cell and returns the new workbook bytes. */
export async function writeCell(
  bytes: Uint8Array,
  ref: CellRef,
  value: number,
): Promise<Uint8Array> {
  const wb = await load(bytes);
  locate(wb, ref).cell.value = value;
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
