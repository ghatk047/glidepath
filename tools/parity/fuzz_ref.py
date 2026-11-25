"""Fuzz oracle (G4, ENG-10; tier2-logic/engine/PORTING.md §6 Fuzz): runs the unchanged reference engine on
the vectors drawn by `pnpm parity:fuzz`.

Usage: python3 -I tools/parity/fuzz_ref.py <spec_dir> <seed_dir> <vectors.json> <out.json>

Imports the unchanged docs/spec/reference/engine.py of this repository by path (stdlib only), loads
`Model(<spec_dir>, <seed_dir>)` once and, for each vector `{preset, values}` of `vectors.json`, runs
`Model.run(preset, {"values": values})`.

Every input value is cast to float before it reaches the engine: the tenant values, the preset values and
overrides, and the drawn values (PORTING.md D4). JSON integers would otherwise stay Python ints, which TS
cannot represent: CPython sum() adds an int term that follows a float without Neumaier compensation
(sum([1e16, 1, 1]) == 1e16), and unary minus of int 0 is int 0, where TS has -0.

Writes `{python, order, results}`: `order` is Model.order (every node cell), and `results[i]` is either
`{"values": [...]}` with the value of each cell of `order` (float repr; non-finite as the strings "nan",
"inf", "-inf"), or `{"error": {"type", "message", "cell"}}`: the Python exception class, its message and
the cell being computed (null when input resolution failed). A complex value in any cell is reported as
error type "complex" naming the first such cell in order (D5).
"""
import importlib.util
import json
import math
import os
import sys

MIN_PYTHON = (3, 12)  # sum() is Neumaier-compensated from 3.12 on (PORTING.md S06)
EXIT_USAGE = 2
EXIT_PYTHON = 3
MESSAGE_CHARS = 300
USAGE = "usage: python3 -I tools/parity/fuzz_ref.py <spec_dir> <seed_dir> <vectors.json> <out.json>"
REPO = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
ENGINE = os.path.join(REPO, "docs", "spec", "reference", "engine.py")


def load_engine():
    spec = importlib.util.spec_from_file_location("engine", ENGINE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def as_float(v):
    """A scalar or a {member_key: x} value with every number as a Python float."""
    if isinstance(v, dict):
        return {k: float(x) for k, x in v.items()}
    return float(v)


class Tracking(dict):
    """Model.cells that remembers the last key read: Model.run reads `self.cells[k]` once per computed
    cell, so after an exception `last` is the cell being computed (None: input resolution failed)."""

    last = None

    def __getitem__(self, key):
        self.last = key
        return dict.__getitem__(self, key)


def encode(x):
    x = float(x)
    if math.isnan(x):
        return "nan"
    if math.isinf(x):
        return "inf" if x > 0 else "-inf"
    return x


def run_vector(model, vector):
    values = {vid: as_float(v) for vid, v in vector["values"].items()}
    model.cells.last = None
    try:
        res = model.run(vector["preset"], {"values": values})
    except Exception as e:  # noqa: BLE001  (every exception class is reported to the comparison)
        error = {"type": type(e).__name__, "message": str(e)[:MESSAGE_CHARS], "cell": model.cells.last}
        return {"error": error}
    for k in model.order:
        if isinstance(res[k], complex):
            return {"error": {"type": "complex", "message": repr(res[k]), "cell": k}}
    return {"values": [encode(res[k]) for k in model.order]}


def main(argv):
    if len(argv) != 5:
        print(USAGE, file=sys.stderr)
        return EXIT_USAGE
    if sys.version_info < MIN_PYTHON:
        need = ".".join(map(str, MIN_PYTHON))
        print(f"fuzz_ref: CPython >= {need} required (sum() compensation), got {sys.version.split()[0]}", file=sys.stderr)
        return EXIT_PYTHON
    spec_dir, seed_dir, vectors_file, out_file = argv[1:]
    engine = load_engine()
    model = engine.Model(spec_dir, seed_dir)
    model.values = {vid: as_float(v) for vid, v in model.values.items()}
    for scenario in model.scenarios["scenarios"]:
        scenario["values"] = {vid: as_float(v) for vid, v in scenario.get("values", {}).items()}
        scenario["overrides"] = {k: float(x) for k, x in scenario.get("overrides", {}).items()}
    model.cells = Tracking(model.cells)
    with open(vectors_file) as f:
        vectors = json.load(f)["vectors"]
    out = {
        "python": sys.version.split()[0],
        "order": model.order,
        "results": [run_vector(model, v) for v in vectors],
    }
    with open(out_file, "w") as f:
        json.dump(out, f, allow_nan=False, separators=(",", ":"))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
