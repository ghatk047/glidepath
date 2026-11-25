import { parseServerMessage } from '@glidepath/api-contract';
import type { ClientMessage, ServerMessage } from '@glidepath/api-contract';
import { WebSocket } from 'ws';

/**
 * A what-if session socket for integration specs. Every server frame must pass the contract's
 * `parseServerMessage` (a frame that does not fails the next read); frames are read in order.
 */

type Of<T extends ServerMessage['type']> = Extract<ServerMessage, { type: T }>;

export const FRAME_WAIT_MS = 15_000;

export class SessionSocket {
  /** Every frame received, in order. */
  readonly received: ServerMessage[] = [];
  private readonly queue: ServerMessage[] = [];
  private failure: Error | null = null;
  private closedWith: number | null = null;
  private wake: (() => void) | null = null;

  constructor(private readonly ws: WebSocket) {
    ws.on('message', (data) => {
      const parsed = parseServerMessage(data.toString());
      if (!parsed.ok) this.failure ??= new Error(`server frame breaks the contract: ${parsed.detail}`);
      else {
        this.received.push(parsed.message);
        this.queue.push(parsed.message);
      }
      this.notify();
    });
    ws.on('close', (code) => {
      this.closedWith = code;
      this.notify();
    });
  }

  send(frame: ClientMessage): void {
    this.ws.send(JSON.stringify(frame));
  }

  /** The next frame in arrival order. */
  async next(timeoutMs = FRAME_WAIT_MS): Promise<ServerMessage> {
    for (;;) {
      if (this.failure) throw this.failure;
      const m = this.queue.shift();
      if (m) return m;
      if (this.closedWith !== null) throw new Error(`socket closed (${this.closedWith}) while waiting for a frame`);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.wake = null;
          reject(new Error(`no frame within ${timeoutMs} ms`));
        }, timeoutMs);
        this.wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    }
  }

  /** The first frame of `type` that `match` accepts; frames before it are skipped (still in `received`). */
  async waitFor<T extends ServerMessage['type']>(
    type: T,
    match: (m: Of<T>) => boolean = () => true,
    timeoutMs = FRAME_WAIT_MS,
  ): Promise<Of<T>> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const m = await this.next(Math.max(1, deadline - Date.now()));
      if (m.type === 'error') throw new Error(`session error: ${JSON.stringify(m)}`);
      if (m.type === type && match(m as Of<T>)) return m as Of<T>;
    }
  }

  close(): Promise<void> {
    if (this.ws.readyState === WebSocket.CLOSED) return Promise.resolve();
    return new Promise((resolve) => {
      this.ws.once('close', () => resolve());
      this.ws.close();
    });
  }

  private notify(): void {
    const w = this.wake;
    this.wake = null;
    w?.();
  }
}

/** Opens `url` with the given handshake headers; rejects with the HTTP answer when the upgrade is refused. */
export function openSession(url: string, headers: Record<string, string>): Promise<SessionSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers });
    // Frames can follow the 101 at once: listen before `open` resolves.
    const socket = new SessionSocket(ws);
    ws.once('unexpected-response', (req, res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (body += chunk));
      res.on('end', () => {
        req.destroy();
        reject(new Error(`WS upgrade refused: ${res.statusCode ?? 0} ${body}`));
      });
    });
    ws.once('open', () => resolve(socket));
    ws.on('error', reject);
  });
}
