-- MANUAL migration (ADR-023, docs/adr/ADR-023-manual-migrations.md). Not generated from schema.json: do not
-- drop it when regenerating. Runs after the generated files and manual 0001-0004 as the owner role.
--
-- DATA-14: scenario.sort_order, the position of a preset in the tenant seed's scenarios.json. The seeder sets it
-- (and repairs it on a re-run); listScenarios orders by it, nulls last, so user scenarios (NULL) follow the presets.
-- scenario is a tenant table already covered by FORCE RLS and grants in 0002_rls.sql; the new column inherits them.
-- Backfill for databases seeded before this migration: the presets of the AA seed, in the order of
-- docs/spec/seed/aa/scenarios.json (rates, A, B, C, D). Other tenants' presets are set by their next seed run.

ALTER TABLE scenario ADD COLUMN sort_order integer;

UPDATE scenario s
   SET sort_order = o.pos
  FROM (VALUES ('rates', 0), ('A', 1), ('B', 2), ('C', 3), ('D', 4)) AS o(key, pos)
 WHERE s.kind = 'preset' AND s.key = o.key
   AND s.tenant_id IN (SELECT id FROM tenant WHERE slug = 'aa');
