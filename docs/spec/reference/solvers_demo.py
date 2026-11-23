"""Demonstrates the solver / optimizer / simulator formulations in 04_solvers.md on the
reference engine, so the formulations are proven feasible and the app has expected outputs.
Pure Python + numpy. Production solvers are specified in 04_solvers.md.
Usage: python3 solvers_demo.py <spec_dir> [mc_iterations]
"""
import json, sys, os, time
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
from engine import Model

SPEC = sys.argv[1] if len(sys.argv) > 1 else "."
NMC = int(sys.argv[2]) if len(sys.argv) > 2 else 500
m = Model(SPEC, os.path.join(SPEC, "seed", "aa"))
REG = m.vars
VPS = m.members["vp"]; LEV = m.members["lever"]
scen = {s["id"]: s for s in m.scenarios["scenarios"]}
out = {}

base_vals, _ = m.input_cells("C")
base = m.run("C")
def run_with(changes):
    return m.rerun(base, changes)

# decision variables = scalar lever intensity inputs (not timing, not one-time cost rates)
DEC = [v for v in REG.values() if v["id"].startswith("lev.L") and v.get("scenario_varies") and not v["dims"] and v["kind"] == "decision"]
lo = {v["id"]: v["min"] for v in DEC}
hi = {v["id"]: max(scen["C"]["values"][v["id"]], scen["D"]["values"][v["id"]]) for v in DEC}   # realism cap: no lever beyond full stretch
step = {v["id"]: v["step"] for v in DEC}
# direction: some params reduce savings when they grow (leakage, transition cost, tooling, severance)
NEG = {"lev.L08.leak", "lev.L03.tc", "lev.L04.tc", "lev.L05.sev", "lev.L06.tool", "lev.L09.dc", "lev.L04.pf"}

# ---------------------------------------------------------------- 1. goal seek: blend C -> D until net = bar
def blend(lmb):
    ch = {}
    for sid_key, val in scen["C"]["values"].items():
        d = scen["D"]["values"][sid_key]
        if isinstance(val, dict):
            for mem, x in val.items(): ch[m.key(sid_key, (mem,))] = x + lmb * (d[mem] - x)
        else: ch[sid_key] = val + lmb * (d - val)
    return run_with(ch)
a, b = 0.0, 1.0
for _ in range(40):
    mid = (a + b) / 2; r = blend(mid)
    if r["res.net"] - r["res.bar"] < 0: a = mid
    else: b = mid
r = blend(b)
out["goal_seek_blend_C_to_D"] = {"lambda": round(b, 4), "net": round(r["res.net"], 2), "bar": round(r["res.bar"], 2), "risk_adj_net": round(r["res.risk"], 2),
                                 "one_time_it": round(r["res.tot_ot_it"], 2), "eps27": round(r["br.eps27"], 4),
                                 "vp_gaps": {v: round(r[f"vp.gap[{v}]"], 2) for v in VPS}}

# ---------------------------------------------------------------- 2. min-risk lever mix (greedy marginal analysis)
def risk_exposure(r):  # expected non-delivery: sum of in-year saving x (1 - confidence)
    return sum(r[f"lev.iy[{l}]"] * (1 - r[m.key("lev.conf", (l,))]) for l in LEV)

def optimise(per_vp=False, ot_cap=None):
    x = {k: scen["C"]["values"][k] for k in lo}
    r = run_with(dict(x)); evals = 1
    def viol(r):
        v = max(0.0, r["res.bar"] - r["res.net"])
        if per_vp: v += sum(max(0.0, r[f"vp.bar[{u}]"] - r[f"vp.net[{u}]"]) for u in VPS)
        if ot_cap is not None: v += max(0.0, r["res.tot_ot_it"] - ot_cap)
        return v
    path = []
    while viol(r) > 1e-6 and len(path) < 400:
        best = None
        for k in lo:
            s = -step[k] if k in NEG else step[k]
            nx = x[k] + s
            if nx < lo[k] - 1e-12 or nx > (hi[k] if k not in NEG else max(hi[k], x[k])) + 1e-12: continue
            if k in NEG and nx < lo[k]: continue
            r2 = run_with({**x, k: nx}); evals += 1
            dv = viol(r) - viol(r2); dr = risk_exposure(r2) - risk_exposure(r)
            if dv <= 1e-9: continue
            score = dv / max(dr, 1e-3)
            if best is None or score > best[0]: best = (score, k, nx, r2)
        if best is None: break
        _, k, nx, r = best; x[k] = nx; path.append(k)
    moved = {k: {"from": scen["C"]["values"][k], "to": round(x[k], 4), "label": REG[k]["label"]} for k in x if abs(x[k] - scen["C"]["values"][k]) > 1e-9}
    return {"feasible": viol(r) <= 1e-6, "evaluations": evals, "steps": len(path), "net": round(r["res.net"], 2), "bar": round(r["res.bar"], 2),
            "risk_adj_net": round(r["res.risk"], 2), "risk_exposure": round(risk_exposure(r), 2), "one_time_it": round(r["res.tot_ot_it"], 2),
            "fte_us": round(r["res.fte_us"], 0), "fte_gcc": round(r["res.fte_gcc"], 0), "eps27": round(r["br.eps27"], 4),
            "vp_gaps": {u: round(r[f"vp.gap[{u}]"], 2) for u in VPS}, "inputs_moved_from_C": moved}
