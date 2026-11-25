import { clientConfig } from '@glidepath/pg-local';
import pg from 'pg';

/**
 * Fictitious users for tests. Names are invented; addresses use the reserved
 * `.test` TLD (RFC 2606) so they can never reach a real mailbox.
 */
export interface FictitiousUser {
  id: string;
  email: string;
  name: string;
  role: 'owner' | 'editor' | 'viewer' | 'advisor';
}

export const FICTITIOUS_EMAIL_DOMAIN = 'example.test';

export const fictitiousUsers: readonly FictitiousUser[] = [
  { id: '00000000-0000-4000-8000-000000000001', email: `owner.one@${FICTITIOUS_EMAIL_DOMAIN}`, name: 'Test Owner One', role: 'owner' },
  { id: '00000000-0000-4000-8000-000000000002', email: `editor.two@${FICTITIOUS_EMAIL_DOMAIN}`, name: 'Test Editor Two', role: 'editor' },
  { id: '00000000-0000-4000-8000-000000000003', email: `viewer.three@${FICTITIOUS_EMAIL_DOMAIN}`, name: 'Test Viewer Three', role: 'viewer' },
  { id: '00000000-0000-4000-8000-000000000004', email: `advisor.four@${FICTITIOUS_EMAIL_DOMAIN}`, name: 'Test Advisor Four', role: 'advisor' },
];

/** Inserts the fictitious users into `app_user` (idempotent). */
export async function insertFictitiousUsers(databaseUrl: string): Promise<void> {
  const c = new pg.Client(clientConfig(databaseUrl));
  await c.connect();
  try {
    for (const u of fictitiousUsers) {
      await c.query('INSERT INTO app_user (id, email, name) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING', [
        u.id,
        u.email,
        u.name,
      ]);
    }
  } finally {
    await c.end();
  }
}
