"""Dump the local sensitivity of res.net and br.eps27 to every input that feeds them, via Model.rerun.

Usage: python3 -I tier2-logic/engine/test/fixtures/dump_explain.py <repo>
Writes explain.json next to this script, for two runs of preset C: "plain" (run("C")) and "parity"
(run("C", {overrides: parity_report.parity_overrides, values: {corp.it_swb_mode: 0}}), PORTING.md §6).

Candidates of a target are the keys its value reads: walk Model.cdeps from the target, stop at a pinned
(overridden) node cell, keep provided input cells and pinned cells. For each candidate x with value x0
(the same finite-difference rule as src/explain/drivers.ts):
  h = max(|x0|, 1) * 2**-26;  h = (x0 + h) - x0
  y1 = Model.rerun(base, {x: x0 + h}, overrides)[target]   (a pinned x: its pin moved to x0 + h instead)
  derivative = (y1 - y0) / h
Per target: "value" (y0), "candidates" (how many), and "rows": [x, derivative] for every candidate whose
derivative is not 0, sorted by key. Floats are float64 bit patterns (16 hex digits, big-endian), so the
comparison is bitwise.
Regenerate when docs/spec or the seed changes. Used by src/explain/explain.spec.ts (ENG-09).
"""
import hashlib, json, os, struct, sys

repo = os.path.abspath(sys.argv[1])
sys.path.insert(0, os.path.join(repo, "docs", "spec", "reference"))
from engine import Model  # noqa: E402  (the unchanged reference engine)

SPEC = "docs/spec"
SEED = "docs/spec/seed/aa"
SOURCES = [
    "docs/spec/formula_graph.json",
    "docs/spec/variables.json",
    "docs/spec/seed/aa/dimension_members.json",
    "docs/spec/seed/aa/variable_values.json",
    "docs/spec/seed/aa/scenarios.json",
    "docs/spec/reference/parity_report.json",
    "docs/spec/reference/engine.py",
]
TARGETS = ["res.net", "br.eps27"]
FD_STEP = 2.0 ** -26


def sha256(rel):
    with open(os.path.join(repo, rel), "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def bits(x):
    return struct.pack(">d", float(x)).hex()


m = Model(os.path.join(repo, SPEC), os.path.join(repo, SEED))
with open(os.path.join(repo, "docs/spec/reference/parity_report.json")) as f:
    parity_overrides = json.load(f)["parity_overrides"]
runs = {"plain": None, "parity": {"overrides": parity_overrides, "values": {"corp.it_swb_mode": 0}}}


def candidates(target, vals, ov):
    seen, stack, out = {target}, [target], []
    while stack:
        k = stack.pop()
        if k != target and (k in ov and k in m.cells or k not in m.cells and k in vals):
            out.append(k)
        if k in ov and k in m.cells:
            continue  # a pinned cell's expression is not evaluated: its deps do not feed the target
        for d in m.cdeps.get(k, ()):
            if d not in seen:
                seen.add(d)
                stack.append(d)
    return sorted(out)


out = {"sources": {s: sha256(s) for s in SOURCES}, "runs": {}}
for name, extra in runs.items():
    vals, ov = m.input_cells("C", extra)
    base = m.run("C", extra)
    targets = {}
    for t in TARGETS:
        y0 = base[t]
        rows, xs = [], candidates(t, vals, ov)
        for x in xs:
            x0 = base[x]
            h = max(abs(x0), 1.0) * FD_STEP
            xh = x0 + h
            h = xh - x0
            if x in ov:
                ov2 = dict(ov)
                ov2[x] = xh
                y1 = m.rerun(base, {}, ov2)[t]
            else:
                y1 = m.rerun(base, {x: xh}, ov)[t]
            d = (y1 - y0) / h
            if d != 0:
                rows.append([x, bits(d)])
        targets[t] = {"value": bits(y0), "candidates": len(xs), "rows": rows}
        print(f"{name} {t}: {len(xs)} candidates, {len(rows)} with a derivative")
    out["runs"][name] = targets
with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "explain.json"), "w") as f:
    json.dump(out, f, separators=(",", ":"))
    f.write("\n")
