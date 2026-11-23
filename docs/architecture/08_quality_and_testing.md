# 08 · Quality gates and testing

A backlog item is done only when its gates pass in CI. The orchestrator merges nothing red.

## 1. Gates

| Gate | What | Runs | Blocks merge |
|---|---|---|---|
| G1 Types and lint | `tsc --noEmit`, ESLint incl. boundaries, magic-number and airline-string rules | every PR | yes |
| G2 Unit | Vitest per package; coverage ≥ 90% lines for `engine`, `solvers`, `domain`, `excel` | every PR, affected packages only (Turborepo) | yes |
| G3 Golden parity | TS engine vs `golden_results.json`, 1e-6 relative | PRs touching spec, engine, db seed | yes |
| G4 Fuzz parity | 200 random vectors, TS vs Python reference | nightly + engine PRs | yes on engine PRs |
| G5 Solver acceptance | min-risk $143.0M / risk $42.0M / people levers unchanged; all-VP $148.1M; MC P(clear) C 0%, D 4.5% ± 1.5 pp seeded | solver PRs, nightly | yes |
| G6 Excel round trip | 8 named tests + LibreOffice and Excel-for-Mac fixtures | excel PRs | yes |
| G7 Tenancy | cross-tenant leak test (2 tenants, every route); RLS enabled on every tenant table (catalog query) | data-access/server PRs | yes |
| G13 Tier separation | boundary lint; `tools/tier-check` finds no tier 2 code or SQL in the web bundle; compose test: `web` container cannot resolve `db` or `objects` | every PR | yes |
| G14 Container | `docker compose up` from clean volumes reaches healthy with seed in < 3 min; multi-arch images build | infra PRs, nightly | yes |
| G8 Perf budget | engine benches (03 §5), preview round trip p95 < 25 ms over WS, commit p95 < 150 ms on seeded DB | engine/api PRs, nightly | yes at +30% |
| G9 E2E smoke | Playwright against the compose stack: load Cockpit C, drag target, switch scenario, edit a lever, undo | every PR (CI compose) | yes |
| G10 Demo storyline | Playwright runs the 11 beats of `ux/05_demo_storyline.md` and asserts the quoted numbers | nightly, and before freeze | yes for release |
| G11 Visual | Playwright screenshots of 8 modules × 2 themes × 2 widths vs approved baselines (pixel threshold), compared with `ux/screens/` on first approval | UI PRs | reviewer decides |
| G12 A11y | axe-core on each module, zero serious violations | UI PRs | yes |

## 2. Test data

- `testkit` exports the AA seed, golden results, a second synthetic tenant (`zz`, five VPs, different labor groups) for multi-tenant tests, and Excel fixtures.
- No real personal data. Seed users are fictitious.

## 3. Review

Every builder subagent's output is reviewed by a separate reviewer subagent (prompt in `prompts/30_reviewer.md`) before merge: checks acceptance criteria, contract adherence, gates, and the conventions in 02. The orchestrator resolves disagreements; for engine, solver, tenancy and tier-boundary items the orchestrator also reads the diff itself.

## 4. Running tests efficiently

Run only affected packages and only failing tests while fixing; full suite on merge to `main` and nightly. Playwright with `--trace off` unless debugging a failure.
