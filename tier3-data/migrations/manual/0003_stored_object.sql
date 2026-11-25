-- MANUAL migration (ADR-023, ADR-025): stored_object, the Postgres backing of the ObjectStore port (DATA-07).
-- Buckets (exports, export-snapshots, imports, ai) are a column of the key space; no storage URL exists.
-- Tenant table under FORCE ROW LEVEL SECURITY like every tenant table (ADR-015): set app.tenant_id per transaction.

CREATE TABLE stored_object (
  tenant_id uuid NOT NULL,
  bucket text NOT NULL,
  key text NOT NULL,
  content_type text NOT NULL,
  bytes bytea NOT NULL,
  sha256 char(64) NOT NULL,
  size bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  CONSTRAINT stored_object_pkey PRIMARY KEY (tenant_id, bucket, key),
  CONSTRAINT stored_object_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenant (id),
  CONSTRAINT stored_object_bucket_check CHECK (bucket IN ('exports', 'export-snapshots', 'imports', 'ai')),
  CONSTRAINT stored_object_size_check CHECK (size >= 0 AND size <= 52428800 AND size = octet_length(bytes))
);

CREATE INDEX stored_object_expires_idx ON stored_object (expires_at) WHERE expires_at IS NOT NULL;

ALTER TABLE stored_object ENABLE ROW LEVEL SECURITY;
ALTER TABLE stored_object FORCE ROW LEVEL SECURITY;
-- rows of the tenant in app.tenant_id only; none when it is not set
CREATE POLICY tenant_isolation ON stored_object FOR ALL TO PUBLIC
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE stored_object TO glidepath_app;
