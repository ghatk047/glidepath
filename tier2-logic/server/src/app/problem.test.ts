import { PROBLEM_CONTENT_TYPE, Problem, problemTypes, toCellKey } from '@glidepath/api-contract';
import { HTTPException } from 'hono/http-exception';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from './app';
import { ApiError } from './problem';
import { AUTH_SECRET, UNREACHABLE_URL, captureLogger, unreachableDb } from './testing/fixtures';

function appWithRoutes() {
  const { logger, lines } = captureLogger();
  const app = createApp({ logger, db: unreachableDb() });
  app.get('/boom', () => {
    throw new Error(`connect to ${UNREACHABLE_URL} failed`);
  });
  app.get('/api-error', () => {
    throw new ApiError({
      status: 422,
      title: 'Changeset rejected',
      detail: 'Org_Map row sums to 95%.\nMake it 100%.',
      type: problemTypes.validation,
      violations: [
        {
          rule: 'VR01',
          cells: [toCellKey('org.dom_share', 'cio,data_analytics')],
          severity: 'error',
          message: 'Row sums to 95%.',
        },
      ],
    });
  });
  app.get('/zod', () => {
    z.object({ baseVersion: z.number() }).parse({ baseVersion: 'x' });
    return new Response('unreachable');
  });
  app.get('/http-exception', () => {
    throw new HTTPException(409, { message: 'stale' });
  });
  app.post('/json', async (c) => c.json(await c.req.json()));
  return { app, lines };
}

async function expectProblem(res: Response, status: number) {
  expect(res.status).toBe(status);
  expect(res.headers.get('content-type')).toContain(PROBLEM_CONTENT_TYPE);
  const body = Problem.parse(await res.json());
  expect(body.status).toBe(status);
  return body;
}

describe('errors map to RFC 9457 problem JSON per contract', () => {
  it('unknown route: 404 problem with instance', async () => {
    const { app } = appWithRoutes();
    const body = await expectProblem(await app.request('/nope'), 404);
    expect(body.type).toBe(problemTypes.notFound);
    expect(body.instance).toBe('/nope');
  });

  it('ApiError keeps status, type and violations and collapses detail to one line', async () => {
    const { app } = appWithRoutes();
    const body = await expectProblem(await app.request('/api-error'), 422);
    expect(body.type).toBe(problemTypes.validation);
    expect(body.detail).toBe('Org_Map row sums to 95%. Make it 100%.');
    expect(body.violations?.[0]?.rule).toBe('VR01');
  });

  it('ZodError becomes a 422 validation problem', async () => {
    const { app } = appWithRoutes();
    const body = await expectProblem(await app.request('/zod'), 422);
    expect(body.type).toBe(problemTypes.validation);
    expect(body.detail).toContain('baseVersion');
  });

  it('HTTPException keeps its status', async () => {
    const { app } = appWithRoutes();
    await expectProblem(await app.request('/http-exception'), 409);
  });

  it('malformed JSON body becomes a 400 bad-request problem', async () => {
    const { app } = appWithRoutes();
    const body = await expectProblem(
      await app.request('/json', { method: 'POST', body: '{nope', headers: { 'content-type': 'application/json' } }),
      400,
    );
    expect(body.type).toBe(problemTypes.badRequest);
  });

  it('unexpected errors become a generic 500 that leaks nothing, and are logged scrubbed', async () => {
    const { app, lines } = appWithRoutes();
    const body = await expectProblem(await app.request('/boom'), 500);
    expect(body.type).toBe(problemTypes.internal);
    expect(JSON.stringify(body)).not.toContain('postgres://');
    expect(lines.some((l) => l.includes('request failed'))).toBe(true);
    expect(lines.join('\n')).not.toContain(AUTH_SECRET);
    expect(lines.join('\n')).not.toContain(UNREACHABLE_URL);
  });
});
