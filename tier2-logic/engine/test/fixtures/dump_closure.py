"""Dump the cdeps (upstream) and users (downstream) closures of 50 sampled keys of the reference Model.

Usage: python3 -I tier2-logic/engine/test/fixtures/dump_closure.py <repo>
Writes closure.json next to this script. The sample is fixed (random.Random(SEED)): 38 node cells, 10 input
keys, plus res.net and br.eps27. Cells are one random cell of each of 38 random nodes, so the sample covers
node kinds rather than the 415-line nodes that hold most cells. For each key:
  "up":   breadth-first levels of the closure over Model.cdeps (level 1 = the cell's cdeps), each level as
          [count, sha256 of the sorted keys joined by "\\n"];
  "down": the closure over Model.users in Model.order, as [count, sha256 of the keys joined by "\\n"].
Hashes keep the fixture small; the counts say which level differs. Regenerate when docs/spec or the seed changes.
Used by src/explain/queries.spec.ts (ENG-09).
"""
import hashlib, json, os, random, sys

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
SAMPLE_SEED = 20261204
N_CELLS, N_INPUTS = 38, 10
ALWAYS = ["res.net", "br.eps27"]


def sha256(rel):
    with open(os.path.join(repo, rel), "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def digest(keys):
    return [len(keys), hashlib.sha256("\n".join(keys).encode()).hexdigest()]


m = Model(os.path.join(repo, SPEC), os.path.join(repo, SEED))

# Keys some cell reads that are not cells: the input cells (AA has no dangling key).
inputs = sorted({d for ds in m.cdeps.values() for d in ds} - set(m.cells))
rng = random.Random(SAMPLE_SEED)
by_node = {}
for k in m.cells:
    if k not in ALWAYS:
        by_node.setdefault(k.split("[", 1)[0], []).append(k)
nodes = rng.sample(sorted(by_node), N_CELLS)
sample = [rng.choice(by_node[n]) for n in nodes] + rng.sample(inputs, N_INPUTS) + ALWAYS


def up_levels(key):
    seen, frontier, levels = {key}, [key], []
    while frontier:
        nxt = []
        for k in frontier:
            for d in m.cdeps.get(k, ()):
                if d not in seen:
                    seen.add(d)
                    nxt.append(d)
        if nxt:
            levels.append(sorted(nxt))
        frontier = nxt
    return levels


def down_closure(key):
    seen, stack = set(), [key]
    while stack:
        for u in m.users.get(stack.pop(), ()):
            if u not in seen:
                seen.add(u)
                stack.append(u)
    return [k for k in m.order if k in seen]


out = {
    "sources": {s: sha256(s) for s in SOURCES},
    "seed": SAMPLE_SEED,
    "sample": [
        {"cell": k, "up": [digest(level) for level in up_levels(k)], "down": digest(down_closure(k))}
        for k in sample
    ],
}
with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "closure.json"), "w") as f:
    json.dump(out, f, indent=1)
    f.write("\n")
print(f"closure.json: {len(sample)} keys")
