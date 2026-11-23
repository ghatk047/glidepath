# @glidepath/parity

Parity harness for `@glidepath/engine` against the Python reference (tier2-logic/engine/PORTING.md §6).
The engine stays pure; this package loads the files.

- `pnpm parity:golden` (G3, ENG-06): compiles the spec for the seed tenant (`docs/spec/seed/aa`, members in
  file order), evaluates the five presets and compares the 760 values of
  `docs/spec/reference/golden_results.json` (1e-6 relative / 1e-9 absolute after Python `round(x, 6)`),
  then replays the 245 checks of `parity_report.json` with the replay table R01-R22 (1e-6 absolute).
  Writes `out/golden-report.json` and `out/replay-report.json` (git-ignored) and exits 1 on any miss.
  Options: `--golden <file>`, `--parity-report <file>`, `--out <dir>`.
- Tests: `golden.spec.ts` (760/760), `parity-replay.spec.ts` (245/245), `gate.spec.ts` (reports, exit code),
  `round.spec.ts` (Python rounding).
- Fuzz parity (G4, ENG-10) is not built yet.
