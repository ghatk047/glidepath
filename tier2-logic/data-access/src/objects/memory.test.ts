import { objectStoreContract } from './contract';
import { MemoryObjectStore } from './memory';

objectStoreContract('memory', () => {
  const clock = { now: new Date('2026-12-01T00:00:00Z') };
  const now = (): Date => clock.now;
  const stores = { A: new MemoryObjectStore(now), B: new MemoryObjectStore(now) };
  return {
    store: (t) => stores[t],
    clock,
    corrupt: async (bucket, key) => stores.A.corruptForTest(bucket, key),
  };
});
