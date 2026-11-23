# Excel fixtures

Small synthetic workbooks for the Excel round-trip tests (G6, docs/architecture/05). `index.json` is the authoritative list of files; a test fails if the folder and the index disagree.

## How they were produced

`make_fixtures.py` (Python 3, `openpyxl`, optional LibreOffice) regenerates every file:

```
python3 tools/testkit/fixtures/excel/make_fixtures.py
```

- The values come from `docs/spec/seed/aa/variable_values.json` and the labels from `docs/spec/variables.json`; nothing is typed into the script.
- `inputs_small.xlsx` is written by openpyxl. `inputs_small_edited.xlsx` is the same with one cell (`hc.us`) doubled.
- `inputs_small_libreoffice.xlsx` is `inputs_small.xlsx` converted by `soffice --headless --convert-to xlsx`, i.e. a LibreOffice re-save.
- `inputs_small.csv` is the same table as CSV.

## Pending

`inputs_small_excel_mac.xlsx` (the baseline saved once from Excel for Mac) cannot be produced in the build container. The owner saves it and drops it in this folder, then moves it from `pending` to `files` in `index.json`.

## Rules

No personal data: only spec ids, labels and tenant inputs. Add new fixtures by extending the script (or noting the tool used here) and listing them in `index.json`.
