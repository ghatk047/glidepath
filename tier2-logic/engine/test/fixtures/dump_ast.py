"""Dump the AST of every expression in formula_graph.json, as engine.py's `parse` returns it.

Usage: python3 -I tier2-logic/engine/test/fixtures/dump_ast.py <repo>
Writes ast.json next to this script (sorted keys). Regenerate when docs/spec changes.
Used by src/parse/ast-parity.spec.ts (ENG-02).
"""
import hashlib, json, os, sys

repo = os.path.abspath(sys.argv[1])
sys.path.insert(0, os.path.join(repo, "docs", "spec", "reference"))
from engine import parse  # noqa: E402  (the unchanged reference engine)

GRAPH = "docs/spec/formula_graph.json"
ENGINE = "docs/spec/reference/engine.py"


def sha256(rel):
    with open(os.path.join(repo, rel), "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def plain(x):
    if isinstance(x, (tuple, list)):
        return [plain(e) for e in x]
    return x


graph = json.load(open(os.path.join(repo, GRAPH)))
nodes, asts = {}, {}
for n in graph["nodes"]:
    exprs = ([n["expr"]] if "expr" in n else []) + [c["expr"] for c in n.get("cases", [])]
    nodes[n["id"]] = exprs
    for e in exprs:
        asts[e] = plain(parse(e))

out = {
    "sources": {GRAPH: sha256(GRAPH), ENGINE: sha256(ENGINE)},
    "node_count": len(nodes),
    "expression_count": len(asts),
    "nodes": nodes,
    "asts": asts,
}
with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "ast.json"), "w") as f:
    json.dump(out, f, sort_keys=True, indent=1, allow_nan=False)
    f.write("\n")
print(f"ast.json: {len(nodes)} nodes, {len(asts)} expressions")
