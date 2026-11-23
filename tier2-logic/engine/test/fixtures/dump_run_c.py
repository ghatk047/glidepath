"""Dump every node cell of the reference Model.run for preset C, plain and with the parity extra.

Usage: python3 -I tier2-logic/engine/test/fixtures/dump_run_c.py <repo>
Writes run_c.json next to this script. Values are float64 bit patterns (16 hex digits, big-endian),
so the comparison is bitwise. "parity" is run("C", {overrides: parity_report.parity_overrides,
values: {corp.it_swb_mode: 0}}) as PORTING.md §6 PARITY(C). Regenerate when docs/spec or the seed changes.
Used by src/eval/evaluate.spec.ts (ENG-05).
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


def sha256(rel):
    with open(os.path.join(repo, rel), "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def bits(x):
    return struct.pack(">d", float(x)).hex()


m = Model(os.path.join(repo, SPEC), os.path.join(repo, SEED))
with open(os.path.join(repo, "docs/spec/reference/parity_report.json")) as f:
    parity_overrides = json.load(f)["parity_overrides"]
extra = {"overrides": parity_overrides, "values": {"corp.it_swb_mode": 0}}

plain = m.run("C")
parity = m.run("C", extra)
out = {
    "sources": {s: sha256(s) for s in SOURCES},
    "order": m.order,
    "plain": [bits(plain[k]) for k in m.order],
    "parity": [bits(parity[k]) for k in m.order],
}
with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "run_c.json"), "w") as f:
    json.dump(out, f, separators=(",", ":"))
    f.write("\n")
print(f"run_c.json: {len(m.order)} cells x 2 runs")
