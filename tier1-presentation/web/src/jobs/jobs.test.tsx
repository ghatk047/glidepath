// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  PROBLEM_CONTENT_TYPE,
  createClient,
  type FetchLike,
  type JobKind,
} from '@glidepath/api-contract';
import {
  createMockSession,
  jobRouteFixtures,
  presetSnapshot,
  specFixtures,
} from '@glidepath/api-contract/testing';
import { GlassProvider, GlassPanel } from '@glidepath/ui/glass';
import { createSessionClient } from '../session';
import {
  EmptyState,
  JobHeader,
  JobsProvider,
  solverRunCanceller,
  useJob,
  type JobHandle,
} from './index';

const C = presetSnapshot('C');
const TENANT = specFixtures.tenant;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const mounted: { root: Root; host: HTMLElement }[] = [];
afterEach(() => {
  for (const { root, host } of mounted.splice(0)) {
    act(() => root.unmount());
    host.remove();
  }
});

function mount(node: ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  mounted.push({ root, host });
  act(() => root.render(node));
  return { host, rerender: (n: ReactNode) => act(() => root.render(n)) };
}

const job = (over: Record<string, unknown> = {}) => ({
  v: 1 as const,
  type: 'job' as const,
  id: 'job-1',
  status: 'running' as const,
  progress: 0.4,
  note: 'Searching 1,634 combinations…',
  ...over,
});

/** Session client on the mock session; `push` delivers job messages and applies the frame. */
async function setup() {
  const session = createMockSession();
  const queue: (() => void)[] = [];
  const client = createSessionClient({
    tenant: TENANT,
    scenario: C.scenarioId,
    origin: 'ws://localhost:8080',
    connect: session.connect,
    requestFrame: (cb) => void queue.push(cb),
    random: () => 0,
  });
  const settle = async () => {
    await session.flush();
    act(() => {
      for (const cb of queue.splice(0)) cb();
    });
  };
  await settle();
  const push = async (...messages: ReturnType<typeof job>[]) => {
    await session.replay(messages);
    await settle();
  };
  return { session, client, push };
}

/** `fetch` stand-in: records requests, answers with `status` and body. */
function fakeFetch(status = 200, body: unknown = jobRouteFixtures.solverRunCancel.response) {
  const calls: { url: string; method: string }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, method: init.method });
    const problem = status >= 400;
    return {
      status,
      headers: {
        get: (n: string) =>
          n.toLowerCase() === 'content-type'
            ? problem
              ? PROBLEM_CONTENT_TYPE
              : 'application/json'
            : null,
      },
      text: async () => JSON.stringify(body),
    };
  };
  return { fetch, calls };
}

function cancelFor(fetch: FetchLike) {
  return solverRunCanceller(createClient('http://tier2.test', fetch), TENANT);
}

/** Renders `useJob(id)` and exposes its latest value. */
function probe(
  id: string | null,
  client: Awaited<ReturnType<typeof setup>>['client'],
  cancel?: ReturnType<typeof cancelFor>,
) {
  const seen: { current: JobHandle | null } = { current: null };
  const Probe = ({ jobId }: { jobId: string | null }) => {
    seen.current = useJob(jobId);
    return null;
  };
  const view = mount(
    <JobsProvider session={client} cancel={cancel}>
      <Probe jobId={id} />
    </JobsProvider>,
  );
  return { seen, ...view };
}

const click = (el: Element) => act(() => void (el as HTMLElement).click());
const flushPromises = () => act(async () => void (await Promise.resolve()));

