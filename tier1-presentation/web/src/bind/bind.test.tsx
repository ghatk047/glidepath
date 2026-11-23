// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  ScenarioId,
  TenantSlug,
  WS_PROTOCOL_VERSION,
  apiRoutes,
  type Change,
  type ChangesetResult,
} from '@glidepath/api-contract';
import {
  coreRouteFixtures,
  createMockSession,
  presetSnapshot,
  specFixtures,
  viewMessageFixtures,
} from '@glidepath/api-contract/testing';
import { fmt } from '@glidepath/ui/format';
import { formatByUnit } from '@glidepath/ui/inputs/slider';
import { DataProvider, createDataClient, createServerState } from '../data';
import { createSessionClient } from '../session';
import {
  BindProvider,
  BoundEditable,
  BoundSlider,
  Value,
  useNode,
  useTrace,
  useVariable,
  useView,
  type BoundNode,
  type BoundVariable,
  type CommitChange,
} from './index';

const BASE = 'http://tier2.test';
const tenant = TenantSlug.parse(specFixtures.tenant);
const C = presetSnapshot('C');
const D = presetSnapshot('D');
const scenarioId = ScenarioId.parse(C.scenarioId);

// Spec ids used verbatim; values always read from the generated fixtures.
const LEVER = 'lev.L10.shelf'; // decision slider, C and D differ
const ESTIMATE = 'lev.L06.tool'; // estimate slider
const OUTPUT = 'res.net';
const bundleVar = (id: string) => specFixtures.bundle.variables.find((v) => v.id === id)!;
const FIXED = specFixtures.bundle.variables.find(
  (v) => !v.scenarioVaries && v.dims.length === 0 && `${v.id}[]` in C.cells,
)!;

/** `GET /scenarios/:id/inputs` body built from a preset snapshot's input cells. */
function inputsBody(snapshot: typeof C) {
  const vars = new Map(specFixtures.bundle.variables.map((v) => [v.id, v]));
  const inputs = Object.entries(snapshot.cells).flatMap(([cell, value]) => {
    const m = /^(.*)\[(.*)\]$/.exec(cell)!;
    const def = vars.get(m[1]!);
    if (!def) return [];
    return [
      {
        var: m[1]!,
        member: m[2]!,
        value,
        from: def.scenarioVaries ? 'scenario' : 'tenant',
        fromScenarioId: def.scenarioVaries ? snapshot.scenarioId : null,
        confidence: null,
        note: null,
      },
    ];
  });
  return { scenarioId: snapshot.scenarioId, version: snapshot.version, inputs, overrides: [] };
}

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());

interface Served {
  hits: Map<string, number>;
  posted: unknown[];
}

function serve(): Served {
  const hits = new Map<string, number>();
  const posted: unknown[] = [];
  const count = (k: string) => hits.set(k, (hits.get(k) ?? 0) + 1);
  const inputs: Record<string, unknown> = {
    [C.scenarioId]: inputsBody(C),
    [D.scenarioId]: inputsBody(D),
  };
  server.use(
    http.get(`${BASE}${apiRoutes.bundle.path}`, () => {
      count('bundle');
      return HttpResponse.json(specFixtures.bundle);
    }),
    http.get(`${BASE}${apiRoutes.scenarios.path}`, () => {
      count('scenarios');
      return HttpResponse.json(specFixtures.scenarios);
    }),
    http.get(`${BASE}${apiRoutes.scenarioInputs.path}`, ({ params }) => {
      const id = String(params['id']);
      count(`inputs:${id}`);
      return inputs[id]
        ? HttpResponse.json(inputs[id])
        : HttpResponse.json(inputsBody({ ...C, scenarioId: id, cells: {} }));
    }),
    http.get(`${BASE}${apiRoutes.nodeExplain.path}`, ({ params }) => {
      count(`explain:${String(params['cell'])}`);
      return HttpResponse.json(coreRouteFixtures.nodeExplain.response);
    }),
    http.post(`${BASE}${apiRoutes.changesetApply.path}`, async ({ request }) => {
      posted.push(await request.json());
      return HttpResponse.json(coreRouteFixtures.changesetApply.response);
    }),
  );
  return { hits, posted };
}

