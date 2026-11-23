import type { Config } from '../app/config';

/**
 * Auth settings, all from env through the app config (CLAUDE.md rule 10). No secret has a default.
 *
 * - `AUTH_SECRET` keys the cookie signature, the CSRF tokens and the stored hashes (crypto.ts).
 * - `PUBLIC_BASE_URL` is the one origin the app is served from: magic links point there and
 *   state-changing requests must carry it as `Origin`. Its scheme decides the cookies' Secure
 *   attribute: `https:` (or unset) sets it; `http:` (a local plain-http run, e.g.
 *   `PUBLIC_BASE_URL=http://localhost:5173`) leaves it off, since browsers drop Secure cookies there.
 * - `PUBLIC_BASE_URL` also names the passkey relying party (API-03): its host name is the RP id and its
 *   origin the only origin a passkey ceremony may come from.
 * - `AUTH_LINK_TTL_MIN`: minutes a magic link stays valid.
 * - `SMTP_URL`: where links are mailed (mailpit locally, ADR-014).
 */
export interface AuthSettings {
  readonly secret: string;
  /** Origin of PUBLIC_BASE_URL (`https://host[:port]`), or null when unset. */
  readonly publicOrigin: string | null;
  /** WebAuthn relying-party id: the host name of PUBLIC_BASE_URL (API-03), or null when unset. */
  readonly rpId: string | null;
  readonly cookieSecure: boolean;
  readonly linkTtlMin: number;
  /** Lifetime of a session from sign-in (absolute; the user signs in again after it). */
  readonly sessionTtlMs: number;
  readonly smtpUrl: string | null;
}

/**
 * Hours a sign-in lasts. An operational limit like the health-check timeout, not a business number;
 * make it an env setting (ADR-022 style) if it ever needs tuning per deployment.
 */
export const SESSION_TTL_HOURS = 12;
const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;

export function authSettingsFrom(
  config: Pick<Config, 'AUTH_SECRET' | 'PUBLIC_BASE_URL' | 'AUTH_LINK_TTL_MIN' | 'SMTP_URL'>,
): AuthSettings {
  const base = config.PUBLIC_BASE_URL ? new URL(config.PUBLIC_BASE_URL) : null;
  return {
    secret: config.AUTH_SECRET,
    publicOrigin: base ? base.origin : null,
    rpId: base ? base.hostname : null,
    cookieSecure: base?.protocol !== 'http:',
    linkTtlMin: config.AUTH_LINK_TTL_MIN,
    sessionTtlMs: SESSION_TTL_HOURS * MINUTES_PER_HOUR * MS_PER_MINUTE,
    smtpUrl: config.SMTP_URL ?? null,
  };
}

export const minutesToMs = (min: number): number => min * MS_PER_MINUTE;
