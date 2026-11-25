# modules/excel

Excel · "Excel round trip" (MOD-09; UX `03_screens.md`, `screens/data-dark-1440.jpg`). Default export `Excel`
renders inside `GlobalLayout` (needs `BindProvider`, `DataProvider`, the router). No workbook is read or
compared here: tier 2 exports, parses, diffs and applies (API-10).

- Export: scenario choice (C, D, C + D, All five; preset scenarios by `key` from `GET scenarios`), the 11 editable
  sheets as toggle chips (`ExcelSheet` minus the `_` sheets; `sheets` is omitted when all are on), file name
  preview, "Export workbook" = `POST exports` then `GET files/:id` and a browser download.
  The name shows `excel_template.json` `file.name_pattern` until tier 2 answers; then tier 2's `file.filename`
  and `templateVersion`.
- Import review: drop or choose a file = `POST imports?filename=` (raw bytes), then `GET imports/:id` every
  `POLL_MS` until `status` is not `null`. File card (three-way or foreign), summary chips (rows shown, conflicts,
  errors), `DiffRow`s from `report.changes` (conflict, changed in file, new line, DELETE removal; conflicts first),
  error rows, ignored sheets / columns, validation line (`violations`, else "VR01–VR10 passed"),
  "Preview impact" (`report.impact`), "Apply as changeset" = `POST imports/:id/apply` (`accept: 'all'`; a
  decision for each conflict (File = excel, App = app) and for each row switched off).
- Labels and units come from the bundle and members (`useBundle`, `useMembers`); values are formatted with the ui
  `formatByUnit`.
- Tests: `excel.test.tsx` (msw, the contract's mock session and fixtures, axe).
