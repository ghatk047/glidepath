#!/usr/bin/env python3
"""adr-check: counts ADR files and required headings (stdlib only).

Usage: python3 docs/adr/adr-check.py              ADR files (FND-05)
       python3 docs/adr/adr-check.py --planning   docs/architecture/PLANNING_NOTES.md (FND-06)
Exit 0 = pass.
"""
import re
import sys
import unittest
from pathlib import Path

DIR = Path(__file__).resolve().parent
ROOT = DIR.parent.parent
PLANNING = ROOT / "docs/architecture/PLANNING_NOTES.md"
DELIVERY = ROOT / "docs/architecture/09_delivery_plan.md"
COVERAGE = ROOT / "docs/backlog/coverage.md"
HEADINGS = ["Context", "Decision", "Consequences", "Status"]
SLUGS_015_024 = {
    15: "database-portability", 16: "test-database", 17: "package-scope",
    18: "binding-split", 19: "domain-ports", 20: "engine-parity-gate",
    21: "view-models", 22: "env-settings", 23: "manual-migrations",
    24: "job-relay-polling",
}
FILE_RE = re.compile(r"^ADR-(\d{3})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$")


def adr_files():
    out = {}
    for p in sorted(DIR.glob("ADR-*.md")):
        m = FILE_RE.match(p.name)
        if m:
            out[int(m.group(1))] = (p, m.group(2))
    return out


def headings(path):
    return [h.strip() for h in re.findall(r"^##\s+(.+?)\s*$", path.read_text(), re.M)]


class AdrCheck(unittest.TestCase):
    def test_all_24_files_exist_with_valid_names(self):
        # 001-024 come from the architecture pack; later ADRs are appended with no gaps.
        bad = [p.name for p in DIR.glob("ADR-*.md") if not FILE_RE.match(p.name)]
        self.assertEqual(bad, [], "bad file names")
        nums = sorted(adr_files())
        self.assertGreaterEqual(len(nums), 24)
        self.assertEqual(nums, list(range(1, len(nums) + 1)))

    def test_adr_025_onward_have_required_headings(self):
        files = adr_files()
        for n in sorted(files):
            if n >= 25:
                self.assertEqual(headings(files[n][0]), HEADINGS, f"ADR-{n:03d}")

    def test_adr_001_to_014_have_required_headings(self):
        files = adr_files()
        for n in range(1, 15):
            self.assertEqual(headings(files[n][0]), HEADINGS, f"ADR-{n:03d}")

    def test_adr_015_to_024_have_required_headings(self):
        files = adr_files()
        for n in range(15, 25):
            self.assertEqual(headings(files[n][0]), HEADINGS, f"ADR-{n:03d}")

    def test_slugs_015_to_024_exact(self):
        files = adr_files()
        for n, slug in SLUGS_015_024.items():
            self.assertEqual(files[n][1], slug, f"ADR-{n:03d}")

    def test_title_and_status_line(self):
        for n, (p, _) in adr_files().items():
            text = p.read_text()
            self.assertTrue(text.startswith(f"# ADR-{n:03d}: "), p.name)
            status = text.split("## Status", 1)[1].strip().split()[0]
            self.assertIn(status, {"Accepted", "Proposed", "Superseded"}, p.name)

    def test_015_content(self):
        t = adr_files()[15][0].read_text()
        for needle in ["DATABASE_URL", "DATABASE_URL_MIGRATE", "sslmode=require",
                       "SET LOCAL", "superuser", "Neon"]:
            self.assertIn(needle, t)

    def test_016_content(self):
        t = adr_files()[16][0].read_text()
        for needle in ["TEST_DATABASE_URL", "tools/pg-local", "Testcontainers"]:
            self.assertIn(needle, t)



# ---------------------------------------------------------------- --planning (FND-06)

PLANNING_SECTIONS = [
    "ADR review", "Scaffold command summary", "Engine port plan",
    "Risk register", "Gaps", "Epic changes vs 10 §3",
]
ITEM_RE = re.compile(r"\b[A-Z]{2,4}-\d{2}\b")


def section(text, title, level="##"):
    """Body under the first heading at `level` that starts with `title`."""
    pat = re.compile(rf"^{level}\s+{re.escape(title)}.*?$(.*?)(?=^{level}\s|\Z)", re.M | re.S)
    m = pat.search(text)
    return m.group(1) if m else None


