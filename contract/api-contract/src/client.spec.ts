import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  ApiError,
  ContractError,
  PROBLEM_CONTENT_TYPE,
  apiRoutes,
  coreRoutes,
  createClient,
  jobRoutes,
  isChangesetConflict,
  problemTypes,
  type ApiRouteId,
  type RouteDef,
} from './index';
import { coreRouteFixtures } from './fixtures/core';
import { apiRouteFixtures, jobRouteFixtures } from './fixtures/jobs';

const BASE = 'http://tier2.test';
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

interface Seen {
  method: string;
  path: string;
  search: string;
  contentType: string | null;
  body: unknown;
}

type LooseFixture = { params?: object; query?: object; body?: unknown; response: unknown };
const fixtureOf = (id: ApiRouteId) => apiRouteFixtures[id] as LooseFixture;
const defOf = (id: ApiRouteId) => apiRoutes[id] as RouteDef;
type LooseCall = (args?: object) => Promise<unknown>;

/** Serves `response` (default: the route's fixture) on the route and records the request. */
function serve(id: ApiRouteId, response?: Response): Seen[] {
  const def = defOf(id);
  const seen: Seen[] = [];
  const method = def.method.toLowerCase() as 'get' | 'post' | 'patch' | 'delete';
  server.use(
    http[method](`${BASE}${def.path}`, async ({ request }) => {
      const url = new URL(request.url);
      const text = await request.text();
      seen.push({
        method: request.method,
        path: url.pathname,
        search: url.search,
        contentType: request.headers.get('content-type'),
        body: text ? JSON.parse(text) : undefined,
      });
      return (
        response ?? HttpResponse.json(fixtureOf(id).response as object, { status: def.status })
      );
    }),
  );
  return seen;
}

const expectedPath = (def: RouteDef, params: object = {}) =>
  def.path.replace(/:(\w+)/g, (_, k: string) =>
    encodeURIComponent(String((params as Record<string, unknown>)[k])),
  );

const problem = (status: number, extra: object = {}) =>
  HttpResponse.json(
    {
      type: problemTypes.notFound,
      title: 'Not found',
      status,
      detail: 'Scenario sc-x does not exist in this tenant.',
      ...extra,
    },
    { status, headers: { 'content-type': PROBLEM_CONTENT_TYPE } },
  );

