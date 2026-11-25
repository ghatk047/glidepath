-- LOCAL ONLY (DATA-02, ADR-015): the owner role owns the application database, as on Neon, so it
-- may create the trusted extension citext and objects in schema public (PostgreSQL 15+ grants no
-- CREATE on public to PUBLIC). Acts on the database it runs in: POSTGRES_DB in docker compose, the
-- --db database of pg-local. Needs 01_roles.sql first. Idempotent.
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I OWNER TO glidepath_owner', current_database());
END
$$;
