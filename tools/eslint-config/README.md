# @glidepath/eslint-config

Shared ESLint flat config for the monorepo (FND-02). The root `eslint.config.js` re-exports it, and
packages pick it up by ESLint's upward search, so they need no config of their own.

- Tier boundaries (02 §1) via `eslint-plugin-boundaries` (`boundaries/dependencies`), driven by `dependencyMatrix`.
- `pg` / `drizzle-*` only in `tier2-logic/data-access`.
- `no-magic-numbers` (allow-list default 0, 1, -1; `createConfig({ magicNumberAllow })`) in `engine`, `solvers`, `domain`, `excel` source, not tests.
- Airline strings (`AA`, `American`, `Sabre`, `DXC`, `Hyderabad`) only in seed folders, fixtures and docs.
- Tier 1: no hex colours or raw px outside `ui/src/tokens`; number formatting only in `ui/src/format` (reuses `formatLintConfig`).

Needs Node >= 22.18 (the config imports a `.ts` file, relying on native type stripping).
Tests: `src/lint-fixtures.spec.ts`.