/** Session client on the contract's mock session, frames applied by `settle()`. */
async function setup(opts: { commit?: CommitChange; onTrace?: (cell: string) => void } = {}) {
  const served = serve();
  const mock = createMockSession({
    views: [viewMessageFixtures.bridge, viewMessageFixtures['baseline.groups']],
  });
  const frames: (() => void)[] = [];
  const session = createSessionClient({
    tenant,
    scenario: scenarioId,
    origin: 'ws://localhost:8080',
    connect: mock.connect,
    requestFrame: (cb) => void frames.push(cb),
    random: () => 0,
  });
  const settle = async () => {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
      await mock.flush();
    });
    act(() => {
      for (const cb of frames.splice(0)) cb();
    });
  };
  const serverState = createServerState();
  const client = createDataClient({ baseUrl: BASE });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DataProvider client={client} serverState={serverState}>
      <BindProvider
        tenant={tenant}
        scenarioId={scenarioId}
        session={session}
        commit={opts.commit}
        onTrace={opts.onTrace}
      >
        {children}
      </BindProvider>
    </DataProvider>
  );
  await settle();
  return { ...served, mock, session, settle, wrapper };
}

const delta = (cells: Record<string, number | null>) => ({
  v: WS_PROTOCOL_VERSION as 1,
  type: 'delta' as const,
  seq: null,
  cells,
});

describe('AC1: useNode', () => {
  it('useNode(id, member?) subscribes on mount, unsubscribes on unmount, re-renders on change', async () => {
    const t = await setup();
    const seen: { current: BoundNode | null; renders: number } = { current: null, renders: 0 };
    const Probe = () => {
      seen.current = useNode(OUTPUT);
      seen.renders += 1;
      return null;
    };
    const view = render(<Probe />, { wrapper: t.wrapper });
    await t.settle();

    // Subscribed on mount; the session pushed the cell.
    expect(t.mock.subscribed.has(`${OUTPUT}[]`)).toBe(true);
    expect(seen.current).toMatchObject({
      id: OUTPUT,
      member: '',
      cell: `${OUTPUT}[]`,
      value: C.cells[`${OUTPUT}[]`],
      stale: false,
    });
    await waitFor(() => expect(seen.current?.def?.id).toBe(OUTPUT));
    expect(seen.current?.def?.unit).toBe(
      specFixtures.bundle.nodes.find((n) => n.id === OUTPUT)!.unit,
    );

    // A pushed change re-renders with tier 2's value; an unrelated cell does not.
    const before = seen.renders;
    const next = (C.cells[`${OUTPUT}[]`] as number) + 1;
    await t.mock.replay([delta({ [`${OUTPUT}[]`]: next })]);
    await t.settle();
    expect(seen.current?.value).toBe(next);
    expect(seen.renders).toBeGreaterThan(before);
    const settled = seen.renders;
    await t.mock.replay([delta({ 'res.bar[]': 1 })]);
    await t.settle();
    expect(seen.renders).toBe(settled);

    // Unmount releases the subscription.
    view.unmount();
    await t.settle();
    expect(t.mock.subscribed.has(`${OUTPUT}[]`)).toBe(false);
    expect(t.mock.sentOf('unsubscribe').flatMap((m) => m.cells)).toContain(`${OUTPUT}[]`);
  });

  it('a member is part of the cell key (`id[member]`)', async () => {
    const t = await setup();
    const cell = Object.keys(C.cells).find((k) => k.startsWith('lev.iy['))!;
    const member = /\[(.*)\]$/.exec(cell)![1]!;
    let got: BoundNode | null = null;
    const Probe = () => {
      got = useNode('lev.iy', member);
      return null;
    };
    render(<Probe />, { wrapper: t.wrapper });
    await t.settle();
    expect(t.mock.subscribed.has(cell)).toBe(true);
    expect(got!.value).toBe(C.cells[cell]);
  });
});

