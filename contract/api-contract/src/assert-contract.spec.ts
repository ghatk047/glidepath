import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  ContractError,
  PROBLEM_CONTENT_TYPE,
  apiRoutes,
  assertContract,
  problemTypes,
  type ApiRouteId,
  type BundleResponse,
  type ChangesetConflict,
  type Problem,
  type RouteDef,
} from './index';
import { coreRouteFixtures } from './fixtures/core';
import { apiRouteFixtures, jobRouteFixtures } from './fixtures/jobs';

/** What a tier-2 route test holds: the `Response` of Hono's `app.request()`. */
const json = (body: unknown, status = 200, type = 'application/json; charset=UTF-8') =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': type } });
const problemJson = (body: object, status: number) => json(body, status, PROBLEM_CONTENT_TYPE);

const conflict = {
  type: problemTypes.versionConflict,
  title: 'Version conflict',
  status: 409,
  detail: 'Someone saved first.',
  serverVersion: 4,
  changesSince: [],
};

describe('assertContract(route, response) helper used by tier-2 route tests', () => {
  it.each(
    (Object.keys(apiRoutes) as ApiRouteId[]).filter(
      (id) => (apiRoutes[id] as RouteDef).responseType !== 'bytes',
    ),
  )('%s: the fixture response passes and comes back parsed', async (id) => {
    const def = apiRoutes[id];
    const fx = apiRouteFixtures[id] as { response: unknown };
    const body = await assertContract(id, json(fx.response, def.status));
    expect(body).toEqual(def.response.parse(fx.response));
  });

  it('returns the typed success body', async () => {
    const body = await assertContract('bundle', json(coreRouteFixtures.bundle.response));
    expectTypeOf(body).toEqualTypeOf<BundleResponse>();
    expect(body.modelVersion.semver).toBe('1.0.0');
  });

  it('fails on a wrong status, naming the route and showing the body', async () => {
    const err = await assertContract(
      'scenarios',
      problemJson({ title: 'Nope', status: 404, detail: 'No such tenant.' }, 404),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ContractError);
    expect(err).toMatchObject({ route: 'scenarios', part: 'status' });
    expect((err as Error).message).toContain('No such tenant.');
  });

  it('fails on a body that breaks the response schema', async () => {
    await expect(
      assertContract('scenarios', json({ scenarios: [{ id: 'sc-1' }] })),
    ).rejects.toMatchObject({ name: 'ContractError', part: 'response' });
  });

  it('fails on a success body that is not JSON or not labelled JSON', async () => {
    await expect(
      assertContract(
        'me',
        new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } }),
      ),
    ).rejects.toMatchObject({ part: 'response' });
    await expect(
      assertContract('me', json(coreRouteFixtures.me.response, 200, 'text/plain')),
    ).rejects.toMatchObject({ part: 'contentType' });
  });

  it('checks 201 for scenarioCreate', async () => {
    const fx = coreRouteFixtures.scenarioCreate.response;
    await expect(assertContract('scenarioCreate', json(fx, 200))).rejects.toMatchObject({
      part: 'status',
    });
    await expect(assertContract('scenarioCreate', json(fx, 201))).resolves.toMatchObject({
      kind: 'blend',
    });
  });

  it('with an error status: problem+json, Problem schema, body.status = HTTP status', async () => {
    const p = await assertContract(
      'scenarioInputs',
      problemJson(
        { type: problemTypes.notFound, title: 'Not found', status: 404, detail: 'No sc-x.' },
        404,
      ),
      404,
    );
    expectTypeOf(p).toEqualTypeOf<Problem>();
    expect(p.detail).toBe('No sc-x.');

    await expect(
      assertContract('scenarioInputs', json({ title: 'x', status: 404, detail: 'y' }, 404), 404),
    ).rejects.toMatchObject({ part: 'contentType' });
    await expect(
      assertContract(
        'scenarioInputs',
        problemJson({ title: 'x', status: 400, detail: 'y' }, 404),
        404,
      ),
    ).rejects.toMatchObject({ part: 'response' });
    await expect(
      assertContract('scenarioInputs', problemJson({ title: 'x', status: 404 }, 404), 404),
    ).rejects.toMatchObject({ part: 'response' });
  });

  it('uses the route error schema: 409 on changesetApply must be a ChangesetConflict', async () => {
    const c = await assertContract('changesetApply', problemJson(conflict, 409), 409);
    expectTypeOf(c).toEqualTypeOf<ChangesetConflict>();
    expect(c.serverVersion).toBe(4);
    const { serverVersion: _drop, ...plain } = conflict;
    void _drop;
    await expect(
      assertContract('changesetApply', problemJson(plain, 409), 409),
    ).rejects.toMatchObject({ part: 'response' });
  });

  it('given the success status explicitly, behaves like the 2-argument form', async () => {
    const body = await assertContract('me', json(coreRouteFixtures.me.response), 200);
    expect(body.user.email).toBe('owner@example.com');
  });
  it('fileDownload: a byte stream with a content type passes as FileDownload; JSON fails', async () => {
    const fx = jobRouteFixtures.fileDownload.response;
    const file = await assertContract(
      'fileDownload',
      new Response(fx.bytes, {
        headers: {
          'content-type': fx.contentType,
          'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fx.filename)}`,
        },
      }),
    );
    expect([...file.bytes]).toEqual([...fx.bytes]);
    expect(file.filename).toBe(fx.filename);
    expect(file.size).toBe(fx.size);
    await expect(assertContract('fileDownload', json({ bytes: [1, 2] }))).rejects.toMatchObject({
      part: 'contentType',
    });
    await expect(
      assertContract('fileDownload', new Response(fx.bytes, { headers: {} })),
    ).rejects.toMatchObject({ part: 'contentType' });
    const p = await assertContract(
      'fileDownload',
      problemJson({ title: 'Not found', status: 404, detail: 'No such file.' }, 404),
      404,
    );
    expect(p.detail).toBe('No such file.');
  });
});
