import { parseServerMessage } from '@glidepath/api-contract';
import type { ServerMessage } from '@glidepath/api-contract';
import { WebSocket } from 'ws';

/**
 * A WebSocket client for session tests: every server frame is checked with the contract's
 * `parseServerMessage` (a frame that fails it fails the test), and frames are read in order.
 */

type Of<T extends ServerMessage['type']> = Extract<ServerMessage, { type: T }>;

export const DEFAULT_WAIT_MS = 10_000;

export class TestSocket {
  /** Every frame received, in order. */
  readonly received: ServerMessage[] = [];
  private readonly queue: ServerMessage[] = [];
  private waiter: { resolve: () => void; reject: (e: Error) => void } | null = null;
  private failure: Error | null = null;
  private closedWith: number | null = null;

  constructor(readonly ws: WebSocket) {
    ws.on('message', (data) => {
      const parsed = parseServerMessage(data.toString());
      if (!parsed.ok) this.fail(new Error(`server frame breaks the contract: ${parsed.detail}`));
      else {
        this.received.push(parsed.message);
        this.queue.push(parsed.message);
      }
      this.wake();
    });
    ws.on('close', (code) => {
      this.closedWith = code;
      this.wake();
    });
  }

  get closeCode(): number | null {
    return this.closedWith;
  }

  send(frame: object | string): void {
    this.ws.send(typeof frame === 'string' ? frame : JSON.stringify(frame));
  }

  /** The next frame (in arrival order). */
  async next(timeoutMs = DEFAULT_WAIT_MS): Promise<ServerMessage> {
    for (;;) {
      if (this.failure) throw this.failure;
      const m = this.queue.shift();
      if (m) return m;
      if (this.closedWith !== null) throw new Error(`socket closed (${this.closedWith}) while waiting for a frame`);
      await this.wait(timeoutMs);
    }
  }

  /** The next frame, which must be of `type`. */
  async expect<T extends ServerMessage['type']>(type: T, timeoutMs = DEFAULT_WAIT_MS): Promise<Of<T>> {
    const m = await this.next(timeoutMs);
    if (m.type !== type) throw new Error(`expected ${type}, got ${JSON.stringify(m)}`);
    return m as Of<T>;
  }

  /** Frames up to and including the first that `done` accepts. */
  async until(done: (m: ServerMessage) => boolean, timeoutMs = DEFAULT_WAIT_MS): Promise<ServerMessage[]> {
    const out: ServerMessage[] = [];
    for (;;) {
      const m = await this.next(timeoutMs);
      out.push(m);
      if (done(m)) return out;
    }
  }

  close(): Promise<void> {
    if (this.ws.readyState === WebSocket.CLOSED) return Promise.resolve();
    return new Promise((resolve) => {
      this.ws.once('close', () => resolve());
      this.ws.close();
    });
  }

  private fail(e: Error): void {
    this.failure ??= e;
  }

  private wake(): void {
    const w = this.waiter;
    this.waiter = null;
    w?.resolve();
  }

  private wait(timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = null;
        reject(new Error(`no frame within ${timeoutMs} ms`));
      }, timeoutMs);
      this.waiter = {
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject,
      };
    });
  }
}

/** A refused handshake: the plain HTTP answer (problem JSON). */
export interface Refused {
  readonly ok: false;
  readonly status: number;
  readonly contentType: string | undefined;
  readonly body: string;
}

export type Opened = { readonly ok: true; readonly socket: TestSocket };

/** Opens `url` with the given request headers; resolves with the socket or the refusal. */
export function openSocket(url: string, headers: Record<string, string>): Promise<Opened | Refused> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers });
    // Frames can follow the 101 at once: listen before `open` resolves.
    const socket = new TestSocket(ws);
    ws.once('unexpected-response', (req, res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (body += chunk));
      res.on('end', () => {
        req.destroy();
        resolve({ ok: false, status: res.statusCode ?? 0, contentType: res.headers['content-type'], body });
      });
    });
    ws.once('open', () => resolve({ ok: true, socket }));
    ws.on('error', reject); // after the outcome a late error is moot (reject is then a no-op)
  });
}
