# @glidepath/server

`logic` container: Hono REST + WebSocket, auth, tenancy, sessions.

Skeleton only: no feature code yet.

## API-01: server skeleton (`src/app`)

- `pnpm --filter @glidepath/server build` bundles `src/app/server.ts` to `dist/server.js` (`node dist/server.js`, listens on `PORT`, default 8080).
- Config is env only, validated with zod (`config.ts`): `DATABASE_URL` and `AUTH_SECRET` (min 16 chars) are required, `PORT`, `LOG_LEVEL`, `PUBLIC_BASE_URL`, `SESSION_IDLE_MIN`, `AI_MAX_TOKENS_PER_JOB` have defaults (ADR-022); `DB_POOL_MAX` / `DB_PREPARED_STATEMENTS` are optional DB tuning. Startup exits 1 listing every missing or invalid variable (never the values).
- `GET /healthz`: 200 when `select 1` answers within 2 s on the `DATABASE_URL` pool, otherwise a 503 problem.
- Errors are RFC 9457 problem JSON built with `@glidepath/api-contract` `Problem` (`problem.ts`): `ApiError`, zod errors (422), malformed JSON (400), unknown routes (404), anything else a generic 500.
- `/api/t/:tenant/*` (`tenant.ts`): authenticate (401), resolve membership (no membership: 404 problem), then run the handler inside `withTenant(tenantId, userId, fn)`; handlers use `c.get('tenant').tx`. Authentication, membership and `withTenant` are injected (`AppDeps`); defaults are stubs (nobody authenticated, no memberships, a local `set_config(..., true)` transaction) until API-02 and DATA-05.
- JSON logs (`logger.ts`) redact sensitive keys and scrub AUTH_SECRET, the DATABASE_URL and its password, URL userinfo and each request's cookie / authorization values.
