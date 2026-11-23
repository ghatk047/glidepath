# @glidepath/excel

Template, build, parse, diff, delta report. Pure: no IO (`eslint.config.js` rejects node builtins, DB/HTTP clients and `@glidepath/spec/node` in `src`). Callers load spec data with the `@glidepath/spec` loaders and pass it in.

Implemented so far: `template.ts` (XL-01). `build`, `parse`, `validate`, `diff`, `report` and `toChangeset` follow in XL-02 to XL-08.

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
