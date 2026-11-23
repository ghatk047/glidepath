#!/usr/bin/env python3
"""Regenerates the synthetic Excel fixtures in this folder.

    python3 tools/testkit/fixtures/excel/make_fixtures.py

Needs openpyxl and (for the re-save fixture) LibreOffice `soffice` on PATH.
Values come from docs/spec/seed/aa/variable_values.json; nothing is typed in here.
No personal data: the workbooks hold only spec ids, labels and tenant inputs.
"""
import csv
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

from openpyxl import Workbook

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2] if (HERE.parents[2] / "docs").exists() else HERE.parents[3]
SEED = REPO / "docs" / "spec" / "seed" / "aa" / "variable_values.json"
VARIABLES = REPO / "docs" / "spec" / "variables.json"

# Scalar inputs that make a small, readable Inputs sheet.
IDS = ["g.target_net", "g.target_pct", "hc.us", "hc.gcc", "hc.ctr", "wf.us_attrition", "rate.billable_hours"]


def rows():
    values = json.loads(SEED.read_text())
    reg = {v["id"]: v for v in json.loads(VARIABLES.read_text())["variables"]}
    return [(i, reg[i].get("label", reg[i].get("name", i)), values[i]) for i in IDS]


def write_xlsx(path, data, edited_id=None):
    wb = Workbook()
    ws = wb.active
    ws.title = "Inputs"
    ws.append(["id", "label", "value"])
    for i, label, v in data:
        ws.append([i, label, (v * 2 if i == edited_id else v)])
    wb.properties.creator = "glidepath-testkit"
    wb.properties.lastModifiedBy = "glidepath-testkit"
    wb.save(path)


def main():
    data = rows()
    write_xlsx(HERE / "inputs_small.xlsx", data)
    write_xlsx(HERE / "inputs_small_edited.xlsx", data, edited_id="hc.us")
    with open(HERE / "inputs_small.csv", "w", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(["id", "label", "value"])
        w.writerows(data)
    soffice = shutil.which("soffice")
    if soffice:
        with tempfile.TemporaryDirectory() as out:
            subprocess.run(
                [soffice, "--headless", "--convert-to", "xlsx", "--outdir", out, str(HERE / "inputs_small.xlsx")],
                check=True,
                capture_output=True,
            )
            shutil.copy(Path(out) / "inputs_small.xlsx", HERE / "inputs_small_libreoffice.xlsx")
    else:
        print("soffice not found: inputs_small_libreoffice.xlsx not regenerated")


if __name__ == "__main__":
    main()
