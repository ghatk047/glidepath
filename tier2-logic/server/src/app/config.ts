import { z } from 'zod';

/**
 * Configuration comes from environment variables only (CLAUDE.md rule 10, 12-factor, doc 11 §4).
 * The database is configured by DATABASE_URL alone (ADR-015): host, role, database and TLS are in the URL.
 * SESSION_IDLE_MIN and AI_MAX_TOKENS_PER_JOB are operational limits with defaults here (ADR-022).
 * SMTP_URL and AUTH_LINK_TTL_MIN configure magic-link sign-in (ADR-014, API-02); PUBLIC_BASE_URL is the
 * origin users open the app on: magic links point there, state-changing requests must come from it, and
 * an `http:` value turns the cookies' Secure attribute off for local plain-http runs.
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
  AUTH_LINK_TTL_MIN: intFromEnv('AUTH_LINK_TTL_MIN', DEFAULT_AUTH_LINK_TTL_MIN).pipe(
    z.number().max(MAX_AUTH_LINK_TTL_MIN, `AUTH_LINK_TTL_MIN must be at most ${MAX_AUTH_LINK_TTL_MIN}`),
  ),
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
  if (result.success) return result.data;

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
