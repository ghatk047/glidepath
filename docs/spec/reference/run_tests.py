"""Parity and golden tests for the unified model spec.

1. PARITY: with v0.3 pool values pinned (node overrides), the generic engine running the
   JSON graph must reproduce the three source models (levers v0.3, baseline VP view,
   corporate v0.1) to rounding.
2. GOLDEN: records unified-default results per scenario (what the app must reproduce).
Usage: python3 run_tests.py <spec_dir>
"""
import json, sys, os
from openpyxl import load_workbook
sys.path.insert(0, os.path.dirname(__file__))
from engine import Model

SPEC = sys.argv[1] if len(sys.argv) > 1 else "."
PF = "/mnt/project-files"
m = Model(SPEC, os.path.join(SPEC, "seed", "aa"))
SC = {"rates": "Rate cuts only", "A": "A. Commercial", "B": "B. Op-model reset", "C": "C. Balanced", "D": "D. Full stretch"}
feed = json.load(open(f"{PF}/levers/pnl_feed.json"))["scenarios"]
cspec = json.load(open(f"{PF}/corporate/AA_Corporate_Model_v0.1_spec.json"))

# ---------------------------------------------------------------- parity overrides (v0.3 hard-coded pools)
G = {"internal_labour": .038, "captive_labour": .09, "si_contingent": .035, "consulting": .03, "software": .06, "airline_platforms": .04,
     "cloud": .08, "dc_hardware": .02, "network": .01, "end_user": .02, "other": .03}
V03 = {"lv.us_total": 3000 * 0.1327, "lv.gcc_total": 36.0, "lv.on_cost": 0.19, "lv.off_cost": 0.059, "lv.ms0": 37.3, "lv.pref": 85.0,
       "lv.cons": 16.05, "lv.sw": 157.2, "lv.sw_ms": 35.0, "lv.cloud": 40.7, "lv.dc_capex": 25.0, "lv.dc_maint": 6.0, "lv.dc_colo": 6.0,
       "lv.net": 31.5, "lv.euc": 28.5, "lv.fees": 133.4, "lv.fees_addr": 31.4}
V03["lv.ext"] = 280 * 0.19 + 520 * 0.059 + 37.3
V03["lv.tail"] = V03["lv.ext"] - 85.0
pools03 = {"internal_labour": V03["lv.us_total"], "captive_labour": 36.0, "si_contingent": V03["lv.ext"], "consulting": 16.05, "software": 157.2,
           "airline_platforms": 133.4, "cloud": 40.7, "dc_hardware": 37.0, "network": 31.5, "end_user": 28.5, "other": 8.0}
V03["base.headwinds"] = sum(pools03[p] * G[p] for p in G)
CX = {"L01": .1, "L03": .1, "L04": .1, "L06": .1, "L07": .1, "L08": .1, "L05": .17, "L14": .6}
for n in range(1, 18):
    lid = f"L{n:02d}"
    if lid != "L12": V03[f"lev.cx[{lid}]"] = CX.get(lid, 0.0)
PARITY = {"overrides": V03, "values": {"corp.it_swb_mode": 0}}

checks, fails = [], []
def chk(name, got, exp, tol):
    ok = abs(got - exp) <= tol
    checks.append({"check": name, "engine": round(got, 6), "source_model": round(exp, 6), "tol": tol, "pass": ok})
    if not ok: fails.append(name)

