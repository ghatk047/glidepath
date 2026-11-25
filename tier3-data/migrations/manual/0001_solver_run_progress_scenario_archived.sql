-- MANUAL migration (ADR-023, docs/adr/ADR-023-manual-migrations.md). Not generated from schema.json: do not
-- drop it when regenerating. Runs after the generated files (0001_schema.sql, 0002_rls.sql) as the owner role.
--
-- GAP-03: solver_run gets job progress and cancel state (docs/architecture/03_engine_and_solvers.md section 4).
--   progress          fraction 0..1 reported by the solver's progress(fraction, note) callback
--   progress_note     last note of that callback
--   cancel_requested  set by tier 2 to cancel; the job's AbortSignal fires at the next batch
--   updated_at        last write to the row (kept by trigger)
-- Also: scenario.archived (CON-01 scenario schema has it; schema.json lacks it).
-- Both tables are tenant tables already covered by RLS and grants in 0002_rls.sql; new columns inherit them.

ALTER TABLE solver_run
  ADD COLUMN progress real NOT NULL DEFAULT 0 CONSTRAINT solver_run_progress_range CHECK (progress >= 0 AND progress <= 1),
  ADD COLUMN progress_note text,
  ADD COLUMN cancel_requested boolean NOT NULL DEFAULT false,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

CREATE FUNCTION solver_run_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

CREATE TRIGGER solver_run_updated_at BEFORE UPDATE ON solver_run
  FOR EACH ROW EXECUTE FUNCTION solver_run_touch_updated_at();

ALTER TABLE scenario ADD COLUMN archived boolean NOT NULL DEFAULT false;