describe('AC1: job messages -> useJob(id) with progress, note and cancel (DELETE)', () => {
  it('follows the job messages of the session client: status, progress, note, kind, on the one socket', async () => {
    const { session, client, push } = await setup();
    const { seen } = probe('job-1', client);
    expect(seen.current).toMatchObject({ status: null, progress: null, note: null, active: false });

    await push(job({ status: 'queued', progress: 0, note: null }));
    expect(seen.current).toMatchObject({ status: 'queued', progress: 0, note: null, active: true });

    await push(job());
    expect(seen.current).toMatchObject({
      status: 'running',
      kind: 'solver',
      progress: 0.4,
      note: 'Searching 1,634 combinations…',
      active: true,
      cancelRequested: false,
    });

    await push(job({ kind: 'import', progress: 0.7 }), job({ id: 'job-2', progress: 0.9 }));
    expect(seen.current).toMatchObject({ kind: 'import', progress: 0.7 });

    await push(job({ status: 'done', progress: 1 }));
    expect(seen.current).toMatchObject({
      status: 'done',
      progress: 1,
      active: false,
      canCancel: false,
    });
    expect(session.connections).toBe(1);
  });

  it('cancel() sends DELETE /solver-runs/:id and shows the request as made until tier 2 reports it', async () => {
    const { client, push } = await setup();
    const api = fakeFetch();
    const { seen } = probe('job-1', client, cancelFor(api.fetch));
    await push(job());
    expect(seen.current!.canCancel).toBe(true);

    await act(async () => {
      await seen.current!.cancel();
    });
    expect(api.calls).toEqual([
      { url: `http://tier2.test/api/t/${TENANT}/solver-runs/job-1`, method: 'DELETE' },
    ]);
    expect(seen.current).toMatchObject({
      cancelRequested: true,
      canCancel: false,
      cancelError: null,
    });

    await push(job({ cancelRequested: true, progress: 0.5 }));
    expect(seen.current).toMatchObject({ cancelRequested: true, progress: 0.5 });
    await push(job({ status: 'cancelled', progress: 0.5 }));
    expect(seen.current).toMatchObject({
      status: 'cancelled',
      cancelRequested: false,
      active: false,
    });
  });

  it('takes cancelRequested from the message (another tab asked) and does not offer a second DELETE', async () => {
    const { client, push } = await setup();
    const api = fakeFetch();
    const { seen } = probe('job-1', client, cancelFor(api.fetch));
    await push(job({ cancelRequested: true }));
    expect(seen.current).toMatchObject({ cancelRequested: true, canCancel: false });
    await act(async () => {
      await seen.current!.cancel();
    });
    expect(api.calls).toEqual([]);
  });

  it("keeps the job running and reports tier 2's one-line cause when the DELETE is refused", async () => {
    const { client, push } = await setup();
    const api = fakeFetch(403, {
      type: '/problems/forbidden',
      title: 'Forbidden',
      status: 403,
      detail: 'Only the user who started this run can cancel it.',
    });
    const { seen } = probe('job-1', client, cancelFor(api.fetch));
    await push(job());
    await act(async () => {
      await seen.current!.cancel();
    });
    expect(seen.current).toMatchObject({
      active: true,
      cancelRequested: false,
      canCancel: true,
      cancelError: 'Only the user who started this run can cancel it.',
    });
  });

  it('offers cancel only where the contract has a route: solver jobs, and only when the app can cancel', async () => {
    const { client, push } = await setup();
    const api = fakeFetch();
    const withCancel = probe('job-1', client, cancelFor(api.fetch));
    const without = probe('job-1', client);
    await push(job());
    expect(withCancel.seen.current!.canCancel).toBe(true);
    expect(without.seen.current!.canCancel).toBe(false);
    await push(job({ kind: 'ai.reconfig' }));
    expect(withCancel.seen.current!.canCancel).toBe(false);
    for (const kind of ['import', 'ai.reconfig'] as JobKind[]) {
      await expect(cancelFor(api.fetch)('job-1', kind)).rejects.toThrow(/No cancel route/);
    }
    expect(api.calls).toEqual([]);
  });

  it('throws a clear error when used outside a JobsProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const Bare = () => {
      useJob('job-1');
      return null;
    };
    expect(() => mount(<Bare />)).toThrow(/JobsProvider/);
    spy.mockRestore();
  });
});

