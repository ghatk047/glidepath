#!/usr/bin/env python3
"""Extract and validate the Glidepath backlog.

Reads every fenced ```yaml block in docs/backlog/<EPIC>.md, parses it with a small
built-in parser (stdlib only; the YAML is written in a deliberately flat style),
validates the item set and writes docs/backlog/items.json.

Flat YAML style accepted (one item per block):
    key: value                 bare scalar (int if all digits, else string)
    key: "text"                double-quoted string, JSON escapes
    key: [A, B, "c d"]         inline list (items bare or double-quoted, no nesting)
    key:                       followed by block-list lines
      - "text"                 one item per line, bare or double-quoted
Blank lines and lines starting with '#' are ignored.
Required fields are listed in FIELDS; the orchestrator may add OPTIONAL_FIELDS
(pr, merged_at, blocked_reason, escalated_to) while building.

Usage:
    python3 tools/backlog/extract.py            # validate + write docs/backlog/items.json
    python3 tools/backlog/extract.py --check    # validate only, also fail if items.json is stale
    python3 tools/backlog/extract.py --root DIR # repo root (default: two levels above this file)
Exit code 0 when valid, 1 on any validation error.
"""
import argparse
import json
import os
import re
import sys

FIELDS = ["id", "title", "epic", "milestone", "priority", "status", "stream", "model", "effort",
          "depends_on", "tier", "package", "contract", "inputs", "acceptance", "gates", "size", "notes"]
# optional fields the orchestrator may add while building (prompts/20 step 5)
OPTIONAL_FIELDS = ["pr", "merged_at", "blocked_reason", "escalated_to"]
REQUIRED_NONEMPTY = ["id", "title", "epic", "milestone", "priority", "status", "model", "effort", "tier",
                     "package", "contract", "inputs", "acceptance", "gates", "size"]
LIST_FIELDS = {"depends_on", "inputs", "acceptance", "gates"}
ENUMS = {
    "milestone": ["M0", "M1", "M2", "M3", "M4", "M5", "POST"],
    "priority": ["must", "should", "could"],
    "status": ["todo", "in_progress", "review", "done", "blocked"],
    "model": ["opus", "sonnet", "haiku"],
    "effort": ["low", "medium", "high", "xhigh", "max"],
    "size": ["S", "M"],
    "stream": ["A", "B", "C", "D"],
}
TIERS = {1, 2, 3, "contract", "ops"}
GATES = {f"G{i}" for i in range(1, 15)}
EPIC_FILES = ["FND", "OPS", "CON", "SPEC", "ENG", "DATA", "DOM", "API", "JOB", "SOL", "XL", "AI",
              "UI", "WEB", "MOD", "QA", "INT", "WIZ", "UIX"]
ID_RE = re.compile(r"^([A-Z]+)-(\d{2})$")
KEY_RE = re.compile(r"^([a-z_]+):(.*)$")
FENCE_OPEN = re.compile(r"^```yaml\s*$")
FENCE_CLOSE = re.compile(r"^```\s*$")


class ParseError(Exception):
    pass


def parse_scalar(raw, where):
    raw = raw.strip()
    if raw.startswith('"'):
        try:
            return json.loads(raw)
        except json.JSONDecodeError as e:
            raise ParseError(f"{where}: bad double-quoted string {raw[:40]!r}: {e}")
    if re.fullmatch(r"-?\d+", raw):
        return int(raw)
    return raw


def split_inline_list(body, where):
    items, buf, in_str, esc = [], "", False, False
    for ch in body:
        if in_str:
            buf += ch
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
        elif ch == '"':
            in_str = True
            buf += ch
        elif ch == ",":
            items.append(buf)
            buf = ""
        else:
            buf += ch
    if in_str:
        raise ParseError(f"{where}: unterminated string in inline list")
    if buf.strip():
        items.append(buf)
    return [parse_scalar(x, where) for x in items if x.strip()]


def parse_block(lines, where):
    item, key = {}, None
    for n, line in enumerate(lines, 1):
        loc = f"{where} line {n}"
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if line.startswith("  - ") or line.startswith("- "):
            if key is None or not isinstance(item.get(key), list):
                raise ParseError(f"{loc}: list item without a list key")
            item[key].append(parse_scalar(line.split("- ", 1)[1], loc))
            continue
        m = KEY_RE.match(line)
        if not m:
            raise ParseError(f"{loc}: cannot parse {line[:60]!r}")
        key, rest = m.group(1), m.group(2).strip()
        if key in item:
            raise ParseError(f"{loc}: duplicate key {key}")
        if rest == "":
            item[key] = []
        elif rest.startswith("["):
            if not rest.endswith("]"):
                raise ParseError(f"{loc}: inline list must close on the same line")
            item[key] = split_inline_list(rest[1:-1], loc)
        else:
            item[key] = parse_scalar(rest, loc)
    return item


def read_epic_file(path):
    blocks, cur, start = [], None, 0
    with open(path, encoding="utf-8") as f:
        for n, line in enumerate(f.read().splitlines(), 1):
            if cur is None and FENCE_OPEN.match(line):
                cur, start = [], n
            elif cur is not None and FENCE_CLOSE.match(line):
                blocks.append((start, cur))
                cur = None
            elif cur is not None:
                cur.append(line)
    if cur is not None:
        raise ParseError(f"{path}: unclosed yaml fence at line {start}")
    return [parse_block(b, f"{os.path.basename(path)} block@{s}") for s, b in blocks]


