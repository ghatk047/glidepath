# @glidepath/parity

Parity harness for `@glidepath/engine` against the Python reference (tier2-logic/engine/PORTING.md §6).
The engine stays pure; this package loads the files.

- `pnpm parity:golden` (G3, ENG-06): compiles the spec for the seed tenant (`docs/spec/seed/aa`, members in
  file order), evaluates the five presets and compares the 760 values of
  `docs/spec/reference/golden_results.json` (1e-6 relative / 1e-9 absolute after Python `round(x, 6)`),
  then replays the 245 checks of `parity_report.json` with the replay table R01-R22 (1e-6 absolute).
  Writes `out/golden-report.json` and `out/replay-report.json` (git-ignored) and exits 1 on any miss,
  including a total other than 760 golden values or 245 checks (`EXPECTED_TOTALS`).
  Options: `--golden <file>`, `--parity-report <file>`, `--out <dir>`.
- `pnpm parity:fuzz` (G4, ENG-10): for each tenant, `aa` (`docs/spec/seed/aa`) and the synthetic `zz`
  (`tools/testkit/seed/zz`), draws 200 seeded vectors within the registry `min`/`max` (`int`, `bool`, `enum`
  on the `min + k * step` grid; vectors 0-99 re-draw 1-8 variables, 100-199 all 168 bounded ones; presets
  cycle `rates, A, B, C, D`) plus 100 edge vectors (a share of values on `min`, `max` or 0, the only way to
  make the reference raise). `fuzz_ref.py` runs them through the unchanged `docs/spec/reference/engine.py`
  (`python3 -I`, stdlib only, CPython >= 3.12, every input cast to float: PORTING.md D4), the TS engine runs
  the same inputs, and every node cell must agree within 1e-6 relative / 1e-9 absolute; a vector that
  raises in one engine must raise in the other (TS code matching the Python class, PORTING.md §5, same
  cell). Writes `out/fuzz-report.json` (seed, per-vector status, worst diffs) and `out/fuzz/` (vectors and
  oracle output); exits 1 on any miss, 2 when the harness fails (no Python, oracle crash). About 30 s.
  Options: `--tenant <aa|zz>` (repeatable), `--seed <n>`, `--vectors <n>`, `--edge <n>`, `--out <dir>`,
  `--python <exe>`, `--oracle <script>`.
- Tests: `golden.spec.ts` (760/760), `parity-replay.spec.ts` (245/245), `gate.spec.ts` (reports, exit code,
  expected totals), `round.spec.ts` (Python rounding), `fuzz.spec.ts` (G4 acceptance: the full fuzz run),
  `fuzz-vectors.spec.ts` (bounds, grid, determinism), `fuzz-compare.spec.ts` (tolerance, raise matching),
  `fuzz-oracle.spec.ts` (D4 cast, input errors, CLI exit codes).
