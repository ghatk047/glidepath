# ADR-025: Store workbooks and AI audit files in Postgres, not MinIO

## Context
The architecture (04 §5, 11) used MinIO for workbooks and AI audit files. During OPS-01 (23 Nov 2026) the official `minio/minio` image was no longer pullable from Docker Hub and quay.io requires a login. The alternatives are community forks we have not vetted. The files are small (workbooks of a few hundred KB to a few MB, AI audit JSON), and the owner will move the database to Neon, where a separate object store would be one more service to host.

## Decision
The `ObjectStore` port in `tier2-logic/data-access` (put/get/stream/list/delete, buckets as a key prefix) gets a Postgres adapter backed by a `stored_object` table (tenant_id, bucket, key, content_type, bytes bytea, sha256, size, created_at, expires_at) under RLS like every tenant table. It is the default. An S3 adapter stays possible behind the same port (`OBJECT_STORE=s3` + `S3_*` settings) but is not built for the demo. The compose stack has no `objects` service.

## Consequences
- One fewer container and network peer; nothing to pull from a third-party registry; backups are a single `pg_dump`.
- Works unchanged on Neon (bytea, no extensions). Row sizes stay well under limits for our file sizes; a 50 MB cap per object is enforced in the adapter.
- Tier separation is unchanged: only `data-access` touches the table; no storage URL leaves tier 2.
- Items changed: OPS-08 (remove `objects` from compose/.env/tests), DATA-07 (Postgres adapter), OPS-07 (backup is pg_dump only), FND-04 (no MinIO service container in CI).

## Status
Accepted (orchestrator, 2026-11-23). Reversible: switch the adapter.
