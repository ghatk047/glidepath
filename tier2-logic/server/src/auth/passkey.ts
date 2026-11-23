import type { UserId } from '@glidepath/api-contract';
import type { Db } from '@glidepath/data-access';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { COSEALG } from '@simplewebauthn/server/helpers';
import type { Context } from 'hono';
import { ApiError } from '../app/problem';
import {
  clearPasskeyChallengeCookie,
  readPasskeyChallengeCookie,
  setPasskeyChallengeCookie,
} from './cookies';
import { newSecret, safeEqual } from './crypto';
import type { AuthCore } from './service';
import { findPasskey, findUserById, insertPasskey, listPasskeys, usePasskey } from './store';

/**
 * Passkey sign-in (WebAuthn, ADR-014, API-03), next to the magic link, which stays the fallback.
 *
 * - Relying party: the RP id is PUBLIC_BASE_URL's host name and the only accepted origin is its origin.
 *   Without PUBLIC_BASE_URL there is no relying party and every passkey route answers 503.
 * - Ceremonies: `.../options` makes a fresh challenge and puts it, with its purpose, expiry and (for
 *   registration) the signed-in user, in a signed HttpOnly cookie scoped to `/api/auth/passkey`; the
 *   matching `.../verify` reads it back, clears it and accepts each challenge once (process-local
 *   memory of used challenges until they expire; the server is one process, ADR-001 compose stack).
 * - Registration needs a session (and its CSRF token, guard). The verified credential goes to the
 *   `passkey` table: credential id, user, COSE public key, signature counter, transports, label.
 * - Sign-in is discoverable (no user name asked): the credential id from the browser picks the passkey,
 *   the assertion is verified with its stored key, the counter moves forward in the same transaction
 *   that rotates the session (`AuthCore.startSession`), and the cookies are those of a magic-link sign-in.
 * - User verification is required: a passkey is the whole sign-in, not a second factor.
 */

/** Minutes a passkey challenge stays valid: a browser prompt, not a mailbox (operational, like SESSION_TTL_HOURS). */
export const PASSKEY_CHALLENGE_TTL_MIN = 5;
/** Shown by the authenticator as the relying party's name. */
export const RP_NAME = 'Glidepath';
/** Longest passkey label kept. */
export const MAX_PASSKEY_LABEL = 64;
/** COSE algorithms offered and accepted (WebAuthn protocol identifiers): ES256, EdDSA, RS256. */
const ALGORITHMS = [COSEALG.ES256, COSEALG.EdDSA, COSEALG.RS256];
const MS_PER_SECOND = 1_000;
const MS_PER_MINUTE = 60_000;

type Purpose = 'register' | 'login';

interface PendingCeremony {
  purpose: Purpose;
  challenge: string;
  expiresAt: number;
  userId: string;
}

const CHALLENGE_SHAPE = /^[A-Za-z0-9_-]{43}$/;

function encodeCeremony(p: PendingCeremony): string {
  return [p.purpose, p.challenge, String(p.expiresAt), p.userId].join('.');
}

function decodeCeremony(value: string | null): PendingCeremony | null {
  if (!value) return null;
  const [purpose, challenge, expiresAt, userId, ...rest] = value.split('.');
  if (rest.length > 0 || (purpose !== 'register' && purpose !== 'login')) return null;
  if (!challenge || !CHALLENGE_SHAPE.test(challenge)) return null;
  const exp = Number(expiresAt);
  if (!Number.isSafeInteger(exp)) return null;
  return { purpose, challenge, expiresAt: exp, userId: userId ?? '' };
}

/** The 16 bytes of a uuid: the WebAuthn user handle (never the e-mail address). */
export function userHandleFor(userId: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Buffer.from(userId.replace(/-/g, ''), 'hex'));
}

const notConfigured = (): ApiError =>
  new ApiError({
    status: 503,
    title: 'Service unavailable',
    detail:
      'Passkey sign-in is not set up on this server (PUBLIC_BASE_URL). Use a sign-in link instead.',
  });

const loginRefused = (): ApiError =>
  ApiError.unauthenticated(
    'This passkey could not sign you in. Try again, or ask for a sign-in link by e-mail.',
  );

const registrationRefused = (): ApiError =>
  ApiError.badRequest('This passkey could not be registered. Start again from the passkey button.');

export interface PasskeyService {
  registrationOptions(c: Context): Promise<PublicKeyCredentialCreationOptionsJSON>;
  register(
    c: Context,
    response: RegistrationResponseJSON,
    label: string | null,
  ): Promise<{ credentialId: string }>;
  loginOptions(c: Context): Promise<PublicKeyCredentialRequestOptionsJSON>;
  /** Verifies the assertion and signs the browser in; throws 401 otherwise. */
  login(c: Context, response: AuthenticationResponseJSON): Promise<UserId>;
}

