import type { Db } from '@glidepath/data-access';
import { Hono } from 'hono';
import { z } from 'zod';
import { ApiError } from '../app/problem';
import type { AppEnv } from '../app/tenant';
import { loadMe, loadTenants } from './memberships';
import { MAX_PASSKEY_LABEL, createPasskeyService } from './passkey';
import type { AuthCore } from './service';

/**
 * Auth routes (API-02 contract): `POST /api/auth/magic-link`, `GET /api/auth/callback`, `GET /api/me`,
 * `GET /api/tenants`, plus `POST /api/auth/logout`; and the passkey routes (API-03 contract
 * `POST /api/auth/passkey/*`): `register/options`, `register/verify`, `login/options`, `login/verify`. `/api/me` and `/api/tenants` answer with the
 * contract's `MeResponse` / `TenantsResponse`. The magic-link and callback routes are not in
 * `@glidepath/api-contract` yet; their wire shapes are defined here (MagicLinkRequest, MagicLinkAccepted).
 */

/** Body of `POST /api/auth/magic-link`. */
export const MagicLinkRequest = z.object({ email: z.string().trim().max(254).pipe(z.email()) });
export type MagicLinkRequest = z.infer<typeof MagicLinkRequest>;

/** 202 body of `POST /api/auth/magic-link`: the same for every address (no account oracle). */
export const MagicLinkAccepted = z.object({ status: z.literal('accepted') });
export type MagicLinkAccepted = z.infer<typeof MagicLinkAccepted>;

/** Where the callback sends the browser: the SPA, signed in, or told the link did not work. */
export const SIGNED_IN_REDIRECT = '/';
export const INVALID_LINK_REDIRECT = '/?auth=invalid-link';

/** A base64url field of a WebAuthn response (bounded: no authenticator sends more). */
const B64URL_MAX = 16_384;
const b64url = z
  .string()
  .min(1)
  .max(B64URL_MAX)
  .regex(/^[A-Za-z0-9_-]+$/, 'must be base64url');
const credentialBase = {
  id: b64url,
  rawId: b64url,
  type: z.literal('public-key'),
  authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
  clientExtensionResults: z.record(z.string(), z.unknown()).default({}),
};
const MAX_TRANSPORTS = 8;
const TRANSPORT_MAX = 32;

/** Body of `POST /api/auth/passkey/register/verify`: the browser's `RegistrationResponseJSON` and an optional label. */
export const PasskeyRegisterRequest = z.object({
  response: z.object({
    ...credentialBase,
    response: z.object({
      clientDataJSON: b64url,
      attestationObject: b64url,
      authenticatorData: b64url.optional(),
      transports: z.array(z.string().max(TRANSPORT_MAX)).max(MAX_TRANSPORTS).optional(),
      publicKeyAlgorithm: z.number().int().optional(),
      publicKey: b64url.optional(),
    }),
  }),
  label: z.string().trim().min(1).max(MAX_PASSKEY_LABEL).optional(),
});
export type PasskeyRegisterRequest = z.infer<typeof PasskeyRegisterRequest>;

/** 201 body of `POST /api/auth/passkey/register/verify`. */
export const PasskeyRegistered = z.object({
  status: z.literal('registered'),
  credentialId: z.string(),
});
export type PasskeyRegistered = z.infer<typeof PasskeyRegistered>;

/** Body of `POST /api/auth/passkey/login/verify`: the browser's `AuthenticationResponseJSON`. */
export const PasskeyLoginRequest = z.object({
  response: z.object({
    ...credentialBase,
    response: z.object({
      clientDataJSON: b64url,
      authenticatorData: b64url,
      signature: b64url,
      userHandle: b64url.optional(),
    }),
  }),
});
export type PasskeyLoginRequest = z.infer<typeof PasskeyLoginRequest>;

/** 200 body of `POST /api/auth/passkey/login/verify`; the session cookies are set as after a magic link. */
export const PasskeySignedIn = z.object({ status: z.literal('signed-in') });
export type PasskeySignedIn = z.infer<typeof PasskeySignedIn>;

const notConfigured = (): ApiError =>
  new ApiError({
    status: 503,
    title: 'Service unavailable',
    detail:
      'Sign-in by e-mail is not set up on this server (SMTP_URL and PUBLIC_BASE_URL). Tell an administrator.',
  });

export function authRoutes(core: AuthCore, db: Db): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  r.post('/api/auth/magic-link', async (c) => {
    const { email } = MagicLinkRequest.parse(await c.req.json());
    if (!core.canSendLinks) throw notConfigured();
    core.requestLink(email, c.get('log'));
    return c.json({ status: 'accepted' } satisfies MagicLinkAccepted, 202);
  });

  // A navigation from the mail client, so it answers with redirects, never problem JSON. The token is
  // in the query: it is not logged (the request log has the path only) and no Referer carries it on.
  r.get('/api/auth/callback', async (c) => {
    c.header('cache-control', 'no-store');
    c.header('referrer-policy', 'no-referrer');
    // Hono runs GET handlers for HEAD too: a link checker's HEAD must not use up the single-use token.
    if (c.req.raw.method === 'HEAD') return c.body(null, 204);
    const ok = await core.signIn(c, c.req.query('token') ?? '');
    return c.redirect(ok ? SIGNED_IN_REDIRECT : INVALID_LINK_REDIRECT, 303);
  });

  // Passkeys (API-03). Options answers are the WebAuthn JSON the browser passes to
  // navigator.credentials.create / .get (PublicKeyCredential.parseCreationOptionsFromJSON etc.).
  const passkeys = createPasskeyService(core, db);

  r.post('/api/auth/passkey/register/options', async (c) => {
    c.header('cache-control', 'no-store');
    return c.json(await passkeys.registrationOptions(c));
  });

  r.post('/api/auth/passkey/register/verify', async (c) => {
    const body = PasskeyRegisterRequest.parse(await c.req.json());
    c.header('cache-control', 'no-store');
    const { credentialId } = await passkeys.register(c, body.response, body.label ?? null);
    return c.json({ status: 'registered', credentialId } satisfies PasskeyRegistered, 201);
  });

  r.post('/api/auth/passkey/login/options', async (c) => {
    c.header('cache-control', 'no-store');
    return c.json(await passkeys.loginOptions(c));
  });

  r.post('/api/auth/passkey/login/verify', async (c) => {
    const body = PasskeyLoginRequest.parse(await c.req.json());
    c.header('cache-control', 'no-store');
    await passkeys.login(c, body.response);
    return c.json({ status: 'signed-in' } satisfies PasskeySignedIn);
  });

  r.post('/api/auth/logout', async (c) => {
    await core.signOut(c);
    c.header('cache-control', 'no-store');
    return c.body(null, 204);
  });

  r.get('/api/me', async (c) => {
    const s = await core.session(c);
    const me = s ? await loadMe(db, s.userId) : null;
    if (!me) throw ApiError.unauthenticated();
    c.header('cache-control', 'private, no-store');
    return c.json(me);
  });

  r.get('/api/tenants', async (c) => {
    const s = await core.session(c);
    if (!s) throw ApiError.unauthenticated();
    c.header('cache-control', 'private, no-store');
    return c.json(await loadTenants(db, s.userId));
  });

  return r;
}
