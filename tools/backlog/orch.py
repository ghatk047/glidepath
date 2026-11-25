#!/usr/bin/env python3
"""Orchestrator helper for the Glidepath backlog (stdlib only).

    orch.py ready              ready items (all deps done, status todo), must first
    orch.py show ID            print the item's yaml block and following prose
    orch.py prompt ID          print a filled builder prompt (prompts/21_builder.md)
    orch.py set ID STATUS [key=value ...]   update status/optional fields, regen items.json
    orch.py summary            counts by status and milestone
"""
import json
import os
import re
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
BL = os.path.join(ROOT, "docs", "backlog")


def items():
    subprocess.run([sys.executable, os.path.join(ROOT, "tools/backlog/extract.py"), "--root", ROOT],
                   check=True, stdout=subprocess.DEVNULL)
    return json.load(open(os.path.join(BL, "items.json")))


def block(item_id):
    epic = item_id.split("-")[0]
    path = os.path.join(BL, f"{epic}.md")
    text = open(path).read()
    m = re.search(r"```yaml\nid: %s\n.*?```\n" % re.escape(item_id), text, re.S)
    if not m:
        sys.exit(f"{item_id} not found")
    return path, text, m


def scope(it):
    return re.split(r" \(| \+", it["package"])[0].strip().rstrip("/")


def overlaps(a, b):
    return a == b or a.startswith(b + "/") or b.startswith(a + "/")


def cmd_ready():
    its = items()
    by = {i["id"]: i for i in its}
    busy = [i for i in its if i["status"] in ("in_progress", "review")]
    out = []
    for i in its:
        if i["status"] != "todo" or i["milestone"] == "POST":
            continue
        if all(by[d]["status"] == "done" for d in i["depends_on"]):
            clash = [b["id"] for b in busy if overlaps(scope(i), scope(b))]
            out.append((i["priority"] != "must", i["milestone"], i["id"], i, clash))
    out.sort(key=lambda x: x[:3])
    print("in flight:", ", ".join(f'{b["id"]}({b["status"]})' for b in busy) or "-")
    for _, _, _, i, clash in out:
        c = f"  CONFLICT {clash}" if clash else ""
        print(f'{i["id"]:8} {i["milestone"]} {i["model"]:6}/{i["effort"]:6} {i["size"]} {scope(i):45} {i["title"][:60]}{c}')


def cmd_show(item_id):
    path, text, m = block(item_id)
    rest = text[m.end():]
    nxt = rest.find("```yaml")
    print(m.group(0) + (rest[:nxt] if nxt >= 0 else rest))


def cmd_prompt(item_id):
    its = {i["id"]: i for i in items()}
    it = its[item_id]
    path, text, m = block(item_id)
    tpl = open(os.path.join(ROOT, "docs/architecture/prompts/21_builder.md")).read()
    tpl = tpl.split("---", 1)[1]
    slug = re.sub(r"[^a-z0-9]+", "-", it["title"].lower()).strip("-")[:40]
    typ = {"ops": "chore", "contract": "feat"}.get(str(it["tier"]), "feat")
    gate_cmds = ", ".join(it["gates"])
    repl = {"{{tier}}": str(it["tier"]), "{{id}}": item_id, "{{slug}}": slug, "{{item_yaml}}": m.group(0).strip("`\n").replace("yaml\n", "", 1),
            "{{package}}": scope(it), "{{gate_commands}}": "gates " + gate_cmds, "{{type}}": typ,
            "{{scope}}": item_id.split("-")[0].lower(), "{{title}}": it["title"]}
    for k, v in repl.items():
        tpl = tpl.replace(k, v)
    print(tpl.strip())


def cmd_set(item_id, status, kv):
    path, text, m = block(item_id)
    blk = m.group(0)
    blk = re.sub(r"^status: .*$", f"status: {status}", blk, flags=re.M)
    for pair in kv:
        k, v = pair.split("=", 1)
        line = f'{k}: "{v}"'
        if re.search(rf"^{k}: .*$", blk, re.M):
            blk = re.sub(rf"^{k}: .*$", line, blk, flags=re.M)
        else:
            blk = blk[: blk.rfind("```")] + line + "\n```\n"
    open(path, "w").write(text[: m.start()] + blk + text[m.end():])
    items()
    print(f"{item_id} -> {status}")


def cmd_summary():
    its = items()
    from collections import Counter
    print(dict(Counter(i["status"] for i in its)))
    for ms in ["M0", "M1", "M2", "M3", "M4", "M5", "POST"]:
        c = Counter(i["status"] for i in its if i["milestone"] == ms)
        print(ms, dict(c))


if __name__ == "__main__":
    a = sys.argv[1:]
    {"ready": lambda: cmd_ready(), "show": lambda: cmd_show(a[1]), "prompt": lambda: cmd_prompt(a[1]),
     "set": lambda: cmd_set(a[1], a[2], a[3:]), "summary": lambda: cmd_summary()}[a[0]]()
