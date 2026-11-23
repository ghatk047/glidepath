-- MANUAL migration (ADR-023, docs/adr/ADR-023-manual-migrations.md). Not generated from schema.json: do not
-- drop it when regenerating. Runs after the generated files and manual 0001-0005 as the owner role.
--
-- OPS-09: sign-in through Cloudflare Access. Cloudflare has already verified the address (one-time PIN, limited to
-- the domains of the Access policy), so tier 2 creates the app_user for a verified address it has not seen before.
-- app_user is a global table and stays SELECT-only for glidepath_app (the G7 catalog rule for global tables); this
-- one SECURITY DEFINER function is the only way the app role adds a user. It can only insert a new address (never
-- change or delete a user, never choose the id) and returns the user's id, new or existing. It touches no tenant
-- table: memberships are written by tier 2 through withTenant, under row-level security as always.

CREATE FUNCTION access_provision_user(p_email citext, p_name text) RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_email IS NULL OR p_email::text !~ '^[^@[:space:]]+@[^@[:space:]]+$' OR length(p_email::text) > 254 THEN
    RAISE EXCEPTION 'access_provision_user: not an e-mail address' USING ERRCODE = '22023';
  END IF;
  INSERT INTO app_user (id, email, name)
    VALUES (gen_random_uuid(), p_email, coalesce(nullif(btrim(p_name), ''), p_email::text))
    ON CONFLICT (email) DO NOTHING
    RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM app_user WHERE email = p_email;
  END IF;
  RETURN v_id;
END
$$;

REVOKE ALL ON FUNCTION access_provision_user(citext, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION access_provision_user(citext, text) TO glidepath_app;
