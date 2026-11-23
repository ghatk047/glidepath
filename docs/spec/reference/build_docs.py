"""Generates the catalogue markdown (variable registry, node catalogue, reconciliation) from the JSON.
Usage: python3 build_docs.py <spec_dir>"""
import json, sys, os
D = sys.argv[1] if len(sys.argv) > 1 else "."
V = json.load(open(os.path.join(D, "variables.json")))["variables"]
G = json.load(open(os.path.join(D, "formula_graph.json")))
R = json.load(open(os.path.join(D, "reconciliation.json")))

def fmt(x):
    if isinstance(x, dict):
        if len(x) > 6: return f"{len(x)} values (per member)"
        return "; ".join(f"{k}: {fmt(v)}" for k, v in x.items())
    if isinstance(x, float): return f"{x:.4g}"
    return "" if x is None else str(x)
esc = lambda s: str(s or "").replace("|", "/").replace("\n", " ")

out = ["# 02 · Input variable registry", "",
       "Generated from `variables.json` by `reference/build_docs.py`. Do not edit by hand.", "",
       f"**{len(V)} input variables** ({sum(1 for v in V if v['dims'])} of them are families over a dimension, e.g. one value per lever or per line). "
       "Every number in the model is one of these, or a calculated node that can be pinned (see 03). Defaults shown are AA's (tenant `aa`); "
       "scenario-varying inputs also carry values for the five preset scenarios in `seed/aa/scenarios.json`.", "",
       "Columns: **kind** = decision (management choice, a solver may move it), estimate (fact or assumption, solvers hold it), fact_or_estimate (non-lever inputs), simulation. "
       "**role** = driver (shown), calibration (hidden by default, reproduces history), simulation (Monte Carlo only). **conf** = H/M/L. "
       "**source** = user (confirmed by the user), baseline / levers / corporate (existing models), filing, market, calibrated, benchmark, assumption, spec (new in the unified model).", ""]
groups = []
for v in V:
    if v["group"] not in groups: groups.append(v["group"])
for g in groups:
    vs = [v for v in V if v["group"] == g]
    out += [f"## {g} ({len(vs)})", "", "| id | label | unit | dims | AA default | C / D (if scenario-varying) | min | max | kind | role | source | conf | note |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for v in vs:
        sc = v.get("aa_scenario_values")
        scs = f"{fmt(sc['C'])} / {fmt(sc['D'])}" if sc and not isinstance(sc["C"], dict) else ("per lever" if sc else "")
        out.append(f"| `{v['id']}` | {esc(v['label'])} | {esc(v['unit'])} | {','.join(v['dims'])} | {esc(fmt(v['aa_default']))} | {scs} | {fmt(v['min'])} | {fmt(v['max'])} | {v['kind']} | {v['role']} | {v['source']} | {v['confidence']} | {esc(v['note'])[:160]} |")
    out.append("")
open(os.path.join(D, "02_variable_registry.md"), "w").write("\n".join(out))

out = ["# 03b · Formula node catalogue", "", "Generated from `formula_graph.json`. Every node is overridable (pinnable) per scenario unless noted. See 03_formula_graph.md for the language and the layer walk-through.", ""]
for layer in G["layers"]:
    ns = [n for n in G["nodes"] if n["layer"] == layer]
    out += [f"## Layer: {layer} ({len(ns)} nodes)", "", "| node | dims | unit | expression | label |", "|---|---|---|---|---|"]
    for n in ns:
        if "cases" in n:
            e = " ; ".join((f"[{','.join(f'{k}={v}' for k, v in c['when'].items())}] " if c["when"] else "[else] ") + c["expr"] for c in n["cases"])
        else: e = n["expr"]
        out.append(f"| `{n['id']}`{' ★' if n['output'] else ''} | {','.join(n['dims'])}{(' ' + json.dumps(n['members'])) if n.get('members') else ''} | {esc(n['unit'])} | `{esc(e)}` | {esc(n['label'])} |")
    out.append("")
out.append("★ = output node (stored in calc_run.outputs and available to the UI).")
open(os.path.join(D, "03b_node_catalogue.md"), "w").write("\n".join(out))

out = ["# 06 · Reconciliation of the three models", "", R["note"], "",
       "| id | area | severity | finding | resolution | impact |", "|---|---|---|---|---|---|"]
for it in R["items"]:
    out.append(f"| {it['id']} | {it['area']} | {it['severity']} | {esc(it['finding'])} | {esc(it['resolution'])} | {esc(it['impact'])} |")
open(os.path.join(D, "06_reconciliation.md"), "w").write("\n".join(out) + "\n")
print("docs ok")