# lever-level in-year savings vs lever workbook Summary
wb = load_workbook(f"{PF}/levers/AA_IT_Savings_Lever_Model_v0.3.xlsx", data_only=True)
sm = wb["Summary"]
for sid, col in zip(SC, range(4, 9)):
    r = m.run(sid, PARITY)
    for i in range(17):
        chk(f"levers v0.3 {sid} L{i+1:02d} in-year", r[f"lev.iy[L{i+1:02d}]"], sm.cell(3 + i, col).value, 0.006)
    f = feed[SC[sid]]
    for k, node in [("g27", "res.tot_iy"), ("o27", "pnl.o27"), ("c27", "pnl.c27"), ("ot27_it", "res.tot_ot_it"), ("e27", "pnl.e27"), ("d27", "pnl.d27"),
                    ("ebit27", "pnl.ebit27"), ("cash27", "pnl.cash27"), ("cash27_co", "pnl.cash27_co"), ("o28", "pnl.o28"), ("c28", "pnl.c28"),
                    ("d28", "pnl.d28"), ("ebit28", "pnl.ebit28"), ("cash28", "pnl.cash28")]:
        exp = f[k] if k != "ot27_it" else -f[k]
        chk(f"levers v0.3 {sid} pnl_feed.{k}", r[node], exp, 0.011)
    chk(f"levers v0.3 {sid} risk-adjusted net", r["res.risk"], sm.cell(24, col).value, 0.01)
    chk(f"levers v0.3 {sid} bar", r["res.bar"], sm.cell(25, col).value, 0.01)
    chk(f"levers v0.3 {sid} end-state GCC FTE", r["res.fte_gcc"], sm.cell(32, col).value, 0.01)
# VP view (levers v0.3, chargeback on) scenario C
vv = wb["VP_View"]
rC = m.run("C", PARITY)
row = next(i for i in range(1, vv.max_row + 1) if vv.cell(i, 1).value == "C. Balanced") + 2
for j, vp in enumerate(["vp_commercial", "vp_operations", "vp_corporate", "vp_infra"]):
    chk(f"levers v0.3 VP {vp} target", rC[f"vp.target[{vp}]"], vv.cell(row + j, 3).value, 0.1)
    chk(f"levers v0.3 VP {vp} net C", rC[f"vp.net[{vp}]"], vv.cell(row + j, 8).value, 0.15)
    chk(f"levers v0.3 VP {vp} gap C", rC[f"vp.gap[{vp}]"], vv.cell(row + j, 10).value, 0.15)
# baseline VP bridge (chargeback off)
om = json.load(open(f"{PF}/baseline/org_map_l1_by_vp.json"))["vp_bridge_cy26_to_cy27"]
rB = m.run("C", {"values": {"g.chargeback_on": 0}})
for vp, nm in zip(["vp_commercial", "vp_operations", "vp_corporate", "vp_infra"], ["Commercial Technology", "Operations Technology", "Corporate Technology", "Infrastructure & All Others"]):
    chk(f"baseline VP {vp} CY26 outlay", rB[f"vp.outlay[{vp}]"], om[nm]["cy26_outlay"] / 1e6, 0.001)
    chk(f"baseline VP {vp} CY27 growth", rB[f"vp.growth[{vp}]"], om[nm]["cy27_growth"] / 1e6, 0.001)
    chk(f"baseline VP {vp} addressable", rB[f"vp.addressable[{vp}]"], om[nm]["addressable"] / 1e6, 0.001)
    chk(f"baseline VP {vp} net target", rB[f"vp.target[{vp}]"], om[nm]["net_target"] / 1e6, 0.001)
chk("baseline total outlay", rB["base.total"], 1007.636932, 0.001)
chk("baseline headwinds", rB["base.headwinds"], 42.97966207, 0.001)
# corporate v0.1
dr, db = cspec["default_results"], cspec["default_bridge"]
for k in ("rev", "ebitda", "ebitdar", "ni", "eps", "fcf", "net_debt"):
    for y, col in (("FY2025A", "fy25"), ("FY2026E", "fy26"), ("FY2027E_base", "fy27b")):
        chk(f"corporate v0.1 {k} {y}", rC[f"pl.{k}[{col}]"], dr[k][y], 0.02 if k != "eps" else 0.0005)
chk("corporate v0.1 price FY2027 base", rC["val.px[fy27b]"], dr["px"]["FY2027E_base"], 0.001)
for k, node, tol in (("ebitda", "br.ebitda27", 0.02), ("ni", "br.ni27", 0.02), ("eps", "br.eps27", 0.0002), ("fcf", "br.fcf27", 0.05)):
    chk(f"corporate v0.1 bridge {k} FY2027 (C)", rC[node], db[k]["FY2027"], tol)
