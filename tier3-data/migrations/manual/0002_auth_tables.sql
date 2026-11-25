-- MANUAL migration (ADR-023, docs/adr/ADR-023-manual-migrations.md). Not generated from schema.json: do not
-- drop it when regenerating. Runs after the generated files as the owner role.
--
-- GAP-04: authentication storage for ADR-014 (email magic link + passkey; tier 2 issues session cookies).
-- All three tables are GLOBAL (no tenant_id, like app_user): a user signs in before any tenant is chosen, and
-- roles come from tenant_membership afterwards. Hence no row-level security here; the grants below are the
-- whole access rule. A tenant-scoped auth table would need ENABLE+FORCE RLS and the tenant_isolation policy
-- of 0002_rls.sql (ADR-023 consequences).
-- Secrets are never stored: auth_token keeps a hash of the token.

-- Magic-link token: hashed, single-use (consumed_at set once, with UPDATE ... WHERE consumed_at IS NULL), expiring.
CREATE TABLE auth_token (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  token_hash text NOT NULL,
  email citext NOT NULL,
  user_id uuid,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_token_pkey PRIMARY KEY (id),
  CONSTRAINT auth_token_token_hash_key UNIQUE (token_hash),
  CONSTRAINT auth_token_user_id_fkey FOREIGN KEY (user_id) REFERENCES app_user (id) ON DELETE CASCADE
);
CREATE INDEX auth_token_expires_at_idx ON auth_token (expires_at);

CREATE TABLE auth_session (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_session_pkey PRIMARY KEY (id),
  CONSTRAINT auth_session_user_id_fkey FOREIGN KEY (user_id) REFERENCES app_user (id) ON DELETE CASCADE
);
CREATE INDEX auth_session_user_id_idx ON auth_session (user_id);
CREATE INDEX auth_session_expires_at_idx ON auth_session (expires_at);

CREATE TABLE passkey (
  credential_id text NOT NULL,
  user_id uuid NOT NULL,
  public_key bytea NOT NULL,
  sign_count bigint NOT NULL DEFAULT 0,
  transports text[],
  label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  CONSTRAINT passkey_pkey PRIMARY KEY (credential_id),
  CONSTRAINT passkey_user_id_fkey FOREIGN KEY (user_id) REFERENCES app_user (id) ON DELETE CASCADE
);
CREATE INDEX passkey_user_id_idx ON passkey (user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE auth_token TO glidepath_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE auth_session TO glidepath_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE passkey TO glidepath_app;
