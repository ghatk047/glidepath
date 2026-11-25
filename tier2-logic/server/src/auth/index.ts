export { createAuth, authFromConfig } from './auth';
export type { Auth, CreateAuthDeps } from './auth';
export { authSettingsFrom, SESSION_TTL_HOURS } from './settings';
export type { AuthSettings } from './settings';
export { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE, sessionCookieName } from './cookies';
export {
  WRITE_ROLES,
  allowedOrigin,
  isSafeMethod,
  isSameOrigin,
  requireRole,
  tenantWriteGuard,
} from './guard';
export { dbMemberships, loadMe, loadTenants } from './memberships';
export { smtpMailer, senderFor, magicLinkMessage } from './mailer';
export type { Mailer, MagicLinkMail } from './mailer';
export {
  MagicLinkRequest,
  MagicLinkAccepted,
  SIGNED_IN_REDIRECT,
  INVALID_LINK_REDIRECT,
  PasskeyRegisterRequest,
  PasskeyRegistered,
  PasskeyLoginRequest,
  PasskeySignedIn,
} from './routes';
export { PASSKEY_CHALLENGE_TTL_MIN, RP_NAME, MAX_PASSKEY_LABEL } from './passkey';
export { PASSKEY_CHALLENGE_COOKIE, passkeyCookieName } from './cookies';
export { MAX_LIVE_LINKS_PER_ADDRESS } from './service';
export type { ActiveSession } from './service';
export {
  ACCESS_JWT_HEADER,
  ACCESS_CERTS_PATH,
  AccessTokenError,
  accessSettingsFrom,
  createAccessVerifier,
  domainAllowed,
} from './access';
export type { AccessSettings, AccessVerifier } from './access';
