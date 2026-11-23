// JOB-04: demo cache warmer. `pnpm warm --tenant aa` (cli.ts); `migrate` runs it when WARM=1.
export { warmTenant, WARM_JOBS } from './warm';
export type { WarmEntry, WarmJob, WarmOptions, WarmReport, WarmStatus } from './warm';
export { parseWarmArgs } from './args';
export { cacheKeyOf, paramsHash, storedKey, withCacheKey } from './cache-key';
export type { CacheKey } from './cache-key';
