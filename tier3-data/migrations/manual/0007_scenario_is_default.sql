-- MANUAL migration (ADR-023, docs/adr/ADR-023-manual-migrations.md). Not generated from schema.json: do not
-- drop it when regenerating. Runs after the generated files and manual 0001-0006 as the owner role.
--
-- WEB-12: scenario.is_default, true for the preset named by `default_scenario` in the tenant seed's
-- scenarios.json. The seeder sets it on every run (compose `migrate --seed` re-seeds on each start), so no
-- backfill here. GET /api/t/:tenant/scenarios returns it as `defaultScenarioId`, where `/` sends the viewer.
-- scenario is a tenant table already covered by FORCE RLS and grants in 0002_rls.sql; the new column inherits them.

ALTER TABLE scenario ADD COLUMN is_default boolean NOT NULL DEFAULT false;
