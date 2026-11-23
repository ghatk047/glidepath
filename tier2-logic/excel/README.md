# @glidepath/excel

Template, build, parse, diff, delta report. Pure: no IO (`eslint.config.js` rejects node builtins, DB/HTTP clients and `@glidepath/spec/node` in `src`). Callers load spec data with the `@glidepath/spec` loaders and pass it in.

Implemented so far: `template.ts` (XL-01), `build.ts` (XL-02), `parse.ts` (XL-03). `validate`, `diff`, `report` and `toChangeset` follow in XL-04 to XL-08. Dependency: `exceljs` (works on buffers, no IO).

## template.ts

```ts
import { buildTemplate } from '@glidepath/excel';

const sheets = buildTemplate(template, bundle, members); // SheetDef[]
```

- `template`: parsed `docs/spec/excel_template.json` (`ExcelTemplateSchema` in `@glidepath/spec/generated`).
- `bundle`: `ModelBundle` (`loadModelBundle` / `loadModelBundleFromDir`).
- `members`: the tenant's `TenantMembers` (`seedToTenantData(...).members`, or the tenant's rows).

Result: one `SheetDef` per template sheet, in template order (13: 11 visible, `_lists` and `_meta` hidden). A `SheetDef` has `columns` (`ColumnDef`: header, role, locked, editable, hidden, `perScenario`, `mapsTo`, `bind`) and `rows` (`RowDef`: key, member, variable facts, number format, which cells carry values). No values: `build.ts` adds them for the chosen scenarios and repeats `perScenario` columns once per scenario.

Which variable goes on which sheet (`placeVariables`), all driven by the template and the registry:

1. explicit ids: `column_blocks` (Lever_Timing), `editable_columns` (Line_Items), `var` and `also` (Org_Map);
2. `filter.prefix` (Levers `lev.L`, Corporate `corp.`);
3. `member_inputs` sheets (Pools): group variables, plus other variables over the same dimensions (`pool.shared`, `pool.swb_flag`);
4. the remaining scalar variables of the group of a matrix `var` (Org_Map: `g.vp_alloc_method`, `org.usage_override_on`, ...);
5. `filter.groups` of scalar-input sheets (Targets, Workforce incl. one `vendor.book` row per vendor).

Variables with role `simulation` get no cell. An input that no sheet carries throws `TemplateError`.

Tenant shape: VPs become Org_Map columns, labor groups Corporate rows, levers Levers groups and Lever_Timing rows, lines Line_Items rows. `cellRef(bundle, row, col)` gives the variable id and member key of a cell (row binding plus column binding).

## build.ts

```ts
import { buildWorkbook, writeWorkbook } from '@glidepath/excel';

const { workbook, snapshot, fileName } = buildWorkbook(sheets, values, meta);
const bytes: Uint8Array = await writeWorkbook(workbook); // in memory; the worker stores file and snapshot
```

- `sheets`: `buildTemplate(...)`. `values` (`ExportValues`): tenant `defaults` (`variable_value` rows), `scenarios` in column order (`id`, `label`, own `scenario_value` rows, optional `overrides` and `outputs`), optional `notes`. A scenario cell with no row is blank (= inherit default). `meta` (`ExportMeta`): the `_meta` fields, `templateVersion`, `exportedAt` (the caller passes the clock), optional `fileNamePattern` and `newRowSlots`.
- `perScenario` columns repeat once per scenario: column id `scenarioColumnId(col.id, scenario.id)` (`scenario@C`, `lev.start@C`), header `columnHeader(col, scenario)`.
- Snapshot (`ExportSnapshot`): `cells[snapshotKey(sheet, key, member, column)]` = value as `parse.ts` will read it (percent as decimal, dropdown label as code, blank as `null`), `rowHashes[rowKey(sheet, key, member)]` = `hashRow([columnId, value][])` over the row's editable cells (the hidden `_hash`), `checksum` = sha256 of the row hashes (`workbook_checksum` of `_meta`). Outputs, README, `_lists` and `_meta` are not in the snapshot.
- Formatting follows `cell_rules`: yellow editable cells (`EDITABLE_FILL`), every sheet protected without a password (sorting, filtering and column width stay allowed), validation from min/max (decimal, whole), dropdowns from `_lists` (enum lists show labels, others codes), the template's number formats (`0.00x` is written as `0.00"x"`), frozen header row, hidden `key` / `member` / `_hash`, `_lists` and `_meta` hidden. Table sheets get `NEW_ROW_SLOTS` spare unlocked rows. Org_Map rows get a `SUM` row check, shaded when it is not the rule's target.
- The Overrides sheet has no scenario column: it lists the pins of the first scenario.

## parse.ts

```ts
import { parseWorkbook, identifyWorkbook } from '@glidepath/excel';

const parsed = await parseWorkbook(bytes, sheets, { scenarios }); // ParsedWorkbook (async: ExcelJS loads buffers asynchronously)
const who = identifyWorkbook(parsed, { tenantId, templateVersion }); // tenant and (same-major) template check
```

- `sheets`: `buildTemplate(...)`. `parseLoadedWorkbook(workbook, sheets, options)` is the synchronous core, for callers that hold an ExcelJS workbook. `ParseError` when the bytes are no .xlsx.
- Sheets are matched by name (case and spacing aside), columns by header text, rows by key (`key` + `member`; Line_Items by `member_key`; Overrides by `node_key` + `member_key`). The header row is the one with most known headers in the first 10 rows. Sorting, filtering, hidden rows or columns, comments and column order change nothing.
- Unknown sheets (`unknownSheets`) and columns (`ParsedSheet.unknownColumns`) are reported and ignored; `missingSheets`, `missingColumns` and `issues` (`ParseIssue`: severity, code, sheet, row) carry the rest. README, Outputs and `_lists` are `ignoredSheets`.
- Per-scenario columns are headed by the scenario label, which can repeat. Pass `options.scenarios` (`{ id, label }` in export order, from `_meta.scenario_keys`) to match them by label; without it they are matched by position and numbered by `_meta.scenario_keys`; in a foreign workbook the label is the id (`scenario@Same`, `scenario@Same#2`). Column ids are `scenarioColumnId(...)`, as in the snapshot.
- `ParsedRow.cells[columnId]` is normalised like the snapshot: `35%` and `0.35` are 0.35, TRUE/FALSE are 1/0, dropdown labels (enum, pool, domain, ...) are codes, blank is `null` (= inherit the default), numbers typed in text cells (`1,234.5`) are numbers. A value that does not fit its type stays as typed (text, or a boolean in a numeric cell) for `validate.ts` to flag.
- Row status inputs for diff: `isNew` (table sheet, blank key), `action` (`DELETE`), `exportedHash` (the `_hash` cell) and `hash` (`hashRow` of the editable cells as parsed): they are equal when the row is unchanged.
- `_meta`: `ParsedWorkbook.meta`; `mode` is `export` when `tenant_id`, `template_version` and `export_job_id` are there, else `foreign` (two-way diff against the database).
