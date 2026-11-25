import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { isoCBOR } from '@simplewebauthn/server/helpers';

/**
 * A software WebAuthn authenticator plus the browser's part of a ceremony (the equivalent of a CDP /
 * WebDriver virtual authenticator, for tests without a browser). It makes ES256 (P-256) discoverable
 * credentials with "none" attestation, signs assertions over `authenticatorData || SHA-256(clientDataJSON)`
 * and keeps a signature counter per credential. `create` / `get` take the server's options JSON and
 * answer with the JSON the SPA would post back.
 *
 * Overrides let a test play a misbehaving or hostile party: another origin (a phishing page), another
 * RP id, a different challenge, no user verification.
 */

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_AT = 0x40;
const COSE_KTY_EC2 = 2;
const COSE_ALG_ES256 = -7;
const COSE_CRV_P256 = 1;
const AAGUID_BYTES = 16;

export interface VirtualCredential {
  readonly id: string;
  readonly rpId: string;
  readonly userHandle: string;
  readonly privateKey: KeyObject;
  counter: number;
}

export interface CeremonyOverrides {
  /** The page's origin as the browser reports it in clientDataJSON. */
  origin?: string;
  /** The RP id the authenticator hashes into authenticatorData (default: the options' rp id). */
  rpId?: string;
  /** Replaces the challenge in clientDataJSON. */
  challenge?: string;
  /** false: the authenticator reports no user verification. */
  userVerified?: boolean;
  /** Use this credential instead of looking one up by RP id. */
  credentialId?: string;
}

const sha256 = (b: Uint8Array | string): Buffer => createHash('sha256').update(b).digest();
const b64u = (b: Uint8Array): string => Buffer.from(b).toString('base64url');

function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
}

function clientData(type: string, challenge: string, origin: string): Buffer {
  return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }), 'utf8');
}

export class VirtualAuthenticator {
  readonly credentials = new Map<string, VirtualCredential>();

  /**
   * @param origin the page's origin (PUBLIC_BASE_URL in the tests)
   * @param opts.counter false: the signature counter stays 0, as with synced passkeys
   */
  constructor(
    private readonly origin: string,
    private readonly opts: { counter?: boolean } = {},
  ) {}

  /** navigator.credentials.create: a new credential for `options.rp.id` and `options.user.id`. */
  create(
    options: PublicKeyCredentialCreationOptionsJSON,
    o: CeremonyOverrides = {},
  ): RegistrationResponseJSON {
    const rpId = o.rpId ?? options.rp.id ?? new URL(this.origin).hostname;
    for (const ex of options.excludeCredentials ?? []) {
      if (this.credentials.has(ex.id)) throw new Error('InvalidStateError: credential excluded');
    }
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' });
    const cose = isoCBOR.encode(
      new Map<number, number | Uint8Array>([
        [1, COSE_KTY_EC2],
        [3, COSE_ALG_ES256],
        [-1, COSE_CRV_P256],
        [-2, new Uint8Array(Buffer.from(jwk.x ?? '', 'base64url'))],
        [-3, new Uint8Array(Buffer.from(jwk.y ?? '', 'base64url'))],
      ]),
    );
    const credId = randomBytes(32);
    const id = b64u(credId);
    const counter = 0;
    const flags = FLAG_UP | FLAG_AT | (o.userVerified === false ? 0 : FLAG_UV);
    const lenBuf = Buffer.alloc(2);
    lenBuf.writeUInt16BE(credId.length);
    const authData = Buffer.concat([
      sha256(rpId),
      Buffer.from([flags]),
      u32(counter),
      Buffer.alloc(AAGUID_BYTES),
      lenBuf,
      credId,
      Buffer.from(cose),
    ]);
    const attestationObject = isoCBOR.encode(
      new Map<string, string | Uint8Array | Map<string, string>>([
        ['fmt', 'none'],
        ['attStmt', new Map<string, string>()],
        ['authData', new Uint8Array(authData)],
      ]),
    );
    this.credentials.set(id, { id, rpId, userHandle: options.user.id, privateKey, counter });
    return {
      id,
      rawId: id,
      type: 'public-key',
      authenticatorAttachment: 'platform',
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64u(
          clientData('webauthn.create', o.challenge ?? options.challenge, o.origin ?? this.origin),
        ),
        attestationObject: b64u(attestationObject),
        transports: ['internal', 'hybrid'],
      },
    };
  }

  /** navigator.credentials.get: an assertion by a discoverable credential for the options' RP id. */
  get(
    options: PublicKeyCredentialRequestOptionsJSON,
    o: CeremonyOverrides = {},
  ): AuthenticationResponseJSON {
    const rpId = o.rpId ?? options.rpId ?? new URL(this.origin).hostname;
    const cred = o.credentialId
      ? this.credentials.get(o.credentialId)
      : [...this.credentials.values()].find((x) => x.rpId === rpId);
    if (!cred) throw new Error(`NotAllowedError: no credential for ${rpId}`);
    if (this.opts.counter !== false) cred.counter += 1;
    const flags = FLAG_UP | (o.userVerified === false ? 0 : FLAG_UV);
    const authData = Buffer.concat([sha256(rpId), Buffer.from([flags]), u32(cred.counter)]);
    const cdj = clientData(
      'webauthn.get',
      o.challenge ?? options.challenge,
      o.origin ?? this.origin,
    );
    const signature = sign('sha256', Buffer.concat([authData, sha256(cdj)]), cred.privateKey);
    return {
      id: cred.id,
      rawId: cred.id,
      type: 'public-key',
      authenticatorAttachment: 'platform',
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64u(cdj),
        authenticatorData: b64u(authData),
        signature: b64u(signature),
        userHandle: cred.userHandle,
      },
    };
  }
}
