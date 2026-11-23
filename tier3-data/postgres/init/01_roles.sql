-- LOCAL ONLY: role bootstrap for the local Postgres (DATA-02, ADR-015).
-- Runs as the bootstrap superuser, in the application database:
--   * docker compose: mounted at /docker-entrypoint-initdb.d of the db service (first start of an empty volume);
--   * tests:          pnpm pg:local start --init tier3-data/postgres/init
-- Neon: create the same two roles in Neon instead. Migrations never create roles;
-- tier3-data/migrations/0002_rls.sql checks glidepath_app and GRANTs to it. Create glidepath_app with
-- plain SQL (CREATE ROLE glidepath_app LOGIN NOBYPASSRLS PASSWORD ...) so it is not a member of a
-- privileged role; 0002_rls.sql warns when it is.
--
--   glidepath_owner  owns the database and every object; DATABASE_URL_MIGRATE (migrations, seed).
--   glidepath_app    runtime role of logic and worker; DATABASE_URL. Row-level security always applies.
--
-- Cluster-wide only (roles), so other test harnesses may run this file on its own before creating
-- their databases. 02_database_owner.sql hands the application database to the owner;
-- 03_role_passwords.sh sets the passwords from OWNER_DB_PASSWORD / APP_DB_PASSWORD (docker).
-- Plain SQL (no psql meta-commands) and idempotent: safe to run again, also from concurrent sessions.

-- Each role: created with its attributes, or put back to them if they drifted. Neither role is a
-- member of another role, and neither may bypass row-level security.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'glidepath_owner') THEN
    CREATE ROLE glidepath_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  ELSIF EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'glidepath_owner'
      AND (NOT rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
  ) THEN
    ALTER ROLE glidepath_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
EXCEPTION WHEN duplicate_object OR unique_violation THEN
  NULL; -- created by a concurrent session
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'glidepath_app') THEN
    CREATE ROLE glidepath_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  ELSIF EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'glidepath_app'
      AND (NOT rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
  ) THEN
    ALTER ROLE glidepath_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
EXCEPTION WHEN duplicate_object OR unique_violation THEN
  NULL;
END
$$;
