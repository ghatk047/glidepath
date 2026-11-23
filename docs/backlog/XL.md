# XL · Excel round trip

Pure `tier2-logic/excel` (template, build, parse, validate, diff, report, toChangeset), the eight round-trip tests and the worker jobs.

8 items. Fields and status values: see [README](README.md). Rubric: `docs/architecture/10_backlog_conventions.md` §2.

| id | title | ms | model/effort | size | depends on |
|---|---|---|---|---|---|
| XL-01 | template.ts: sheet definitions from excel_template.json | M3 | sonnet/high | M | SPEC-02, DOM-01 |
| XL-02 | build.ts: workbook, formatting and export snapshot | M3 | sonnet/high | M | XL-01 |
| XL-03 | parse.ts: header-text parsing and normalisation | M3 | sonnet/high | M | XL-01 |
| XL-04 | validate.ts: per-cell and cross-row validation | M3 | sonnet/high | S | XL-03, DOM-02 |
| XL-05 | diff.ts: three-way and foreign two-way diff | M3 | opus/xhigh | M | XL-03 |
| XL-06 | report.ts and toChangeset.ts | M3 | sonnet/high | S | XL-04, XL-05 |
| XL-07 | Round-trip suite: the eight tests plus fixtures | M3 | sonnet/high | M | XL-02, XL-06, QA-01 |
| XL-08 | Excel jobs: export, import preview with impact, apply | M3 | sonnet/high | M | XL-02, XL-06, JOB-01, DATA-07, DOM-05 |

## XL-01 · template.ts: sheet definitions from excel_template.json

```yaml
id: XL-01
title: "template.ts: sheet definitions from excel_template.json"
epic: XL
milestone: M3
priority: must
status: done
stream: B
model: sonnet
effort: high
depends_on: [SPEC-02, DOM-01]
tier: 2
package: "tier2-logic/excel"
contract: "buildTemplate(template, bundle, members): SheetDef[]"
inputs:
  - "docs/architecture/05_excel_roundtrip.md#1. Package `tier2-logic/excel` (pure, tier 2)"
  - "docs/spec/excel_template.json (sheets, scalar_inputs_columns)"
  - "docs/spec/05_excel_template.md#2. Workbook layout"
  - "docs/architecture/05_excel_roundtrip.md#5. Multi-tenant notes"
acceptance:
  - "sheet defs for README, Targets, Workforce (+ vend.book rows), Pools, Levers, Lever_Timing, Org_Map, Line_Items, Corporate, Overrides, Outputs, _lists, _meta (test: 11 editable sheets + 2 hidden)"
  - "columns per scalar_inputs_columns incl. locked, hidden key/member/_hash, per-scenario value columns (test)"
  - "tenant zz (five VPs) yields five Org_Map VP columns (test with QA-02 fixture or an inline five-VP member set)"
gates: [G1, G2]
size: M
notes: ""
merged_at: "2026-11-23"
```

Which variable goes on which sheet, driven by the bundle.

## XL-02 · build.ts: workbook, formatting and export snapshot

```yaml
id: XL-02
title: "build.ts: workbook, formatting and export snapshot"
epic: XL
milestone: M3
priority: must
status: done
stream: B
model: sonnet
effort: high
depends_on: [XL-01]
tier: 2
package: "tier2-logic/excel"
contract: "buildWorkbook(defs, values, meta) → {workbook, snapshot}"
inputs:
  - "docs/architecture/05_excel_roundtrip.md#3. Formatting rules (build)"
  - "docs/spec/excel_template.json (cell_rules, file, sheets._meta)"
acceptance:
  - "ExcelJS workbook + export snapshot (sheet/key/member/column → value) + row sha256 hashes (test)"
  - "yellow editable fill; locked cells protected without password; validation from min/max; dropdowns from _lists; formats '%' '$M' 'FTE' 'x'; frozen headers; key/member/_hash hidden; _meta hidden and protected (test reads the buffer back)"
  - "file name {tenant_slug}_it_savings_{scenario_keys}_{yyyymmdd-hhmm}.xlsx (test); README sheet text from the template, no tenant prose in code (test)"
gates: [G1, G2, G6]
size: M
notes: ""
merged_at: "2026-11-23"
```

Export side of the round trip.

## XL-03 · parse.ts: header-text parsing and normalisation

```yaml
id: XL-03
title: "parse.ts: header-text parsing and normalisation"
epic: XL
milestone: M3
priority: must
status: in_progress
stream: B
model: sonnet
effort: high
depends_on: [XL-01]
tier: 2
package: "tier2-logic/excel"
contract: "parseWorkbook(buffer, defs): ParsedWorkbook"
inputs:
  - "docs/architecture/05_excel_roundtrip.md#1. Package `tier2-logic/excel` (pure, tier 2)"
  - "docs/spec/05_excel_template.md#3. Import pipeline (steps 1–2)"
  - "docs/spec/excel_template.json (import_pipeline)"
acceptance:
  - "sheets and columns found by header text; unknown sheets/columns reported and ignored (test)"
  - "'35%' → 0.35, '0.35', blank = inherit, TRUE/FALSE, dropdown labels → ids (test table)"
  - "_meta read; missing _meta → foreign mode (test); sorted, filtered, hidden rows and comments are harmless (test)"
gates: [G1, G2, G6]
size: M
notes: ""
```

Reads whatever Excel hands back.

## XL-04 · validate.ts: per-cell and cross-row validation