MS_RANK = {m: i for i, m in enumerate(ENUMS["milestone"])}
PRI_RANK = {"must": 0, "should": 1, "could": 2}


def validate(items):
    errors = []
    ids = {}
    for it in items:
        iid = it.get("id", "?")
        for k in FIELDS:
            if k not in it:
                errors.append(f"{iid}: missing field '{k}'")
        for k in it:
            if k not in FIELDS and k not in OPTIONAL_FIELDS:
                errors.append(f"{iid}: unknown field '{k}'")
        for k in REQUIRED_NONEMPTY:
            v = it.get(k)
            if v is None or v == "" or v == []:
                errors.append(f"{iid}: field '{k}' is empty")
        for k in LIST_FIELDS:
            if k in it and not isinstance(it[k], list):
                errors.append(f"{iid}: field '{k}' must be a list")
        for k, allowed in ENUMS.items():
            if k in it and it[k] not in allowed:
                errors.append(f"{iid}: {k}={it[k]!r} not in {allowed}")
        if it.get("status") == "blocked" and not it.get("blocked_reason"):
            errors.append(f"{iid}: status blocked needs blocked_reason")
        if it.get("tier") not in TIERS:
            errors.append(f"{iid}: tier={it.get('tier')!r} not in 1|2|3|contract|ops")
        for g in it.get("gates", []) or []:
            if g not in GATES:
                errors.append(f"{iid}: unknown gate {g}")
        m = ID_RE.match(str(iid))
        if not m:
            errors.append(f"{iid}: id must look like EPIC-NN")
        elif m.group(1) != it.get("epic"):
            errors.append(f"{iid}: id prefix does not match epic {it.get('epic')}")
        if iid in ids:
            errors.append(f"{iid}: duplicate id")
        ids[iid] = it
    for it in items:
        iid = it.get("id")
        for d in it.get("depends_on", []) or []:
            if d not in ids:
                errors.append(f"{iid}: depends_on {d} does not exist")
                continue
            if d == iid:
                errors.append(f"{iid}: depends on itself")
            dep = ids[d]
            if MS_RANK.get(dep.get("milestone"), 0) > MS_RANK.get(it.get("milestone"), 0):
                errors.append(f"{iid} ({it.get('milestone')}) depends on {d} in a later milestone ({dep.get('milestone')})")
            if PRI_RANK.get(dep.get("priority"), 0) > PRI_RANK.get(it.get("priority"), 0):
                errors.append(f"{iid} ({it.get('priority')}) depends on lower-priority {d} ({dep.get('priority')})")
    # cycle check (Kahn)
    indeg = {i: 0 for i in ids}
    users = {i: [] for i in ids}
    for it in items:
        for d in it.get("depends_on", []) or []:
            if d in ids:
                indeg[it["id"]] += 1
                users[d].append(it["id"])
    queue = [i for i, v in indeg.items() if v == 0]
    seen = 0
    while queue:
        i = queue.pop()
        seen += 1
        for u in users[i]:
            indeg[u] -= 1
            if indeg[u] == 0:
                queue.append(u)
    if seen != len(ids):
        stuck = {i for i, v in indeg.items() if v > 0}
        # trim items that are only downstream of a cycle: keep those with a user still in the set
        changed = True
        while changed:
            changed = False
            for i in list(stuck):
                if not any(u in stuck for u in users[i]):
                    stuck.discard(i)
                    changed = True
        errors.append(f"dependency cycle among: {', '.join(sorted(stuck)[:12])}")
    return errors


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--root", default=os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
    ap.add_argument("--check", action="store_true", help="validate only; fail if items.json is stale")
    args = ap.parse_args()
    bdir = os.path.join(args.root, "docs", "backlog")
    items, errors = [], []
    for epic in EPIC_FILES:
        path = os.path.join(bdir, f"{epic}.md")
        if not os.path.exists(path):
            errors.append(f"missing epic file {epic}.md")
            continue
        try:
            got = read_epic_file(path)
        except ParseError as e:
            errors.append(str(e))
            continue
        for it in got:
            if it.get("epic") != epic:
                errors.append(f"{it.get('id')}: in {epic}.md but epic={it.get('epic')}")
        items.extend(got)
    errors += validate(items)
    out_path = os.path.join(bdir, "items.json")
    ordered = [{**{k: it.get(k) for k in FIELDS}, **{k: it[k] for k in OPTIONAL_FIELDS if k in it}} for it in items]
    text = json.dumps(ordered, indent=2, ensure_ascii=False) + "\n"
    if args.check:
        current = open(out_path, encoding="utf-8").read() if os.path.exists(out_path) else ""
        if current != text:
            errors.append("docs/backlog/items.json is stale: run python3 tools/backlog/extract.py")
    if errors:
        for e in errors:
            print("ERROR", e, file=sys.stderr)
        print(f"{len(errors)} error(s) in {len(items)} items", file=sys.stderr)
        return 1
    if not args.check:
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(text)
    by_epic = {}
    for it in items:
        by_epic[it["epic"]] = by_epic.get(it["epic"], 0) + 1
    print(f"OK: {len(items)} items, " + ", ".join(f"{k} {v}" for k, v in by_epic.items()))
    print(("checked " if args.check else "wrote ") + os.path.relpath(out_path, args.root))
    return 0


if __name__ == "__main__":
    sys.exit(main())
