#!/usr/bin/env python3
"""adr-check: counts ADR files and required headings (stdlib only).

Usage: python3 docs/adr/adr-check.py   (exit 0 = pass)
"""
import re
import sys
import unittest
from pathlib import Path

DIR = Path(__file__).resolve().parent
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
        bad = [p.name for p in DIR.glob("ADR-*.md") if not FILE_RE.match(p.name)]
        self.assertEqual(bad, [], "bad file names")
        self.assertEqual(sorted(adr_files()), list(range(1, 25)))

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


if __name__ == "__main__":
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(AdrCheck)
    res = unittest.TextTestRunner(verbosity=2).run(suite)
    print(f"adr-check: {len(adr_files())} ADR files, required headings {HEADINGS}")
    sys.exit(0 if res.wasSuccessful() else 1)
