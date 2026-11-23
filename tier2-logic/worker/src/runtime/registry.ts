import { isQueueName } from './types';
import type { JobHandler, JobPayload, QueueSettings } from './types';

export interface Registration {
  readonly queue: string;
  readonly handler: JobHandler<never>;
  readonly settings: QueueSettings;
}

/** Handlers by queue name. Job modules register theirs at import time; the runtime reads them at start. */
export class HandlerRegistry {
  private readonly byQueue = new Map<string, Registration>();

  /** `registerHandler(queue, fn)`. One handler per queue; the name must be `solver.*`, `excel.*` or `ai.*`. */
  registerHandler<P extends JobPayload = JobPayload>(queue: string, fn: JobHandler<P>, settings: QueueSettings = {}): void {
    if (!isQueueName(queue)) throw new Error(`worker: cannot register '${queue}': queue names are solver.*, excel.* or ai.*`);
    if (typeof fn !== 'function') throw new TypeError(`worker: handler for '${queue}' is not a function`);
    if (this.byQueue.has(queue)) throw new Error(`worker: a handler for '${queue}' is already registered`);
    if (settings.retryLimit !== undefined && (!Number.isInteger(settings.retryLimit) || settings.retryLimit < 0)) {
      throw new Error(`worker: retryLimit of '${queue}' must be a non-negative integer`);
    }
    if (settings.expireInSeconds !== undefined && (!Number.isInteger(settings.expireInSeconds) || settings.expireInSeconds < 1)) {
      throw new Error(`worker: expireInSeconds of '${queue}' must be a positive integer`);
    }
    this.byQueue.set(queue, { queue, handler: fn as unknown as JobHandler<never>, settings });
  }

  get(queue: string): Registration | undefined {
    return this.byQueue.get(queue);
  }

  queues(): string[] {
    return [...this.byQueue.keys()].sort();
  }

  registrations(): Registration[] {
    return this.queues().map((q) => this.byQueue.get(q)!);
  }
}

/** The process-wide registry that `registerHandler` fills and `startWorker` consumes by default. */
export const defaultRegistry = new HandlerRegistry();

/** Registers `fn` as the handler of `queue` in the process-wide registry (JOB-01 contract). */
export function registerHandler<P extends JobPayload = JobPayload>(queue: string, fn: JobHandler<P>, settings?: QueueSettings): void {
  defaultRegistry.registerHandler(queue, fn, settings);
}
