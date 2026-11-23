# 05 · Excel round trip

Behaviour is specified in `model-spec/05_excel_template.md` and `excel_template.json` (sheets, columns, diff table, delta report schema, eight round-trip tests). This page is the implementation plan.

## 1. Package `tier2-logic/excel` (pure, tier 2)

All Excel logic is in tier 2. Tier 1 only uploads the file, downloads the workbook and renders the delta report that tier 2 returns.

| Module | Input → output |
|---|---|
| `template.ts` | `excel_template.json` + model bundle → sheet definitions (columns, which variables go on which sheet, validation lists) |
| `build.ts` | sheet definitions + resolved values for chosen scenarios + `_meta` → ExcelJS `Workbook` and an **export snapshot** (map of `sheet/key/member/column → value`, plus row hashes) |
| `parse.ts` | uploaded buffer → `ParsedWorkbook` (sheets found by header text, unknown sheets/columns reported, cells normalised: `35%` → 0.35, TRUE/FALSE, dropdown labels → ids, blanks = inherit) |
| `validate.ts` | parsed rows + bundle → validation entries (unknown key, type, min/max, enum, locked column edited, cross-row VR rules) |
| `diff.ts` | (E snapshot, W parsed, D current) → per-cell status `unchanged / changed_in_excel / changed_in_app / conflict / already_applied`; row status `new / delete / missing` |
| `report.ts` | diff + validation → delta report (schema in `excel_template.json → delta_report_schema`) |
| `toChangeset.ts` | delta report + user decisions → changeset draft (`origin = excel_import`) |

No IO in this package. ExcelJS is the only dependency.

## 2. Flow in the app

1. **Export** (Excel module): pick scenarios and sheets → `POST /exports` → tier 2 worker builds workbook, stores file and E snapshot, row in `export_job` → download.
2. **Import**: drop file → `POST /imports` → tier 2 worker: parse → identify via `_meta` (tenant, template version, export id; foreign workbook = two-way diff) → validate → diff → impact preview (engine `rerun` per affected scenario: net, gap, risk-adjusted, VP gaps, EPS, price before → after) → delta report saved on `import_job`.
3. **Review** in tier 1 (UX 03 Excel screen, diff rows component #25), decisions sent back to tier 2: conflicts first, accept all / per row / choose File or App per conflict.
4. **Apply** → `toChangeset` → `applyChangeset` (atomic, version-checked) → new calc run. Undo is reverting that changeset.

## 3. Formatting rules (build)

Yellow editable cells, locked cells protected without a password, data validation from registry min/max, dropdowns from `_lists`, percent format on decimals, $M number format, frozen header rows, `key` / `member` / `_hash` columns hidden, `_meta` hidden and protected, README sheet generated from the template (no tenant-specific prose in code).

## 4. Tests (all must pass in CI)

The eight tests in model-spec 05 §4 are implemented as named Vitest cases in `tier2-logic/excel/test/roundtrip.spec.ts`, using real ExcelJS buffers:

1. export → import unchanged = 0 changes
2. one cell edited = exactly 1 change
3. rows sorted and filtered = 0 changes
4. same cell edited in app and in Excel = 1 conflict
5. new line-item row = insert with a new key
6. `35%` typed in a decimal cell = 0.35
7. out-of-range value = invalid, not applied
8. row deleted without `DELETE` = warning, no delete

Plus: a workbook saved by LibreOffice and by Excel for Mac (fixtures in `testkit`) re-imports with 0 changes; a CSV of one sheet imports via two-way diff.

## 5. Multi-tenant notes

Sheet content is driven by the bundle and members: a tenant with five VPs gets five Org_Map columns; a tenant with different labor groups gets different Corporate rows. Template version is global; a minor version bump stays import-compatible.
