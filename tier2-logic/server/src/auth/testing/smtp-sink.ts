import { createServer } from 'node:net';
import type { AddressInfo, Socket } from 'node:net';

/**
 * Test support: a local SMTP sink on 127.0.0.1 (the in-process stand-in for mailpit). It speaks just
 * enough SMTP for nodemailer (EHLO, MAIL, RCPT, DATA, RSET, NOOP, QUIT, no STARTTLS) and keeps every
 * message. `failNext()` makes the next DATA fail with a 554, to test delivery errors.
 */

export interface SunkMail {
  from: string;
  to: string[];
  /** The raw message (headers and body), dot-unstuffed. */
  raw: string;
  /** Decoded plain-text body (7bit / quoted-printable / base64). */
  text: string;
  headers: Record<string, string>;
}

export interface SmtpSink {
  /** `smtp://127.0.0.1:<port>`: use as SMTP_URL. */
  url: string;
  port: number;
  messages: SunkMail[];
  /** Waits for a message to `to` beyond the first `after` messages to that address. */
  waitFor(to: string, opts?: { after?: number; timeoutMs?: number }): Promise<SunkMail>;
  /** Messages delivered to `to` so far. */
  countTo(to: string): number;
  failNext(): void;
  close(): Promise<void>;
}

function parseHeaders(head: string): Record<string, string> {
  const out: Record<string, string> = {};
  const unfolded = head.replace(/\r\n[ \t]+/g, ' ');
  for (const line of unfolded.split('\r\n')) {
    const i = line.indexOf(':');
    if (i > 0) out[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return out;
}

function decodeQuotedPrintable(body: string): string {
  const bytes = body
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
  return Buffer.from(bytes, 'latin1').toString('utf8');
}

export function decodeMessage(raw: string): { headers: Record<string, string>; text: string } {
  const split = raw.indexOf('\r\n\r\n');
  const headers = parseHeaders(split < 0 ? raw : raw.slice(0, split));
  const body = split < 0 ? '' : raw.slice(split + 4);
  const cte = (headers['content-transfer-encoding'] ?? '7bit').toLowerCase();
  const text =
    cte === 'quoted-printable'
      ? decodeQuotedPrintable(body)
      : cte === 'base64'
        ? Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8')
        : body;
  return { headers, text };
}

const address = (arg: string): string => (/<([^>]*)>/.exec(arg)?.[1] ?? arg).trim();

export async function startSmtpSink(): Promise<SmtpSink> {
  const messages: SunkMail[] = [];
  const waiters: (() => void)[] = [];
  const sockets = new Set<Socket>();
  let failNext = false;

  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    socket.setEncoding('latin1');
    let buffer = '';
    let inData = false;
    let data: string[] = [];
    let from = '';
    let to: string[] = [];
    const reply = (line: string) => socket.write(`${line}\r\n`);
    reply('220 sink.test ESMTP test sink');

    socket.on('data', (chunk: string) => {
      buffer += chunk;
      let nl: number;
      while ((nl = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            if (failNext) {
              failNext = false;
              reply('554 5.0.0 rejected by test sink');
            } else {
              const raw = data.join('\r\n');
              const decoded = decodeMessage(Buffer.from(raw, 'latin1').toString('utf8'));
              messages.push({ from, to, raw, ...decoded });
              reply('250 2.0.0 queued');
              for (const w of waiters.splice(0)) w();
            }
            data = [];
            from = '';
            to = [];
          } else {
            data.push(line.startsWith('..') ? line.slice(1) : line);
          }
          continue;
        }
        const [verb = '', ...rest] = line.split(' ');
        const arg = rest.join(' ');
        switch (verb.toUpperCase()) {
          case 'EHLO':
            socket.write('250-sink.test\r\n250-8BITMIME\r\n250 SMTPUTF8\r\n');
            break;
          case 'HELO':
            reply('250 sink.test');
            break;
          case 'MAIL':
            from = address(arg.replace(/^FROM:/i, '').split(' ')[0] ?? '');
            reply('250 2.1.0 ok');
            break;
          case 'RCPT':
            to.push(address(arg.replace(/^TO:/i, '')));
            reply('250 2.1.5 ok');
            break;
          case 'DATA':
            inData = true;
            reply('354 end with <CRLF>.<CRLF>');
            break;
          case 'RSET':
            from = '';
            to = [];
            reply('250 ok');
            break;
          case 'NOOP':
            reply('250 ok');
            break;
          case 'QUIT':
            reply('221 bye');
            socket.end();
            break;
          default:
            reply('502 5.5.2 not implemented');
        }
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  const toAddr = (m: SunkMail, addr: string) =>
    m.to.some((t) => t.toLowerCase() === addr.toLowerCase());

  return {
    url: `smtp://127.0.0.1:${port}`,
    port,
    messages,
    countTo: (addr) => messages.filter((m) => toAddr(m, addr)).length,
    waitFor(addr, opts = {}) {
      const after = opts.after ?? 0;
      const timeoutMs = opts.timeoutMs ?? 5_000;
      return new Promise((resolve, reject) => {
        const check = (): boolean => {
          const hit = messages.filter((m) => toAddr(m, addr))[after];
          if (hit) resolve(hit);
          return hit !== undefined;
        };
        if (check()) return;
        const timer = setTimeout(
          () => reject(new Error(`no mail to ${addr} within ${timeoutMs} ms`)),
          timeoutMs,
        );
        const wait = () => {
          if (check()) clearTimeout(timer);
          else waiters.push(wait);
        };
        waiters.push(wait);
      });
    },
    failNext() {
      failNext = true;
    },
    close() {
      for (const s of sockets) s.destroy();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}
