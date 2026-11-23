import { createRequire } from 'node:module';

/**
 * Workbooks in the leak test: an export's cells are scanned like any other answer, and the other tenants edit
 * and re-import their own exports. ExcelJS is a dependency of the excel and worker packages, not of the server:
 * it is loaded from the excel package (as `src/routes/excel/excel.pg.test.ts` does).
 */
interface Cell {
  value: unknown;
}
interface Sheet {
  name: string;
  rowCount: number;
  columnCount: number;
  getCell(row: number, col: number): Cell;
}
export interface Book {
  xlsx: { load(b: ArrayBuffer): Promise<unknown>; writeBuffer(): Promise<ArrayBuffer> };
  worksheets: Sheet[];
  getWorksheet(name: string): Sheet | undefined;
}
const requireFromExcel = createRequire(new URL('../../../excel/package.json', import.meta.url));
const ExcelJS = requireFromExcel('exceljs') as { Workbook: new () => Book };

export async function loadBook(bytes: Uint8Array): Promise<Book> {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  return book;
}

export const bytesOf = async (book: Book): Promise<Uint8Array> => new Uint8Array(await book.xlsx.writeBuffer());

/** Every cell value of every sheet (rich text and formulas reduced to their text and result). */
export function cellValues(book: Book): unknown[] {
  const out: unknown[] = [];
  for (const ws of book.worksheets) {
    out.push(ws.name);
    for (let r = 1; r <= ws.rowCount; r += 1) {
      for (let c = 1; c <= ws.columnCount; c += 1) {
        const v = ws.getCell(r, c).value;
        if (v === null || v === undefined) continue;
        if (typeof v === 'object' && !(v instanceof Date)) {
          const o = v as { richText?: { text: string }[]; result?: unknown; text?: unknown; formula?: unknown };
          if (o.richText) out.push(o.richText.map((t) => t.text).join(''));
          if (o.result !== undefined) out.push(o.result);
          if (o.text !== undefined) out.push(o.text);
          continue;
        }
        out.push(v);
      }
    }
  }
  return out;
}

/** Sets the Default cell of a Targets row (key in column A, header `Default`). */
export function setDefault(book: Book, key: string, value: number): void {
  const ws = book.getWorksheet('Targets');
  if (!ws) throw new Error('the export has no Targets sheet');
  let col = 0;
  for (let c = 1; c <= ws.columnCount; c += 1) if (ws.getCell(1, c).value === 'Default') col = c;
  if (col === 0) throw new Error('the Targets sheet has no Default column');
  for (let r = 2; r <= ws.rowCount; r += 1) {
    if (ws.getCell(r, 1).value === key) {
      ws.getCell(r, col).value = value;
      return;
    }
  }
  throw new Error(`no Targets row ${key}`);
}
