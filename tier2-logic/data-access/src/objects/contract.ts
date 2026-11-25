import { describe, expect, it } from 'vitest';
import { EXPORT_TTL_DAYS, MAX_OBJECT_BYTES, ObjectIntegrityError, ObjectTooLargeError, sha256Hex } from './port';
import type { Bucket, ObjectStore } from './port';

/** Shared contract suite: runs against every ObjectStore adapter (DATA-07). */
export interface ContractHarness {
  /** A store bound to tenant `A` or `B`; both share one backing and the same clock. */
  store(tenant: 'A' | 'B'): ObjectStore;
  /** The test clock every store reads. */
  clock: { now: Date };
  /** Corrupt the stored bytes of an object of tenant A behind the adapter's back. */
  corrupt(bucket: Bucket, key: string): Promise<void>;
}

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);
const DAY = 24 * 60 * 60 * 1000;

export function objectStoreContract(name: string, setup: () => ContractHarness | Promise<ContractHarness>): void {
  describe(`ObjectStore contract: ${name}`, () => {
    let h: ContractHarness;
    const fresh = async (): Promise<ContractHarness> => (h = await setup());

    it('put then get round-trips bytes and metadata; put again replaces', async () => {
      await fresh();
      const s = h.store('A');
      const meta = await s.put('imports', 'a/b.xlsx', bytes('hello'), { contentType: 'text/plain' });
      expect(meta).toMatchObject({ bucket: 'imports', key: 'a/b.xlsx', contentType: 'text/plain', size: 5, expiresAt: null });
      expect(meta.sha256).toBe(sha256Hex(bytes('hello')));
      const got = await s.get('imports', 'a/b.xlsx');
      expect(Buffer.from(got!.bytes).toString()).toBe('hello');
      await s.put('imports', 'a/b.xlsx', bytes('bye'));
      expect(Buffer.from((await s.get('imports', 'a/b.xlsx'))!.bytes).toString()).toBe('bye');
      expect(await s.get('imports', 'missing')).toBeNull();
      expect(await s.stream('imports', 'missing')).toBeNull();
    });

    it('buckets are separate key spaces; list filters by bucket and prefix, ordered by key', async () => {
      await fresh();
      const s = h.store('A');
      await s.put('ai', 'job1/notes.json', bytes('1'));
      await s.put('ai', 'job1/sources.json', bytes('2'));
      await s.put('ai', 'job2/notes.json', bytes('3'));
      await s.put('imports', 'job1/notes.json', bytes('4'));
      expect((await s.list('ai')).map((m) => m.key)).toEqual(['job1/notes.json', 'job1/sources.json', 'job2/notes.json']);
      expect((await s.list('ai', 'job1/')).map((m) => m.key)).toEqual(['job1/notes.json', 'job1/sources.json']);
      expect((await s.list('ai', 'job_')).length).toBe(0);
      expect((await s.list('export-snapshots')).length).toBe(0);
    });

    it('delete removes and reports whether something was there', async () => {
      await fresh();
      const s = h.store('A');
      await s.put('ai', 'k', bytes('x'));
      expect(await s.delete('ai', 'k')).toBe(true);
      expect(await s.delete('ai', 'k')).toBe(false);
      expect(await s.get('ai', 'k')).toBeNull();
    });

    it('tenants are isolated: B sees nothing of A and cannot delete it', async () => {
      await fresh();
      await h.store('A').put('exports', 'k', bytes('secret'));
      const b = h.store('B');
      expect(await b.get('exports', 'k')).toBeNull();
      expect(await b.list('exports')).toEqual([]);
      expect(await b.delete('exports', 'k')).toBe(false);
      expect(await h.store('A').get('exports', 'k')).not.toBeNull();
      await b.put('exports', 'k', bytes('mine'));
      expect(Buffer.from((await h.store('A').get('exports', 'k'))!.bytes).toString()).toBe('secret');
    });

    it('expires_at is honoured: exports expire after 30 days, other buckets do not; expired is invisible and purgeable', async () => {
      await fresh();
      const s = h.store('A');
      const t0 = h.clock.now.getTime();
      const e = await s.put('exports', 'x.xlsx', bytes('x'));
      expect(e.expiresAt?.getTime()).toBe(t0 + EXPORT_TTL_DAYS * DAY);
      expect((await s.put('export-snapshots', 'x.json', bytes('x'))).expiresAt).toBeNull();
      await s.put('ai', 'short', bytes('x'), { expiresAt: new Date(t0 + 1000) });
      h.clock.now = new Date(t0 + 1001);
      expect(await s.get('ai', 'short')).toBeNull();
      expect(await s.get('exports', 'x.xlsx')).not.toBeNull();
      h.clock.now = new Date(t0 + EXPORT_TTL_DAYS * DAY);
      expect(await s.get('exports', 'x.xlsx')).toBeNull();
      expect(await s.stream('exports', 'x.xlsx')).toBeNull();
      expect(await s.list('exports')).toEqual([]);
      expect(await s.get('export-snapshots', 'x.json')).not.toBeNull();
      expect(await s.purgeExpired()).toBe(2);
      expect(await s.purgeExpired()).toBe(0);
    });

    it('objects over 50 MB are rejected, exactly 50 MB is accepted', async () => {
      await fresh();
      const s = h.store('A');
      await expect(s.put('imports', 'big', new Uint8Array(MAX_OBJECT_BYTES + 1))).rejects.toBeInstanceOf(ObjectTooLargeError);
      expect(await s.get('imports', 'big')).toBeNull();
      const ok = await s.put('imports', 'max', new Uint8Array(MAX_OBJECT_BYTES));
      expect(ok.size).toBe(MAX_OBJECT_BYTES);
    }, 60_000);

    it('sha256 is stored and verified on read (get and stream)', async () => {
      await fresh();
      const s = h.store('A');
      await s.put('ai', 'k', bytes('payload'));
      expect((await s.get('ai', 'k'))!.meta.sha256).toBe(sha256Hex(bytes('payload')));
      await h.corrupt('ai', 'k');
      await expect(s.get('ai', 'k')).rejects.toBeInstanceOf(ObjectIntegrityError);
      await expect(s.stream('ai', 'k')).rejects.toBeInstanceOf(ObjectIntegrityError);
    });

    it('no storage URL leaves tier 2: stream API only', async () => {
      await fresh();
      const s = h.store('A');
      const meta = await s.put('exports', 'k', bytes('streamed'));
      const proto = Object.getPrototypeOf(s) as object;
      const methods = Object.getOwnPropertyNames(proto).filter((n) => n !== 'constructor');
      expect(methods.filter((n) => /url|presign|sign|link|href/i.test(n))).toEqual([]);
      expect(JSON.stringify(meta)).not.toMatch(/https?:|s3:|:\/\//i);
      const r = (await s.stream('exports', 'k'))!;
      expect(Object.keys(r).sort()).toEqual(['meta', 'stream']);
      const chunks: Buffer[] = [];
      for await (const c of r.stream) chunks.push(Buffer.from(c as Uint8Array));
      expect(Buffer.concat(chunks).toString()).toBe('streamed');
    });
  });
}