describe('AC2: panel header inline progress + cancel link; the rest of the screen stays usable', () => {
  const screen = (
    client: Awaited<ReturnType<typeof setup>>['client'],
    cancel: ReturnType<typeof cancelFor>,
    other: () => void,
  ) => (
    <GlassProvider frameSampling={false}>
      <JobsProvider session={client} cancel={cancel}>
        <GlassPanel header={{ label: 'Odds', status: <JobHeader id="job-1" /> }}>
          <p>Histogram</p>
        </GlassPanel>
        <button type="button" onClick={other}>
          Other control
        </button>
      </JobsProvider>
    </GlassProvider>
  );

  it("shows tier 2's note, a progress bar and a Cancel link in the header while the job runs", async () => {
    const { client, push } = await setup();
    const api = fakeFetch();
    const { host } = mount(screen(client, cancelFor(api.fetch), () => {}));
    expect(host.querySelector('.gp-job')).toBeNull();

    await push(job());
    const header = host.querySelector('header')!;
    expect(header.textContent).toContain('Odds');
    expect(header.textContent).toContain('Searching 1,634 combinations…');
    const bar = header.querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute('aria-valuenow')).toBe('0.4');
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('1');
    expect(bar.getAttribute('style')).toContain('--gp-job-progress: 0.4');
    const cancel = [...header.querySelectorAll('button')].find((b) => b.textContent === 'Cancel')!;
    expect(cancel).toBeTruthy();

    await push(job({ progress: 0.75, note: 'Searching 1,634 combinations… 1,200 done' }));
    expect(header.textContent).toContain('1,200 done');
    expect(header.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBe(
      '0.75',
    );
  });

  it('Cancel sends DELETE and turns into "Cancelling…"; a finished job leaves the header empty', async () => {
    const { client, push } = await setup();
    const api = fakeFetch();
    const { host } = mount(screen(client, cancelFor(api.fetch), () => {}));
    await push(job());
    click([...host.querySelectorAll('button')].find((b) => b.textContent === 'Cancel')!);
    await flushPromises();
    expect(api.calls.map((c) => c.method)).toEqual(['DELETE']);
    expect(host.querySelector('.gp-job-cancel')).toBeNull();
    expect(host.querySelector('.gp-job-cancelling')!.textContent).toBe('Cancelling…');

    await push(job({ status: 'done', progress: 1 }));
    expect(host.querySelector('.gp-job')).toBeNull();
    expect(host.querySelector('.gp-job-end')).toBeNull();
  });

  it('shows a one-word end state for failed and cancelled jobs', async () => {
    const { client, push } = await setup();
    const { host } = mount(screen(client, cancelFor(fakeFetch().fetch), () => {}));
    await push(job({ status: 'failed', note: 'Solver stopped: no feasible mix.' }));
    expect(host.querySelector('.gp-job-end')!.textContent).toContain(
      'Solver stopped: no feasible mix.',
    );
    await push(job({ status: 'cancelled', note: null }));
    expect(host.querySelector('.gp-job-end')!.textContent).toContain('Cancelled');
  });

  it('leaves the rest of the screen usable: body not busy, nothing inert or hidden, other controls respond', async () => {
    const { client, push } = await setup();
    const other = vi.fn();
    const { host } = mount(screen(client, cancelFor(fakeFetch().fetch), other));
    await push(job());
    const panel = host.querySelector('section')!;
    expect(panel.getAttribute('aria-busy')).toBeNull();
    expect(host.querySelector('.gp-skel')).toBeNull();
    expect(host.querySelector('p')!.textContent).toBe('Histogram');
    for (let el: Element | null = host.querySelector('.gp-job'); el; el = el.parentElement) {
      expect(el.hasAttribute('inert')).toBe(false);
      expect(el.getAttribute('aria-hidden')).not.toBe('true');
      expect(el.getAttribute('aria-modal')).toBeNull();
    }
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    const button = [...host.querySelectorAll('button')].find(
      (b) => b.textContent === 'Other control',
    )!;
    expect(button.disabled).toBe(false);
    click(button);
    expect(other).toHaveBeenCalledTimes(1);
  });
});

describe('AC3: EmptyState is one line and one action', () => {
  it('renders the line and the action, and the action fires once per click', () => {
    const onAction = vi.fn();
    const { host } = mount(
      <EmptyState
        line="This scenario has not been simulated."
        action={{ label: 'Run 2,000 trials', onAction }}
      />,
    );
    const lines = host.querySelectorAll('p');
    const buttons = host.querySelectorAll('button');
    expect(lines).toHaveLength(1);
    expect(lines[0]!.textContent).toBe('This scenario has not been simulated.');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.textContent).toBe('Run 2,000 trials');
    expect(host.querySelectorAll('a, input, select, textarea')).toHaveLength(0);
    click(buttons[0]!);
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('disables the action while its job runs', () => {
    const onAction = vi.fn();
    const { host } = mount(
      <EmptyState line="Not simulated." action={{ label: 'Run', onAction, disabled: true }} />,
    );
    click(host.querySelector('button')!);
    expect(onAction).not.toHaveBeenCalled();
  });
});
