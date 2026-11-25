import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config';
import { startServer } from './start';

const valid = {
  DATABASE_URL: 'postgresql://glidepath_app:pw12345@db.example:5432/glidepath?sslmode=require',
  AUTH_SECRET: 'a-long-enough-secret-value',
};

describe('config', () => {
  it('reads config from env only with zod and applies the documented defaults', () => {
    const c = loadConfig(valid);
    expect(c.DATABASE_URL).toBe(valid.DATABASE_URL);
    expect(c.PORT).toBe(8080);
    expect(c.LOG_LEVEL).toBe('info');
    expect(c.SESSION_IDLE_MIN).toBeGreaterThan(0);
    expect(c.AI_MAX_TOKENS_PER_JOB).toBeGreaterThan(0);
    expect(loadConfig({ ...valid, PORT: '9090', LOG_LEVEL: 'debug', SESSION_IDLE_MIN: '45' })).toMatchObject({
      PORT: 9090,
      LOG_LEVEL: 'debug',
      SESSION_IDLE_MIN: 45,
    });
  });

  it('startup fails listing every missing variable', () => {
    let err: unknown;
    try {
      loadConfig({});
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ConfigError);
    expect((err as ConfigError).missing).toEqual(['DATABASE_URL', 'AUTH_SECRET']);
    expect((err as ConfigError).message).toContain('DATABASE_URL, AUTH_SECRET');
  });

  it('treats empty values as missing and reports invalid values without echoing them', () => {
    let err: ConfigError | undefined;
    try {
      loadConfig({ DATABASE_URL: '', AUTH_SECRET: 'short', PORT: 'abc', LOG_LEVEL: 'loud' });
    } catch (e) {
      err = e as ConfigError;
    }
    expect(err?.missing).toEqual(['DATABASE_URL']);
    expect(err?.invalid.map((i) => i.name)).toEqual(['AUTH_SECRET', 'PORT', 'LOG_LEVEL']);
    expect(err?.message).not.toContain('short');
    expect(err?.message).not.toContain('abc');
  });

  it('rejects a DATABASE_URL that is not postgres', () => {
    expect(() => loadConfig({ ...valid, DATABASE_URL: 'mysql://x/y' })).toThrow(/DATABASE_URL must be a postgres/);
  });

  it('startServer fails on missing variables before opening anything', async () => {
    await expect(startServer({})).rejects.toThrow(/missing environment variables: DATABASE_URL, AUTH_SECRET/);
  });
});
