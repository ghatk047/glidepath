import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SignJWT, exportJWK, exportSPKI, generateKeyPair } from 'jose';
import type { CryptoKey, JWTPayload } from 'jose';

/**
 * A stand-in for Cloudflare Access in tests (OPS-09): an RSA key pair generated here, a local HTTP server that
 * answers like `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs` (`{ keys: [jwk], public_cert,
 * public_certs: [...] }`, the Cloudflare format; the `cert` fields carry the SPKI PEM, which the verifier does not
 * read), and a signer for Access-style JWTs. No real Cloudflare is ever contacted.
 */

export const TEAM_DOMAIN = 'icy-recipe-ffdf.cloudflareaccess.com';
export const TEAM_ORIGIN = `https://${TEAM_DOMAIN}`;
/** A made-up AUD tag (64 hex in real life; any string works). */
export const AUD = 'test-aud-0f3c9a1b';

interface Key {
  readonly kid: string;
  readonly privateKey: CryptoKey;
  readonly jwk: Record<string, unknown>;
  readonly pem: string;
}

async function newKey(kid: string): Promise<Key> {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
  const jwk = { ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' };
  return { kid, privateKey, jwk, pem: await exportSPKI(publicKey) };
}

export interface SignOptions {
  /** Claims to merge over the defaults (email, iss, aud, iat, nbf, exp). `undefined` removes one. */
  claims?: Record<string, unknown>;
  /** Sign with a key the certs endpoint does not publish (same kid unless `kid` is given). */
  foreignKey?: boolean;
  kid?: string;
  /** Seconds from now. */
  expiresIn?: number;
  notBefore?: number;
}

export interface FakeAccess {
  /** The certs URL to hand the verifier (`http://127.0.0.1:<port>/cdn-cgi/access/certs`). */
  readonly certsUrl: string;
  /** Requests the certs endpoint has answered. */
  fetches(): number;
  sign(email: string | undefined, opts?: SignOptions): Promise<string>;
  /** Env for loadConfig. */
  env(extra?: Record<string, string>): Record<string, string>;
  close(): Promise<void>;
}

const HOUR = 3_600;

export async function startFakeAccess(): Promise<FakeAccess> {
  const key = await newKey('kid-current');
  const foreign = await newKey('kid-current');
  let count = 0;
  const server = createServer((req, res) => {
    if (req.url !== '/cdn-cgi/access/certs') {
      res.writeHead(404).end();
      return;
    }
    count += 1;
    const cert = { kid: key.kid, cert: key.pem };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ keys: [key.jwk], public_cert: cert, public_certs: [cert] }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    certsUrl: `http://127.0.0.1:${port}/cdn-cgi/access/certs`,
    fetches: () => count,
    async sign(email, opts = {}) {
      const now = Math.floor(Date.now() / 1000);
      const claims: Record<string, unknown> = {
        email,
        iss: TEAM_ORIGIN,
        aud: [AUD],
        sub: 'access-user',
        type: 'app',
        iat: now,
        nbf: now + (opts.notBefore ?? 0),
        exp: now + (opts.expiresIn ?? HOUR),
        ...opts.claims,
      };
      for (const k of Object.keys(claims)) if (claims[k] === undefined) delete claims[k];
      const k = opts.foreignKey ? foreign : key;
      return new SignJWT(claims as JWTPayload)
        .setProtectedHeader({ alg: 'RS256', kid: opts.kid ?? k.kid, typ: 'JWT' })
        .sign(k.privateKey);
    },
    env: (extra = {}) => ({ CF_ACCESS_TEAM_DOMAIN: TEAM_DOMAIN, CF_ACCESS_AUD: AUD, ...extra }),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
