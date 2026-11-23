-- MANUAL migration (ADR-023, docs/adr/ADR-023-manual-migrations.md). Not generated from schema.json: do not
-- drop it when regenerating. Runs after the generated files and manual 0001-0003 as the owner role.
--
-- DATA-12 (G7): a tenant row can only reference rows of its own tenant. schema.json names these reference
-- columns without an FK, so a row of tenant A could carry an id of tenant B (found by the DATA-10 leak suite).
-- Foreign-key checks bypass row-level security, so every guard carries the tenant:
--   * composite (tenant_id, x) -> target (tenant_id, id) foreign keys, against new UNIQUE (tenant_id, id) keys
--     of scenario and changeset. DEFERRABLE INITIALLY DEFERRED: one write transaction (applyChangeset) may store
--     values before the changeset row they point at; the check runs at COMMIT (SET CONSTRAINTS ... IMMEDIATE
--     brings it forward). NO ACTION on delete: a referenced scenario or changeset cannot be deleted from under
--     its rows.
--   * restrictive same-tenant policies (checked on INSERT and UPDATE, like 0002_rls.sql *_same_tenant) where a
--     composite FK cannot express the rule:
--       source_id -> source           the target may be a global source (tenant_id NULL)
--       import_job.export_job_id      informational link from a workbook's _meta; export jobs are purged
--                                     (deleteExportJob) without touching the imports that came from them
--       export_job.scenario_ids       uuid[]: every element must be a scenario of the tenant
-- Not covered here (not references between tenant tables): created_by/actor/user_id (app_user, global),
-- model_version_id (global), change.changeset_id and line_item.source_id (already guarded by 0002_rls.sql).

ALTER TABLE scenario ADD CONSTRAINT scenario_tenant_id_id_key UNIQUE (tenant_id, id);
ALTER TABLE changeset ADD CONSTRAINT changeset_tenant_id_id_key UNIQUE (tenant_id, id);

ALTER TABLE scenario ADD CONSTRAINT scenario_parent_id_fkey
  FOREIGN KEY (tenant_id, parent_id) REFERENCES scenario (tenant_id, id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE variable_value ADD CONSTRAINT variable_value_changeset_id_fkey
  FOREIGN KEY (tenant_id, changeset_id) REFERENCES changeset (tenant_id, id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE scenario_value ADD CONSTRAINT scenario_value_scenario_id_fkey
  FOREIGN KEY (tenant_id, scenario_id) REFERENCES scenario (tenant_id, id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE scenario_value ADD CONSTRAINT scenario_value_changeset_id_fkey
  FOREIGN KEY (tenant_id, changeset_id) REFERENCES changeset (tenant_id, id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE node_override ADD CONSTRAINT node_override_scenario_id_fkey
  FOREIGN KEY (tenant_id, scenario_id) REFERENCES scenario (tenant_id, id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE market_snapshot ADD CONSTRAINT market_snapshot_applied_changeset_id_fkey
  FOREIGN KEY (tenant_id, applied_changeset_id) REFERENCES changeset (tenant_id, id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE changeset ADD CONSTRAINT changeset_scenario_id_fkey
  FOREIGN KEY (tenant_id, scenario_id) REFERENCES scenario (tenant_id, id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE changeset ADD CONSTRAINT changeset_reverts_id_fkey
  FOREIGN KEY (tenant_id, reverts_id) REFERENCES changeset (tenant_id, id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE import_job ADD CONSTRAINT import_job_changeset_id_fkey
  FOREIGN KEY (tenant_id, changeset_id) REFERENCES changeset (tenant_id, id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE calc_run ADD CONSTRAINT calc_run_scenario_id_fkey
  FOREIGN KEY (tenant_id, scenario_id) REFERENCES scenario (tenant_id, id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE solver_run ADD CONSTRAINT solver_run_scenario_id_fkey
  FOREIGN KEY (tenant_id, scenario_id) REFERENCES scenario (tenant_id, id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE solver_run ADD CONSTRAINT solver_run_result_scenario_id_fkey
  FOREIGN KEY (tenant_id, result_scenario_id) REFERENCES scenario (tenant_id, id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE ai_reconfig_job ADD CONSTRAINT ai_reconfig_job_changeset_id_fkey
  FOREIGN KEY (tenant_id, changeset_id) REFERENCES changeset (tenant_id, id) DEFERRABLE INITIALLY DEFERRED;

-- source_id must reference a source row of the same tenant or a global one
CREATE POLICY variable_value_source_id_same_tenant ON variable_value AS RESTRICTIVE FOR ALL TO PUBLIC
  USING (true)
  WITH CHECK (variable_value.source_id IS NULL OR EXISTS (SELECT 1 FROM source r WHERE r.id = variable_value.source_id AND (r.tenant_id = variable_value.tenant_id OR r.tenant_id IS NULL)));
CREATE POLICY market_snapshot_source_id_same_tenant ON market_snapshot AS RESTRICTIVE FOR ALL TO PUBLIC
  USING (true)
  WITH CHECK (EXISTS (SELECT 1 FROM source r WHERE r.id = market_snapshot.source_id AND (r.tenant_id = market_snapshot.tenant_id OR r.tenant_id IS NULL)));
-- export_job_id, when set, must be an export job of the same tenant
CREATE POLICY import_job_export_job_id_same_tenant ON import_job AS RESTRICTIVE FOR ALL TO PUBLIC
  USING (true)
  WITH CHECK (import_job.export_job_id IS NULL OR EXISTS (SELECT 1 FROM export_job r WHERE r.id = import_job.export_job_id AND r.tenant_id = import_job.tenant_id));
-- every element of scenario_ids must be a scenario of the same tenant
CREATE POLICY export_job_scenario_ids_same_tenant ON export_job AS RESTRICTIVE FOR ALL TO PUBLIC
  USING (true)
  WITH CHECK (NOT EXISTS (SELECT 1 FROM unnest(export_job.scenario_ids) s(id) WHERE NOT EXISTS (SELECT 1 FROM scenario r WHERE r.id = s.id AND r.tenant_id = export_job.tenant_id)));