```yaml
id: XL-04
title: "validate.ts: per-cell and cross-row validation"
epic: XL
milestone: M3
priority: must
status: todo
stream: B
model: sonnet
effort: high
depends_on: [XL-03, DOM-02]
tier: 2
package: "tier2-logic/excel"
contract: "validateParsed(parsed, bundle): ValidationEntry[]"
inputs:
  - "docs/spec/05_excel_template.md#3. Import pipeline (step 3)"
  - "docs/spec/schema.json (validation_rules)"
acceptance:
  - "unknown key, type, min/max (VR04), enum membership and edits to locked columns each produce an entry (one test each)"
  - "cross-row rules reuse domain rule functions: Org_Map rows sum to 100% (VR01), one shared-services VP (VR02), usage keys (VR03) (test)"
gates: [G1, G2, G6]
size: S
notes: ""
```

Nothing invalid reaches a changeset.

## XL-05 · diff.ts: three-way and foreign two-way diff

```yaml
id: XL-05
title: "diff.ts: three-way and foreign two-way diff"
epic: XL
milestone: M3
priority: must
status: todo
stream: B
model: opus
effort: xhigh
depends_on: [XL-03]
tier: 2
package: "tier2-logic/excel"
contract: "diff(E, W, D): CellDiff[] + RowDiff[]"
inputs:
  - "docs/spec/05_excel_template.md#3. Import pipeline (step 4 table)"
  - "docs/spec/excel_template.json (import_pipeline[3])"
  - "docs/architecture/05_excel_roundtrip.md#1. Package `tier2-logic/excel` (pure, tier 2)"
acceptance:
  - "per cell: W=E → unchanged; W≠E, D=E → changed_in_excel; W=E, D≠E → changed_in_app; W≠E, D≠E, W≠D → conflict; W≠E, W=D → already_applied (test table, all five)"
  - "rows: blank key → new; DELETE → delete; missing row → warning, never a delete (test)"
  - "foreign mode: W vs D two-way by key columns (test)"
  - "numbers compared at exported precision so LibreOffice/Excel re-saves cause no spurious diffs (test with a re-saved fixture); row _hash fast path skips unchanged rows (test)"
gates: [G1, G2, G6]
size: M
notes: ""
```

The heart of safe re-import.

## XL-06 · report.ts and toChangeset.ts

```yaml
id: XL-06
title: "report.ts and toChangeset.ts"
epic: XL
milestone: M3
priority: must
status: todo
stream: B
model: sonnet
effort: high
depends_on: [XL-04, XL-05]
tier: 2
package: "tier2-logic/excel"
contract: "buildReport(diff, validation), toChangeset(report, decisions)"
inputs:
  - "docs/spec/excel_template.json (delta_report_schema)"
  - "docs/architecture/05_excel_roundtrip.md#2. Flow in the app (steps 3–4)"
acceptance:
  - "delta report matches delta_report_schema: summary counts, changes[], impact slot (test)"
  - "toChangeset honours accept all / per row / File|App per conflict; origin excel_import; invalid rows never included (test)"
gates: [G1, G2, G6]
size: S
notes: ""
```

From diff to a reviewable changeset.

## XL-07 · Round-trip suite: the eight tests plus fixtures

```yaml
id: XL-07
title: "Round-trip suite: the eight tests plus fixtures"
epic: XL
milestone: M3
priority: must
status: todo
stream: B
model: sonnet
effort: high
depends_on: [XL-02, XL-06, QA-01]
tier: 2
package: "tier2-logic/excel (test/roundtrip.spec.ts)"
contract: "`pnpm test:excel` (G6)"
inputs:
  - "docs/architecture/05_excel_roundtrip.md#4. Tests (all must pass in CI)"
  - "docs/spec/05_excel_template.md#4. Round-trip tests the build must pass"
  - "docs/spec/excel_template.json (round_trip_tests)"
acceptance:
  - "named tests with real ExcelJS buffers: (1) export → import unchanged = 0 changes; (2) one cell edited = exactly 1 change; (3) rows sorted and filtered = 0 changes; (4) same cell edited in app and Excel = 1 conflict; (5) new line-item row = insert with a new key; (6) '35%' in a decimal cell = 0.35; (7) out-of-range value = invalid, not applied; (8) row deleted without DELETE = warning, no delete (G6)"
  - "a workbook re-saved by LibreOffice (headless, if installed) and an Excel-for-Mac fixture in testkit re-import with 0 changes (test)"
  - "a CSV of one sheet imports via two-way diff (test)"
gates: [G1, G2, G6]
size: M
notes: "Excel-for-Mac fixture: the owner saves one exported file on the Mac; until then the test is marked pending with the reason (orchestrator asks once)."
```

G6 in one file.

## XL-08 · Excel jobs: export, import preview with impact, apply

```yaml
id: XL-08
title: "Excel jobs: export, import preview with impact, apply"
epic: XL
milestone: M3
priority: must
status: todo
stream: B
model: sonnet
effort: high
depends_on: [XL-02, XL-06, JOB-01, DATA-07, DOM-05]
tier: 2
package: "tier2-logic/worker/src/jobs/excel"
contract: "handlers excel.export, excel.import, excel.apply"
inputs:
  - "docs/architecture/05_excel_roundtrip.md#2. Flow in the app"
  - "docs/spec/05_excel_template.md#3. Import pipeline (steps 5–7)"
  - "docs/architecture/04_data_and_api.md#5. Tier 3 · Object storage (MinIO)"
acceptance:
  - "excel.export builds the workbook, stores file (exports/) and snapshot (export-snapshots/), writes export_job (test with fs object-store adapter)"
  - "excel.import: identify via _meta → parse → validate → diff vs snapshot and current DB → impact preview by rerun per affected scenario (net, gap, risk-adjusted, VP gaps, EPS, price before → after) → import_job.report (test)"
  - "excel.apply: toChangeset → applyChangeset, atomic and version-checked; undo = revert (test)"
gates: [G1, G2, G6]
size: M
notes: ""
```

IO around the pure Excel package.
