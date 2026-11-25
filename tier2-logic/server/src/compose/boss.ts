/**
 * The one module of the server that imports pg-boss (ADR-008), as the worker's `runtime/boss.ts`. pg-boss is the
 * job queue's own Postgres client (schema `pgboss`, job envelopes only: tenant, user and run ids, never tenant
 * rows), so the G13 rule "only data-access imports a database driver" needs an exemption for it. Tenant data is
 * still read and written only through `@glidepath/data-access`.
 * TODO(API-09 review): replace this disable with a `pg-boss` exemption for tier2-logic/server and
 * tier2-logic/worker in tools/eslint-config (outside this item's package).
 */
/* eslint-disable no-restricted-imports */
export { PgBoss } from 'pg-boss';
