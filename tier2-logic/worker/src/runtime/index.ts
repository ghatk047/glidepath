/**
 * Worker runtime (JOB-01): pg-boss consumers for `solver.*`, `excel.*` and `ai.*` queues.
 * Handler modules call `registerHandler(queue, fn)`; `startWorker()` consumes what is registered.
 */
export { registerHandler, defaultRegistry, HandlerRegistry } from './registry';
export type { Registration } from './registry';
export { WorkerRuntime, startWorker } from './runtime';
export type { WorkerRuntimeOptions } from './runtime';
export { installQueueSchema } from './install';
export type { InstallQueueSchemaOptions } from './install';
export { enqueueJob } from './enqueue';
export { installShutdownHandlers } from './signals';
export type { SignalSource } from './signals';
export { runJob, parsePayload, JobPayloadError, JobCancelledError, WorkerStoppingError } from './run-job';
export { ProgressThrottle } from './progress';
export type { ProgressUpdate } from './progress';
export { workerConfigFromEnv, defaultConcurrency, PROGRESS_INTERVAL_MS, JOBS_PER_VCPU } from './config';
export type { WorkerConfig } from './config';
export { jsonLogger, silentLogger } from './logger';
export type { Logger } from './logger';
export { systemClock } from './clock';
export type { Clock } from './clock';
export { QUEUE_FAMILIES, isQueueName, queueFamily } from './types';
export type { JobContext, JobHandler, JobPayload, QueueFamily, QueueSettings } from './types';