describe('AC2: useVariable', () => {
  it('useVariable(id, member?) returns the definition from the bundle (label, unit, min, max, step, kind, source, confidence, default), current value, preview(v), commit(v)', async () => {
    const t = await setup();
    const seen: { lever: BoundVariable | null; fixed: BoundVariable | null } = {
      lever: null,
      fixed: null,
    };
    const Probe = () => {
      seen.lever = useVariable(LEVER);
      seen.fixed = useVariable(FIXED.id);
      return null;
    };
    render(<Probe />, { wrapper: t.wrapper });
    await t.settle();
    await waitFor(() => expect(seen.lever?.definition).toBeDefined());
    await waitFor(() => expect(seen.lever?.from).toBeDefined());

    const def = bundleVar(LEVER);
    expect(seen.lever!.definition).toEqual({
      label: def.label,
      unit: def.unit,
      min: def.min,
      max: def.max,
      step: def.step,
      kind: def.kind,
      source: def.source,
      confidence: def.confidence,
      default: null, // the scenario sets it itself: tier 2 sent no tenant default
    });
    expect(seen.lever!.value).toBe(C.cells[`${LEVER}[]`]);
    expect(seen.lever!.from).toBe('scenario');
    // A value resolved from the tenant layer is the tenant default.
    expect(seen.fixed!.definition?.default).toBe(C.cells[`${FIXED.id}[]`]);

    // preview(v) -> session `preview` frame (intent only; no local math).
    const target = D.cells[`${LEVER}[]`] as number;
    act(() => seen.lever!.preview(target));
    await t.settle();
    expect(t.mock.sentOf('preview').flatMap((m) => m.changes)).toContainEqual({
      var: LEVER,
      member: '',
      value: target,
    });

    // commit(v) -> POST /changesets on the session's version, then cancelPreview.
    let result: ChangesetResult | undefined;
    await act(async () => {
      result = await seen.lever!.commit(target);
    });
    expect(t.posted).toEqual([
      {
        scenarioId: C.scenarioId,
        baseVersion: C.version,
        changes: [{ target: 'variable', key: LEVER, member: '', value: target }],
      },
    ]);
    expect(result?.changesetId).toBe(coreRouteFixtures.changesetApply.response.changesetId);
    await t.settle();
    expect(t.mock.sentOf('cancelPreview').length).toBeGreaterThan(0);
  });

  it('commit(v) goes through the provider commit when one is given (WEB-05 queue)', async () => {
    const commit = vi.fn<CommitChange>(
      async () => coreRouteFixtures.changesetApply.response as unknown as ChangesetResult,
    );
    const t = await setup({ commit });
    let v: BoundVariable | null = null;
    const Probe = () => {
      v = useVariable(LEVER);
      return null;
    };
    render(<Probe />, { wrapper: t.wrapper });
    await t.settle();
    await act(async () => void (await v!.commit(null, 'back to inherited')));
    const change: Change = {
      target: 'variable',
      key: LEVER as Change['key'],
      member: '' as Change['member'],
      value: null,
      note: 'back to inherited',
    } as Change;
    expect(commit).toHaveBeenCalledWith(change);
    expect(t.posted).toEqual([]);
  });
});

describe('AC3: bound wrappers', () => {
  it('bound wrappers compose ui components; ghost ticks read C and D values from tier 2 scenario inputs', async () => {
    const t = await setup();
    render(<BoundSlider variable={LEVER} ghosts={['C', 'D']} />, { wrapper: t.wrapper });
    await t.settle();
    const def = bundleVar(LEVER);
    const slider = await screen.findByRole('slider', { name: def.label });
    expect(slider).toHaveProperty('value', String(C.cells[`${LEVER}[]`]));
    expect(slider.getAttribute('min')).toBe(String(def.min));
    expect(slider.getAttribute('max')).toBe(String(def.max));
    expect(slider.closest('[data-variant]')?.getAttribute('data-variant')).toBe('decision');

    // Ghosts come from GET /scenarios/:id/inputs of C and D (not from the session).
    const ghostC = inputsBody(C).inputs.find((i) => i.var === LEVER)!.value as number;
    const ghostD = inputsBody(D).inputs.find((i) => i.var === LEVER)!.value as number;
    const text = (v: number) => formatByUnit(v, def.unit, def.step!);
    await waitFor(() =>
      expect(
        screen.getByText(`Reference marks: C ${text(ghostC)}, D ${text(ghostD)}`),
      ).toBeTruthy(),
    );
    expect(t.hits.get(`inputs:${D.scenarioId}`)).toBeGreaterThan(0);

    // Release -> commit of the moved value; drag -> preview.
    fireEvent.change(slider, { target: { value: String(ghostD) } });
    fireEvent.pointerUp(slider);
    await t.settle();
    await waitFor(() => expect(t.posted).toHaveLength(1));
    expect(t.posted[0]).toMatchObject({
      changes: [{ target: 'variable', key: LEVER, member: '', value: ghostD }],
    });
  });

  it('estimate kind gives the estimate slider', async () => {
    const t = await setup();
    render(<BoundSlider variable={ESTIMATE} />, { wrapper: t.wrapper });
    await t.settle();
    const slider = await screen.findByRole('slider', { name: bundleVar(ESTIMATE).label });
    expect(slider.closest('[data-variant]')?.getAttribute('data-variant')).toBe('estimate');
  });

  it('a value above the registry max is clamped on the track only, never rewritten', async () => {
    const t = await setup();
    render(<BoundSlider variable={LEVER} />, { wrapper: t.wrapper });
    await t.settle();
    const def = bundleVar(LEVER);
    const above = (def.max as number) * 2;
    await t.mock.replay([delta({ [`${LEVER}[]`]: above })]);
    await t.settle();
    const slider = await screen.findByRole('slider', { name: def.label });
    expect(slider).toHaveProperty('value', String(def.max));
    fireEvent.blur(slider);
    await t.settle();
    expect(t.posted).toEqual([]);
    expect(t.mock.sentOf('preview')).toEqual([]);
  });

  it('<Value> and <BoundEditable node> show the pushed output and open the trace', async () => {
    const onTrace = vi.fn();
    const t = await setup({ onTrace });
    render(
      <>
        <Value node={OUTPUT} format="money" />
        <BoundEditable node={OUTPUT} format="money" />
      </>,
      { wrapper: t.wrapper },
    );
    await t.settle();
    const shown = fmt.money(C.cells[`${OUTPUT}[]`] as number);
    const buttons = await screen.findAllByRole('button', { name: shown });
    expect(buttons).toHaveLength(2);
    expect(buttons[0]!.getAttribute('data-id')).toBe(OUTPUT);
    fireEvent.click(buttons[0]!);
    expect(onTrace).toHaveBeenCalledWith(`${OUTPUT}[]`);
  });

  it('<Value> without a trace handler is a rolled number', async () => {
    const t = await setup();
    const { container } = render(<Value node={OUTPUT} format="money" />, { wrapper: t.wrapper });
    await t.settle();
    const el = container.querySelector('.gp-value')!;
    expect(el.textContent).toBe(fmt.money(C.cells[`${OUTPUT}[]`] as number));
    expect(el.getAttribute('data-value')).toBe(String(C.cells[`${OUTPUT}[]`]));
  });

  it('<BoundEditable variable> opens the edit popover with the bundle definition', async () => {
    const t = await setup();
    render(<BoundEditable variable={LEVER} />, { wrapper: t.wrapper });
    await t.settle();
    const def = bundleVar(LEVER);
    const button = await waitFor(() => {
      const b = document.querySelector(`[data-id="${LEVER}"]`);
      if (!b || !b.getAttribute('aria-haspopup')) throw new Error('not ready');
      return b as HTMLElement;
    });
    expect(button.getAttribute('data-changed')).toBe('true');
    fireEvent.click(button);
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain(def.label);
    expect(dialog.textContent).toContain(def.source);
  });
});

