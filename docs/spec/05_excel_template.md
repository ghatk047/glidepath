# 05 · Excel export / import template

Machine-readable version: `excel_template.json`.

People who prefer Excel get a workbook the app generates, edit the yellow cells, and upload it back. The app shows exactly what changed, flags conflicts with edits made in the app meanwhile, previews the impact on the headline numbers, and applies the accepted changes as one undoable changeset.

## 1. Principles

- **The app writes the template and is its only reader.** Users edit values, not structure.
- **Rows are matched by key, never by position.** Sorting, filtering, hiding columns, adding comments or colouring cells are all safe.
- **Three-way diff.** Each export stores a server-side snapshot of every exported cell. On import the app compares export snapshot (E), workbook (W) and current database (D).

## 2. Workbook layout

| Sheet | Contents | Editable |
|---|---|---|
| README | What to edit, what not to touch, export id and time | No |
| Targets | Target, growth absorption, one-time funding, head start, D&A life | Value columns |
| Workforce | Headcount, contractor mix and rates, attrition, productivity, preferred-SI book | Value columns |
| Pools | Growth by pool, shared-pool flags, SWB flags, addressability shares, sub-pool shares, app portfolio | Value columns |
| Levers | Every lever input, grouped by lever, one column per exported scenario | Value columns |
| Lever_Timing | Matrix lever × {start, ramp, confidence, on}, per scenario | Values |
| Org_Map | Matrix domain × VP with a row check (= 100%), shared-services flag, manual targets, usage keys | Values |
| Line_Items | One row per baseline line: name, L2, pool, domain, addressability, scale driver, in scope, amount, capex share, notes. Blank key = new line; `DELETE` in the action column removes one | Listed columns |
| Corporate | Each corporate driver × FY25 / FY26 / FY27 | Values |
| Overrides | Pinned calculated numbers: node, member, value, reason | Rows |
| Outputs | Key results per scenario at export time, for reference | No (ignored on import) |
| _lists (hidden) | Dropdown sources | No |
| _meta (hidden, protected) | Tenant, model version, template version, export id, time, user, scenarios, checksum | No |

Input-sheet columns: `key` and `member` (locked, may be hidden), Group, Input, Unit, Min, Max (locked), **Default**, **one column per exported scenario** (blank = inherit default), Source, Confidence (locked), Note (editable), `_hash` (hidden hash of the row's editable cells).

Formatting: editable cells light yellow, locked cells protected (no password by default), data validation from registry min/max and dropdowns for enums, booleans and categories. Percentages are stored as decimals with % format; money in $M.

## 3. Import pipeline

1. **Identify.** Read `_meta`; check tenant and template version (minor versions compatible); load the export snapshot. No `_meta` means a foreign workbook: match by key columns and diff two-way against the database.
2. **Parse.** Find sheets and columns by header text. Unknown sheets or columns are reported and ignored. Normalise `35%`, `0.35`, blanks, TRUE/FALSE and dropdown labels.
3. **Validate.** Unknown keys, types, min/max, enum membership, cross-row rules (ownership sums to 100%, one shared-services VP, managed services ≥ 0), edits to locked columns.
4. **Diff** each cell:

| E vs W | E vs D | Status | Default action |
|---|---|---|---|
| same | same | unchanged | none |
| different | same | changed_in_excel | apply |
| same | different | changed_in_app | keep app value |
| different | different, W ≠ D | **conflict** | user decides |
| different | different, W = D | already_applied | none |

   Rows: blank key = new; `DELETE` = delete; a row missing from the sheet = warning only, never a silent delete.
5. **Impact preview.** Recalculate the affected scenarios with the proposed changes (incremental engine) and show before → after for net, gap, risk-adjusted net, VP gaps, EPS and share price.
6. **Review.** Changes grouped by sheet, conflicts first; accept all, per row, or resolve each conflict.
7. **Apply.** One changeset (origin = excel_import), atomic, version-checked, audited, with a new calc run. Undo = revert the changeset.

The delta report format is in `excel_template.json → delta_report_schema`.

## 4. Round-trip tests the build must pass

- Export then import unchanged: zero changes.
- Edit one cell: exactly one change.
- Sort and filter rows: zero changes.
- Same cell edited in the app after export and in Excel: one conflict.
- New line-item row: insert with a new key.
- `35%` typed in a decimal cell: stored as 0.35.
- Out-of-range value: flagged invalid, not applied.
- Row deleted without `DELETE`: warning, no delete.

CSV export of any single sheet uses the same keys and the same import path (two-way diff).
