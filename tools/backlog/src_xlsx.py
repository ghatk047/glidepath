#!/usr/bin/env python3
"""Write docs/backlog/SRC_backlog.xlsx from docs/backlog/items.json (SRC epic). Run after extract.py."""
import json
import sys
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs/backlog/SRC_backlog.xlsx"

FEATURES = [
    ("F1", "Breakeven table", "VP IT", "Plan", "What each lever would have to deliver alone to close the gap.", "SRC-18", 9),
    ("F2", "Solve for this (goal seek)", "VP IT", "Edit popover", "Pick any input and get the value that closes the gap, then apply it.", "SRC-19", 8),
    ("F3", "Stress tests", "VP IT / CFO", "Plan", "Named shocks (GCC can't hire, vendors win COLA, late start) with editable sizes.", "SRC-18", 8),
    ("F4", "Savings vs risk frontier", "VP IT", "Path", "Pareto curve of minimum-risk mixes over a range of bars.", "SRC-12, SRC-13", 7),
    ("F5", "Vendor spend cube", "VP Procurement", "Sourcing", "Spend by vendor, concentration (HHI, top 5), preferred vs tail, levers touching each.", "SRC-06, SRC-11", 10),
    ("F6", "Renewal calendar", "VP Procurement", "Sourcing", "Renewals, notice deadlines, escalator exposure and in-year capture per negotiation.", "SRC-08, SRC-11", 10),
    ("F7", "Should-cost benchmarks", "VP Procurement", "Sourcing", "Unit cost vs P25/median/P75 benchmarks, gap and headroom beyond modelled levers.", "SRC-09, SRC-11", 9),
    ("F8", "Vendor consolidation optimizer", "VP Procurement", "Sourcing", "Move tail spend to preferred vendors under a concentration cap and vendor-count floor.", "SRC-10, SRC-11", 9),
    ("F9", "Lever business case", "VP IT / CFO", "Plan", "NPV, payback, IRR and ROI per lever at an editable discount rate.", "SRC-16, SRC-18", 8),
    ("F10", "Wave planner", "VP IT", "Plan", "Optimise lever start months under a quarterly one-time budget and launch capacity.", "SRC-14, SRC-18", 8),
]

WAVE = {
    "SRC-01": 0, "SRC-02": 0, "SRC-03": 0, "SRC-04": 0, "SRC-05": 0, "SRC-12": 0,
    "SRC-06": 1, "SRC-07": 1, "SRC-08": 1, "SRC-09": 1, "SRC-10": 1, "SRC-14": 1, "SRC-15": 1, "SRC-16": 1, "SRC-17": 1,
    "SRC-11": 2, "SRC-13": 2, "SRC-18": 2, "SRC-19": 2,
    "SRC-20": 3, "SRC-21": 3, "SRC-22": 3, "SRC-23": 9, "SRC-24": 9,
}
PRIO_ORDER = {"must": 0, "should": 1, "could": 2}
HOURS = {"S": 2, "M": 4}

HEAD = Font(bold=True, color="FFFFFF")
FILL = PatternFill("solid", fgColor="1F3A5F")
WRAP = Alignment(wrap_text=True, vertical="top")


def header(ws, cols, widths):
    ws.append(cols)
    for i, w in enumerate(widths, 1):
        c = ws.cell(row=1, column=i)
        c.font, c.fill, c.alignment = HEAD, FILL, Alignment(vertical="center", wrap_text=True)
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = "A2"


def main():
    items = [i for i in json.loads((ROOT / "docs/backlog/items.json").read_text()) if i["epic"] == "SRC"]
    feat_of = {}
    for f in FEATURES:
        for iid in f[5].split(", "):
            feat_of.setdefault(iid, []).append(f[0])
    items.sort(key=lambda i: (PRIO_ORDER[i["priority"]], WAVE.get(i["id"], 9), i["id"]))

    wb = Workbook()
    ws = wb.active
    ws.title = "Backlog"
    cols = ["Rank", "ID", "Title", "Feature", "Priority", "Wave", "Tier", "Package", "Model", "Effort", "Size",
            "Est. agent hours", "Depends on", "Status", "Acceptance", "Notes"]
    header(ws, cols, [6, 9, 48, 9, 9, 6, 9, 38, 8, 8, 6, 8, 22, 11, 70, 40])
    for rank, it in enumerate(items, 1):
        ws.append([
            rank, it["id"], it["title"], ", ".join(feat_of.get(it["id"], [])), it["priority"],
            WAVE.get(it["id"], "") if WAVE.get(it["id"]) != 9 else "later", str(it["tier"]), it["package"],
            it["model"], it["effort"], it["size"], HOURS[it["size"]], ", ".join(it.get("depends_on") or []),
            it["status"], "\n".join("• " + a for a in it.get("acceptance") or []), it.get("notes") or "",
        ])
    for row in ws.iter_rows(min_row=2):
        for c in row:
            c.alignment = WRAP
    n = len(items) + 1
    for col, opts in (("I", "opus,sonnet,haiku"), ("J", "low,medium,high,xhigh,max"), ("K", "S,M"),
                      ("N", "todo,in_progress,review,done,blocked"), ("E", "must,should,could")):
        dv = DataValidation(type="list", formula1=f'"{opts}"', allow_blank=False)
        ws.add_data_validation(dv)
        dv.add(f"{col}2:{col}{n}")
    ws.auto_filter.ref = f"A1:{get_column_letter(len(cols))}{n}"

    fs = wb.create_sheet("Features")
    header(fs, ["#", "Feature", "Persona", "Where", "What it answers", "Backlog items", "Demo value (1-10)"],
           [6, 30, 16, 14, 70, 18, 10])
    for f in FEATURES:
        fs.append(list(f))
    for row in fs.iter_rows(min_row=2):
        for c in row:
            c.alignment = WRAP

    ss = wb.create_sheet("Summary")
    header(ss, ["Model / effort", "Items", "Est. agent hours"], [22, 10, 16])
    combos = sorted({(i["model"], i["effort"]) for i in items})
    for k, (m, e) in enumerate(combos, 2):
        ss.append([f"{m} / {e}", f'=COUNTIFS(Backlog!I:I,"{m}",Backlog!J:J,"{e}")',
                   f'=SUMIFS(Backlog!L:L,Backlog!I:I,"{m}",Backlog!J:J,"{e}")'])
    last = len(combos) + 1
    ss.append(["Total", f"=SUM(B2:B{last})", f"=SUM(C2:C{last})"])
    ss.append([])
    ss.append(["Status", "Items"])
    for s in ("todo", "in_progress", "review", "done", "blocked"):
        ss.append([s, f'=COUNTIF(Backlog!N:N,"{s}")'])
    ss.append([])
    ss.append(["Rubric: docs/architecture/10_backlog_conventions.md §2. Source of truth: docs/backlog/SRC.md."])

    wb.save(OUT)
    print(f"wrote {OUT.relative_to(ROOT)} ({len(items)} items)")


if __name__ == "__main__":
    sys.exit(main())
