"""Dump the greedy path of docs/spec/reference/solvers_demo.py `optimise(per_vp=False)` (min_risk_total_bar).

Usage: python3 -I tier2-logic/solvers/test/fixtures/dump_min_risk.py <repo>
Runs the unchanged prologue of solvers_demo.py and its `risk_exposure` / `optimise` (section 2), with
the step list of `optimise` exposed, and writes min_risk_path.json next to this script: the ordered
steps, each cell's first step (the optimizer's order) and the result. Regenerate when docs/spec or the
seed changes. Used by src/problems/min-risk.spec.ts (SOL-04).
"""
import hashlib, json, os, sys

repo = os.path.abspath(sys.argv[1])
ref = os.path.join(repo, "docs", "spec", "reference")
sys.path.insert(0, ref)
demo_path = os.path.join(ref, "solvers_demo.py")
src = open(demo_path, encoding="utf8").read()
start = src.index("# ---------------------------------------------------------------- 2.")
cut = src.index("t = time.time()", start)
prologue = src[: src.index("# ---------------------------------------------------------------- 1.")]
section = src[start:cut]
os.chdir(repo)
sys.argv = [demo_path, os.path.join("docs", "spec")]
scope = {"__file__": demo_path, "__name__": "solvers_demo_prologue"}
exec(compile(prologue, demo_path, "exec"), scope)

# Expose the path: the demo appends each chosen cell to a local list.
marker = "    path = []\n"
assert marker in section
section = section.replace(marker, marker + "    PATHS.append(path)\n", 1)
scope["PATHS"] = []
exec(compile(section, demo_path, "exec"), scope)
result = scope["optimise"](per_vp=False)
path = scope["PATHS"][-1]
first = []
for k in path:
    if k not in first:
        first.append(k)


def sha256(rel):
    with open(os.path.join(repo, rel), "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


SOURCES = [
    "docs/spec/variables.json",
    "docs/spec/formula_graph.json",
    "docs/spec/seed/aa/scenarios.json",
    "docs/spec/reference/solvers_demo.py",
]
out = {
    "sources": {s: sha256(s) for s in SOURCES},
    "path": path,
    "order": first,
    "result": {k: v for k, v in result.items() if k != "inputs_moved_from_C"},
    "moved": {k: [v["from"], v["to"]] for k, v in result["inputs_moved_from_C"].items()},
}
with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "min_risk_path.json"), "w") as f:
    json.dump(out, f, indent=1)
    f.write("\n")
