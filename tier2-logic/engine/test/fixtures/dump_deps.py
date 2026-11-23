"""Dump every cell of the reference Model: chosen expression, sorted cdeps, expansion and topological order.

Usage: python3 -I tier2-logic/engine/test/fixtures/dump_deps.py <repo>
Writes deps.json next to this script; "cells" is in expansion order (Model.cells). Regenerate when docs/spec or the seed changes.
Used by src/expand/deps-parity.spec.ts (ENG-03) and src/compile/toposort.spec.ts (ENG-04).
"""
import hashlib, json, os, sys

repo = os.path.abspath(sys.argv[1])
sys.path.insert(0, os.path.join(repo, "docs", "spec", "reference"))
from engine import Model  # noqa: E402  (the unchanged reference engine)

SPEC = "docs/spec"
SEED = "docs/spec/seed/aa"
SOURCES = [
    "docs/spec/formula_graph.json",
    "docs/spec/variables.json",
    "docs/spec/seed/aa/dimension_members.json",
    "docs/spec/reference/engine.py",
]


def sha256(rel):
    with open(os.path.join(repo, rel), "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


m = Model(os.path.join(repo, SPEC), os.path.join(repo, SEED))

# The chosen expression per cell, with the unchanged Model helpers (the loop of Model._expand).
exprs, expr_index, chosen = [], {}, {}
for n in m.graph["nodes"]:
    dims = n.get("dims", [])
    for combo in m.combos(dims, n.get("members")):
        e = m.pick_expr(n, dict(zip(dims, combo)))
        if e not in expr_index:
            expr_index[e] = len(exprs)
            exprs.append(e)
        chosen[m.key(n["id"], combo)] = expr_index[e]
assert list(chosen) == list(m.cells), "expansion order differs from Model._expand"

lines = ["{"]
head = {
    "sources": {s: sha256(s) for s in SOURCES},
    "cell_count": len(m.cells),
    "edge_count": sum(len(d) for d in m.cdeps.values()),
    "order": m.order,
    "exprs": exprs,
}
for k, v in head.items():
    lines.append(f" {json.dumps(k)}: {json.dumps(v, separators=(',', ':'))},")
lines.append(' "cells": {')
cells = [
    f"  {json.dumps(k)}: {json.dumps({'expr': chosen[k], 'deps': sorted(m.cdeps[k])}, separators=(',', ':'))}"
    for k in m.cells
]
lines.append(",\n".join(cells))
lines.append(" }")
lines.append("}")
with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "deps.json"), "w") as f:
    f.write("\n".join(lines) + "\n")
print(f"deps.json: {len(m.cells)} cells, {head['edge_count']} edges, {len(exprs)} expressions")