describe('AC4: useView', () => {
  it('useView(view, params) for ADR-021 views', async () => {
    const t = await setup();
    const seen: { current: ReturnType<typeof useView<'baseline.groups'>> | null } = {
      current: null,
    };
    const Probe = () => {
      seen.current = useView('baseline.groups', { by: 'pool' }); // inline params on purpose
      return null;
    };
    const view = render(<Probe />, { wrapper: t.wrapper });
    expect(seen.current?.isLoading).toBe(true);
    await t.settle();
    await t.settle();
    expect(seen.current?.payload).toEqual(viewMessageFixtures['baseline.groups'].payload);
    expect(seen.current?.isLoading).toBe(false);
    view.rerender(<Probe />);
    await t.settle();
    expect(t.mock.sentOf('subscribeView')).toEqual([
      expect.objectContaining({ view: 'baseline.groups', params: { by: 'pool' } }),
    ]);

    // A new payload from tier 2 re-renders; unmount unsubscribes.
    const payload = { ...viewMessageFixtures['baseline.groups'].payload, total: 1 };
    await t.mock.replay([{ ...viewMessageFixtures['baseline.groups'], payload }]);
    await t.settle();
    expect(seen.current?.payload).toEqual(payload);
    view.unmount();
    await t.settle();
    expect(t.mock.sentOf('unsubscribeView')).toEqual([
      expect.objectContaining({ view: 'baseline.groups', params: { by: 'pool' } }),
    ]);
  });
});

describe('useTrace', () => {
  it('useTrace(cell) answers GET /nodes/:cell/explain and refetches on a new version', async () => {
    const t = await setup();
    let got: ReturnType<typeof useTrace> | null = null;
    const Probe = () => {
      got = useTrace(`${OUTPUT}[]`);
      return null;
    };
    render(<Probe />, { wrapper: t.wrapper });
    await waitFor(() =>
      expect(got!.data?.words).toBe(coreRouteFixtures.nodeExplain.response.words),
    );
    expect(t.hits.get(`explain:${OUTPUT}[]`)).toBe(1);

    await t.mock.replay([
      {
        v: WS_PROTOCOL_VERSION,
        type: 'changeset',
        scenarioId: C.scenarioId,
        version: C.version + 1,
        editsCount: 1,
      },
    ]);
    await t.settle();
    expect(t.session.store.getState().version).toBe(C.version + 1);
    await waitFor(() => expect(t.hits.get(`explain:${OUTPUT}[]`)).toBe(2));
  });
});
