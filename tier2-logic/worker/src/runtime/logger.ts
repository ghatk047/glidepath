/** Minimal structured logger port; the entry wires JSON lines to stdout. Never log payload values or URLs. */
export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

const ORDER = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof ORDER;

export function jsonLogger(level: Level = 'info', write: (line: string) => void = (l) => process.stdout.write(l + '\n')): Logger {
  const emit =
    (lvl: Level) =>
    (msg: string, fields: Record<string, unknown> = {}): void => {
      if (ORDER[lvl] < ORDER[level]) return;
      write(JSON.stringify({ level: lvl, time: new Date().toISOString(), svc: 'worker', msg, ...fields }));
    };
  return { debug: emit('debug'), info: emit('info'), warn: emit('warn'), error: emit('error') };
}

export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
