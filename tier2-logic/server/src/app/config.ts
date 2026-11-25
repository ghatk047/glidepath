import { MembershipRole } from '@glidepath/api-contract';
import { z } from 'zod';
import { DEFAULT_IMPORT_MAX_BYTES } from '../routes/excel/limits';

/**
 * Configuration comes from environment variables only (CLAUDE.md rule 10, 12-factor, doc 11 §4).
 * The database is configured by DATABASE_URL alone (ADR-015): host, role, database and TLS are in the URL.
 * SESSION_IDLE_MIN and AI_MAX_TOKENS_PER_JOB are operational limits with defaults here (ADR-022).
 * SMTP_URL and AUTH_LINK_TTL_MIN configure magic-link sign-in (ADR-014, API-02); PUBLIC_BASE_URL is the
 * origin users open the app on: magic links point there, state-changing requests must come from it, and
 * an `http:` value turns the cookies' Secure attribute off for local plain-http runs.
 * CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD (both or neither) turn on sign-in by Cloudflare Access JWT (OPS-09);
 * ACCESS_AUTO_TENANTS, ACCESS_AUTO_ROLE and ACCESS_ALLOWED_DOMAINS shape the accounts it creates (auth/access.ts).
 */

const intFromEnv = (name: string, def: number, min = 1) =>
  z.preprocess(
    (v) => (v === undefined || v === '' ? def : typeof v === 'string' && /^-?\d+$/.test(v.trim()) ? Number(v) : v),
    z
      .number({ error: `${name} must be an integer` })
      .int(`${name} must be an integer`)
      .min(min, `${name} must be at least ${min}`),
  );

export const MIN_AUTH_SECRET_LENGTH = 16;
export const DEFAULT_PORT = 8080;
export const DEFAULT_SESSION_IDLE_MIN = 30;
export const DEFAULT_AI_MAX_TOKENS_PER_JOB = 200_000;
export const DEFAULT_AUTH_LINK_TTL_MIN = 15;
/** A sign-in link is a bearer credential in a mailbox: never valid for more than a day. */
export const MAX_AUTH_LINK_TTL_MIN = 24 * 60;

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const optionalText = z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().trim().optional());

/** A comma-separated list: trimmed, lower case, empty entries dropped. */
const csv = (name: string, item: RegExp, def: string) =>
  z.preprocess(
    (v) => (v === undefined || (typeof v === 'string' && v.trim() === '') ? def : v),
    z
      .string()
      .transform((v) => v.split(',').map((x) => x.trim().toLowerCase()).filter((x) => x !== ''))
      .refine((xs) => xs.every((x) => item.test(x)), `${name} must be a comma-separated list of ${item.source}`),
  );