t = time.time()
out["min_risk_total_bar"] = optimise(per_vp=False)
out["min_risk_total_and_vp_bars"] = optimise(per_vp=True)
out["min_risk_reference"] = {"C_risk_exposure": round(risk_exposure(base), 2), "D_risk_exposure": round(risk_exposure(m.run("D")), 2), "seconds": round(time.time() - t, 1)}

# ---------------------------------------------------------------- 3. tornado (one-at-a-time, registry min/max)
torn = []
cand = [v for v in REG.values() if not v["dims"] and v["role"] == "driver" and v["min"] is not None and v["max"] is not None
        and not v["id"].startswith("corp.") and v["type"] != "enum"]
for v in cand:
    k = v["id"]; lohi = []
    for val in (v["min"], v["max"]):
        r = run_with({k: val}); lohi.append((r["res.net"] - base["res.net"], r["br.eps27"] - base["br.eps27"]))
    torn.append({"id": k, "label": v["label"], "min": v["min"], "max": v["max"], "net_at_min": round(lohi[0][0], 2), "net_at_max": round(lohi[1][0], 2),
                 "swing": round(abs(lohi[1][0] - lohi[0][0]), 2), "eps_swing": round(abs(lohi[1][1] - lohi[0][1]), 4)})
torn.sort(key=lambda d: -d["swing"])
out["tornado_net_top15"] = torn[:15]

# ---------------------------------------------------------------- 4. Monte Carlo
rng = np.random.default_rng(20261204)
K = 4.0                       # Beta concentration: realisation ~ Beta(conf*K, (1-conf)*K) on [0,1.2]
RHO = 0.5                     # correlation inside a lever family (Gaussian copula)
fam = {l: ("labour" if int(l[1:]) <= 8 else "tech") for l in LEV}
from math import erf, sqrt
def phi(z): return 0.5 * (1 + erf(z / sqrt(2)))
from scipy_free import beta_ppf  # local helper
def mc(sid):
  base = m.run(sid)
  nets, bars, eps, vpok = [], [], [], {u: 0 for u in VPS}
  t = time.time()
  for it in range(NMC):
      zf = {"labour": rng.standard_normal(), "tech": rng.standard_normal()}
      ch = {}
      for l in LEV:
          z = sqrt(RHO) * zf[fam[l]] + sqrt(1 - RHO) * rng.standard_normal()
          c = base[m.key("lev.conf", (l,))]
          ch[m.key("lev.realize", (l,))] = 1.2 * beta_ppf(phi(z), c * K / 1.2 * 1.0, (1 - c / 1.2) * K)
          ch[m.key("lev.start", (l,))] = min(12, base[m.key("lev.start", (l,))] + int(rng.integers(0, 3)))   # 0-2 month slip
      for p in m.members["pool"]:
          g = base[m.key("pool.growth", (p,))]
          ch[m.key("pool.growth", (p,))] = rng.triangular(0.7 * g, g, 1.4 * g) if g > 0 else g
      r = m.rerun(base, ch)
      nets.append(r["res.net"]); bars.append(r["res.bar"]); eps.append(r["br.eps27"])
      for u in VPS: vpok[u] += r[f"vp.net[{u}]"] >= r[f"vp.bar[{u}]"]
  nets, bars, eps = map(np.array, (nets, bars, eps))
  res = {"iterations": NMC, "seconds": round(time.time() - t, 1), "assumptions": {"realisation": "Beta with mean = lever confidence, scaled to [0,1.2]", "family_correlation": RHO,
                          "start_slip_months": "uniform 0-2", "pool_growth": "triangular 0.7x / 1x / 1.4x"},
                          "net_p10_p50_p90": [round(float(np.percentile(nets, q)), 1) for q in (10, 50, 90)],
                          "bar_p10_p50_p90": [round(float(np.percentile(bars, q)), 1) for q in (10, 50, 90)],
                          "prob_clear_bar": round(float(np.mean(nets >= bars)), 3), "prob_clear_target_ignoring_growth": round(float(np.mean(nets >= base["res.target"])), 3),
                          "eps27_p10_p50_p90": [round(float(np.percentile(eps, q)), 4) for q in (10, 50, 90)],
                          "prob_vp_clears_bar": {u: round(vpok[u] / NMC, 3) for u in VPS}}
  return res
out["monte_carlo_C"] = mc("C"); out["monte_carlo_D"] = mc("D")
json.dump(out, open(os.path.join(SPEC, "reference", "solver_demo_results.json"), "w"), indent=1)
print(json.dumps({k: (v if k.startswith("monte") or k.startswith("goal") or k == "min_risk_reference" else {kk: vv for kk, vv in v.items() if kk != "inputs_moved_from_C"}) for k, v in out.items() if not k.startswith("tornado")}, indent=1))
print([(d["id"], d["swing"]) for d in out["tornado_net_top15"]])
