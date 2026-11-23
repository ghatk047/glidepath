import type { Logger } from './logger';

/** The part of `process` the shutdown wiring uses (injectable for tests). */
export interface SignalSource {
  on(signal: 'SIGTERM' | 'SIGINT', listener: () => void): unknown;
  off(signal: 'SIGTERM' | 'SIGINT', listener: () => void): unknown;
}

/**
 * SIGTERM / SIGINT start one graceful `stop()` (drain in-flight jobs, close pg-boss and the pool), then
 * call `onStopped(exitCode)`. A second signal does not start a second stop. Returns the function that
 * removes the listeners.
 */
export function installShutdownHandlers(
  runtime: { stop(): Promise<void> },
  onStopped: (exitCode: number) => void,
  source: SignalSource = process,
  logger?: Logger,
): () => void {
  let started = false;
  const handler = (): void => {
    if (started) return;
    started = true;
    runtime.stop().then(
      () => onStopped(0),
      (err: unknown) => {
        logger?.error('shutdown failed', { error: err instanceof Error ? err.message : String(err) });
        onStopped(1);
      },
    );
  };
  source.on('SIGTERM', handler);
  source.on('SIGINT', handler);
  return () => {
    source.off('SIGTERM', handler);
    source.off('SIGINT', handler);
  };
}
