# @glidepath/excel

Template, build, parse, diff, delta report. Pure: no IO (`eslint.config.js` rejects node builtins, DB/HTTP clients and `@glidepath/spec/node` in `src`). Callers load spec data with the `@glidepath/spec` loaders and pass it in.

Implemented so far: `template.ts` (XL-01), `build.ts` (XL-02), `parse.ts` (XL-03), `validate.ts` (XL-04), `diff.ts` (XL-05). `report` and `toChangeset` follow in XL-06. Dependency: `exceljs` (works on buffers, no IO).

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

## validate.ts

```ts
import { validateParsed } from '@glidepath/excel';

const entries = validateParsed(parsed, { sheets, model: bundle, members, current }); // ValidationEntry[]
```

- `bundle` (`ValidationBundle`): `sheets` (`buildTemplate(...)`, for column and row facts and dropdown lists), `model` (the pinned `variables` and `nodes`), the tenant's `members`, and optionally `current` (`defaults` and per-scenario `scenarios` value rows as stored). With `current`, a workbook with some sheets only is checked against the rest, and a blank cell leaves the stored value. Without it the cross-row rules see only what the workbook carries (an absent cell counts as 0).
- An entry (`ValidationEntry`): `code`, `rule` (VR id, when there is one), `severity`, `message` (cause and fix), `cells` (contract CellKeys `id[member_key]`), `locations` (sheet, 1-based file row, key, member, column id, scenario) and, for cross-row entries of a scenario, `scenarioId`. Empty list = valid.
- Per cell, one entry each (`ValidationCode`):

  | Code           | When                                                                                                                                                                                                                                                    | Severity                          |
  | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
  | `unknown_key`  | key (and member) not in the template; Overrides: node not in the model. A blank key on Line_Items is an insert, not unknown                                                                                                                             | error                             |
  | `type`         | text, boolean or a fraction (whole-number types) where a number belongs: the cells `parse.ts` leaves as typed                                                                                                                                           | error                             |
  | `out_of_range` | VR04: below `min` or above `max` (a null bound is open; DOM-02's tolerance)                                                                                                                                                                             | warning (`VALIDATION_RULES.VR04`) |
  | `not_in_list`  | value is not a code of the cell's list (enum, bool, pool, domain, addr_tag, scale driver) or of the action column                                                                                                                                       | error                             |
  | `locked_edit`  | Group, Input, Unit, Min, Max, Source or Confidence differ from the template (warning: nothing is applied from them); a value in a locked cell: a scenario cell of an input that does not vary by scenario, a matrix cell the row does not carry (error) | warning / error                   |

  A cell that fails `type` or `not_in_list` is not given to the cross-row rules.

- Across rows, `validateInputs` of `@glidepath/domain` runs on the state the workbook would produce: once for the default layer (Default, Value, year and VP columns on top of `current.defaults`) and once per scenario (defaults, then the scenario's own values, then its columns; a blank scenario cell drops the scenario's own value). Entries of `CROSS_ROW_RULES` (VR01 ownership sums, VR02 one shared-services VP, VR03 usage keys, VR06, VR07) are kept when they involve a cell that the layer's columns set. Cells and messages are the domain's; a scenario's message ends with `(scenario <label>)`.
- Not here: VR04 is checked per cell (it needs the file position); VR09 and VR10 need member attributes and complete corporate inputs and run in `applyChangeset`; VR05 and VR08 read engine outputs.
## diff.ts

```ts
import { diff, toDeltaEntry } from '@glidepath/excel';

const E = exportJob.snapshot; // ExportSnapshot of the export, or null for a foreign workbook
const W = await parseWorkbook(bytes, sheets, { scenarios }); // scenarios of the export (foreign: of the tenant)
const D = buildWorkbook(sheets, currentValues, meta).snapshot; // the app now: same scenarios, same form as E
const result = diff(E, W, D, sheets); // DiffResult
```

- Contract `diff(E, W, D)`, plus `sheets` (`buildTemplate(...)` of the tenant now, the ones W was parsed with): they name each cell's variable and member key and say which cells are editable. `mode` is `three_way` with E, `foreign` without.
- Per editable cell (the cells the row `_hash` covers; locked columns are `validate.ts`'s), `cellStatus(E, W, D)` is the table of `import_pipeline[3]`: W=E → `unchanged`; W≠E, D=E → `changed_in_excel`; W=E, D≠E → `changed_in_app`; W≠E, D≠E, W≠D → `conflict`; W≠E, W=D → `already_applied`. Foreign: W vs D by key columns, equal → `unchanged`, else `changed_in_excel`. A row or cell the export lacks counts as blank in E (a typed value that differs from the app is a conflict, never a silent overwrite); a row the app no longer has counts as blank in D.
- `cells`: a `CellDiff` for every cell that is not `unchanged`, in workbook order. Its delta-report keys mirror `delta_report_schema.changes[]` verbatim (`sheet`, `key` = variable id, `member` = member key, `scenario` = scenario id or `null`, `export`, `workbook`, `current`, `status`, `messages`): `DeltaChange` of CON-03, mirrored, not imported; a test holds the keys to `excel_template.json`, and `toDeltaEntry()` picks exactly them. Plus `column` (snapshot column id), `rowNumber` and `target` (`value` → `variable_value` / `scenario_value`, `note`, `attr` of a Line_Items member, `override` field of a pin of the first scenario).
- `rows`: `RowDiff` `new_row` (table sheet, blank key; a new pin on Overrides), `deleted_row` (`DELETE`; `inApp: false` = already deleted in the app), `missing_row` (in the export and still in the app, or foreign: in the app, but not in the sheet): a warning with the app's values, never a delete. Missing sheets and sheets without their key column have no missing rows.
- `unmatched`: what cannot be placed and is never applied: `unknown_row` (key in neither E nor D, or not a row of the registry), `unknown_cell` (a scenario column of an unknown scenario, a cell the app lacks), `duplicate_row` (a key's second row; the first is read).
- Numbers are equal to `EXPORT_PRECISION_DIGITS` (15) significant digits (`sameValue`): Excel keeps 15 and LibreOffice writes 15, so a re-save changes nothing. Text compares with line ends normalised.
- Fast path: a row whose parsed `hash` equals the snapshot's row hash (and D's) counts as `unchanged` without a cell compare (`stats.rowsSkipped`; `{ fastPath: false }` turns it off). A row whose hidden `_hash` is not the snapshot's gets a message (moved without its key?).
- `counts` per cell and row status (unchanged cells are counted, not listed). `DiffError` when W names another export than E.
- Fixtures: `fixtures/precision_export.xlsx` (an export with 17-digit values) and `fixtures/precision_export_libreoffice.xlsx` (the same file saved by LibreOffice headless); `npx tsx fixtures/make_fixtures.ts` regenerates both (needs `soffice`).
