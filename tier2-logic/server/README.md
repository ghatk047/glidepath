# @glidepath/server

`logic` container: Hono REST + WebSocket, auth, tenancy, sessions.

Server app (API-01), auth (API-02), read routes (API-04) and what-if sessions (API-06).

## API-01: server skeleton (`src/app`)

- `pnpm --filter @glidepath/server build` bundles `src/app/server.ts` to `dist/server.js` (`node dist/server.js`, listens on `PORT`, default 8080).
- Config is env only, validated with zod (`config.ts`): `DATABASE_URL` and `AUTH_SECRET` (min 16 chars) are required, `PORT`, `LOG_LEVEL`, `PUBLIC_BASE_URL`, `SESSION_IDLE_MIN`, `AI_MAX_TOKENS_PER_JOB` have defaults (ADR-022); `DB_POOL_MAX` / `DB_PREPARED_STATEMENTS` are optional DB tuning. Startup exits 1 listing every missing or invalid variable (never the values).
- `GET /healthz`: 200 when `select 1` answers within 2 s on the `DATABASE_URL` pool, otherwise a 503 problem.
- Errors are RFC 9457 problem JSON built with `@glidepath/api-contract` `Problem` (`problem.ts`): `ApiError`, zod errors (422), malformed JSON (400), unknown routes (404), anything else a generic 500.
- `/api/t/:tenant/*` (`tenant.ts`): authenticate (401), resolve membership (no membership: 404 problem), then run the handler inside `withTenant(tenantId, userId, fn)`; handlers use `c.get('tenant').tx`. Authentication, membership and `withTenant` are injected (`AppDeps`); the defaults are the cookie session of `AppDeps.auth` (else nobody), tenant_membership via DATA-05 `withUser` + `findMyMembership`, and data-access `withTenant`.
- JSON logs (`logger.ts`) redact sensitive keys and scrub AUTH_SECRET, the DATABASE_URL and its password, URL userinfo and each request's cookie / authorization values.

## API-02: auth (`src/auth`)

Magic-link sign-in (ADR-014), cookie sessions, roles from `tenant_membership`. `start.ts` builds it with `authFromConfig(config, { db })` and passes it to `createApp` as `auth`.

| Route | Answer |
|---|---|
| `POST /api/auth/magic-link` `{ email }` | `202 { status: 'accepted' }` for every address (no account oracle); 422 bad address; 503 when `SMTP_URL` or `PUBLIC_BASE_URL` is unset. For an existing `app_user` the mail is queued after the answer. |
| `GET /api/auth/callback?token=` | Consumes the token, rotates the session, sets the cookies, `303 /`; unknown, used or expired: `303 /?auth=invalid-link`, no cookie. `HEAD` does not consume. |
| `POST /api/auth/logout` | Deletes the session, clears both cookies, 204. |
| `GET /api/me`, `GET /api/tenants` | Contract `MeResponse` / `TenantsResponse` (`withUser`: only the caller's memberships), `private, no-store`; 401 without a session. |

- Env: `AUTH_SECRET` (HKDF-derived keys for the cookie signature, CSRF tokens and stored hashes), `PUBLIC_BASE_URL` (link target and the one allowed `Origin`; an `http:` value turns Secure off for local plain-http runs), `SMTP_URL` (`smtp://mail:1025` = mailpit), `AUTH_LINK_TTL_MIN` (default 15, max 1440). Sessions last `SESSION_TTL_HOURS` (12) from sign-in.
- Stored: `auth_token.token_hash` = HMAC of the 256-bit token; `auth_session.id` = uuid from the HMAC of the 256-bit session secret. The secret only lives in the cookie. Single use is one `UPDATE ... WHERE consumed_at IS NULL AND expires_at > now RETURNING`; sign-in voids the address's other links; at most 5 live links per address (advisory lock per address).
- Cookies: `__Host-gp_session` (`gp_session` on plain http): HttpOnly, Secure, SameSite=Lax, Path=/, value signed (Hono signed cookie). `gp_csrf`: the session's CSRF token, readable by the SPA, which sends it back as `x-csrf-token`.
- Guards: on `/api/*`, every state-changing method needs `Origin` = PUBLIC_BASE_URL's origin (or, without `Origin`, `Sec-Fetch-Site: same-origin`), and, with a session, the CSRF header (403 problem otherwise). On `/api/t/:tenant/*`, state-changing methods need role owner or editor (`tenantWriteGuard`, deny by default); `requireRole(...)` narrows a route further (e.g. owner only).
- For API-06 (WS): `auth.session(c)` / `auth.authenticate(c)` read the cookie; `isSameOrigin(headers, allowedOrigin(settings, url))` checks the handshake.
- Tests (`src/auth/*.pg.test.ts`) run on a testkit database as `glidepath_app`, with an in-process SMTP sink (`testing/smtp-sink.ts`) as `SMTP_URL`.

## API-03: passkeys (`src/auth/passkey.ts`)

WebAuthn via `@simplewebauthn/server`; the magic link stays the fallback. RP id = host name of `PUBLIC_BASE_URL`, accepted origin = its origin; without it every passkey route answers 503.

| Route | Answer |
|---|---|
| `POST /api/auth/passkey/register/options` | Session required (401; CSRF as usual). `PublicKeyCredentialCreationOptionsJSON`: resident key and user verification required, the user's passkeys excluded, user handle = the user's uuid bytes. |
| `POST /api/auth/passkey/register/verify` `{ response, label? }` | `201 { status: 'registered', credentialId }`; row in `passkey` (COSE key, counter, transports, label). 400 unverifiable, 409 already registered. |
| `POST /api/auth/passkey/login/options` | `PublicKeyCredentialRequestOptionsJSON`, discoverable (no `allowCredentials`). |
| `POST /api/auth/passkey/login/verify` `{ response }` | `200 { status: 'signed-in' }` with the same session rotation and cookies as the magic-link callback; counter and `last_used_at` move in the same transaction. 401 problem pointing at the sign-in link otherwise. |

- Challenge: 32 random bytes in a signed cookie (`__Secure-gp_passkey`, HttpOnly, SameSite=Strict, Path=/api/auth/passkey, `PASSKEY_CHALLENGE_TTL_MIN` = 5) with its purpose, expiry and, for registration, the user; cleared on verify and accepted once (used challenges are remembered in-process until they expire).
- Tests: `passkey.pg.test.ts` with a software authenticator (`testing/virtual-authenticator.ts`, ES256, "none" attestation).
## API-06: what-if sessions (`src/session`)

`WS /ws/session?tenant&scenario`: the handshake checks origin, the session cookie, membership and the scenario before upgrading; each connection is a `Session(user, tenant, scenario)` on a `CompiledModel` from the `ModelCache` keyed `(tenant, model_version, members_hash)`. `subscribe` → `snapshot`, `preview` → coalesced `rerun` on a scratch copy → `delta` of the subscribed cells that changed, `cancelPreview`, `open`. Previews run no SQL. `startServer` builds the hub (`createSessionHub` + `dbScenarioLoader`, one spec source shared with the bundle route), mounts it on the app (`AppDeps.sessions`) and on the server's `upgrade` event, and closes it on shutdown. Details: `src/session/README.md`. Bench (G8): `pnpm --filter @glidepath/server bench` (`ws.preview`).