chk("corporate v0.1 bridge price FY2027 (C)", rC["br.px27"], db["px"]["FY2027"], 0.002)
for k, node in (("ebitda", "br.ebitda28"), ("eps", "br.eps28"), ("px", "br.px28")):
    chk(f"corporate v0.1 bridge {k} FY2028 run-rate (C)", rC[node], db[k]["FY2028_runrate"], 0.02 if k == "ebitda" else 0.002)
# internal invariants on unified defaults
for sid in SC:
    r = m.run(sid)
    chk(f"invariant {sid} pool effects sum to run-rate", max(abs(r[f"lev.rr_check[L{n:02d}]"]) for n in range(1, 18)), 0, 1e-9)
    chk(f"invariant {sid} VP nets sum to total net", r["vp.check"], 0, 1e-6)
    chk(f"invariant {sid} only IT lines differ in FY2027 revenue", r["pl.rev[fy27it]"] - r["pl.rev[fy27b]"], 0, 1e-9)

# ---------------------------------------------------------------- golden results (unified defaults)
OUTS = ["base.total", "base.capex_total", "base.opex_total", "base.addressable_total", "base.headwinds", "base.locked_share",
        "res.tot_iy", "res.tot_rr", "res.tot_ot_all", "res.tot_ot_it", "res.net", "res.risk", "res.target", "res.bar", "res.gap", "res.gap_risk", "res.coverage",
        "res.cy27_outlay", "res.cy27_vs_cy26_pct", "res.fte_us", "res.fte_gcc", "res.fte_on", "res.offshore_mix",
        "pnl.o27", "pnl.c27", "pnl.e27", "pnl.ebit27", "pnl.cash27_co", "pnl.o28", "pnl.c28", "pnl.swb_share27",
        "br.ebitda27", "br.eps27", "br.eps_pct27", "br.px27", "br.mcap27", "br.ebitda28", "br.eps28", "br.px28", "br.fuel_equiv_cents",
        "pl.eps[fy27b]", "pl.eps[fy27it]", "val.px[fy27b]", "val.px[fy27it]"]
golden = {"note": "Unified-default results ($M unless stated). App calc engine must match to 1e-6 relative.", "scenarios": {}}
for sid in SC:
    r = m.run(sid)
    g = {k: round(r[k], 6) for k in OUTS}
    g["levers"] = {f"L{n:02d}": {"rr": round(r[f'lev.rr[L{n:02d}]'], 6), "iy": round(r[f'lev.iy[L{n:02d}]'], 6), "ot": round(r[f'lev.ot[L{n:02d}]'], 6), "cx": round(r[f'lev.cx[L{n:02d}]'], 6)} for n in range(1, 18)}
    g["vp"] = {vp: {k: round(r[f"vp.{k}[{vp}]"], 6) for k in ("outlay", "eff_addr", "growth", "target", "bar", "savings", "one_time", "net", "gap", "gap_risk")} for vp in m.members["vp"]}
    golden["scenarios"][sid] = g
# deltas unified vs v0.3 (explain the reconciliation)
delta = {}
for sid in SC:
    a, b = m.run(sid), m.run(sid, PARITY)
    delta[sid] = {k: round(a[k] - b[k], 3) for k in ("res.net", "res.risk", "res.tot_rr", "pnl.o27", "pnl.c27", "br.ebitda27", "br.eps27", "br.px27")}
golden["unified_minus_v03"] = delta
json.dump(golden, open(os.path.join(SPEC, "reference", "golden_results.json"), "w"), indent=1)
json.dump({"passed": len(checks) - len(fails), "failed": len(fails), "fails": fails, "checks": checks,
           "parity_overrides": V03}, open(os.path.join(SPEC, "reference", "parity_report.json"), "w"), indent=1)
print(f"parity: {len(checks) - len(fails)} passed, {len(fails)} failed")
for f in fails[:40]:
    c = next(x for x in checks if x["check"] == f); print("  FAIL", f, c["engine"], c["source_model"])
print(json.dumps(delta["C"]))
