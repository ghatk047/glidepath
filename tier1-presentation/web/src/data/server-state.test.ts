import { describe, expect, it } from 'vitest';
import { createServerState } from './server-state';

/** A fetcher whose answers the test resolves by hand. */
function controlled<T>() {
  const calls: { resolve: (v: T) => void; reject: (e: unknown) => void }[] = [];
  const fetcher = () =>
    new Promise<T>((resolve, reject) => {
      calls.push({ resolve, reject });
    });
  return { fetcher, calls };
}
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('server-state layer', () => {
  it('shares one request between concurrent fetches of the same key', async () => {
    const s = createServerState();
    const { fetcher, calls } = controlled<string>();
    const a = s.fetch(['k'], fetcher);
    const b = s.fetch(['k'], fetcher);
    expect(calls).toHaveLength(1);
    expect(s.entry(['k'])?.fetching).toBe(true);
    calls[0]!.resolve('x');
    await Promise.all([a, b]);
    expect(s.entry(['k'])).toMatchObject({ data: 'x', status: 'success', fetching: false });
  });

  it('serves fresh data without a request until the stale time passes', async () => {
    let t = 1_000;
    const s = createServerState({ now: () => t });
    let n = 0;
    const fetcher = () => Promise.resolve(++n);
    await s.fetch(['k'], fetcher, { staleTime: 100 });
    t += 99;
    await s.fetch(['k'], fetcher, { staleTime: 100 });
    expect(n).toBe(1);
    t += 1;
    await s.fetch(['k'], fetcher, { staleTime: 100 });
    expect(n).toBe(2);
    await s.fetch(['k'], fetcher, { staleTime: 100, force: true });
    expect(n).toBe(3);
  });

  it('keeps the last good data when a refetch fails, and never rejects', async () => {
    const s = createServerState();
    await s.fetch(['k'], () => Promise.resolve('good'));
    const boom = new Error('down');
    await s.fetch(['k'], () => Promise.reject(boom), { force: true });
    expect(s.entry(['k'])).toMatchObject({ data: 'good', status: 'error', error: boom });
    await s.fetch(['k'], () => Promise.resolve('again'), { force: true });
    expect(s.entry(['k'])).toMatchObject({ data: 'again', status: 'success', error: null });
  });

  it('keeps the same object when a refetch returns the same JSON', async () => {
    const s = createServerState();
    await s.fetch(['k'], () => Promise.resolve({ a: [1] }));
    const first = s.entry(['k'])?.data;
    await s.fetch(['k'], () => Promise.resolve({ a: [1] }), { force: true });
    expect(s.entry(['k'])?.data).toBe(first);
  });

  it('invalidate refetches observed entries by key prefix, and others on next use', async () => {
    const s = createServerState();
    const counts = { a1: 0, a2: 0, b: 0 };
    const fa1 = () => Promise.resolve(++counts.a1);
    const fa2 = () => Promise.resolve(++counts.a2);
    const fb = () => Promise.resolve(++counts.b);
    await s.fetch(['t', 'a', 'calc'], fa1, { staleTime: 1e9 });
    await s.fetch(['t', 'a', 'inputs'], fa2, { staleTime: 1e9 });
    await s.fetch(['t', 'b', 'calc'], fb, { staleTime: 1e9 });
    const release = s.observe(['t', 'a', 'calc'], fa1, 1e9);

    await s.invalidate(['t', 'a']);

    expect(counts).toEqual({ a1: 2, a2: 1, b: 1 }); // observed refetched now; unobserved only marked
    expect(s.entry(['t', 'a', 'inputs'])?.invalidated).toBe(true);
    expect(s.entry(['t', 'b', 'calc'])?.invalidated).toBe(false);
    await s.fetch(['t', 'a', 'inputs'], fa2, { staleTime: 1e9 }); // next use refetches
    expect(counts.a2).toBe(2);

    release();
    await s.invalidate(['t', 'a', 'calc']);
    expect(counts.a1).toBe(2); // nobody mounted: no request
  });

  it('exact invalidation leaves entries below the key alone', async () => {
    const s = createServerState();
    await s.fetch(['t', 'x'], () => Promise.resolve(1));
    await s.fetch(['t', 'x', 'more'], () => Promise.resolve(2));
    await s.invalidate(['t', 'x'], { exact: true });
    expect(s.entry(['t', 'x'])?.invalidated).toBe(true);
    expect(s.entry(['t', 'x', 'more'])?.invalidated).toBe(false);
  });

  it('an invalidation during a request refetches once it lands (the answer may predate the change)', async () => {
    const s = createServerState();
    const { fetcher, calls } = controlled<string>();
    s.observe(['k'], fetcher, 1e9);
    const first = s.fetch(['k'], fetcher, { staleTime: 1e9 });
    const inval = s.invalidate(['k']);
    expect(calls).toHaveLength(1);
    calls[0]!.resolve('old');
    await tick();
    expect(calls).toHaveLength(2); // the re-run
    expect(s.entry(['k'])).toMatchObject({ data: 'old', invalidated: true });
    calls[1]!.resolve('new');
    await Promise.all([first, inval]);
    expect(s.entry(['k'])).toMatchObject({ data: 'new', invalidated: false });
  });

  it('fetchMore appends a page, and drops it when a refetch replaced the list meanwhile', async () => {
    let t = 0;
    const clocked = createServerState({ now: () => ++t });
    await clocked.fetch(['h'], () => Promise.resolve(['p1']));
    const merge = (cur: string[], page: string[]) => [...cur, ...page];

    await clocked.fetchMore<string[]>(['h'], () => () => Promise.resolve(['p2']), merge);
    expect(clocked.entry(['h'])?.data).toEqual(['p1', 'p2']);

    const { fetcher, calls } = controlled<string[]>();
    const more = clocked.fetchMore<string[]>(['h'], () => fetcher, merge);
    expect(clocked.entry(['h'])?.fetchingMore).toBe(true);
    await clocked.fetch(['h'], () => Promise.resolve(['fresh']), { force: true });
    calls[0]!.resolve(['stale-page']);
    await more;
    expect(clocked.entry(['h'])).toMatchObject({ data: ['fresh'], fetchingMore: false });
  });
});