describe('createClient(baseUrl, fetch) covers every route with zod-validated responses (msw)', () => {
  const routeIds = Object.keys(apiRoutes) as ApiRouteId[];
  const jsonRouteIds = routeIds.filter((id) => {
    const def = defOf(id);
    return def.requestType !== 'bytes' && def.responseType !== 'bytes';
  });

  it('has one method per route of apiRoutes, and apiRoutes holds every CON-01 and CON-03 route', () => {
    const client = createClient(BASE, fetch);
    expect(Object.keys(client).sort()).toEqual([...routeIds].sort());
    expect(Object.keys(coreRoutes).every((id) => id in apiRoutes)).toBe(true);
    expect(Object.keys(jobRoutes).every((id) => id in apiRoutes)).toBe(true);
    expect(Object.keys(apiRouteFixtures).sort()).toEqual([...routeIds].sort());
  });

  it.each(jsonRouteIds)(
    '%s: method, path, query and body on the wire; parsed response back',
    async (id) => {
      const def = defOf(id);
      const fx = fixtureOf(id);
      const seen = serve(id);
      const call = (createClient(`${BASE}/`, fetch) as unknown as Record<ApiRouteId, LooseCall>)[
        id
      ];

      const result = await call({ params: fx.params, query: fx.query, body: fx.body });

      expect(result).toEqual(def.response.parse(fx.response));
      expect(seen).toHaveLength(1);
      const req = seen[0]!;
      expect(req.method).toBe(def.method);
      expect(req.path).toBe(expectedPath(def, fx.params));
      const query = Object.fromEntries(
        Object.entries(fx.query ?? {}).map(([k, v]) => [k, String(v)]),
      );
      expect(Object.fromEntries(new URLSearchParams(req.search))).toEqual(query);
      if (def.body) {
        expect(req.contentType).toBe('application/json');
        expect(req.body).toEqual(def.body.parse(fx.body));
      } else {
        expect(req.body).toBeUndefined();
      }
    },
  );

  it('encodes a cell key path segment (nodes/:cell/explain)', async () => {
    const seen = serve('nodeExplain');
    const client = createClient(BASE, fetch);
    await client.nodeExplain({
      params: { tenant: 'zz', cell: 'hc.rate[pilots,fy27]' },
      query: { scenario: 'sc-custom-c' },
    });
    expect(seen[0]!.path).toBe('/api/t/zz/nodes/hc.rate%5Bpilots%2Cfy27%5D/explain');
  });

  it('returns typed, branded output (e.g. bundle variables keep spec ids verbatim)', async () => {
    serve('bundle');
    const bundle = await createClient(BASE, fetch).bundle({ params: { tenant: 'zz' } });
    expect(bundle.variables.map((v) => v.id)).toContain('g.target_net');
  });

  it('a success body that breaks the schema throws ContractError (response)', async () => {
    serve('bundle', HttpResponse.json({ modelVersion: { id: 'mv-1' } }));
    const err = await createClient(BASE, fetch)
      .bundle({ params: { tenant: 'zz' } })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ContractError);
    expect(err).toMatchObject({ route: 'bundle', part: 'response' });
  });

  it('an unexpected 2xx status throws ContractError (status)', async () => {
    serve('scenarios', new HttpResponse(null, { status: 204 }));
    const err = await createClient(BASE, fetch)
      .scenarios({ params: { tenant: 'zz' } })
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ name: 'ContractError', part: 'status' });
  });

  it('a request that breaks the schema is refused before fetch (ContractError params/body)', async () => {
    const seen = serve('changesetApply');
    const client = createClient(BASE, fetch);
    await expect(client.scenarios({ params: { tenant: '' } })).rejects.toMatchObject({
      name: 'ContractError',
      part: 'params',
    });
    await expect(
      client.changesetApply({
        params: { tenant: 'zz' },
        body: { scenarioId: 'sc-1', baseVersion: 0, changes: [] },
      }),
    ).rejects.toMatchObject({ name: 'ContractError', part: 'body' });
    expect(seen).toHaveLength(0);
  });

  it('a problem+json error throws ApiError with the parsed problem', async () => {
    serve('scenarioInputs', problem(404));
    const err = await createClient(BASE, fetch)
      .scenarioInputs({ params: { tenant: 'zz', id: 'sc-x' } })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    const api = err as ApiError;
    expect(api.status).toBe(404);
    expect(api.synthetic).toBe(false);
    expect(api.problem.detail).toBe('Scenario sc-x does not exist in this tenant.');
    expect(isChangesetConflict(api)).toBe(false);
  });

  it('409 on changesetApply parses as ChangesetConflict (serverVersion, changesSince)', async () => {
    serve(
      'changesetApply',
      problem(409, {
        type: problemTypes.versionConflict,
        title: 'Version conflict',
        detail: 'Someone saved first. Your edits were re-based.',
        serverVersion: 4,
        changesSince: [
          {
            seq: 0,
            target: 'variable',
            key: 'g.target_net',
            member: '',
            op: 'update',
            oldValue: 100,
            newValue: 120,
            changesetId: 'cs-8',
          },
        ],
      }),
    );
    const fx = coreRouteFixtures.changesetApply;
    const err = await createClient(BASE, fetch)
      .changesetApply({ params: fx.params, body: fx.body })
      .catch((e: unknown) => e);
    expect(isChangesetConflict(err)).toBe(true);
    if (!isChangesetConflict(err)) return;
    expect(err.problem.serverVersion).toBe(4);
    expect(err.problem.changesSince[0]?.changesetId).toBe('cs-8');
  });

  it('a non-problem error body still yields a one-line problem (synthetic)', async () => {
    serve(
      'me',
      new HttpResponse('<html>bad gateway</html>', {
        status: 502,
        statusText: 'Bad Gateway',
        headers: { 'content-type': 'text/html' },
      }),
    );
    const err = (await createClient(BASE, fetch)
      .me()
      .catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.synthetic).toBe(true);
    expect(err.problem).toMatchObject({ status: 502, title: 'Bad Gateway' });
    expect(err.problem.detail).not.toMatch(/\n/);
  });

  it('passes per-call headers and an abort signal through', async () => {
    const def = defOf('bundle');
    let ifNoneMatch: string | null = null;
    server.use(
      http.get(`${BASE}${def.path}`, ({ request }) => {
        ifNoneMatch = request.headers.get('if-none-match');
        return HttpResponse.json(coreRouteFixtures.bundle.response);
      }),
    );
    const client = createClient(BASE, fetch);
    await client.bundle({ params: { tenant: 'zz' }, headers: { 'if-none-match': '"b1"' } });
    expect(ifNoneMatch).toBe('"b1"');
    const ac = new AbortController();
    ac.abort();
    await expect(
      client.bundle({ params: { tenant: 'zz' }, signal: ac.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('fileDownload: a byte stream comes back as FileDownload (bytes, content type, filename, size)', async () => {
    const fx = jobRouteFixtures.fileDownload;
    let accept: string | null = null;
    server.use(
      http.get(`${BASE}${defOf('fileDownload').path}`, ({ request }) => {
        accept = request.headers.get('accept');
        return new HttpResponse(fx.response.bytes, {
          headers: {
            'content-type': fx.response.contentType,
            'content-disposition': `attachment; filename="${fx.response.filename}"`,
          },
        });
      }),
    );
    const file = await createClient(BASE, fetch).fileDownload({ params: fx.params });
    expect(file.bytes).toBeInstanceOf(Uint8Array);
    expect([...file.bytes]).toEqual([...fx.response.bytes]);
    expect(file).toMatchObject({
      contentType: fx.response.contentType,
      filename: fx.response.filename,
      size: fx.response.size,
    });
    expect(accept).toContain(PROBLEM_CONTENT_TYPE);
  });

  it('fileDownload: a JSON body where bytes are due breaks the contract; a 404 is an ApiError', async () => {
    const fx = jobRouteFixtures.fileDownload;
    serve('fileDownload', HttpResponse.json({ url: 'https://elsewhere.test/file' }));
    await expect(
      createClient(BASE, fetch).fileDownload({ params: fx.params }),
    ).rejects.toMatchObject({ name: 'ContractError', part: 'contentType' });
    server.resetHandlers();
    serve('fileDownload', problem(404));
    const err = await createClient(BASE, fetch)
      .fileDownload({ params: fx.params })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
  });

  it('importCreate: uploads raw bytes as application/octet-stream with the filename in the query', async () => {
    const fx = jobRouteFixtures.importCreate;
    let seen: { type: string | null; search: string; bytes: number[] } | undefined;
    server.use(
      http.post(`${BASE}${defOf('importCreate').path}`, async ({ request }) => {
        seen = {
          type: request.headers.get('content-type'),
          search: new URL(request.url).search,
          bytes: [...new Uint8Array(await request.arrayBuffer())],
        };
        return HttpResponse.json(fx.response, { status: 201 });
      }),
    );
    const job = await createClient(BASE, fetch).importCreate({
      params: fx.params,
      query: fx.query,
      body: fx.body,
    });
    expect(job).toEqual(apiRoutes.importCreate.response.parse(fx.response));
    expect(seen?.type).toBe('application/octet-stream');
    expect(Object.fromEntries(new URLSearchParams(seen?.search))).toEqual(fx.query);
    expect(seen?.bytes).toEqual([...fx.body]);
    await expect(
      createClient(BASE, fetch).importCreate({
        params: fx.params,
        query: fx.query,
        body: 'not bytes' as unknown as Uint8Array,
      }),
    ).rejects.toMatchObject({ name: 'ContractError', part: 'body' });
  });
});
