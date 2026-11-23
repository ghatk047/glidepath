import { LOG_LEVELS } from './config';
import type { LogLevel } from './config';

/**
 * Structured JSON logger that cannot leak secrets: sensitive keys are replaced, and the known secret
 * values (AUTH_SECRET, the DATABASE_URL password and URL) plus any `scheme://user:password@` are scrubbed
 * from every string, including error messages and stacks.
 */

export const REDACTED = '[redacted]';

/** Keys whose value is never logged, matched case-insensitively as a substring. */
const SENSITIVE_KEY = /cookie|authorization|password|passwd|secret|token|api[-_]?key|database_url/i;
/** Secrets shorter than this are not scrubbed from free text: they would mangle ordinary words. */
const MIN_SCRUB_LENGTH = 4;
const URL_USERINFO = /([a-z][a-z0-9+.-]*:\/\/[^\s:/@]*:)[^\s@/]*@/gi;

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  /** A logger with extra base fields and, optionally, extra exact values to scrub (e.g. one request's cookies). */
  child(fields: LogFields, extraSecrets?: readonly (string | undefined)[]): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  /** Receives one JSON line (no trailing newline). Defaults to stdout. */
  write?: (line: string) => void;
  /** Exact values to scrub from every logged string. */
  secrets?: readonly (string | undefined)[];
  /** Fields on every line. */
  base?: LogFields;
  now?: () => Date;
}

/** The exact secret strings to scrub, derived from the secret-bearing config values. */
export function secretsFrom(values: { AUTH_SECRET?: string; DATABASE_URL?: string; SMTP_URL?: string | undefined }): string[] {
  const out: string[] = [];
  if (values.AUTH_SECRET) out.push(values.AUTH_SECRET);
  for (const url of [values.DATABASE_URL, values.SMTP_URL]) {
    if (!url) continue;
    out.push(url);
    try {
      const u = new URL(url);
      if (u.password) out.push(u.password, decodeURIComponent(u.password));
    } catch {
      /* not a URL: only the raw string is scrubbed */
    }
  }
  return out;
}

function makeScrubber(secrets: readonly (string | undefined)[]): (s: string) => string {
  const list = [
    ...new Set(secrets.filter((s): s is string => typeof s === 'string' && s.length >= MIN_SCRUB_LENGTH)),
  ].sort((a, b) => b.length - a.length);
  return (s) => {
    let out = s;
    for (const secret of list) out = out.split(secret).join(REDACTED);
    return out.replace(URL_USERINFO, `$1${REDACTED}@`);
  };
}

export function createLogger(opts: LoggerOptions = {}): Logger {
  const secrets = opts.secrets ?? [];
  return build(opts, secrets, opts.base ?? {});
}

function build(opts: LoggerOptions, secrets: readonly (string | undefined)[], baseFields: LogFields): Logger {
  const threshold = LOG_LEVELS.indexOf(opts.level ?? 'info');
  const write = opts.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const scrub = makeScrubber(secrets);
  const now = opts.now ?? (() => new Date());

  const sanitize = (value: unknown, depth: number, seen: WeakSet<object>): unknown => {
    if (typeof value === 'string') return scrub(value);
    if (value === null || typeof value !== 'object') {
      if (typeof value === 'bigint') return value.toString();
      return typeof value === 'function' || typeof value === 'symbol' ? undefined : value;
    }
    if (depth > 6 || seen.has(value)) return '[truncated]';
    seen.add(value);
    if (value instanceof Error) {
      const e: Record<string, unknown> = { name: value.name, message: scrub(value.message) };
      if (value.stack) e.stack = scrub(value.stack);
      if (value.cause !== undefined) e.cause = sanitize(value.cause, depth + 1, seen);
      return e;
    }
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map((v) => sanitize(v, depth + 1, seen));
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[scrub(k)] = SENSITIVE_KEY.test(k) ? REDACTED : sanitize(v, depth + 1, seen);
    }
    return out;
  };

  const base = baseFields;
  {
    const emit = (level: Exclude<LogLevel, 'silent'>, msg: string, fields?: LogFields) => {
      if (LOG_LEVELS.indexOf(level) < threshold) return;
      const entry = sanitize({ ...base, ...fields }, 0, new WeakSet()) as Record<string, unknown>;
      // Reserved keys last so a field cannot overwrite them.
      write(scrub(JSON.stringify({ ...entry, level, time: now().toISOString(), msg: scrub(msg) })));
    };
    return {
      debug: (m, f) => emit('debug', m, f),
      info: (m, f) => emit('info', m, f),
      warn: (m, f) => emit('warn', m, f),
      error: (m, f) => emit('error', m, f),
      child: (f, extra) => build(opts, extra ? [...secrets, ...extra] : secrets, { ...base, ...f }),
    };
  }
}

/** The values of a Cookie / Authorization header, to scrub from one request's logs. */
export function requestSecrets(headers: { get(name: string): string | null }): string[] {
  const out: string[] = [];
  const cookie = headers.get('cookie');
  if (cookie) {
    out.push(cookie);
    for (const part of cookie.split(';')) {
      const value = part.slice(part.indexOf('=') + 1).trim();
      if (value) out.push(value, safeDecode(value));
    }
  }
  const auth = headers.get('authorization');
  if (auth) out.push(auth, auth.replace(/^\w+\s+/, ''));
  // Cloudflare Access JWT (OPS-09): a bearer credential like the cookie.
  const access = headers.get('cf-access-jwt-assertion');
  if (access) out.push(access);
  return out;
}

function safeDecode(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}
