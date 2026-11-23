import { createTransport } from 'nodemailer';

/**
 * Outgoing mail for magic links (ADR-014). Locally SMTP_URL points at the mailpit container, so
 * sign-in works with no internet; on a host with a mail server, SMTP_URL points there
 * (`smtps://user:pass@host:465`, or `smtp://` with STARTTLS when the server offers it).
 */

export interface MagicLinkMail {
  readonly to: string;
  readonly link: string;
  readonly ttlMin: number;
}

export interface Mailer {
  sendMagicLink(mail: MagicLinkMail): Promise<void>;
  close(): void;
}

/** A dead mail server must not hold a sign-in request open for nodemailer's default minutes. */
const SMTP_TIMEOUT_MS = 10_000;

/** Subject and plain-text body of the sign-in mail. The link is the only secret in it. */
export function magicLinkMessage(mail: MagicLinkMail): { subject: string; text: string } {
  const minutes = mail.ttlMin === 1 ? '1 minute' : `${mail.ttlMin} minutes`;
  return {
    subject: 'Your Glidepath sign-in link',
    text: [
      'Open this link to sign in to Glidepath:',
      '',
      mail.link,
      '',
      `The link works once and expires in ${minutes}.`,
      'If you did not ask to sign in, ignore this e-mail.',
      '',
    ].join('\n'),
  };
}

/** Sender address: no-reply at the host users open the app on. */
export function senderFor(publicOrigin: string | null): string {
  const host = publicOrigin ? new URL(publicOrigin).hostname : 'localhost';
  return `Glidepath <no-reply@${host}>`;
}

/** Mailer over SMTP_URL (nodemailer). Attachments from files or URLs are disabled. */
export function smtpMailer(smtpUrl: string, from: string): Mailer {
  const transport = createTransport({
    url: smtpUrl,
    connectionTimeout: SMTP_TIMEOUT_MS,
    greetingTimeout: SMTP_TIMEOUT_MS,
    socketTimeout: SMTP_TIMEOUT_MS,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  return {
    async sendMagicLink(mail) {
      const { subject, text } = magicLinkMessage(mail);
      await transport.sendMail({ from, to: mail.to, subject, text });
    },
    close() {
      transport.close();
    },
  };
}
