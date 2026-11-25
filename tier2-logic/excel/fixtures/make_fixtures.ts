/**
 * Regenerates the re-save fixtures of diff.test.ts (XL-05):
 *
 *     cd tier2-logic/excel && npx tsx fixtures/make_fixtures.ts
 *
 * - `precision_export.xlsx`: an export written by `buildWorkbook` (ExcelJS) from the AA seed, every `number`
 *   input shifted at the 13th significant digit (`v * (1 + 1e-12 / 3)`), so cells hold 17-digit doubles the way
 *   computed values do. Each data sheet keeps its first rows only, to keep the file small.
 * - `precision_export_libreoffice.xlsx`: the same file opened and saved by LibreOffice headless
 *   (`soffice --headless --convert-to xlsx`), which writes numbers with 15 significant digits.
 *
 * The test reads E from the first file and W from the second: the diff must report no change. Needs `soffice`.
 * No personal data: spec ids, labels and seed inputs only.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { InputValueRow } from '@glidepath/domain';
import { seedToTenantData, type InputValue } from '@glidepath/spec';
import { ExcelTemplateSchema } from '@glidepath/spec/generated';
import { loadModelBundleFromDir, readTenantSeed } from '@glidepath/spec/node';
import { buildTemplate, buildWorkbook, writeWorkbook, type SheetDef } from '../src/index';

const here = dirname(fileURLToPath(import.meta.url));
const specDir = join(here, '../../../docs/spec');
const ROWS_PER_SHEET = 12;
const SHIFT = 1e-12 / 3;

const rowsOf = (v: Readonly<Record<string, InputValue>>): InputValueRow[] =>
  Object.entries(v).flatMap(([var_key, value]) =>
    typeof value === 'number'
      ? [{ var_key, member_key: '', value }]
      : Object.entries(value).map(([member_key, n]) => ({ var_key, member_key, value: n })),
  );

async function main(): Promise<void> {
  const template = ExcelTemplateSchema.parse(
    JSON.parse(readFileSync(join(specDir, 'excel_template.json'), 'utf8')),
  );
  const bundle = await loadModelBundleFromDir(specDir);
  const seed = await readTenantSeed(join(specDir, 'seed/aa'));
  const members = seedToTenantData(seed, 'C', bundle).members;
  const defs: SheetDef[] = buildTemplate(template, bundle, members).map((d) =>
    d.rows.length > ROWS_PER_SHEET ? { ...d, rows: d.rows.slice(0, ROWS_PER_SHEET) } : d,
  );

  // Variables typed `number` (not int, enum or bool): their values get the 17-digit shift.
  const numeric = new Set<string>();
  for (const d of defs) {
    for (const r of d.rows) if (r.varId !== undefined && r.type === 'number') numeric.add(r.varId);
    for (const c of d.columns)
      if (c.varId !== undefined && c.type === 'number') numeric.add(c.varId);
  }
  const shift = (rows: InputValueRow[]): InputValueRow[] =>
    rows.map((r) => (numeric.has(r.var_key) ? { ...r, value: r.value * (1 + SHIFT) } : r));

  const scenarios = ['A', 'C'].map((id) => {
    const s = seed.scenarios.scenarios.find((x) => x.id === id);
    if (s === undefined) throw new Error(`no scenario ${id}`);
    return {
      id,
      label: s.label,
      values: shift(rowsOf(s.values)),
      overrides: [
        { node_key: 'res.net', member_key: '', value: 119.3 * (1 + SHIFT), reason: 'pin' },
      ],
    };
  });
  const built = buildWorkbook(
    defs,
    {
      defaults: shift(rowsOf(seed.variableValues)),
      scenarios,
      notes: [
        { var_key: 'g.target_net', member_key: '', note: 'agreed with finance\nsecond line' },
      ],
    },
    {
      tenantId: seed.tenant.id,
      tenantSlug: 'aa',
      modelVersion: 'fixture',
      templateVersion: template.template_version,
      exportJobId: 'exp-fixture-precision',
      exportedAt: new Date(Date.UTC(2026, 10, 23, 8, 0)),
      exportedBy: 'fixture',
    },
  );
  const original = join(here, 'precision_export.xlsx');
  writeFileSync(original, await writeWorkbook(built.workbook));

  const work = mkdtempSync(join(tmpdir(), 'glidepath-resave-'));
  try {
    execFileSync(
      'soffice',
      [
        `-env:UserInstallation=${pathToFileURL(join(work, 'profile')).href}`,
        '--headless',
        '--convert-to',
        'xlsx',
        '--outdir',
        join(work, 'out'),
        original,
      ],
      { stdio: 'inherit' },
    );
    copyFileSync(
      join(work, 'out', 'precision_export.xlsx'),
      join(here, 'precision_export_libreoffice.xlsx'),
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

await main();
