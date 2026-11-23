"""Dump the decision variables of docs/spec/reference/solvers_demo.py (DEC, lo, hi, step, NEG).

Usage: python3 -I tier2-logic/solvers/test/fixtures/dump_dec.py <repo>
Runs the unchanged prologue of solvers_demo.py (everything before its first solver section) and writes
dec.json next to this script. Regenerate when docs/spec or the seed changes.
Used by src/decision-sets.spec.ts (SOL-01).
"""
import hashlib, json, os, sys

repo = os.path.abspath(sys.argv[1])
ref = os.path.join(repo, "docs", "spec", "reference")
sys.path.insert(0, ref)
demo_path = os.path.join(ref, "solvers_demo.py")
src = open(demo_path, encoding="utf8").read()
cut = src.index("# ---------------------------------------------------------------- 1.")
os.chdir(repo)
sys.argv = [demo_path, os.path.join("docs", "spec")]
scope = {"__file__": demo_path, "__name__": "solvers_demo_prologue"}
exec(compile(src[:cut], demo_path, "exec"), scope)


def sha256(rel):
    with open(os.path.join(repo, rel), "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


SOURCES = [
    "docs/spec/variables.json",
    "docs/spec/seed/aa/scenarios.json",
    "docs/spec/reference/solvers_demo.py",
]
out = {
    "sources": {s: sha256(s) for s in SOURCES},
    "dec": [v["id"] for v in scope["DEC"]],
    "lo": scope["lo"],
    "hi": scope["hi"],
    "step": scope["step"],
    "neg": sorted(scope["NEG"]),
}
with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "dec.json"), "w") as f:
    json.dump(out, f, indent=1)
    f.write("\n")