export function createPasskeyService(core: AuthCore, db: Db): PasskeyService {
  const { settings, keys } = core;
  /** Challenges already presented to a verify route, until they expire (single use). */
  const used = new Map<string, number>();

  function relyingParty(): { rpId: string; origin: string } {
    if (!settings.rpId || !settings.publicOrigin) throw notConfigured();
    return { rpId: settings.rpId, origin: settings.publicOrigin };
  }

  /** Starts a ceremony; returns the challenge's bytes (the options carry them base64url-encoded). */
  async function begin(
    c: Context,
    purpose: Purpose,
    userId: string,
  ): Promise<Uint8Array<ArrayBuffer>> {
    const challenge = newSecret();
    const expiresAt = core.now().getTime() + PASSKEY_CHALLENGE_TTL_MIN * MS_PER_MINUTE;
    await setPasskeyChallengeCookie(
      c,
      settings,
      keys,
      encodeCeremony({ purpose, challenge, expiresAt, userId }),
      (PASSKEY_CHALLENGE_TTL_MIN * MS_PER_MINUTE) / MS_PER_SECOND,
    );
    return new Uint8Array(Buffer.from(challenge, 'base64url'));
  }

  /** The browser's pending ceremony of `purpose`, once: cleared and remembered as used. */
  async function take(c: Context, purpose: Purpose): Promise<PendingCeremony | null> {
    const p = decodeCeremony(await readPasskeyChallengeCookie(c, settings, keys));
    clearPasskeyChallengeCookie(c, settings);
    const now = core.now().getTime();
    for (const [ch, exp] of used) if (exp <= now) used.delete(ch);
    if (!p || p.purpose !== purpose || p.expiresAt <= now || used.has(p.challenge)) return null;
    used.set(p.challenge, p.expiresAt);
    return p;
  }

  async function signedInUser(c: Context): Promise<string> {
    const s = await core.session(c);
    if (!s) throw ApiError.unauthenticated('Sign in first, then add a passkey.');
    return s.userId;
  }

  return {
    async registrationOptions(c) {
      const { rpId } = relyingParty();
      const userId = await signedInUser(c);
      const user = await findUserById(db, userId);
      if (!user) throw ApiError.unauthenticated();
      const existing = await listPasskeys(db, userId);
      const challenge = await begin(c, 'register', userId);
      return generateRegistrationOptions({
        rpName: RP_NAME,
        rpID: rpId,
        userName: user.email,
        userDisplayName: user.name,
        userID: userHandleFor(userId),
        challenge,
        attestationType: 'none',
        excludeCredentials: existing.map((p) => ({
          id: p.credentialId,
          ...(p.transports ? { transports: p.transports } : {}),
        })),
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        supportedAlgorithmIDs: ALGORITHMS,
        timeout: PASSKEY_CHALLENGE_TTL_MIN * MS_PER_MINUTE,
      });
    },

    async register(c, response, label) {
      const { rpId, origin } = relyingParty();
      const userId = await signedInUser(c);
      const pending = await take(c, 'register');
      if (!pending || pending.userId !== userId) throw registrationRefused();
      let verified;
      try {
        verified = await verifyRegistrationResponse({
          response,
          expectedChallenge: pending.challenge,
          expectedOrigin: origin,
          expectedRPID: rpId,
          requireUserVerification: true,
          supportedAlgorithmIDs: ALGORITHMS,
        });
      } catch {
        throw registrationRefused();
      }
      if (!verified.verified) throw registrationRefused();
      const { credential } = verified.registrationInfo;
      const stored = await insertPasskey(db, {
        credentialId: credential.id,
        userId,
        publicKey: credential.publicKey,
        signCount: credential.counter,
        transports: credential.transports ?? response.response.transports ?? null,
        label,
        createdAt: core.now(),
      });
      if (!stored) {
        throw new ApiError({
          status: 409,
          title: 'Conflict',
          detail: 'This passkey is already registered.',
        });
      }
      return { credentialId: credential.id };
    },

    async loginOptions(c) {
      const { rpId } = relyingParty();
      const challenge = await begin(c, 'login', '');
      return generateAuthenticationOptions({
        rpID: rpId,
        challenge,
        userVerification: 'required',
        timeout: PASSKEY_CHALLENGE_TTL_MIN * MS_PER_MINUTE,
      });
    },

    async login(c, response) {
      const { rpId, origin } = relyingParty();
      const pending = await take(c, 'login');
      if (!pending) throw loginRefused();
      const passkey = await findPasskey(db, response.id);
      if (!passkey) throw loginRefused();
      // A discoverable credential reports its user handle: it must be the one stored with the key.
      const handle = response.response.userHandle;
      if (
        handle !== undefined &&
        !safeEqual(handle, Buffer.from(userHandleFor(passkey.userId)).toString('base64url'))
      )
        throw loginRefused();
      let newCount: number;
      try {
        const v = await verifyAuthenticationResponse({
          response,
          expectedChallenge: pending.challenge,
          expectedOrigin: origin,
          expectedRPID: rpId,
          requireUserVerification: true,
          credential: {
            id: passkey.credentialId,
            publicKey: passkey.publicKey,
            counter: passkey.signCount,
            ...(passkey.transports ? { transports: passkey.transports } : {}),
          },
        });
        if (!v.verified) throw loginRefused();
        newCount = v.authenticationInfo.newCounter;
      } catch {
        throw loginRefused();
      }
      const at = core.now();
      const ok = await core.startSession(c, (tx) =>
        usePasskey(tx, {
          credentialId: passkey.credentialId,
          expectedCount: passkey.signCount,
          newCount,
          at,
        }),
      );
      if (!ok) throw loginRefused();
      return passkey.userId as UserId;
    },
  };
}