def table(body):
    """First markdown table in body as a list of dicts keyed by lower-case header."""
    rows = [ln.strip() for ln in body.splitlines() if ln.strip().startswith("|")]
    if len(rows) < 2:
        return []
    cells = lambda ln: [c.strip() for c in ln.strip("|").split("|")]
    head = [h.lower() for h in cells(rows[0])]
    return [dict(zip(head, cells(r))) for r in rows[2:]]


class PlanningCheck(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = PLANNING.read_text()

    def test_planning_sections(self):
        heads = [h.strip() for h in re.findall(r"^##\s+(.+?)\s*$", self.text, re.M)]
        for want in PLANNING_SECTIONS:
            self.assertTrue(any(h.startswith(want) for h in heads), f"missing section: {want}")
        rows = table(section(self.text, "ADR review"))
        by_adr = {r["adr"]: r for r in rows}
        for n in range(1, 15):
            r = by_adr.get(f"ADR-{n:03d}")
            self.assertIsNotNone(r, f"ADR review row ADR-{n:03d}")
            self.assertRegex(r["verdict"], r"^(Confirm|Change)\b", f"ADR-{n:03d} verdict")
            self.assertTrue(r["impact on dec 4"], f"ADR-{n:03d} impact on Dec 4")
            self.assertTrue(r["reason"], f"ADR-{n:03d} reason")
        eng = section(self.text, "Engine port plan")
        self.assertIn("tier2-logic/engine/PORTING.md", eng)
        self.assertIn("ENG-01", eng)
        self.assertTrue(table(section(self.text, "Scaffold command summary")), "scaffold table")
        self.assertTrue(table(section(self.text, "Epic changes vs 10 §3")), "epic changes table")

    def test_planning_risk_register(self):
        rows = table(section(self.text, "Risk register"))
        self.assertTrue(rows, "risk register table")
        for col in ("id", "risk", "owner", "earliest retire"):
            self.assertIn(col, rows[0], f"risk register column {col}")
        source_risks = [r["risk"] for r in table(section(DELIVERY.read_text(), "4. Risks"))]
        self.assertGreaterEqual(len(source_risks), 1, "09 §4 parsed")
        risk_text = [r["risk"] for r in rows]
        for want in source_risks:
            self.assertTrue(any(want in t for t in risk_text), f"09 §4 risk missing: {want}")
        for want in ("Thanksgiving", "Docker daemon", "Neon"):
            self.assertTrue(any(want in t for t in risk_text), f"extra risk missing: {want}")
        for r in rows:
            self.assertRegex(r["owner"], r"^[A-D]\b", f"{r['id']} owner stream")
            m = re.search(r"\d{4}-\d{2}-\d{2}", r["earliest retire"])
            self.assertIsNotNone(m, f"{r['id']} retire date")
            self.assertTrue("2026-11-24" <= m.group(0) <= "2026-12-03", f"{r['id']} date range")

    def test_planning_gaps(self):
        src = table(section(COVERAGE.read_text(), "Gaps found while writing the backlog"))
        self.assertTrue(src, "coverage.md gaps parsed")
        rows = {r["gap id"]: r for r in table(section(self.text, "Gaps"))}
        for i, g in enumerate(src, 1):
            gid = f"GAP-{i:02d}"
            self.assertIn(gid, rows, f"{gid} ({g['gap'][:40]}...)")
            fixed_by = set(ITEM_RE.findall(rows[gid]["fixed by"]))
            for item in ITEM_RE.findall(g["item"]):
                self.assertIn(item, fixed_by, f"{gid} fixed by {item}")


if __name__ == "__main__":
    case = PlanningCheck if "--planning" in sys.argv[1:] else AdrCheck
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(case)
    res = unittest.TextTestRunner(verbosity=2).run(suite)
    if case is AdrCheck:
        print(f"adr-check: {len(adr_files())} ADR files, required headings {HEADINGS}")
    else:
        print(f"adr-check --planning: {PLANNING.relative_to(ROOT)} sections {PLANNING_SECTIONS}")
    sys.exit(0 if res.wasSuccessful() else 1)