/** `icy-recipe-ffdf.cloudflareaccess.com`, optionally with `https://` and a trailing slash. */
const TEAM_DOMAIN = /^(?:https:\/\/)?([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)\/?$/i;
const SLUG = /^[a-z0-9][a-z0-9_-]*$/;
const DOMAIN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
/** ACCESS_AUTO_TENANTS default: the first tenant (CLAUDE.md: AA is the first tenant). `none` turns auto-membership off. */
export const DEFAULT_ACCESS_AUTO_TENANTS = 'aa';
export const DEFAULT_ACCESS_AUTO_ROLE: MembershipRole = 'editor';

const required = (name: string) => z.string({ error: `${name} is required` }).trim().min(1, `${name} is required`);

export const ConfigSchema = z.object({
  DATABASE_URL: required('DATABASE_URL').refine((v) => {
    try {
      const p = new URL(v).protocol;
      return p === 'postgres:' || p === 'postgresql:';
    } catch {
      return false;
    }
  }, 'DATABASE_URL must be a postgres:// or postgresql:// URL'),
  AUTH_SECRET: required('AUTH_SECRET').min(
    MIN_AUTH_SECRET_LENGTH,
    `AUTH_SECRET must be at least ${MIN_AUTH_SECRET_LENGTH} characters`,
  ),
  PORT: intFromEnv('PORT', DEFAULT_PORT, 0).pipe(z.number().max(65535, 'PORT must be at most 65535')),
  LOG_LEVEL: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.enum(LOG_LEVELS, { error: `LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}` }).default('info'),
  ),
  PUBLIC_BASE_URL: z.preprocess((v) => (v === '' ? undefined : v), z.url('PUBLIC_BASE_URL must be a URL').optional()),
  SESSION_IDLE_MIN: intFromEnv('SESSION_IDLE_MIN', DEFAULT_SESSION_IDLE_MIN),
  AI_MAX_TOKENS_PER_JOB: intFromEnv('AI_MAX_TOKENS_PER_JOB', DEFAULT_AI_MAX_TOKENS_PER_JOB),
  /** Outgoing mail for magic links (`smtp://mail:1025` is mailpit). Unset: sign-in links cannot be sent (503). */
  SMTP_URL: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z
      .string()
      .refine((v) => {
        try {
          const p = new URL(v).protocol;
          return p === 'smtp:' || p === 'smtps:';
        } catch {
          return false;
        }
      }, 'SMTP_URL must be an smtp:// or smtps:// URL')
      .optional(),
  ),
  /** Largest workbook `POST imports` takes, in bytes (ADR-022); `importMaxBytes()` clamps it to the object store's own cap. */
  IMPORT_MAX_BYTES: intFromEnv('IMPORT_MAX_BYTES', DEFAULT_IMPORT_MAX_BYTES),
  /** pg-boss schema of the job queue (the worker's `JOB_QUEUE_SCHEMA`): the server sends jobs to it. */
  JOB_QUEUE_SCHEMA: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z
      .string()
      .regex(/^[a-z_][a-z0-9_]*$/, 'JOB_QUEUE_SCHEMA must be a lower-case SQL identifier')
      .default('pgboss'),
  ),
  AUTH_LINK_TTL_MIN: intFromEnv('AUTH_LINK_TTL_MIN', DEFAULT_AUTH_LINK_TTL_MIN).pipe(
    z.number().max(MAX_AUTH_LINK_TTL_MIN, `AUTH_LINK_TTL_MIN must be at most ${MAX_AUTH_LINK_TTL_MIN}`),
  ),
  /**
   * Cloudflare Access team domain (`<team>.cloudflareaccess.com`): the JWT issuer, and where its signing keys are
   * (`https://<team>/cdn-cgi/access/certs`). Normalised to `https://<host>`. Unset: no Access sign-in.
   */
  CF_ACCESS_TEAM_DOMAIN: optionalText.pipe(
    z
      .string()
      .regex(TEAM_DOMAIN, 'CF_ACCESS_TEAM_DOMAIN must be a host name such as <team>.cloudflareaccess.com')
      .transform((v) => `https://${TEAM_DOMAIN.exec(v)![1]!.toLowerCase()}`)
      .optional(),
  ),
  /** Application Audience (AUD) tag of the Access application: the JWT's `aud` must contain it. */
  CF_ACCESS_AUD: optionalText,
  /** Tenant slugs an Access-verified user with no membership joins (`none`: none). */
  ACCESS_AUTO_TENANTS: csv('ACCESS_AUTO_TENANTS', SLUG, DEFAULT_ACCESS_AUTO_TENANTS).transform((xs) =>
    xs.length === 1 && xs[0] === 'none' ? [] : xs,
  ),
  /** Role of those memberships. */
  ACCESS_AUTO_ROLE: z.preprocess(
    (v) => (v === undefined || v === '' ? DEFAULT_ACCESS_AUTO_ROLE : v),
    z.enum(MembershipRole.options, { error: `ACCESS_AUTO_ROLE must be one of ${MembershipRole.options.join(', ')}` }),
  ),
  /** Optional re-check of the address domain after Access (which enforces its own policy); empty: no re-check. */
  ACCESS_ALLOWED_DOMAINS: csv('ACCESS_ALLOWED_DOMAINS', DOMAIN, ''),
});

export type Config = z.infer<typeof ConfigSchema>;

/** Names of the variables the loader reads, in the order they are listed in errors. */
export const CONFIG_VARS = Object.keys(ConfigSchema.shape) as (keyof Config)[];

/**
 * Startup failure. `missing` lists variables that are unset or empty, `invalid` those that are set but
 * wrong. Messages never contain the values (they may be secrets).
 */
export class ConfigError extends Error {
  readonly missing: string[];
  readonly invalid: { name: string; message: string }[];

  constructor(missing: string[], invalid: { name: string; message: string }[]) {
    const parts: string[] = [];
    if (missing.length > 0) parts.push(`missing environment variables: ${missing.join(', ')}`);
    if (invalid.length > 0) {
      parts.push(`invalid environment variables: ${invalid.map((i) => `${i.name} (${i.message})`).join('; ')}`);
    }
    super(`Invalid configuration: ${parts.join('; ')}`);
    this.name = 'ConfigError';
    this.missing = missing;
    this.invalid = invalid;
  }
}

/** Reads and validates the environment. Throws {@link ConfigError} listing every problem at once. */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const picked: Record<string, string | undefined> = {};
  for (const name of CONFIG_VARS) picked[name] = env[name];
  const result = ConfigSchema.safeParse(picked);
  if (result.success) {
    // Access sign-in needs both the issuer and the audience: one without the other is a half-done setup.
    const { CF_ACCESS_TEAM_DOMAIN: team, CF_ACCESS_AUD: aud } = result.data;
    if (team && !aud) throw new ConfigError(['CF_ACCESS_AUD'], []);
    if (aud && !team) throw new ConfigError(['CF_ACCESS_TEAM_DOMAIN'], []);
    return result.data;
  }

  const missing = new Set<string>();
  const invalid = new Map<string, string>();
  for (const issue of result.error.issues) {
    const name = String(issue.path[0] ?? '');
    const raw = env[name];
    if (raw === undefined || raw.trim() === '') missing.add(name);
    else if (!invalid.has(name)) invalid.set(name, issue.message);
  }
  throw new ConfigError(
    [...missing],
    [...invalid].map(([name, message]) => ({ name, message })),
  );
}
